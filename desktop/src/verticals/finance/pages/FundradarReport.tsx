/**
 * 资金雷达工作台 · 分析报告页（/report）
 * ------------------------------------------------------------
 * 输入 6 位代码（或名称）→ 生成可视化分析报告：
 * ① 综合评分横幅（0-100 大字 + 分级 + 三因子子分）
 * ② 四大类指标卡（行情 / 技术指标+评分 / 资金 / 估值）
 * ③ 趋势图（K线+MA5/10/20+成交量 + MACD/RSI 副图）+ 资金趋势
 * ④ 风险点列表（行业 / 公司 / 估值 / 技术面；取不到写「未获取」，不编）
 * ⑤ 短期 / 长期倾向（偏多 / 中性 / 偏空 + 一句话理由 + 触发条件）
 * ⑥ 免责声明
 *
 * 数据全部走 lib/fundradarStock.ts 的 loadStockReport（复用 loadStockLive +
 * loadStockValuation），评分/倾向/RSI/BIAS 走 lib/fundradarIndicators.ts 纯函数。
 * 红线：本页只给评分与倾向（偏多 / 中性 / 偏空）与触发条件，不提供任何投资动作建议。
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileText, History, Lock, Printer, RefreshCw, Search, Trash2, Unlock } from "lucide-react";

import { FrSkeleton, FrSkeletonCard, FrSkeletonChart } from "@/components/fundradar/FrSkeleton";
import { FrAnimatedNumber } from "@/components/fundradar/FrAnimatedNumber";
import { FrScoreRing } from "@/components/fundradar/FrScoreRing";
import { FrReportChart } from "@/components/fundradar/FrReportChart";
import { FrFlowTrendChart, type FrFlowTrendPoint } from "@/components/fundradar/FrFlowTrendChart";
import { FrSourceFooter } from "@/components/fundradar/FrSourceFooter";
import { FrSectionNav, type FrSection } from "@/components/fundradar/FrSectionNav";
import { FrSectionRail } from "@/components/fundradar/FrSectionRail";
import { FrBackToTop } from "@/components/fundradar/FrBackToTop";
import { FR_DISCLAIMER } from "@/data/fundradarSample";
import { frDateLabel, frEndpointCn } from "@/lib/fundradarData";
import {
  reportLeaning, scoreComposite,
  type CompositeScoreResult, type FlowScoreInput, type LeanResult, type ValuationScoreInput,
} from "@/lib/fundradarIndicators";
import type { KlineBar } from "@/lib/fundradarIndicators";
import { frPctClass, frSigned } from "@/lib/fundradarTheme";
import { consecutiveFlow, loadStockReport, resolveStockCode, type FrStockReportLive } from "@/lib/fundradarStock";
import {
  buildReportHtml, buildReportMarkdown, clearReportHistory, deleteReportHistoryItem,
  FR_REPORT_HISTORY_CHANGED, loadReportHistory, reportMarkdownFilename, saveReportHistory,
  setReportHistoryLock, type ReportHistoryItem,
} from "@/lib/fundradarReportHistory";

/* ---------------- 文案/格式工具 ---------------- */

/** 报告页区块锚点（id 与下方各 section 对应；资金趋势/历史报告为条件渲染，缺失时 scrollspy 自动跳过） */
const REPORT_SECTIONS: FrSection[] = [
  { id: "report-head", label: "综合评分" },
  { id: "report-indicators", label: "指标卡" },
  { id: "report-kline", label: "走势图" },
  { id: "report-flow", label: "资金趋势" },
  { id: "report-risk", label: "风险点" },
  { id: "report-stance", label: "多空倾向" },
  { id: "report-history", label: "历史报告" },
];

const signedYi = (v: number): string => `${v > 0 ? "+" : ""}${(v / 1e8).toFixed(2)}亿`;
const pct = (v: number | null): string => (v == null ? "—" : `${Math.round(v)}%`);
const num2 = (v: number | null): string => (v == null ? "—" : v.toFixed(2));
const gradeClass = (g: string): string => (g === "偏多" ? "fr-up" : g === "偏空" ? "fr-down" : "fr-flat");
/** 评分颜色：≥60 偏多红 / 40-59 中性灰 / <40 偏空绿（与报告页评分分级一致） */
const scoreClass = (s: number): string => (s >= 60 ? "fr-up" : s >= 40 ? "fr-flat" : "fr-down");
/** 历史时间戳 → 本地时间文案（年月日 + 时分） */
const formatTs = (ts: number): string => {
  try {
    return new Date(ts).toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return String(ts);
  }
};

/** 分析明细（L3）：把「；」分隔的评分明细拆成 bullet 列表，每点一行、行距拉开。 */
function NoteBullets({ note }: { note: string }) {
  const items = note.split("；").map((s) => s.trim()).filter(Boolean);
  return (
    <ul className="fr-sub mt-1.5 space-y-1.5 text-muted-foreground">
      {items.map((s, i) => (
        <li key={`${i}-${s}`} className="flex gap-2 leading-relaxed">
          <span className="shrink-0" aria-hidden="true">•</span>
          <span>{s}</span>
        </li>
      ))}
    </ul>
  );
}

