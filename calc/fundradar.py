"""资金雷达产品层确定性计算库(纯函数)。契约依据:《刀2规格-calc函数与skill提示词-v1.0.md》§一。

约定(与 calc/SPEC.md 同风格):
- 所有函数返回 dict:{"status": "ok" | "not_meaningful" | "error", "value": 数或 None, "unit", "reason", "details"};
  绝不抛出业务异常;返回树任何位置都不会出现 inf / NaN(复用 formulas._res 递归守卫)。
- 输出舍入按刀2契约:heat_score 保留 1 位小数;zscore20 的 z 保留 2 位、mu / sigma 保留 3 位;
  pnl 金额保留 2 位、百分比保留 1 位;anomaly_judge 不额外舍入(原样记录)。舍入用 Python round(银行家舍入,半值取偶)。
- 异常域(not_meaningful)与错误域(error)严格按刀2契约;负值照实报告,不做截断。
- 派生数字的运算全部在本模块完成,调用方不得自行换算、不得手写公式。

函数清单:
- heat_score(zt_count, flow_yi, height):主线热度分 = 涨停家数×3 + 资金净流入(亿元)×2 + 最高连板×1。
- zscore20(series):资金流异常 z-score;series = 最近 21 个交易日主力净流入(亿元,含当日,最后一个为当日),
  mu / sigma 用前 20 个元素(总体标准差,除以 20),z = (series[-1] - mu) / sigma。
- pnl(cost, qty, price, prev_close):持仓盈亏;today_pnl = (现价-昨收)×股数,
  cum_pnl = (现价-成本)×股数,cum_pct = (现价/成本-1)×100。金额单位:元。
- anomaly_judge(fund_z, turnover_pctile, vol_z, board_ratio, zhapu_rate, ladder_delta):
  六维异常判定;strong ← |fund_z|≥3 或 board_ratio≥3 或 zhapu_rate≥45;
  normal ← |fund_z|≥2 或 turnover_pctile≥90 或 vol_z≥2.5 或 board_ratio≥2 或 |ladder_delta|≥2;
  均不触发 → none;任一输入 None → 该维度跳过并记入 triggers 为 skipped。
- range_return(closes, n):区间涨跌幅%(近 n 日)= (末值 ÷ 首值 − 1) × 100,保留 2 位小数;
  closes = 按时间升序的收盘价序列(最后一个为最新),首值 = closes[-n]、末值 = closes[-1]。
"""
from __future__ import annotations

import math
from typing import Any

from calc.formulas import CalcInputError, _err, _num, _res

FUNDRADAR_VERSION = "0.1.0"


def _int_nonneg(x: Any, name: str) -> int:
    """非负整数校验:bool / 非 int / 负数 → CalcInputError。"""
    if isinstance(x, bool) or not isinstance(x, int):
        raise CalcInputError(f"{name} 必须是非负整数")
    if x < 0:
        raise CalcInputError(f"{name} 不能为负")
    return x


def _int_qty(x: Any) -> int:
    """qty 校验:整数且 ≥ 0;负数与非整数 → CalcInputError(刀2契约:qty<0 报错)。"""
    if isinstance(x, bool) or not isinstance(x, int):
        raise CalcInputError("qty 必须是整数")
    if x < 0:
        raise CalcInputError("qty 不能为负")
    return x


def _finite(x: float, what: str) -> float:
    if not math.isfinite(x):
        raise CalcInputError(f"{what} 溢出")
    return x


def heat_score(zt_count, flow_yi, height):
    """主线热度分 = 涨停家数×3 + 资金净流入(亿元)×2 + 最高连板×1,保留 1 位小数。

    异常域:任一输入为 None → not_meaningful;负值热度照实报告(不做截断)。
    error:zt_count / height 违反非负整数约束、flow_yi 非数值或非有限、结果溢出。
    """
    try:
        if zt_count is None or flow_yi is None or height is None:
            return _res("not_meaningful", unit="分", reason="任一输入为 None,主线热度分无意义")
        zt = _int_nonneg(zt_count, "zt_count")
        flow = _num(flow_yi, "flow_yi")
        h = _int_nonneg(height, "height")
        zt_term = _finite(zt * 3, "涨停项")
        flow_term = _finite(flow * 2, "资金项")
        height_term = _finite(h * 1, "高度项")
        score = _finite(zt_term + flow_term + height_term, "热度分")
    except CalcInputError as e:
        return _err(str(e))
    return _res("ok", round(score, 1), "分",
                zt_count=zt, flow_yi=flow, height=h,
                zt_term=zt_term, flow_term=flow_term, height_term=height_term,
                score_raw=score)


