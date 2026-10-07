"""akshare 直连东财个股资金流备源(120 日四维:主力 / 超大单 / 大单 / 中单 / 小单)。

⚠️ 重要事实:akshare.stock_individual_fund_flow 底层请求的是
`push2his.eastmoney.com/api/qt/stock/fflow/daykline/get`,与本源 `em_fund_flow_120d`
同一主机。东财 push2his 封 IP 时本函数与 em_fund_flow_120d **一样失败**(不构成绕过)。
本模块的价值:当 push2his 恢复可达时,提供与 em_fund_flow_120d 等价的 120 日四维
(含新浪备源没有的中单 / 小单),字段契约以 akshare 返回实测为准。
单位:东财资金流净额为「元」;日期为 YYYY-MM-DD。
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import norm_ticker  # noqa: E402
from sources._http import record_raw  # noqa: E402

# akshare stock_individual_fund_flow 返回列(中文)→ 内部键(与 em_fund_flow_120d 对齐)
_COL_MAP = {
    "日期": "date",
    "主力净流入-净额": "main_net",
    "小单净流入-净额": "small_net",
    "中单净流入-净额": "mid_net",
    "大单净流入-净额": "large_net",
    "超大单净流入-净额": "super_net",
    "收盘价": "close",
    "涨跌幅": "change_pct",
}


def _num(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
        return f if f == f else None  # NaN → None
    except (TypeError, ValueError):
        return None


def akshare_fund_flow_120d(code: str) -> list[dict]:
    """akshare 个股资金流(日级四维):[{date, main_net, small_net, mid_net, large_net, super_net, close, change_pct}](元)。"""
    digits, market = norm_ticker(code, stock_only=True)
    import akshare as ak  # 延迟导入:重依赖(pandas/numpy),仅本端点需要

    df = ak.stock_individual_fund_flow(stock=digits, market=market.lower())
    rows: list[dict] = []
    if df is None or getattr(df, "empty", True):
        return rows
    for _, r in df.iterrows():
        rows.append({out_key: (_num(r.get(col)) if out_key in ("close", "change_pct", "main_net", "small_net", "mid_net", "large_net", "super_net")
                              else str(r.get(col))[:10])
                     for col, out_key in _COL_MAP.items()})
    # 落盘 extracted JSON(前端 /api/fetch-raw 接缝按 raw_ref 读序列做 5/20 日合计)
    record_raw(json.dumps(rows, ensure_ascii=False).encode("utf-8"), "json", kind="extracted")
    return rows