interface RiskItem { title: string; detail: string; }

/** 风险点列表：数据可取则取，取不到写「未获取」，不编。 */
function buildRisks(live: FrStockReportLive, score: CompositeScoreResult): RiskItem[] {
  const risks: RiskItem[] = [];

  // —— 技术面风险 ——
  let techRisk = false;
  if (score.rsiValue !== null && score.rsiValue > 80) {
    risks.push({ title: "RSI 超买", detail: `RSI(14)=${score.rsiValue.toFixed(1)}，短期涨幅过快，追高风险累积` });
    techRisk = true;
  }
  if (score.biasValue !== null && score.biasValue > 5) {
    risks.push({ title: "正乖离偏大", detail: `乖离率 ${score.biasValue.toFixed(1)}%，偏离 MA5 过大，短线过热` });
    techRisk = true;
  }
  if (score.macdSignal === "零轴下空头" || score.macdSignal === "死叉/空头运行") {
    risks.push({ title: "MACD 空头运行", detail: `MACD ${score.macdSignal}，动能偏弱` });
    techRisk = true;
  }
  if (score.maArrangement === "空头") {
    risks.push({ title: "均线空头排列", detail: "MA5 < MA10 < MA20，趋势偏弱" });
    techRisk = true;
  }
  if (!techRisk) risks.push({ title: "技术面暂无明显风险", detail: "未出现超买、明显乖离或空头信号" });

  // —— 估值风险 ——
  const val = live.valuation;
  if (!val) {
    risks.push({ title: "估值未获取", detail: frEndpointCn("估值端点不可用（fetch_pe_history / bs_valuation_history），估值风险无法评估") });
  } else if (val.pe !== null && val.pe <= 0) {
    risks.push({ title: "PE 为负（亏损）", detail: "PE_TTM 为负，估值不可直接比较，需结合基本面判断" });
  } else {
    let valRisk = false;
    if (val.pePercentile !== null && val.pePercentile > 80) {
      risks.push({ title: "PE 分位偏高", detail: `PE=${val.pe == null ? "—" : val.pe.toFixed(1)} 倍，处于历史约 ${Math.round(val.pePercentile)}% 分位，估值偏贵` });
      valRisk = true;
    }
    if (val.pbPercentile !== null && val.pbPercentile > 80) {
      risks.push({ title: "PB 分位偏高", detail: `PB=${val.pb == null ? "—" : val.pb.toFixed(2)} 倍，处于历史约 ${Math.round(val.pbPercentile)}% 分位` });
      valRisk = true;
    }
    if (!valRisk) risks.push({ title: "估值未现高位风险", detail: `PE 分位 ${pct(val.pePercentile)}、PB 分位 ${pct(val.pbPercentile)}` });
  }

  // —— 公司基本面风险（财务，只进风险点，不改评分因子）——
  const fin = live.financials;
  if (!fin) {
    risks.push({ title: "财务数据未获取", detail: frEndpointCn("财务端点不可用（fetch_financials），基本面风险无法评估") });
  } else {
    const fundRisks: RiskItem[] = [];
    if (fin.netProfit !== null && fin.netProfit < 0) {
      fundRisks.push({ title: "亏损", detail: `归母净利 ${(fin.netProfit / 1e8).toFixed(2)} 亿（亏损）` });
    }
    if (fin.netProfitYoy !== null && fin.netProfitYoy < -30) {
      fundRisks.push({ title: "盈利大幅下滑", detail: `净利同比 ${fin.netProfitYoy.toFixed(1)}%（较去年同期大幅下滑）` });
    }
    if (fin.debtRatio !== null && fin.debtRatio > 60) {
      fundRisks.push({ title: "负债率偏高", detail: `资产负债率 ${fin.debtRatio.toFixed(1)}%` });
    }
    if (fin.revenueYoy !== null && fin.revenueYoy < -20) {
      fundRisks.push({ title: "营收下滑", detail: `营收同比 ${fin.revenueYoy.toFixed(1)}%` });
    }
    if (fundRisks.length === 0) {
      fundRisks.push({ title: "未发现明显财务风险", detail: "营收/净利同比正常，未触发亏损、大幅下滑、负债率偏高或营收下滑阈值" });
    }
    risks.push(...fundRisks);
  }

  // —— 龙虎榜活跃（独立于财务风险，仅在上榜时提示；不再把「无上榜」当「基本面未获取」）——
  const lhb = live.lhb;
  if (lhb && lhb.count > 0) {
    risks.push({
      title: lhb.count >= 2 ? "龙虎榜活跃" : "近期上榜",
      detail: `近 30 日龙虎榜上榜 ${lhb.count} 次，游资/机构博弈较频繁，波动可能放大`,
    });
  }

  // —— 行业风险 ——
  if (live.boards.length > 0) {
    risks.push({ title: "行业集中度", detail: `所属板块：${live.boards.join("、")}；行业景气度与板块资金流本报告未取` });
  } else {
    risks.push({ title: "行业风险未获取", detail: frEndpointCn("板块归属未取到（em_concept_blocks 不可用）") });
  }

  return risks;
}