def zscore20(series):
    """资金流异常 z-score。series = 最近 21 个交易日个股主力净流入(亿元,含当日,最后一个为当日)。

    mu / sigma 用前 20 个元素(总体标准差,除以 20);z = (series[-1] - mu) / sigma。
    输出:value = z(保留 2 位);details.mu / sigma 保留 3 位、n = 序列长度(21)。
    异常域:len < 21 → not_meaningful(基线不足);sigma == 0 → not_meaningful(附原因)。
    error:非列表 / 元素缺失或非数值 / 非有限 / len > 21(超出契约输入域)/ 溢出。
    """
    try:
        if not isinstance(series, (list, tuple)):
            raise CalcInputError("series 必须是最近 21 个交易日的数值列表")
        if len(series) < 21:
            return _res("not_meaningful",
                        reason=f"序列长度 {len(series)} < 21,基线不足 20 个交易日,z-score 无意义")
        if len(series) > 21:
            raise CalcInputError(f"序列长度 {len(series)} > 21,超出契约输入域(应为最近 21 个交易日)")
        vals = [_num(x, f"series[{i}]") for i, x in enumerate(series)]
        baseline = vals[:20]
        mu = _finite(sum(baseline) / 20.0, "mu")
        sigma = _finite(math.sqrt(sum((x - mu) ** 2 for x in baseline) / 20.0), "sigma")
        if sigma == 0:
            return _res("not_meaningful", reason="前 20 个元素标准差为 0(基线无波动),z-score 无意义",
                        mu=round(mu, 3), sigma=round(sigma, 3), n=len(vals))
        z = _finite((vals[-1] - mu) / sigma, "z")
    except CalcInputError as e:
        return _err(str(e))
    return _res("ok", round(z, 2), "", mu=round(mu, 3), sigma=round(sigma, 3), n=len(vals),
                z_raw=z, mu_raw=mu, sigma_raw=sigma, sigma_ddof=0, baseline_window=20)


def pnl(cost, qty, price, prev_close):
    """持仓盈亏(金额单位:元)。

    today_pnl = (price - prev_close) × qty;cum_pnl = (price - cost) × qty;cum_pct = (price / cost - 1) × 100。
    输出:value = today_pnl(保留 2 位);details.today_pnl / cum_pnl 保留 2 位、cum_pct 保留 1 位。
    异常域:cost ≤ 0 → not_meaningful。
    error:qty < 0 或非整数、输入缺失 / 布尔 / 非数值 / 非有限、结果溢出。
    """
    try:
        c = _num(cost, "cost")
        if c <= 0:
            return _res("not_meaningful", unit="元", reason="cost ≤ 0,累计盈亏无意义")
        q = _int_qty(qty)
        p = _num(price, "price")
        pc = _num(prev_close, "prev_close")
        today = _finite((p - pc) * q, "今日盈亏")
        cum = _finite((p - c) * q, "累计盈亏")
        pct = _finite((p / c - 1.0) * 100.0, "累计盈亏百分比")
    except CalcInputError as e:
        return _err(str(e))
    return _res("ok", round(today, 2), "元",
                today_pnl=round(today, 2), cum_pnl=round(cum, 2), cum_pct=round(pct, 1),
                cost=c, qty=q, price=p, prev_close=pc,
                today_pnl_raw=today, cum_pnl_raw=cum, cum_pct_raw=pct)


def _r_fund_strong(v):
    return abs(v) >= 3


def _r_board_strong(v):
    return v >= 3


def _r_zhapu_strong(v):
    return v >= 45


def _r_fund_normal(v):
    return abs(v) >= 2


def _r_turnover_normal(v):
    return v >= 90


def _r_vol_normal(v):
    return v >= 2.5


def _r_board_normal(v):
    return v >= 2


def _r_ladder_normal(v):
    return abs(v) >= 2


# 维度判定规则(按维度顺序;每维度内规则从强到弱,命中即取最强一条)
_STRONG_TEXTS = {"|fund_z| ≥ 3", "board_ratio ≥ 3", "zhapu_rate ≥ 45"}
_DIM_RULES = [
    ("fund_z", [("|fund_z| ≥ 3", _r_fund_strong), ("|fund_z| ≥ 2", _r_fund_normal)]),
    ("turnover_pctile", [("turnover_pctile ≥ 90", _r_turnover_normal)]),
    ("vol_z", [("vol_z ≥ 2.5", _r_vol_normal)]),
    ("board_ratio", [("board_ratio ≥ 3", _r_board_strong), ("board_ratio ≥ 2", _r_board_normal)]),
    ("zhapu_rate", [("zhapu_rate ≥ 45", _r_zhapu_strong)]),
    ("ladder_delta", [("|ladder_delta| ≥ 2", _r_ladder_normal)]),
]


