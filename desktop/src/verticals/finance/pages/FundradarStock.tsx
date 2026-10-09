/**
 * 资金雷达工作台 · 个股详情页（/stock/:code）
 * ------------------------------------------------------------
 * 从上到下：① 个股头卡（名称/代码/现价/涨跌幅/板块/换手/量比/持仓标记/返回）
 * ② K 线区（简洁/专业双模式，localStorage fr-kline-mode 记忆；专业模式 +MACD/BOLL/KDJ
 *   副图 + 日/周/月切换 + 十字光标 + dataZoom；分时图走 tdx_bars 一分钟，
 *   断连/无数据 → 降级腾讯分钟 K，两者都失败 → 隐藏分时标签并说明）③ 资金流向四维（当日/5日/20日，
 *   降级链 em_fund_flow_minute → em_fund_flow_120d → sina_fund_flow → 示例+提示）
 * ④ 龙虎榜记录（近 30 日次数 + 最近一次原因/净买额 + 买卖营业部明细 + 游资/机构标签）⑤ AI 解读入口。
 * 取数全部走 lib/fundradarStock.ts（复用 fundradarData 的 fetchFr 机制），
 * 任一区块失败只降级该区块，页面不崩。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Sparkles } from "lucide-react";

import { useAiPage } from "../../../core/ai/pageContext";
import { FrDataNotice } from "@/components/fundradar/FrDataNotice";
import { FrSectionNav, type FrSection } from "@/components/fundradar/FrSectionNav";
import { FrSectionRail } from "@/components/fundradar/FrSectionRail";
import { FrBackToTop } from "@/components/fundradar/FrBackToTop";
import { FrSkeleton, FrSkeletonCard, FrSkeletonChart } from "@/components/fundradar/FrSkeleton";
import { FrAnimatedNumber, FrChangePop } from "@/components/fundradar/FrAnimatedNumber";
import { FrStockChart } from "@/components/fundradar/FrStockChart";
import { FrFlowTrendChart, type FrFlowTrendPoint } from "@/components/fundradar/FrFlowTrendChart";
import { FrSourceFooter } from "@/components/fundradar/FrSourceFooter";
import { FrStockSectorNews } from "@/components/fundradar/FrSectorNews";

/** 个股详情页区块锚点（id 与下方各 section 对应） */
const STOCK_SECTIONS: FrSection[] = [
  { id: "stock-head", label: "个股头卡" },
  { id: "stock-kline", label: "K 线" },
  { id: "stock-flow", label: "资金流向" },
  { id: "stock-lhb", label: "龙虎榜记录" },
];
import {
  consecutiveFlow, loadStockFundFlow, loadStockIntraday, loadStockLive, mainNetRatio,
  type FrFlowDims, type FrFlowLive, type FrFlowPoint, type FrKlineLive, type FrLhbSeat, type FrLhbStock, type FrStockLive,
} from "@/lib/fundradarStock";
import { useHoldings } from "@/lib/fundradarPortfolio";
import { frDateLabel, frEndpointCn, useFrLoader, type FrLoaderState } from "@/lib/fundradarData";
import { frPctClass, frSigned } from "@/lib/fundradarTheme";
import { seatTagOf } from "@/lib/fundradarHotMoney";
import { aggregateKline, type KlineBar, type KlinePeriod } from "@/lib/fundradarIndicators";
import { isMarketTrading } from "@/lib/marketSymbol";
import { storageGet, storageSet } from "@/lib/storage";

/* ---------------- 常量 ---------------- */

const KLINE_MODE_KEY = "fr-kline-mode";
type KlineMode = "simple" | "pro";
type FlowTab = "today" | "5d" | "20d";

/** 资金区块级示例数据（仅当三个资金端点全部失败时展示，界面明确标注「示例」） */
const FLOW_SAMPLE = { main: 1.2e8, superLarge: 0.9e8, large: 0.3e8, mid: -0.7e8, small: -0.5e8 };

function loadKlineMode(): KlineMode {
  return storageGet(KLINE_MODE_KEY) === "pro" ? "pro" : "simple";
}

const yi = (v: number): string => `${v > 0 ? "+" : ""}${(v / 1e8).toFixed(2)}亿`;

/* ---------------- ① 头卡 ---------------- */