interface ReportSnapshot {
  score: CompositeScoreResult;
  lean: { short: LeanResult; long: LeanResult };
  risks: RiskItem[];
}

/** 从整页取数结果算出评分/倾向/风险（渲染与历史落盘共用，避免两处口径不一致）。 */
function computeReport(live: FrStockReportLive): ReportSnapshot {
  const closes = live.kline?.daily?.map((b) => b.close) ?? [];
  const flowInput: FlowScoreInput | null = live.flow
    ? {
        mainToday: live.flow.today?.main ?? null,
        consecutive: consecutiveFlow(live.flow.series),
        sum5: live.flow.sum5,
        sum20: live.flow.sum20,
      }
    : null;
  const valuationInput: ValuationScoreInput | null = live.valuation
    ? {
        pe: live.valuation.pe,
        pb: live.valuation.pb,
        pePercentile: live.valuation.pePercentile,
        pbPercentile: live.valuation.pbPercentile,
      }
    : null;
  const score = scoreComposite({ closes, flow: flowInput, valuation: valuationInput });
  const lean = reportLeaning(score, flowInput, valuationInput);
  const risks = buildRisks(live, score);
  return { score, lean, risks };
}

/** 一句话结论（评分 + 子分 + 短长期倾向拼一句，历史落盘与导出共用口径）。 */
function buildConclusion(score: CompositeScoreResult, lean: { short: LeanResult; long: LeanResult }): string {
  return `${score.grade}：综合评分 ${score.score} 分（技术 ${score.tech} / 资金 ${score.flow} / 估值 ${score.valuation}），短期${lean.short.direction}、长期${lean.long.direction}。`;
}

/** 数据来源中文名列表（页面出处折叠区与历史落盘共用口径）。 */
function buildSources(live: FrStockReportLive): string[] {
  return [
    `数据日期：${frDateLabel(live.dataDate)}`,
    "腾讯行情（现价 / 涨跌幅 / 换手 / 量比）",
    "日K线（前复权）",
    live.flow ? `资金：${frEndpointCn(live.flow.source)}` : "资金：未获取（显示 —）",
    live.valuation ? `估值：${frEndpointCn(live.valuation.source)}` : "估值：未获取（显示 —）",
    live.financials ? `财务：${frEndpointCn("fetch_financials")}` : "财务：未获取（显示 财务数据未获取）",
    live.boards.length > 0 ? `概念板块（${live.boards.join("、")}）` : "概念板块（未取到）",
  ];
}

/** 历史行操作按钮基础样式（≥48px 点击区，DSH 风） */
const actionBtnCls =
  "fr-sub fr-tap inline-flex items-center gap-1.5 rounded-btn border border-border bg-muted/40 px-2.5 py-1.5 font-bold text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";
const deleteBtnCls =
  "fr-sub fr-tap inline-flex items-center gap-1.5 rounded-btn border border-border bg-muted/40 px-2.5 py-1.5 font-bold text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40";