def anomaly_judge(fund_z, turnover_pctile, vol_z, board_ratio, zhapu_rate, ladder_delta):
    """六维异常判定(刀2契约 §一.4)。

    strong ← |fund_z| ≥ 3 或 board_ratio ≥ 3 或 zhapu_rate ≥ 45;
    normal ← |fund_z| ≥ 2 或 turnover_pctile ≥ 90 或 vol_z ≥ 2.5 或 board_ratio ≥ 2 或 |ladder_delta| ≥ 2;
    均不触发 → none。
    输出:value = 触发维度数(个);details.level ∈ none|normal|strong;
    details.triggers = [{dim, value, rule}](触发维度,rule 为命中的最强规则;
    输入为 None 的维度记 {dim, value: None, rule: "skipped"} 表示跳过)。
    error:布尔 / 非数值 / 非有限、turnover_pctile 越界(0..100)、zhapu_rate 为负、ladder_delta 非整数。
    """
    try:
        raw = {"fund_z": fund_z, "turnover_pctile": turnover_pctile, "vol_z": vol_z,
               "board_ratio": board_ratio, "zhapu_rate": zhapu_rate, "ladder_delta": ladder_delta}
        values = {}
        for name, x in raw.items():
            if x is None:
                continue  # 该维度跳过
            v = _num(x, name)
            if name == "turnover_pctile" and not 0 <= v <= 100:
                raise CalcInputError(f"turnover_pctile={v} 越界,必须在 0..100")
            if name == "zhapu_rate" and v < 0:
                raise CalcInputError(f"zhapu_rate={v} 不能为负")
            if name == "ladder_delta" and (isinstance(x, bool) or not isinstance(x, int)):
                raise CalcInputError("ladder_delta 必须是整数")
            values[name] = v
        triggers = []
        skipped = []
        for name, rules in _DIM_RULES:
            if name not in values:
                triggers.append({"dim": name, "value": None, "rule": "skipped"})
                skipped.append(name)
                continue
            v = values[name]
            for rule, pred in rules:
                if pred(v):
                    triggers.append({"dim": name, "value": v, "rule": rule})
                    break
        matched = [t for t in triggers if t["rule"] != "skipped"]
        if any(t["rule"] in _STRONG_TEXTS for t in matched):
            level = "strong"
        elif matched:
            level = "normal"
        else:
            level = "none"
    except CalcInputError as e:
        return _err(str(e))
    return _res("ok", len(matched), "个", level=level, triggers=triggers, skipped_dims=skipped)


def range_return(closes, n):
    """区间涨跌幅%(近 n 日)= (末值 ÷ 首值 − 1) × 100,保留 2 位小数。

    closes = 收盘价序列(按时间升序,最后一个为最新);n = 回看天数(正整数)。
    区间取最近 n 个收盘价:首值 = closes[-n]、末值 = closes[-1]。
    输出:value = 涨跌幅%(保留 2 位);details.first / last / n / ret_raw(未舍入原值)。
    异常域:len(closes) < n → not_meaningful(回看天数不足);首值 ≤ 0 → not_meaningful(负/零基价下涨跌无意义)。
    error:closes 非列表 / 元素缺失或非数值或非有限 / n 非正整数 / 结果溢出。
    """
    try:
        if not isinstance(closes, (list, tuple)):
            raise CalcInputError("closes 必须是按时间升序的收盘价数值列表")
        if isinstance(n, bool) or not isinstance(n, int):
            raise CalcInputError("n 必须是正整数(回看天数)")
        if n <= 0:
            raise CalcInputError("n 必须是正整数(回看天数 ≥ 1)")
        vals = [_num(x, f"closes[{i}]") for i, x in enumerate(closes)]
        if len(vals) < n:
            return _res("not_meaningful",
                        reason=f"序列长度 {len(vals)} < 回看天数 {n},区间涨跌幅无意义")
        first = vals[-n]
        last = vals[-1]
        if first <= 0:
            return _res("not_meaningful", reason="首值 ≤ 0,区间涨跌幅无意义",
                        n=n, first=first, last=last)
        ret = _finite((last / first - 1.0) * 100.0, "区间涨跌幅")
    except CalcInputError as e:
        return _err(str(e))
    return _res("ok", round(ret, 2), "%", n=n, first=first, last=last, ret_raw=ret)
