"""fundradar.py 数据驱动测试:fixture 中每条 case 都是按《刀2规格-calc函数与skill提示词-v1.0.md》§一手算的期望值。"""
from __future__ import annotations

import json
import math
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
from calc import fundradar  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "fundradar_cases.json")
with open(FIXTURE, encoding="utf-8") as f:
    CASES = json.load(f)["cases"]

_B1 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]  # mu=1, sigma=1(总体标准差)


def _walk(obj):
    """递归遍历返回树中的所有浮点数。"""
    if isinstance(obj, bool):
        return
    if isinstance(obj, float):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _walk(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from _walk(v)


def assert_contract(out):
    assert set(out.keys()) == {"status", "value", "unit", "reason", "details"}, "返回结构必须固定"
    assert out["status"] in ("ok", "not_meaningful", "error")
    if out["status"] != "ok":
        assert out["value"] is None and out["reason"], "非 ok 必须 value=null 且有 reason"
    assert all(math.isfinite(x) for x in _walk(out)), "返回树任何位置不得有 inf/NaN"
    json.dumps(out, allow_nan=False)  # 必须可严格 JSON 序列化


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_fixture_case(case):
    fn = getattr(fundradar, case["function"])
    out = fn(**case["args"])
    assert_contract(out)
    assert out["status"] == case["expect_status"], out
    if "expect_value" in case:
        assert out["value"] is not None
        assert math.isclose(out["value"], case["expect_value"], rel_tol=0, abs_tol=1e-6), out
    for k, v in case.get("expect_details", {}).items():
        assert k in out["details"], f"details 缺 {k}"
        if isinstance(v, float):
            assert math.isclose(out["details"][k], v, abs_tol=1e-6)
        else:
            assert out["details"][k] == v


@pytest.mark.parametrize("probe", [
    lambda: fundradar.heat_score(10 ** 300, 1e308, 10 ** 300),
    lambda: fundradar.heat_score(1, float("nan"), 1),
    lambda: fundradar.heat_score(1, float("inf"), 1),
    lambda: fundradar.zscore20([1e308] * 21),
    lambda: fundradar.zscore20([1e308] * 20 + [0.0]),
    lambda: fundradar.zscore20([-1e308] * 20 + [1e308]),
    lambda: fundradar.pnl(1e-300, 1, 1e308, 0),
    lambda: fundradar.pnl(1e308, 1, 1e308, 0),
    lambda: fundradar.anomaly_judge(float("inf"), 50, 1, 1, 10, 0),
    lambda: fundradar.anomaly_judge(1, 50, float("nan"), 1, 10, 0),
    lambda: fundradar.range_return([1e-308, 1e308], 2),
    lambda: fundradar.range_return([1e308] * 3, 3),
])
def test_extreme_inputs_never_leak_nonfinite(probe):
    """极端输入:要么有限数 ok,要么 error / not_meaningful;返回树任何位置不得有 inf/NaN。"""
    out = probe()
    assert_contract(out)
    for x in _walk(out):
        assert math.isfinite(x)


def test_zscore20_population_sigma_documented():
    """sigma 为前 20 个元素的总体标准差(除以 20),sigma_ddof=0 需在 details 留痕。"""
    out = fundradar.zscore20(_B1 + [3.5])
    assert out["status"] == "ok"
    assert out["details"]["sigma_ddof"] == 0
    assert out["details"]["baseline_window"] == 20
    assert out["details"]["mu"] == 1.0 and out["details"]["sigma"] == 1.0


def test_heat_score_half_value_bankers_rounding():
    """保留 1 位小数的半值按 Python round 银行家舍入取偶。"""
    assert fundradar.heat_score(0, 1.125, 0)["value"] == 2.2


def test_anomaly_judge_value_counts_triggered_dims():
    """value = 触发维度数;skipped 不计入。"""
    out = fundradar.anomaly_judge(None, None, None, 3.0, None, None)
    assert out["status"] == "ok" and out["value"] == 1
    assert out["details"]["level"] == "strong"
    assert out["details"]["skipped_dims"] == ["fund_z", "turnover_pctile", "vol_z", "zhapu_rate", "ladder_delta"]


def test_range_return_window_takes_last_n():
    """区间取最近 n 个收盘价:首值 = closes[-n]、末值 = closes[-1],保留 2 位。"""
    out = fundradar.range_return([10, 11, 12, 13, 14], 3)
    assert out["status"] == "ok"
    assert out["details"]["first"] == 12.0 and out["details"]["last"] == 14.0
    assert out["details"]["n"] == 3
    assert math.isclose(out["value"], 16.67, abs_tol=1e-6)


def test_fundradar_version_is_semver():
    parts = fundradar.FUNDRADAR_VERSION.split(".")
    assert len(parts) == 3 and all(p.isdigit() for p in parts)