function HeaderCard({ code, live }: { code: string; live: FrStockLive }) {
  const q = live.quote;
  // ●我的持仓 标记：读用户持仓清单 loadHoldings（useHoldings 订阅增删改）
  const holdings = useHoldings();
  const holding = holdings.some((h) => h.code === code);
  return (
    <section id="stock-head" aria-label="个股头卡" className="fr-glass mb-4 scroll-mt-16 rounded-xl p-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Link to="/" className="fr-sub fr-tap flex items-center gap-1.5 rounded-btn border border-border px-3 py-1.5 text-muted-foreground hover:border-primary/50 hover:text-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> 返回
        </Link>
        {holding && (
          <span className="fr-chip fr-sub border-primary/40 text-primary" title="在持仓清单内">
            ● 我的持仓
          </span>
        )}
        <span className="fr-sub text-muted-foreground">{q ? frDateLabel(live.dataDate) : "行情未取到"}</span>
      </div>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <h1 className="fr-title font-bold">
            {q?.name ?? code}
            <span className="fr-sub ml-2 font-normal text-muted-foreground">{code}</span>
          </h1>
          <div className="mt-1 flex flex-wrap gap-2">
            {live.boards.map((b) => (
              <span key={b} className="fr-chip fr-sub">{b}</span>
            ))}
            {live.boards.length === 0 && <span className="fr-sub text-muted-foreground">板块归属未取到</span>}
          </div>
        </div>
        <div className="ml-auto text-right">
          <p className={`fr-num ${frPctClass(q?.chg ?? null)}`}>
            <FrAnimatedNumber value={q?.price} format={(v) => `¥${v.toFixed(2)}`} placeholder="¥—" />
          </p>
          <p className={`fr-body font-bold ${frPctClass(q?.chg ?? null)}`}>
            <FrChangePop value={q?.chg ?? null} className={frPctClass(q?.chg ?? null)}>
              {q?.chg == null ? "—" : frSigned(q.chg, "%")}
            </FrChangePop>
          </p>
        </div>
      </div>
      <div className="fr-sub mt-3 flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
        {q && (
          <>
            <span>今开 {q.open == null ? "—" : `${q.open.toFixed(2)}元`}</span>
            <span>最高 {q.high == null ? "—" : `${q.high.toFixed(2)}元`}</span>
            <span>最低 {q.low == null ? "—" : `${q.low.toFixed(2)}元`}</span>
            <span>昨收 {q.lastClose == null ? "—" : `${q.lastClose.toFixed(2)}元`}</span>
            <span>换手 {q.turnover == null ? "—" : `${q.turnover}%`}</span>
            <span>量比 {q.volRatio == null ? "—" : q.volRatio}</span>
            {q.mcap != null && <span>总市值 {q.mcap}亿</span>}
          </>
        )}
        {!q && <span>{frEndpointCn("现价 / 涨跌幅 / 换手 / 量比暂不可用（tx_quotes_batch 未取到）。")}</span>}
      </div>
    </section>
  );
}

/* ---------------- ② K 线区 ---------------- */