export function FundradarReport() {
  const [searchParams] = useSearchParams();
  const [searchQ, setSearchQ] = useState("");
  const [searchHint, setSearchHint] = useState("");
  const [searching, setSearching] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [live, setLive] = useState<FrStockReportLive | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [history, setHistory] = useState<ReportHistoryItem[]>([]);
  const [lastViewedTs, setLastViewedTs] = useState<number | null>(null);

  const runLoad = async (c: string, refresh: boolean) => {
    setLoading(true);
    setFailed(false);
    setLive(null);
    try {
      const v = await loadStockReport(c, refresh);
      setLive(v);
      // 行情与 K 线都取不到才算「整页失败」；其余块各自降级为「— / 未获取」
      const wholeFail = v.quote === null && v.kline === null;
      setFailed(wholeFail);
      // 报告成功生成（行情或 K 线至少取到其一）→ 落一条完整报告快照，供下次回看 / 导出
      if (!wholeFail) {
        const snap = computeReport(v);
        saveReportHistory({
          code: c,
          name: v.quote?.name || c,
          ts: Date.now(),
          score: snap.score.score,
          shortTrend: snap.lean.short.direction,
          longTrend: snap.lean.long.direction,
          riskCount: snap.risks.length,
          subscores: { tech: snap.score.tech, flow: snap.score.flow, valuation: snap.score.valuation },
          conclusion: buildConclusion(snap.score, snap.lean),
          shortReason: snap.lean.short.reason,
          shortTrigger: snap.lean.short.trigger,
          longReason: snap.lean.long.reason,
          longTrigger: snap.lean.long.trigger,
          risks: snap.risks.map((r) => `${r.title}：${r.detail}`),
          sources: buildSources(v),
        });
      }
    } catch {
      setLive(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const generate = async () => {
    const t = searchQ.trim();
    if (!t || searching || loading) return;
    setSearching(true);
    setSearchHint("");
    try {
      const hit = await resolveStockCode(t);
      if (!hit) {
        setSearchHint("找不到该代码/名称：请输入 6 位 A 股代码（如 600183）");
        return;
      }
      setSearchHint("");
      setCode(hit.code);
      setLastViewedTs(null);
      await runLoad(hit.code, false);
    } catch {
      setSearchHint("查找失败，请稍后重试或直接输入 6 位代码");
    } finally {
      setSearching(false);
    }
  };

  const retry = () => {
    if (code) void runLoad(code, true);
  };

  // 订阅历史变化事件：本页保存 / 其他标签页保存 / 清空 都实时刷新列表
  useEffect(() => {
    setHistory(loadReportHistory());
    const onChanged = () => setHistory(loadReportHistory());
    window.addEventListener(FR_REPORT_HISTORY_CHANGED, onChanged);
    return () => window.removeEventListener(FR_REPORT_HISTORY_CHANGED, onChanged);
  }, []);

  // 下钻入口：评分榜跳转 /report?code=<code> 时自动加载该股报告
  useEffect(() => {
    const c = searchParams.get("code");
    if (c && /^\d{6}$/.test(c) && c !== code) {
      setCode(c);
      setSearchQ(c);
      setLastViewedTs(null);
      void runLoad(c, false);
    }
    // 依赖只放 searchParams：runLoad 每次渲染都会重建，纳入依赖会重复触发
  }, [searchParams]);

  // 点击某条历史 → 重新加载该 code 的报告，并提示「上次查看」时间
  const openHistory = async (item: ReportHistoryItem) => {
    if (loading || searching) return;
    setSearchQ(item.code);
    setSearchHint("");
    setCode(item.code);
    setLastViewedTs(item.ts);
    await runLoad(item.code, false);
  };

  // 删除单条（二次确认；锁定的不可删，按钮已禁用，此处再兜底一层）
  const removeItem = (h: ReportHistoryItem) => {
    if (h.locked) return;
    if (!window.confirm(`确定删除「${h.name}（${h.code}）」这份报告？删除后无法恢复。`)) return;
    const ok = deleteReportHistoryItem(h.code, h.ts);
    if (!ok) window.alert("这份报告已锁定，请先解锁后再删除。");
  };

  // 锁定 / 解锁（点锁图标切换；锁定不影响导出）
  const toggleLock = (h: ReportHistoryItem) => {
    setReportHistoryLock(h.code, h.ts, !h.locked);
  };

  // 清空全部（二次确认；跳过锁定的，明确提示「有 N 条已锁定」）
  const clearAll = () => {
    const lockedCount = history.filter((h) => h.locked === true).length;
    const unlockedCount = history.length - lockedCount;
    if (history.length === 0) return;
    if (lockedCount === history.length) {
      window.alert("所有报告都已锁定，请先解锁后再清空。");
      return;
    }
    const tip = lockedCount > 0
      ? `有 ${lockedCount} 条报告已锁定，本次清空将保留它们，只删除未锁定的 ${unlockedCount} 条。是否继续？`
      : "确定清空全部报告历史？清空后无法恢复。";
    if (!window.confirm(tip)) return;
    const remaining = clearReportHistory();
    if (remaining > 0) {
      window.alert(`已清空未锁定的报告；还有 ${remaining} 条已锁定报告保留（如需删除请先解锁）。`);
    }
  };

  // 导出 Markdown（Blob 下载 <name>-<code>-<日期>.md）
  const exportMarkdown = (h: ReportHistoryItem) => {
    try {
      const md = buildReportMarkdown(h);
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = reportMarkdownFilename(h);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.alert("导出 Markdown 失败，请重试。");
    }
  };

  // 导出 PDF（打印视图新窗口 → window.print() → 用户「另存为 PDF」）
  const exportPdf = (h: ReportHistoryItem) => {
    const w = window.open("", "_blank");
    if (!w) {
      window.alert("浏览器拦截了打印窗口，请允许本站弹出窗口后重试（或改用「导出 Markdown」）。");
      return;
    }
    w.document.open();
    w.document.write(buildReportHtml(h));
    w.document.close();
    // 等打印视图完成布局后再触发打印
    window.setTimeout(() => {
      try {
        w.focus();
        w.print();
      } catch {
        /* 打印被取消/浏览器不支持：用户可手动在打开的窗口里 Ctrl+P */
      }
    }, 120);
  };

  /* ---------------- 派生：评分 / 倾向 / 风险 / 资金趋势 ---------------- */
  const derived = useMemo(() => (live ? computeReport(live) : null), [live]);

  const flowTrendPoints = useMemo<FrFlowTrendPoint[]>(() => {
    if (!live?.flow) return [];
    const klineMap = new Map<string, KlineBar>();
    for (const b of live.kline?.daily ?? []) klineMap.set(b.date, b);
    return live.flow.series.map((p) => ({
      date: p.date,
      main: p.main,
      superLarge: p.superLarge,
      close: klineMap.get(p.date)?.close ?? p.close,
    }));
  }, [live]);

  const q = live?.quote ?? null;
  const klineBars = live?.kline?.daily ?? null;
  const score = derived?.score ?? null;
  const lean = derived?.lean ?? null;
  const risks = derived?.risks ?? [];
  const flowMain = live?.flow?.today?.main ?? null;
  const flowSum5 = live?.flow?.sum5 ?? null;
  const flowSum20 = live?.flow?.sum20 ?? null;
  const flowConsec = live?.flow ? consecutiveFlow(live.flow.series) : null;

  const leanBadge = (l: LeanResult) => (
    <span className={`fr-sub rounded-btn px-3 py-1 font-bold ${gradeClass(l.direction)}`}>{l.direction}</span>
  );

  return (
    <div data-fr-page="fundradar-report" className="fr-elder-page p-6">
      <div className="fr-fade-in mx-auto max-w-[1500px]">
        <h1 className="sr-only">资金雷达 · 分析报告</h1>

        {/* 搜索区 */}
        <section aria-label="生成分析报告" className="fr-glass fr-glass-accent mb-5 rounded-xl p-5">
          <p className="fr-sub font-semibold uppercase tracking-[0.2em] text-primary">Report</p>
          <h2 className="fr-title mt-1 font-bold">分析报告</h2>
          <p className="fr-body mt-2 text-muted-foreground">
            输入 6 位 A 股代码（如 600183），生成可视化分析报告：综合评分、四大指标卡、趋势图、风险点与多空倾向。
          </p>
          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(e) => { e.preventDefault(); void generate(); }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-input border border-border bg-muted px-3 py-2">
              <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                value={searchQ}
                onChange={(e) => { setSearchQ(e.target.value); setSearchHint(""); }}
                placeholder="输入 6 位代码（如 600183）或持仓名称"
                aria-label="搜索股票代码或名称"
                className="fr-sub w-full bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={searching || loading}
              className="fr-sub fr-press fr-tap rounded-btn bg-primary px-5 py-2 font-bold text-primary-foreground disabled:opacity-60"
            >
              {searching || loading ? "生成中…" : "生成报告"}
            </button>
          </form>
          {searchHint && <span role="status" className="fr-sub mt-2 inline-block text-destructive">{searchHint}</span>}
        </section>

        {/* 加载骨架 */}
        {loading && !live && (
          <div aria-label="加载中">
            <span className="sr-only" role="status">正在生成报告…</span>
            <section className="fr-glass mb-4 rounded-xl p-5">
              <FrSkeleton className="mb-4 w-64 rounded-md" style={{ height: "calc(var(--fs-title) * 0.9)" }} />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="rounded-btn border border-border bg-muted/40 p-4">
                    <FrSkeletonCard lines={3} />
                  </div>
                ))}
              </div>
            </section>
            <section className="fr-glass mb-4 rounded-xl p-5">
              <FrSkeletonChart height={560} />
            </section>
          </div>
        )}

        {/* 整页失败 */}
        {!loading && failed && (
          <section className="fr-glass mb-4 rounded-xl p-6">
            <p className="fr-title font-bold">报告数据未取到</p>
            <p className="fr-body mt-2">行情与 K 线端点均未返回数据，本页不显示任何数字（不编值）。请稍后重试。</p>
            <button type="button" onClick={retry}
              className="fr-sub fr-tap mt-4 inline-flex items-center gap-2 rounded-btn border border-primary/60 bg-primary-subtle-strong px-4 py-2 font-bold text-primary">
              <RefreshCw className="h-5 w-5" aria-hidden="true" /> 重试
            </button>
          </section>
        )}

        {live && score && lean && (
          <>
            {lastViewedTs !== null && (
              <p role="status" className="fr-sub mb-3 font-bold text-primary">
                上次查看：{formatTs(lastViewedTs)}
              </p>
            )}

            {/* 页内锚点导航：报告长页快速定位（滚动时高亮当前区块） */}
            <FrSectionNav sections={REPORT_SECTIONS} />
            {/* 右侧章节导轨：大屏滚动位置指示 */}
            <FrSectionRail sections={REPORT_SECTIONS} />

            {/* 头卡 + 综合评分横幅 */}
            <section id="report-head" aria-label="报告头卡与综合评分" className="fr-glass fr-glass-accent mb-5 scroll-mt-16 rounded-xl p-5">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
                {/* 第一重点：综合评分（0-100）——SVG 环形进度条 + 中间 count-up，置顶、左侧主位 */}
                <div className="flex flex-col items-center gap-1 rounded-btn border border-border bg-muted/40 px-7 py-4">
                  <p className="fr-sub font-bold text-muted-foreground">综合评分</p>
                  <FrScoreRing score={score.score} />
                  <p className={`fr-body font-bold ${gradeClass(score.grade)}`}>{score.grade}</p>
                </div>

                <div className="min-w-0 flex-1">
                  <h2 className="fr-title font-bold">
                    {q?.name || code}
                    <span className="fr-sub ml-2 font-normal text-muted-foreground">{code}</span>
                  </h2>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {live.boards.map((b) => <span key={b} className="fr-chip fr-sub">{b}</span>)}
                    <span className="fr-sub text-muted-foreground">{frDateLabel(live.dataDate)}</span>
                  </div>
                  {q && (
                    <p className="fr-body mt-2">
                      现价 <span className={`font-bold ${frPctClass(q.chg)}`}><FrAnimatedNumber value={q.price} format={(v) => `¥${v.toFixed(2)}`} placeholder="¥—" /></span>
                      {"　"}<span className={`font-bold ${frPctClass(q.chg)}`}>{q.chg == null ? "—" : frSigned(q.chg, "%")}</span>
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-btn border border-border bg-muted/40 p-3">
                  <p className="fr-sub font-bold text-muted-foreground">技术面 50%</p>
                  <p className="fr-title font-bold"><FrAnimatedNumber value={score.tech} format={(v) => String(Math.round(v))} /><span className="fr-sub"> 分</span></p>
                  <NoteBullets note={score.techNote} />
                </div>
                <div className="rounded-btn border border-border bg-muted/40 p-3">
                  <p className="fr-sub font-bold text-muted-foreground">资金面 30%</p>
                  <p className="fr-title font-bold"><FrAnimatedNumber value={score.flow} format={(v) => String(Math.round(v))} /><span className="fr-sub"> 分</span></p>
                  <NoteBullets note={score.flowNote} />
                </div>
                <div className="rounded-btn border border-border bg-muted/40 p-3">
                  <p className="fr-sub font-bold text-muted-foreground">估值面 20%</p>
                  <p className="fr-title font-bold"><FrAnimatedNumber value={score.valuation} format={(v) => String(Math.round(v))} /><span className="fr-sub"> 分</span></p>
                  <NoteBullets note={score.valuationNote} />
                </div>
              </div>
            </section>

            {/* 四大类指标卡 */}
            <section id="report-indicators" aria-label="四大类指标卡" className="mb-5 grid scroll-mt-16 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {/* ① 行情 */}
              <div className="fr-glass rounded-xl p-4">
                <p className="fr-sub font-bold text-muted-foreground">① 行情</p>
                <p className={`fr-num mt-2 ${frPctClass(q?.chg ?? null)}`}>
                  <FrAnimatedNumber value={q?.price} format={(v) => `¥${v.toFixed(2)}`} placeholder="¥—" />
                </p>
                <p className={`fr-body font-bold ${frPctClass(q?.chg ?? null)}`}>{q?.chg == null ? "—" : frSigned(q.chg, "%")}</p>
                <div className="fr-sub mt-2 space-y-1 text-muted-foreground">
                  <p>换手 {q?.turnover == null ? "—" : `${q.turnover}%`}</p>
                  <p>量比 {q?.volRatio == null ? "—" : q.volRatio}</p>
                </div>
              </div>

              {/* ② 技术指标 + 评分 */}
              <div className="fr-glass rounded-xl p-4">
                <p className="fr-sub font-bold text-muted-foreground">② 技术指标 + 评分</p>
                <p className={`fr-num mt-2 ${gradeClass(score.grade)}`}>
                  <FrAnimatedNumber value={score.score} format={(v) => String(Math.round(v))} />
                  <span className="fr-sub font-bold"> / 100</span>
                </p>
                <p className={`fr-body font-bold ${gradeClass(score.grade)}`}>{score.grade}</p>
                <div className="fr-sub mt-2 space-y-1 text-muted-foreground">
                  <p>均线 {score.maArrangement ?? "—"}（MA5 {num2(score.ma5)} / MA10 {num2(score.ma10)} / MA20 {num2(score.ma20)}）</p>
                  <p>MACD {score.macdSignal ?? "—"}</p>
                  <p>RSI(14) {score.rsiValue == null ? "—" : score.rsiValue.toFixed(1)}（{score.rsiZone ?? "—"}）</p>
                  <p>乖离率 {score.biasValue == null ? "—" : `${score.biasValue >= 0 ? "+" : ""}${score.biasValue.toFixed(1)}%`}</p>
                </div>
              </div>

              {/* ③ 资金 */}
              <div className="fr-glass rounded-xl p-4">
                <p className="fr-sub font-bold text-muted-foreground">③ 资金 · 主力净流入</p>
                {live.flow ? (
                  <>
                    <p className={`fr-num mt-2 ${frPctClass(flowMain)}`}>
                      <FrAnimatedNumber value={flowMain} format={signedYi} />
                    </p>
                    <p className={`fr-body font-bold ${frPctClass(flowMain)}`}>当日主力</p>
                    <div className="fr-sub mt-2 space-y-1 text-muted-foreground">
                      <p>连续 {flowConsec?.dir === "in" ? `流入 ${flowConsec.days} 天` : flowConsec?.dir === "out" ? `流出 ${flowConsec.days} 天` : "方向不明"}</p>
                      <p>5 日 {flowSum5 == null ? "—" : signedYi(flowSum5)}</p>
                      <p>20 日 {flowSum20 == null ? "—" : signedYi(flowSum20)}</p>
                    </div>
                  </>
                ) : (
                  <p className="fr-body mt-3 text-muted-foreground">资金数据未获取（—）</p>
                )}
              </div>

              {/* ④ 估值 */}
              <div className="fr-glass rounded-xl p-4">
                <p className="fr-sub font-bold text-muted-foreground">④ 估值</p>
                {live.valuation ? (
                  <>
                    <p className="fr-num mt-2">
                      {live.valuation.pe == null ? "—" : live.valuation.pe <= 0 ? "亏损" : (
                        <>{live.valuation.pe.toFixed(1)}<span className="fr-sub ml-1 font-bold text-muted-foreground">倍</span></>
                      )}
                    </p>
                    <p className="fr-sub text-muted-foreground">PE_TTM</p>
                    <div className="fr-sub mt-2 space-y-1 text-muted-foreground">
                      <p>PE 历史分位 {pct(live.valuation.pePercentile)}</p>
                      <p>PB {live.valuation.pb == null ? "—" : `${live.valuation.pb.toFixed(2)} 倍`}（分位 {pct(live.valuation.pbPercentile)}）</p>
                      <p className="leading-relaxed">{live.valuation.note}</p>
                    </div>
                  </>
                ) : (
                  <p className="fr-body mt-3 text-muted-foreground">估值未获取（—）：端点本机不通则显示「—」</p>
                )}
              </div>
            </section>

            {/* 趋势图：K线 + MA + 成交量 + MACD + RSI */}
            <section id="report-kline" aria-label="K线与技术指标趋势图" className="fr-glass mb-5 scroll-mt-16 rounded-xl p-5">
              <div className="mb-2">
                <p className="fr-sub font-semibold uppercase tracking-[0.2em] text-primary">Chart</p>
                <h2 className="fr-title mt-1 font-bold">走势与技术指标</h2>
              </div>
              {klineBars && klineBars.length > 0 ? (
                <>
                  <FrReportChart rows={klineBars} height={560} />
                  <p className="fr-sub mt-2 text-muted-foreground">
                    主图：日K（前复权）+ MA5/10/20 + 成交量；副图：MACD(12,26,9) 与 RSI(14)（30/70 参考线）。
                    指标为前端纯函数自算（口径见 fundradarIndicators.ts），只展示不构成任何投资动作建议。
                  </p>
                </>
              ) : (
                <p className="fr-body rounded-btn border border-dashed border-border bg-muted/40 px-5 py-8">
                  {frEndpointCn("K 线序列未获取（fetch_kline raw 接缝不可读），趋势图不可绘制。")}
                </p>
              )}
            </section>

            {/* 资金趋势 */}
            {live.flow && flowTrendPoints.length > 0 && (
              <section id="report-flow" aria-label="资金流向趋势" className="fr-glass mb-5 scroll-mt-16 rounded-xl p-5">
                <div className="mb-2">
                  <p className="fr-sub font-semibold uppercase tracking-[0.2em] text-primary">Fund Flow</p>
                  <h2 className="fr-title mt-1 font-bold">资金流向趋势</h2>
                </div>
                <FrFlowTrendChart points={flowTrendPoints} days={20} height={360} />
                <p className="fr-sub mt-2 text-muted-foreground">
                  柱 = 主力净流入（左轴，亿，红入绿出）；折线 = 收盘价（右轴，元）。
                </p>
              </section>
            )}

            {/* 风险点 */}
            <section id="report-risk" aria-label="风险点" className="fr-glass mb-5 scroll-mt-16 rounded-xl p-5">
              <div className="mb-3">
                <p className="fr-sub font-semibold uppercase tracking-[0.2em] text-primary">Risks</p>
                <h2 className="fr-title mt-1 font-bold">风险点</h2>
              </div>
              <div className="grid gap-2">
                {risks.map((r) => (
                  <div key={r.title} className="flex items-start gap-3 rounded-btn border border-border bg-muted/30 px-4 py-2.5">
                    <span className="fr-sub mt-0.5 shrink-0 rounded px-2 py-0.5 font-bold bg-warning/15 text-warning">{r.title}</span>
                    <span className="fr-sub min-w-0 flex-1 leading-relaxed text-muted-foreground">{r.detail}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* 短期 / 长期倾向 */}
            <section id="report-stance" aria-label="短期与长期倾向" className="mb-5 grid scroll-mt-16 gap-3 md:grid-cols-2">
              <div className="fr-glass rounded-xl p-5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="fr-title font-bold">短期倾向（约 1-2 周）</h3>
                  {leanBadge(lean.short)}
                </div>
                <p className="fr-body mt-3 font-bold leading-relaxed">{lean.short.reason}</p>
                <p className="fr-sub mt-3 rounded-btn border border-border bg-muted/40 px-4 py-2.5 leading-relaxed">
                  <span className="font-bold text-primary">触发条件：</span>{lean.short.trigger}
                </p>
              </div>
              <div className="fr-glass rounded-xl p-5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="fr-title font-bold">长期倾向（约 1-3 月）</h3>
                  {leanBadge(lean.long)}
                </div>
                <p className="fr-body mt-3 font-bold leading-relaxed">{lean.long.reason}</p>
                <p className="fr-sub mt-3 rounded-btn border border-border bg-muted/40 px-4 py-2.5 leading-relaxed">
                  <span className="font-bold text-primary">触发条件：</span>{lean.long.trigger}
                </p>
              </div>
            </section>

            {/* 免责声明 */}
            <p className="fr-sub mb-5 leading-relaxed text-muted-foreground/80">
              {FR_DISCLAIMER}
              <br />
              本报告仅呈现基于公开数据的评分与倾向（偏多 / 中性 / 偏空）及触发条件，供研究参考；不构成任何投资建议，请独立判断、风险自担。
            </p>

            {/* 出处减弱（L4）：数据来源收到底部折叠 */}
            <FrSourceFooter className="mb-4" items={buildSources(live)} />

            {/* 数据链路自检 */}
            <details className="fr-sub mb-4 rounded-btn border border-border bg-muted/30 p-3 text-muted-foreground">
              <summary className="cursor-pointer font-bold">数据链路（自检）</summary>
              <ul className="mt-2 list-disc pl-5 leading-relaxed">
                <li>行情：腾讯行情（现价/涨跌幅/换手/量比）{q ? " · OK" : " · 已降级"}</li>
                <li>K线：日K线（日K前复权）{klineBars && klineBars.length > 0 ? " · 序列OK" : " · 序列未开放"}</li>
                <li>资金：分钟资金流 → 120日资金流 → akshare四维资金流 → 新浪资金流{live.flow ? ` · 命中 ${frEndpointCn(live.flow.source)}` : " · 全部失败"}</li>
                <li>估值：PE历史 → 估值历史{live.valuation ? ` · 命中 ${frEndpointCn(live.valuation.source)}` : " · 全部失败（显示 —）"}</li>
                <li>财务：财务摘要{live.financials ? " · OK" : " · 已降级（财务数据未获取）"}</li>
                <li>板块：概念板块{live.boards.length > 0 ? " · OK" : " · 已降级"}</li>
              </ul>
            </details>
          </>
        )}

        {/* 尚未生成且非加载/失败态：说明提示 */}
        {!live && !loading && !failed && (
          <section className="fr-glass rounded-xl p-6">
            <p className="fr-body text-muted-foreground">输入上方代码并点击「生成报告」开始分析。</p>
          </section>
        )}

        {/* 历史报告：最近生成的报告，可点击回看 */}
        {history.length > 0 && (
          <section id="report-history" aria-label="历史报告" className="fr-glass mb-5 scroll-mt-16 rounded-xl p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <History className="h-6 w-6 text-primary" aria-hidden="true" />
                <h2 className="fr-title font-bold">历史报告</h2>
                <span className="fr-sub text-muted-foreground">最近 {history.length} 条，点击回看</span>
              </div>
              <button
                type="button"
                onClick={clearAll}
                className="fr-sub fr-tap inline-flex items-center gap-1.5 rounded-btn border border-border px-3 py-1.5 font-bold text-muted-foreground hover:border-destructive/50 hover:text-destructive"
              >
                <Trash2 className="h-5 w-5" aria-hidden="true" /> 清空全部
              </button>
            </div>
            <ul className="space-y-2">
              {history.map((h) => {
                const locked = h.locked === true;
                return (
                  <li
                    key={`${h.code}-${h.ts}`}
                    className={`rounded-btn border bg-muted/30 ${locked ? "border-primary/40" : "border-border"}`}
                  >
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void openHistory(h)}
                        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 text-left"
                      >
                        <span className={`fr-num min-w-[3ch] shrink-0 text-center ${scoreClass(h.score)}`}>{h.score}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">
                            <span className="fr-body font-bold">{h.name}</span>
                            <span className="fr-sub ml-2 text-muted-foreground">{h.code}</span>
                            {locked && (
                              <span className="fr-sub ml-2 inline-flex items-center gap-1 rounded px-2 py-0.5 font-bold text-primary">
                                <Lock className="h-3.5 w-3.5" aria-hidden="true" /> 已锁定
                              </span>
                            )}
                          </span>
                          <span className="fr-sub mt-0.5 block text-muted-foreground">
                            {formatTs(h.ts)} · 风险 {h.riskCount} 项
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className={`fr-sub rounded-btn px-3 py-1 font-bold ${gradeClass(h.shortTrend)}`}>短 {h.shortTrend}</span>
                          <span className={`fr-sub rounded-btn px-3 py-1 font-bold ${gradeClass(h.longTrend)}`}>长 {h.longTrend}</span>
                        </span>
                      </button>
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleLock(h)}
                          title={locked ? "点击解锁（解锁后才能删除）" : "点击锁定（锁定后不会被删除，也不影响导出）"}
                          aria-label={locked ? `解锁 ${h.name}` : `锁定 ${h.name}`}
                          className={actionBtnCls}
                        >
                          {locked ? <Unlock className="h-4 w-4" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
                          {locked ? "解锁" : "锁定"}
                        </button>
                        <button
                          type="button"
                          onClick={() => exportMarkdown(h)}
                          title="导出 Markdown（.md 文件下载）"
                          aria-label={`导出 ${h.name} 为 Markdown`}
                          className={actionBtnCls}
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" /> Markdown
                        </button>
                        <button
                          type="button"
                          onClick={() => exportPdf(h)}
                          title="导出 PDF（浏览器打印 → 另存为 PDF）"
                          aria-label={`导出 ${h.name} 为 PDF`}
                          className={actionBtnCls}
                        >
                          <Printer className="h-4 w-4" aria-hidden="true" /> PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => removeItem(h)}
                          disabled={locked}
                          title={locked ? "已锁定，请先解锁再删除" : "删除这条报告"}
                          aria-label={`删除 ${h.name}`}
                          className={deleteBtnCls}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" /> 删除
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
      <FrBackToTop />
    </div>
  );
}
