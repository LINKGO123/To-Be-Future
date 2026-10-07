"""交易所 / 备用源:龙虎榜官方备源(深交所结构化 + 上交所全文)、公告备源(深市走深交所官方,沪市走东财 np-anotice)。移植自 a-stock-data SKILL.md 备用源速查。"""
from __future__ import annotations

import json
import os
import ssl
import sys
import urllib.request
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import UA, norm_ticker  # noqa: E402
from sources._http import http_get, http_json, insecure_tls_allowed, last_raw_ref, record_raw  # noqa: E402

_NOVERIFY = ssl.create_default_context()
_NOVERIFY.check_hostname = False
_NOVERIFY.verify_mode = ssl.CERT_NONE


def _szse_json(url: str, headers: dict, data: Optional[bytes] = None, timeout: int = 15) -> tuple:
    """深交所接口:先正常校验证书;SSL 失败再免校验重试并在返回里标注(不静默)。返回 (json, tls_verified)"""
    try:
        r = http_get(url, headers=headers, timeout=timeout, ext="json") if data is None else None
        if r is not None:
            r.raise_for_status()
            return r.json(), True
        import requests
        resp = requests.post(url, data=data, headers=headers, timeout=timeout)
        resp.raise_for_status()
        record_raw(resp.content, "json", url)
        return resp.json(), True
    except Exception as e:  # noqa: BLE001
        if "SSL" not in type(e).__name__ and "certificate" not in str(e).lower():
            raise
        if not insecure_tls_allowed():
            raise RuntimeError(f"深交所接口证书校验失败({type(e).__name__});若接受风险可设 VRA_ALLOW_INSECURE_TLS=1 降级(仅研究用)") from e
        req = urllib.request.Request(url, data=data, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout, context=_NOVERIFY) as resp:
            body = resp.read()
        record_raw(body, "json", url)
        return json.loads(body), False


def dragon_tiger_backup(trade_date: Optional[str] = None) -> dict:
    """龙虎榜官方备源:{date, szse:[{code,name,amount,reason,date}], sse_raw(全文), tls_verified};trade_date 缺省 = 北京时间今天。

    深交所 ShowReport 每页 10 条,按 metadata.pagecount 翻页取全;分页失败不致命,保留已取到的页。
    """
    if not trade_date:
        from datetime import datetime
        from common import TZ_SH
        trade_date = datetime.now(TZ_SH).strftime("%Y-%m-%d")
    base = (f"https://www.szse.cn/api/report/ShowReport/data?SHOWTYPE=JSON&CATALOGID=1842_xxpl&TABKEY=tab1"
            f"&txtStart={trade_date}&txtEnd={trade_date}")
    hdr = {"User-Agent": UA, "Referer": "https://www.szse.cn/disclosure/supervision/dealinfo/index.html"}
    d, ok = _szse_json(base + "&random=0.9", hdr)
    raw_sz = last_raw_ref()
    out = {"date": trade_date, "szse": [], "sse_raw": "", "tls_verified": ok, "_raw_sz": raw_sz, "_raw_sse": None}
    sz_rows: list = list((d[0] or {}).get("data") or []) if d else []
    if d:
        meta = (d[0] or {}).get("metadata") or {}
        try:
            page_count = int(meta.get("pagecount") or 1)
        except (TypeError, ValueError):
            page_count = 1
        for p in range(2, page_count + 1):
            try:
                dp, _ = _szse_json(f"{base}&PAGENO={p}&random=0.9", hdr)
                page_raw = last_raw_ref()
                for row in (dp[0] or {}).get("data") or [] if dp else []:
                    sz_rows.append({**row, "_raw": page_raw})
            except Exception:  # noqa: BLE001 — 分页失败不致命,保留已取到的页
                break
    for row in sz_rows:
        out["szse"].append({"code": row.get("zqdm"), "name": row.get("zqjc"), "amount": row.get("cjje"),
                            "reason": row.get("plyy"), "date": row.get("dqrq"), "_raw": row.get("_raw", raw_sz)})
    r = http_get(f"https://query.sse.com.cn/infodisplay/showTradePublicFile.do?jsonCallBack=cb&isPagination=false&dateTx={trade_date}",
                 headers={"User-Agent": UA, "Referer": "https://www.sse.com.cn/disclosure/diclosure/public/"}, timeout=15, ext="js")
    t = r.text
    out["_raw_sse"] = getattr(r, "_vra_raw_ref", None)
    if "(" in t:
        out["sse_raw"] = "\n".join((json.loads(t[t.index("(") + 1: t.rindex(")")]) or {}).get("fileContents") or [])  # 非交易日 fileContents 为 null
    return out


def announcements_backup(code: str, page_size: int = 20) -> list[dict]:
    """公告备源:[{title, time, pdf}];深市 → szse annList,沪市 / 北交所 → 东财 np-anotice"""
    digits, market = norm_ticker(code, stock_only=True)
    if market == "SZ":
        body = json.dumps({"channelCode": ["listedNotice_disc"], "pageSize": page_size, "pageNum": 1, "stock": [digits]}).encode()
        d, _ = _szse_json("https://www.szse.cn/api/disc/announcement/annList", {"User-Agent": UA, "Content-Type": "application/json", "Referer": "https://www.szse.cn/disclosure/listed/notice/index.html"}, data=body)
        return [{"title": a.get("title"), "time": (a.get("publishTime") or "")[:10], "pdf": "https://disc.static.szse.cn/download" + (a.get("attachPath") or "")} for a in d.get("data", []) or []]
    d = http_json(f"https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size={page_size}&page_index=1&ann_type=A&client_source=web&stock_list={digits}&f_node=0&s_node=0", headers={"User-Agent": UA}, timeout=15)
    return [{"title": a.get("title"), "time": (a.get("notice_date") or "")[:10], "pdf": f"https://pdf.dfcfw.com/pdf/H2_{a.get('art_code', '')}_1.pdf"} for a in (d.get("data") or {}).get("list") or []]