function KlineSection({
  kline, code,
}: {
  kline: FrKlineLive | null;
  code: string;
}) {
  const [mode, setMode] = useState<KlineMode>(loadKlineMode);
  const [period, setPeriod] = useState<KlinePeriod>("day");
  const [view, setView] = useState<"kline" | "intraday">("kline");
  const [intraday, setIntraday] = useState<{ probing: boolean; minutes: KlineBar[] | null; note: string }>({ probing: false, minutes: null, note: "" });

  const switchMode = (m: KlineMode) => {
    setMode(m);
    storageSet(KLINE_MODE_KEY, m);
    setView("kline"); // 切模式回到主图
    if (m === "simple") setPeriod("day");
  };

  // 分时懒探测：tdx_bars 一分钟在本机网络断连（超时）属预期 → 失败后降级腾讯分钟 K，
  // 两者都失败才隐藏分时标签并说明。
  // 失败结果按「代码+当天」记 sessionStorage，避免反复打注定失败的端点。
  const probeIntraday = useCallback(async () => {
    const skipKey = `fr-tdx-unavailable-${code}-${new Date().toISOString().slice(0, 10)}`;
    if (storageGet(skipKey)) {
      setIntraday({ probing: false, minutes: null, note: "分时不可用：分钟线端点在本机网络断连（当天已跳过重试）。" });
      return;
    }
    if (intraday.probing) return;
    setIntraday((s) => ({ ...s, probing: true }));
    try {
      const r = await Promise.race([
        loadStockIntraday(code),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 20_000)),
      ]);
      if (r && r.minutes && r.minutes.length > 0) {
        setIntraday({ probing: false, minutes: r.minutes, note: r.note });
        setView("intraday");
      } else {
        storageSet(skipKey, "1");
        setIntraday({ probing: false, minutes: null, note: "分时不可用：分钟线端点断连 / 无数据（已隐藏分时标签）。" });
      }
    } catch {
      storageSet(skipKey, "1");
      setIntraday({ probing: false, minutes: null, note: "分时不可用：分钟线端点断连 / 无数据（已隐藏分时标签）。" });
    }
  }, [code, intraday.probing]);

  const rows: KlineBar[] = useMemo(
    () => (kline?.daily ? aggregateKline(kline.daily, period) : []),
    [kline?.daily, period],
  );

  const hasIntraday = intraday.minutes !== null && intraday.minutes.length > 0;

  return (
    <section id="stock-kline" aria-label="K线区" className="fr-glass mb-4 scroll-mt-16 rounded-xl p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="fr-body font-bold">K 线</h2>
        <div className="flex flex-wrap gap-2" role="group" aria-label="K线模式">
          {([["simple", "简洁"], ["pro", "专业"]] as [KlineMode, string][]).map(([m, label]) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => switchMode(m)}
              className={`fr-sub fr-tap rounded-btn border px-4 font-bold ${mode === m ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary/50"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 专业模式工具条：周期切换 + 分时标签（无数据则隐藏并说明） */}
      {mode === "pro" && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {([["day", "日K"], ["week", "周K"], ["month", "月K"]] as [KlinePeriod, string][]).map(([p, label]) => (
            <button key={p} type="button" aria-pressed={period === p && view === "kline"}
              onClick={() => { setPeriod(p); setView("kline"); }}
              className={`fr-sub fr-tap rounded-btn border px-3 font-bold ${period === p && view === "kline" ? "border-primary/60 bg-primary-subtle-strong text-primary" : "border-border text-muted-foreground"}`}>
              {label}
            </button>
          ))}
          {hasIntraday ? (
            <button type="button" aria-pressed={view === "intraday"} onClick={() => setView("intraday")}
              className={`fr-sub fr-tap rounded-btn border px-3 font-bold ${view === "intraday" ? "border-primary/60 bg-primary-subtle-strong text-primary" : "border-border text-muted-foreground"}`}>
              分时
            </button>
          ) : (
            <button type="button" disabled={intraday.probing}
              onClick={() => void probeIntraday()}
              className="fr-sub fr-tap rounded-btn border border-dashed border-border px-3 text-muted-foreground disabled:opacity-60"
              title={intraday.note || frEndpointCn("尝试取盘中分时（tdx_bars → 腾讯分钟 K）")}>
              {intraday.probing ? "分时探测中…" : "分时"}
            </button>
          )}
        </div>
      )}

      {kline && kline.daily && rows.length > 0 ? (
        <FrStockChart
          rows={view === "intraday" && hasIntraday ? intraday.minutes! : rows}
          mode={mode}
          period={period}
          intraday={view === "intraday" && hasIntraday}
          height={mode === "simple" ? 440 : 660}
        />
      ) : kline ? (
        /* 信封摘要降级：日 K 蜡烛序列在底座 raw 文件、未对界面开放时如实说明 */
        <div className="fr-body rounded-btn border border-dashed border-border bg-muted/40 px-5 py-8 leading-relaxed">
          <p className="font-bold">日 K 序列暂不可用（蜡烛图未开放）</p>
          <p className="fr-sub mt-2 text-muted-foreground">
            {frEndpointCn("fetch_kline 信封只给最新收盘与条数（全序列在底座 raw 文件，界面暂无法读取）。")}
            最新前复权收盘 {kline.latestClose == null ? "—" : `¥${kline.latestClose.toFixed(2)}`}（{kline.dataDate}），
            共 {kline.bars} 根（{kline.start || "—"} 至 {kline.end || "—"}）。
          </p>
          <p className="fr-sub mt-1 text-muted-foreground">
            技术指标（MA/MACD/BOLL/KDJ）需完整序列，未取到序列时不显示、不编值。
          </p>
        </div>
      ) : (
        <div className="fr-body rounded-btn border border-dashed border-border bg-muted/40 px-5 py-8">
          {frEndpointCn("K 线数据暂不可用（fetch_kline 取数失败），请点右上「重试」。")}
        </div>
      )}

      <p className="fr-sub mt-2 text-muted-foreground">
        {mode === "simple"
          ? "简洁模式：日K蜡烛 + MA5/10/20 + 成交量；切换「专业」查看 MACD/BOLL/KDJ 副图、日/周/月与缩放。"
          : "专业模式：MACD(12,26,9)·BOLL(20,2)·KDJ(9,3,3) 为前端自算（口径见 fundradarIndicators.ts）；周/月线由日K聚合；十字光标+滚轮缩放。"}
        {intraday.note && !hasIntraday ? ` ${intraday.note}` : ""}
      </p>
      <FrSourceFooter
        items={kline
          ? [
              `K 线：${kline.source} · ${kline.bars} 根（${kline.start || "—"} 至 ${kline.end || "—"}）`,
              `口径：日K前复权；周/月线由日K聚合，MACD/BOLL/KDJ 前端自算。`,
            ]
          : ["K 线：未取到（fetch_kline 取数失败）。"]}
      />
    </section>
  );
}

/* ---------------- ③ 资金流向区 ---------------- */

const FLOW_DIM_LABELS = [
  { key: "main", label: "主力" },
  { key: "superLarge", label: "超大单" },
  { key: "large", label: "大单" },
  { key: "mid", label: "中单" },
  { key: "small", label: "小单" },
] as const;

function FlowSection({ flow, kline }: { flow: FrFlowLive | null; kline: FrKlineLive | null }) {
  const [tab, setTab] = useState<FlowTab>("today");
  const [trendDays, setTrendDays] = useState<20 | 60>(20);
  // 示例数据（三源全失败）：明确标注，不冒充真实
  const sample = flow === null;
  // 第一重点「今日资金方向」：当日主力净流入（元）；三源全失败回退示例值
  const todayMain: number | null = sample ? FLOW_SAMPLE.main : (flow.today?.main ?? null);

  // ---- 日序列（趋势曲线 + 强度指标共用口径） ----
  const series: FrFlowPoint[] = sample ? [] : flow.series;
  const lastPoint = series.length > 0 ? series[series.length - 1]! : null;

  // K 线收盘价按日期合并：趋势图折线优先用前复权 K 线收盘，缺则回退新浪 trade
  const klineMap = useMemo(() => {
    const m = new Map<string, KlineBar>();
    for (const b of kline?.daily ?? []) m.set(b.date, b);
    return m;
  }, [kline?.daily]);
  const trendPoints: FrFlowTrendPoint[] = useMemo(() => series.map((p) => ({
    date: p.date,
    main: p.main,
    superLarge: p.superLarge,
    close: klineMap.get(p.date)?.close ?? p.close,
  })), [series, klineMap]);

  // ---- 强度指标（由日序列确定性计算） ----
  const ratio = mainNetRatio(lastPoint ?? undefined, lastPoint ? klineMap.get(lastPoint.date) : undefined);
  const consec = useMemo(() => consecutiveFlow(series), [series]);
  const sum20 = sample ? null : flow.sum20;

  const signedYi = (v: number) => `${v > 0 ? "+" : ""}${(v / 1e8).toFixed(2)}亿`;
  const ratioText = ratio == null ? "—" : `${ratio > 0 ? "+" : ""}${(ratio * 100).toFixed(2)}%`;
  const consecLabel = consec.dir === "in" ? "连续流入" : consec.dir === "out" ? "连续流出" : "连续方向";
  const consecValue = consec.dir == null ? "—" : `${consec.days} 天`;

  // 诚实降级注：sina 无中单/小单；东财 push2his 本机不通
  const fourDimNote = !sample && flow.source.includes("sina")
    ? "四维历史序列当前数据源受限（东财 push2his 本机不通）；趋势图为主力口径，超大单可叠加（新浪 r0_net）；中单/小单无日序列。"
    : null;

  // 当前 tab 的五档值：当日 = flow.today；5日/20日 = flow.dims5/dims20（日序列尾 N 条五档合计）
  const dims: FrFlowDims | null = sample
    ? { main: FLOW_SAMPLE.main, superLarge: FLOW_SAMPLE.superLarge, large: FLOW_SAMPLE.large, mid: FLOW_SAMPLE.mid, small: FLOW_SAMPLE.small, asOf: "示例" }
    : tab === "today"
      ? flow.today
      : tab === "5d"
        ? flow.dims5
        : flow.dims20;

  /** 展示口径：各档净流入（元）→ 亿；占比 = 该档绝对值 ÷ 五档绝对值合计（纯展示聚合） */
  const rows = FLOW_DIM_LABELS.map(({ key, label }) => {
    const v = dims?.[key] ?? null;
    return { key, label, value: v, yiText: v === null ? "—" : yi(v) };
  });
  // 中单/小单缺失时的合并项：中单+小单 = -主力（东财四档净额合计为 0 的口径；新浪无中/小单时为近似）
  const mainV = dims?.main ?? null;
  const merged = rows[3]!.value === null && rows[4]!.value === null && mainV !== null;
  const mergedValue = merged && mainV !== null ? -mainV : null;
  const absSum = rows.reduce((s, r) => s + Math.abs(r.value ?? 0), 0);

  const tabLabel = tab === "today" ? "当日" : tab === "5d" ? "近 5 个交易日" : "近 20 个交易日";

  /** 出处减弱（L4）：资金数据源与口径收到底部折叠 */
  const flowSourceItems: string[] = sample
    ? ["资金数据：em_fund_flow_minute / em_fund_flow_120d / akshare_fund_flow_120d / sina_fund_flow 均未取到，展示示例值。"]
    : [
        `数据源：${flow.source}${dims?.asOf ? ` · ${dims.asOf}` : ""}`,
        flow.note,
        "口径：红入绿出；占比 = 各档绝对值 ÷ 五档绝对值合计（展示口径）。",
        fourDimNote,
      ].filter((x): x is string => typeof x === "string" && x.length > 0);

  return (
    <section id="stock-flow" aria-label="资金流向" className="fr-glass mb-4 scroll-mt-16 rounded-xl p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="fr-body font-bold">资金流向</h2>
      </div>

      {/* 第一重点：今日资金方向（红=净流入 / 绿=净流出） */}
      <div className="mb-4 rounded-btn border border-border bg-muted/40 px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p className="fr-sub font-bold text-muted-foreground">今日主力资金</p>
          <p className={`fr-num ${todayMain == null ? "fr-flat" : todayMain >= 0 ? "fr-up" : "fr-down"}`}>
            <FrAnimatedNumber value={todayMain} format={signedYi} />
          </p>
          <span className={`fr-body font-bold ${todayMain == null ? "fr-flat" : todayMain >= 0 ? "fr-up" : "fr-down"}`}>
            {todayMain == null ? "数据未取到" : todayMain >= 0 ? "净流入" : "净流出"}
          </span>
        </div>
        <p className="fr-sub mt-1 text-muted-foreground">红=净流入 · 绿=净流出 · 当日主力口径</p>
      </div>

      {/* B 强度指标：三张大字卡 */}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-btn border border-border bg-muted/40 p-4">
          <p className="fr-sub font-bold text-muted-foreground">主力净占比（当日）</p>
          <p className={`fr-num mt-1 ${frPctClass(ratio)}`}>{ratioText}</p>
          <p className="fr-sub mt-1 leading-relaxed text-muted-foreground">当日主力净流入 ÷ 成交额</p>
        </div>
        <div className="rounded-btn border border-border bg-muted/40 p-4">
          <p className="fr-sub font-bold text-muted-foreground">{consecLabel}</p>
          <p className={`fr-num mt-1 ${consec.dir === "in" ? "fr-up" : consec.dir === "out" ? "fr-down" : "fr-flat"}`}>{consecValue}</p>
          <p className="fr-sub mt-1 leading-relaxed text-muted-foreground">由日序列逐日符号计算</p>
        </div>
        <div className="rounded-btn border border-border bg-muted/40 p-4">
          <p className="fr-sub font-bold text-muted-foreground">20 日累计净流入（主力）</p>
          <p className={`fr-num mt-1 ${frPctClass(sum20)}`}>{sum20 == null ? "—" : signedYi(sum20)}</p>
          <p className="fr-sub mt-1 leading-relaxed text-muted-foreground">日序列尾部 20 日求和</p>
        </div>
      </div>

      {/* A 趋势曲线：双轴（柱=主力净流入，折线=收盘价），20/60 日切换 */}
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <p className="fr-sub font-bold text-muted-foreground">主力资金趋势</p>
        <div className="flex gap-2" role="group" aria-label="趋势窗口">
          {([20, 60] as const).map((d) => (
            <button key={d} type="button" aria-pressed={trendDays === d} onClick={() => setTrendDays(d)}
              className={`fr-sub fr-tap rounded-btn border px-4 font-bold ${trendDays === d ? "border-primary/60 bg-primary-subtle-strong text-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
              {d}日
            </button>
          ))}
        </div>
      </div>
      {series.length > 0 ? (
        <div className="mb-4">
          <FrFlowTrendChart points={trendPoints} days={trendDays} height={360} />
          <p className="fr-sub mt-1 text-muted-foreground">
            柱 = 主力净流入（左轴，亿，红入绿出）；折线 = 收盘价（右轴，元）；虚线 = 超大单净流入（左轴，亿）。
            {fourDimNote ? ` ${fourDimNote}` : ""}
          </p>
        </div>
      ) : (
        <div className="fr-body mb-4 rounded-btn border border-dashed border-border bg-muted/40 px-5 py-6">
          {frEndpointCn("趋势曲线与强度指标暂不可得：资金日序列未开放（em_fund_flow_120d 与 sina_fund_flow raw 均不可读），显示「—」不编值。")}
        </div>
      )}

      {/* 四维明细（当日 / 5日 / 20日 分档） */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="fr-sub font-bold text-muted-foreground">分档明细</p>
        <div className="flex gap-2" role="group" aria-label="资金时间范围">
          {([["today", "当日"], ["5d", "5日"], ["20d", "20日"]] as [FlowTab, string][]).map(([t, label]) => (
            <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}
              className={`fr-sub fr-tap rounded-btn border px-4 font-bold ${tab === t ? "border-primary/60 bg-primary-subtle-strong text-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {dims === null && !sample ? (
        <p className="fr-body rounded-btn border border-dashed border-border bg-muted/40 px-5 py-8">
          {tabLabel}四维暂不可得：日序列未开放（raw 接缝不可读），显示「—」不编值。
        </p>
      ) : (
        <div className="space-y-2.5">
          {merged && mergedValue !== null ? (
            <>
              {rows.slice(0, 3).map((r) => (
                <div key={r.key} className="flex items-center gap-3">
                  <span className="fr-sub w-20 shrink-0 text-muted-foreground">{r.label}</span>
                  <div className="h-7 min-w-0 flex-1 overflow-hidden rounded-md bg-muted">
                    <div
                      style={{
                        width: `${absSum > 0 ? Math.min(100, (Math.abs(r.value ?? 0) / absSum) * 240) : 0}%`,
                        background: (r.value ?? 0) >= 0 ? "var(--color-up)" : "var(--color-down)",
                      }}
                      className="h-full rounded-md"
                    />
                  </div>
                  <span className={`fr-sub w-24 shrink-0 text-right font-bold ${frPctClass(r.value)}`}>{r.yiText}</span>
                  <span className="fr-sub w-14 shrink-0 text-right text-muted-foreground">
                    {absSum > 0 && r.value !== null ? `${Math.round((Math.abs(r.value) / absSum) * 100)}%` : "—"}
                  </span>
                </div>
              ))}
              <div className="flex items-center gap-3">
                <span className="fr-sub w-20 shrink-0 text-muted-foreground">中单+小单</span>
                <div className="h-7 min-w-0 flex-1 overflow-hidden rounded-md bg-muted">
                  <div
                    style={{
                      width: `${absSum > 0 ? Math.min(100, (Math.abs(mergedValue) / absSum) * 240) : 0}%`,
                      background: mergedValue >= 0 ? "var(--color-down)" : "var(--color-up)",
                    }}
                    className="h-full rounded-md"
                  />
                </div>
                <span className={`fr-sub w-24 shrink-0 text-right font-bold ${frPctClass(mergedValue)}`}>{yi(mergedValue)}</span>
                <span className="fr-sub w-14 shrink-0 text-right text-muted-foreground">
                  {absSum > 0 ? `${Math.round((Math.abs(mergedValue) / absSum) * 100)}%` : "—"}
                </span>
              </div>
            </>
          ) : (
            rows.map((r) => (
              <div key={r.key} className="flex items-center gap-3">
                <span className="fr-sub w-20 shrink-0 text-muted-foreground">{r.label}</span>
                <div className="h-7 min-w-0 flex-1 overflow-hidden rounded-md bg-muted">
                  <div
                    style={{
                      width: `${absSum > 0 ? Math.min(100, (Math.abs(r.value ?? 0) / absSum) * 240) : 0}%`,
                      background: (r.value ?? 0) >= 0 ? "var(--color-up)" : "var(--color-down)",
                    }}
                    className="h-full rounded-md"
                  />
                </div>
                <span className={`fr-sub w-24 shrink-0 text-right font-bold ${frPctClass(r.value)}`}>{r.yiText}</span>
                <span className="fr-sub w-14 shrink-0 text-right text-muted-foreground">
                  {absSum > 0 && r.value !== null ? `${Math.round((Math.abs(r.value) / absSum) * 100)}%` : "—"}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {sample && (
        <p className="fr-sub mt-2 font-bold text-warning">资金数据暂不可用，以上为示例数据（三源均未取到）。</p>
      )}
      <FrSourceFooter items={flowSourceItems} />
      <p className="fr-sub mt-1 text-muted-foreground">想知道谁在买？看下方龙虎榜席位</p>
    </section>
  );
}

/* ---------------- ④ 龙虎榜区 ---------------- */

/** 席位一行：游资 / 机构 标签（命中才显示）+ 营业部名 + 净额红绿 */
function SeatRow({ seat }: { seat: FrLhbSeat }) {
  const tag = seatTagOf(seat.name);
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate">
        {tag ? (
          <span className="fr-tag">{tag.label}</span>
        ) : (
          <span className="fr-sub text-muted-foreground">{seat.name}</span>
        )}
      </span>
      <span className={`fr-sub shrink-0 font-bold ${frPctClass(seat.netWan)}`}>
        {seat.netWan >= 0 ? "+" : ""}{(seat.netWan / 10000).toFixed(2)}亿
      </span>
    </div>
  );
}

function LhbSection({ lhb }: { lhb: FrLhbStock | null }) {
  if (!lhb) {
    return (
      <section id="stock-lhb" aria-label="龙虎榜记录" className="fr-glass mb-4 scroll-mt-16 rounded-xl p-5">
        <h2 className="fr-body font-bold">龙虎榜记录</h2>
        <p className="fr-sub mt-2 text-muted-foreground">个股龙虎榜数据暂不可用（取数失败）。</p>
      </section>
    );
  }
  const latest = lhb.records[0] ?? null;
  const buySeats = lhb.seats.buy.slice(0, 5);
  const sellSeats = lhb.seats.sell.slice(0, 5);
  return (
    <section id="stock-lhb" aria-label="龙虎榜记录" className="fr-glass mb-4 scroll-mt-16 rounded-xl p-5">
      <h2 className="fr-body font-bold">龙虎榜记录
        <span className="fr-sub ml-2 font-normal text-muted-foreground">近 30 日上榜 {lhb.count} 次</span>
      </h2>
      {lhb.count === 0 ? (
        <p className="fr-sub mt-3 text-muted-foreground">近 30 日无上榜记录（真实状态，非故障）。</p>
      ) : (
        <div className="mt-3 space-y-3">
          {latest && (
            <div className="fr-body rounded-lg border border-border bg-muted/40 p-4">
              <p className="font-bold">最近一次：{latest.date}
                {latest.netWan >= 0
                  ? <span className="fr-up"> 净买 +{(latest.netWan / 10000).toFixed(2)}亿</span>
                  : <span className="fr-down"> 净卖 {(latest.netWan / 10000).toFixed(2)}亿</span>}
              </p>
              <p className="fr-sub mt-1 text-muted-foreground">上榜原因：{latest.reason || "—"}</p>
              {lhb.institutionNetWan != null && (
                <p className="fr-sub mt-1 text-muted-foreground">
                  机构席位净额 {(lhb.institutionNetWan >= 0 ? "+" : "")}{(lhb.institutionNetWan / 10000).toFixed(2)}亿（东财机构专用口径）
                </p>
              )}
            </div>
          )}

          {(buySeats.length > 0 || sellSeats.length > 0) && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-btn border border-border bg-muted/40 p-4">
                <p className="fr-sub font-bold text-muted-foreground">买入席位（前 5）</p>
                {buySeats.length === 0 ? (
                  <p className="fr-sub mt-1 text-muted-foreground">—</p>
                ) : (
                  <div className="mt-1.5 space-y-1.5">
                    {buySeats.map((s, i) => <SeatRow key={`buy-${s.name}-${i}`} seat={s} />)}
                  </div>
                )}
              </div>
              <div className="rounded-btn border border-border bg-muted/40 p-4">
                <p className="fr-sub font-bold text-muted-foreground">卖出席位（前 5）</p>
                {sellSeats.length === 0 ? (
                  <p className="fr-sub mt-1 text-muted-foreground">—</p>
                ) : (
                  <div className="mt-1.5 space-y-1.5">
                    {sellSeats.map((s, i) => <SeatRow key={`sell-${s.name}-${i}`} seat={s} />)}
                  </div>
                )}
              </div>
            </div>
          )}

          {lhb.records.length > 1 && (
            <p className="fr-sub text-muted-foreground">
              近 30 日共 {lhb.records.length} 条记录：
              {lhb.records.slice(1, 6).map((r) => `${r.date} ${r.reason || "上榜"}`).join("；")}
              {lhb.records.length > 6 ? `…（余 ${lhb.records.length - 6} 条）` : ""}
            </p>
          )}
          <FrSourceFooter
            items={[
              `统计窗口：${lhb.window[0]} 至 ${lhb.window[1]} · 上榜 ${lhb.count} 次`,
              "席位明细：em_dragon_tiger 最新一次上榜的 extra.seats（万元→亿换算）",
              "游资标签：公开经验口径，非官方，仅供提示。",
            ]}
          />
        </div>
      )}
    </section>
  );
}

/* ---------------- 页面主体 ---------------- */

export function FundradarStock() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const normalized = /^\d{6}$/.test(code ?? "") ? code! : null;

  const load = useCallback(
    (refresh: boolean) => (normalized ? loadStockLive(normalized, refresh) : Promise.resolve(null)),
    [normalized],
  );
  const { loading, live, failed, retry }: FrLoaderState<FrStockLive | null> = useFrLoader(load);

  // 盘中分钟资金流：每 5 分钟刷新当日四维（源为 em_fund_flow_minute 且交易时段内）
  const [flowLive, setFlowLive] = useState<FrFlowLive | null>(null);
  useEffect(() => {
    setFlowLive(live?.flow ?? null);
  }, [live?.flow]);
  useEffect(() => {
    if (!normalized) return;
    if (!flowLive?.intraday) return;
    if (!isMarketTrading("CN")) return;
    const timer = window.setInterval(() => {
      void loadStockFundFlow(normalized, false)
        .then((f) => { if (f) setFlowLive(f); })
        .catch(() => { /* 单次刷新失败：保留现有数据，下一拍再试 */ });
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [normalized, flowLive?.intraday]);

  // AI 解读：sessionStorage 预填 → 跳 /agent-chat
  const askAi = () => {
    if (!normalized) return;
    const name = live?.quote?.name ?? "";
    window.sessionStorage.setItem("fr-ai-prefill", `帮我看看 ${name} ${normalized}`);
    navigate("/agent-chat");
  };

  const aiContext = normalized && live
    ? `个股详情（真实数据 ${live.dataDate}）：${live.quote?.name ?? ""}${normalized} 现价${live.quote?.price ?? "—"} ${live.quote?.chg == null ? "—" : frSigned(live.quote.chg, "%")}；板块${live.boards.join("、") || "—"}；K线${live.kline ? `${live.kline.bars}根（${live.kline.start}..${live.kline.end}）` : "未取到"}；资金${live.flow ? `${live.flow.source} 主力${live.flow.today?.main == null ? "—" : yi(live.flow.today.main)}` : "未取到"}；近30日龙虎榜上榜${live.lhb?.count ?? "—"}次。`
    : `个股详情（${normalized ?? "无效代码"}）：数据尚未取到。`;

  useAiPage({
    key: `fundradar-stock-${normalized ?? "bad"}`,
    title: `资金雷达 · 个股 ${normalized ?? ""}`,
    context: aiContext,
  });

  if (!normalized) {
    return (
      <div data-fr-page="fundradar-stock" className="fr-elder-page p-6">
        <div className="fr-fade-in mx-auto max-w-[1500px]">
          <section className="fr-glass rounded-xl p-8">
            <h1 className="fr-title font-bold">个股详情</h1>
            <p className="fr-body mt-3">链接里的代码不对：请输入 6 位 A 股代码（如 600183）。</p>
            <Link to="/" className="fr-sub mt-4 inline-block font-bold text-primary hover:underline">← 回首页搜索</Link>
          </section>
        </div>
      </div>
    );
  }

  // 首次加载（无数据）：头卡 + K线 + 资金 三块骨架屏，替代「正在取数…」小字
  if (loading && !live) {
    return (
      <div data-fr-page="fundradar-stock" className="fr-elder-page p-6">
        <div className="fr-fade-in mx-auto max-w-[1500px]">
          <span className="sr-only" role="status">正在加载个股数据…</span>

          {/* 头卡骨架 */}
          <section aria-label="加载中" className="fr-glass mb-4 rounded-xl p-5">
            <div className="mb-3 flex items-center gap-3">
              <FrSkeleton className="rounded-lg" style={{ height: "calc(var(--fs-sub) * 1.7)", width: 88 }} />
              <FrSkeleton className="rounded-full" style={{ height: "calc(var(--fs-sub) * 1.7)", width: 120 }} />
            </div>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
              <FrSkeleton className="w-56 rounded-md" style={{ height: "calc(var(--fs-title) * 1.05)" }} />
              <FrSkeleton className="ml-auto rounded-md" style={{ height: "calc(var(--fs-num) * 0.9)", width: 170 }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
              {[0, 1, 2, 3, 4].map((i) => (
                <FrSkeleton key={i} className="rounded-md" style={{ height: "calc(var(--fs-sub) * 1.1)", width: 96 }} />
              ))}
            </div>
          </section>

          {/* K线骨架 */}
          <section aria-label="加载中" className="fr-glass mb-4 rounded-xl p-5">
            <FrSkeleton className="mb-3 w-40 rounded-md" style={{ height: "calc(var(--fs-body) * 1.1)" }} />
            <FrSkeletonChart height={440} />
          </section>

          {/* 资金骨架 */}
          <section aria-label="加载中" className="fr-glass mb-4 rounded-xl p-5">
            <FrSkeleton className="mb-4 w-40 rounded-md" style={{ height: "calc(var(--fs-body) * 1.1)" }} />
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-lg border border-border bg-muted/40 p-4">
                  <FrSkeletonCard lines={2} />
                </div>
              ))}
            </div>
            <FrSkeletonChart height={360} spinner={false} />
          </section>
        </div>
      </div>
    );
  }

  const lhb = live?.lhb ?? null;
  const kline = live?.kline ?? null;

  return (
    <div data-fr-page="fundradar-stock" className="fr-elder-page p-6">
      <div className="fr-fade-in mx-auto max-w-[1500px]">
        <FrDataNotice loading={loading} missing={failed ? ["全部数据"] : live?.missing ?? []} onRetry={retry} />

        {/* 页内锚点导航 + 右侧章节导轨 */}
        <FrSectionNav sections={STOCK_SECTIONS} />
        <FrSectionRail sections={STOCK_SECTIONS} />

        {live && <HeaderCard code={normalized} live={live} />}

        {!live && !loading && (
          <section className="fr-glass mb-4 rounded-xl p-5">
            <p className="fr-body">整页数据未取到，页面不显示数字（不编值）。</p>
          </section>
        )}

        <KlineSection kline={kline} code={normalized} />

        <FlowSection flow={flowLive} kline={kline} />

        <LhbSection lhb={lhb} />

        {/* ④.5 所属板块要闻（按个股概念板块归属，关联对应板块利好利空新闻前 3 条） */}
        <FrStockSectorNews boards={live?.boards ?? []} />

        {/* ⑤ AI 解读入口 */}
        <button type="button" onClick={askAi}
          className="fr-title fr-btn-h fr-press mb-3 flex w-full items-center justify-center gap-3 rounded-btn border border-border bg-card py-3 font-bold text-primary transition-colors hover:border-primary/50 hover:bg-muted">
          <Sparkles className="h-6 w-6" aria-hidden="true" />
          让 AI 说说这只票
        </button>

        <p className="fr-sub mb-5 text-muted-foreground">
          点击后跳转 Agent 对话并自动预填「帮我看看 {live?.quote?.name || ""} {normalized}」。
          本页只展示数据，不给任何投资动作建议。
        </p>

        {/* 供测试/排查：数据链路一目了然（不展示敏感信息） */}
        <details className="fr-sub mb-4 rounded-btn border border-border bg-muted/30 p-3 text-muted-foreground">
          <summary className="cursor-pointer font-bold">数据链路（自检）</summary>
          <ul className="mt-2 list-disc pl-5 leading-relaxed">
            <li>头卡：腾讯行情（现价/涨跌幅/换手/量比）+ 概念板块（板块）{live?.missing.includes("行情") ? " · 已降级" : " · OK"}</li>
            <li>K线：日K线（日K前复权）{kline ? (kline.seriesOk ? " · 序列OK（raw 接缝）" : " · 信封摘要（序列未开放）") : " · 已降级"}</li>
            <li>分时：通达信分时(1分) → 腾讯分钟分时 · 两源都失败则隐藏</li>
            <li>资金：分钟资金流 → 120日资金流 → akshare四维资金流 → 新浪资金流{flowLive ? ` · 命中 ${frEndpointCn(flowLive.source)}` : " · 全部失败（示例）"}</li>
            <li>龙虎榜：个股龙虎榜{lhb ? ` · OK（${lhb.count} 次）` : " · 已降级"}</li>
          </ul>
        </details>
      </div>
      <FrBackToTop />
    </div>
  );
}
