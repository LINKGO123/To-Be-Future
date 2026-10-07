/**
 * 资金雷达工作台 · 首页（常用区域 P1）
 * ------------------------------------------------------------
 * 布局对齐 shadcn taxonomy 现代 dashboard 范式（KPI 卡片矩阵 + 图表优先 +
 * 一个主色点睛 + 大量留白），信息层级从上到下：
 *   1. 顶部标题区（标题 + 今日日期｜搜索 + 自动刷新徽标）
 *   2. 今日市场卡（第一重点：primary 淡底 + 左描边）
 *   3. KPI 卡片一排（涨停家数 / 最高连板 / 持仓今日盈亏 / 主线热度）
 *   4. 持仓卡片网格（每只一张卡）
 *   5. 主线热度趋势（暂无板块级 20 日序列端点 → 跳过，不造假数据）
 *   6. 全球要闻（简洁列表 + 分隔线 + hover）
 *   7. 五功能快捷入口（底部一行：图标 + 短文字）
 *
 * 数据（刀5）：真实数据来自底座 —— 持仓行情 tx_quotes_batch、
 * 情绪 em_limit_up_sentiment + 主线 em_zt_pool（涨停池）、全球要闻 em_global_news（备源 rss_news）。
 * 任一取数失败 → 该块降级为示例数据并在顶部提示「点击重试」，页面不会崩。
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, ExternalLink, Globe, Mic, Newspaper, Radar, Search, Settings, TrendingUp, Wallet,
  type LucideIcon,
} from "lucide-react";
import { useAiPage } from "../../../core/ai/pageContext";
import { FrDataNotice } from "@/components/fundradar/FrDataNotice";
import { FrAutoRefreshBadge } from "@/components/fundradar/FrDataStatus";
import { FrWorldIndexCard } from "@/components/fundradar/FrWorldIndexCard";
import { FrSectorNews } from "@/components/fundradar/FrSectorNews";
import { FR_NEWS_PAGE_SIZE, FrPager } from "@/components/fundradar/FrPager";

import { FrSkeleton, FrSkeletonLine } from "@/components/fundradar/FrSkeleton";
import { FrAnimatedNumber, frStaggerDelay } from "@/components/fundradar/FrAnimatedNumber";
import {
  frDateCn, frDateLabel, frEndpointCn, frTodayKey, loadHomeLive, useFrLoader,
  type FrHomeLive, type FrNewsItem, type FrQuote,
} from "@/lib/fundradarData";
import { resolveStockCode } from "@/lib/fundradarStock";
import { useHoldings } from "@/lib/fundradarPortfolio";
import {
  FR_DISCLAIMER, FR_EMOTION, FR_FEATURE_GROUPS, FR_HEAT_RANK, FR_NEWS, FR_SUGGESTIONS,
} from "@/data/fundradarSample";
import { frSigned } from "@/lib/fundradarTheme";
import { loadWorldIndices, type FrWorldIndex } from "@/lib/fundradarWorldIndex";

// 名称→6 位代码 的查名逻辑已收敛到 lib/fundradarStock.ts 的 resolveStockCode（首页与报告页共用）。

/** 五功能快捷入口图标（按组标题映射，底部一行入口用） */
const FEATURE_ICONS: Record<string, LucideIcon> = {
  "看主线": Radar,
  "看资金": TrendingUp,
  "我的持仓": Wallet,
  "情报与晨报": Newspaper,
  "设置": Settings,
};

export function FundradarHome() {
  const { loading, live, failed, retry } = useFrLoader<FrHomeLive>(loadHomeLive);
  const navigate = useNavigate();
  const [searchQ, setSearchQ] = useState("");
  const [searchHint, setSearchHint] = useState("");
  const [searching, setSearching] = useState(false);
  /** 全球要闻：当前展开详情的条目下标（null = 未展开） */
  const [openNewsIdx, setOpenNewsIdx] = useState<number | null>(null);
  /** 全球要闻：当前列表页码（每页 10 条） */
  const [newsPage, setNewsPage] = useState(1);
  const holdings = useHoldings();
  const worldIndices = useFrLoader<FrWorldIndex[]>(loadWorldIndices);

  /**
   * 个股搜索：6 位代码直接跳 /stock/<code>；名称先查本地持仓档案（持仓名已知代码），
   * 再读 CATALOG 走 iwencai_query 名称解析；都不可用 → 提示输 6 位代码。
   */
  const submitSearch = async () => {
    const t = searchQ.trim();
    if (!t || searching) return;
    if (/^\d{6}$/.test(t)) {
      setSearchHint("");
      navigate(`/stock/${t}`);
      return;
    }
    setSearching(true);
    setSearchHint("正在按名称查找代码…");
    try {
      const hit = await resolveStockCode(t);
      if (hit) {
        setSearchHint("");
        navigate(`/stock/${hit.code}`);
      } else {
        setSearchHint("按名称找不到（iwencai 未配置或未收录）：请输入 6 位 A 股代码（如 600183）");
      }
    } catch {
      setSearchHint("按名称找不到：请输入 6 位 A 股代码（如 600183）");
    } finally {
      setSearching(false);
    }
  };
  /** 新闻详情里的「让 AI 解读这条新闻」：sessionStorage 预填 → 跳 /agent-chat（读后即清，只预填不自动发送） */
  const askAiNews = (n: FrNewsItem) => {
    window.sessionStorage.setItem("fr-ai-prefill", `帮我解读这条新闻：${n.title}`);
    navigate("/agent-chat");
  };
  /** 弹层内上下条切换：夹取下标 + 同步所在页，保证详情与列表页码一致 */
  const goNewsIdx = (idx: number) => {
    if (news.length === 0) return;
    const clamped = Math.max(0, Math.min(news.length - 1, idx));
    setOpenNewsIdx(clamped);
    setNewsPage(Math.floor(clamped / FR_NEWS_PAGE_SIZE) + 1);
  };

  // 新闻详情弹层：Esc 关闭（友好，醒目关闭按钮之外再多一条退路）
  useEffect(() => {
    if (openNewsIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenNewsIdx(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNewsIdx]);

  const radar = live?.radar ?? null;
  const sentiment = radar?.sentiment ?? null;
  const topLine = radar?.heat[0] ?? null;
  const quotes: FrQuote[] = live?.quotes ?? [];
  const news: FrNewsItem[] = live?.news ?? FR_NEWS.map((n) => ({ ...n, time: "" }));
  const openNews = openNewsIdx === null ? null : (news[openNewsIdx] ?? null);
  const totalNewsPages = Math.max(1, Math.ceil(news.length / FR_NEWS_PAGE_SIZE));
  const curNewsPage = Math.min(newsPage, totalNewsPages);
  const newsStart = (curNewsPage - 1) * FR_NEWS_PAGE_SIZE;
  const pageNews = news.slice(newsStart, newsStart + FR_NEWS_PAGE_SIZE);
  const usingSample = !live;
  const dataDate = live?.dataDate ?? "";

  // 示例兜底值（真实数据缺失时与既有 sample 数据一致；只用于展示，不算作真实数据）
  const sampleTop = FR_HEAT_RANK[0]!;
  const ztCount = sentiment ? sentiment.zt : FR_EMOTION.ztTotal;
  const maxBoard = radar ? radar.maxBoard : FR_EMOTION.maxBoard;
  const lamp = sentiment ? sentiment.lamp : FR_EMOTION.lamp;
  const zhaRateLabel = sentiment ? `${sentiment.zhaRatePct}%` : FR_EMOTION.zhaRate;
  const topLineName = topLine ? topLine.name : sampleTop.name;
  const topLineZt = topLine ? topLine.zt : sampleTop.zt;
  const topLineFlow = topLine ? topLine.flow : sampleTop.flow;
  const topLineHeight = topLine ? topLine.height : sampleTop.height;
  const topLineHot = topLine ? topLine.hot : sampleTop.hot;
  const topLineCover = topLine ? topLine.cover : sampleTop.cover;

  // 主线横幅切换脉冲：数据刷新后主线换方向（topLineName 变化）时，给横幅
  // 一次性 .fr-flash-once 高亮（key 重挂触发动画，只闪一次）。首次真实数据落盘不闪。
  const [bannerFlash, setBannerFlash] = useState(0);
  const prevTopLineRef = useRef<string | null>(null);
  const hadLiveRef = useRef(false);
  useEffect(() => {
    if (!live) return; // 示例数据阶段不追踪主线变化
    const name = topLineName;
    if (hadLiveRef.current && prevTopLineRef.current !== name) {
      setBannerFlash((n) => n + 1);
    }
    hadLiveRef.current = true;
    prevTopLineRef.current = name;
  }, [live, topLineName]);

  // 持仓累计盈亏（首页第一重点之一）：按（现价−成本）×数量合计，与持仓页同口径；
  // 未录成本/数量的持仓不计入，返回 null 表示「暂无盈亏数据」。
  const pnlTotal = holdings.reduce<number | null>((sum, h) => {
    const q = quotes.find((x) => x.code === h.code);
    if (q?.price != null && h.cost != null && h.qty != null) {
      return (sum ?? 0) + (q.price - h.cost) * h.qty;
    }
    return sum;
  }, null);

  const aiContext = usingSample
    ? `资金雷达首页（示例数据）：今日情绪中、涨停52家、最高5板；持仓：${holdings.map((h) => h.name).join("、") || "暂无"}。`
    : `资金雷达首页（真实数据 ${dataDate}）：涨停${sentiment?.zt ?? "—"}家、炸板率${sentiment?.zhaRatePct ?? "—"}%${topLine ? `；主线${topLine.name} ${topLine.zt}家涨停${topLine.flow != null ? ` 资金${topLine.flow}亿` : ""}${topLine.cover ? " 覆盖持仓" : ""}` : ""}；持仓现价：${quotes.map((q) => `${q.name}${q.price ?? "—"} ${q.chg == null ? "—" : frSigned(q.chg, "%")}`).join("、")}。`;

  useAiPage({
    key: "fundradar-home",
    title: "资金雷达 · 首页",
    context: aiContext,
    suggestions: FR_SUGGESTIONS,
  });

  // 首次加载（无数据）：整页骨架屏，替代「正在取数…」小字；刷新（live 已有）时不闪骨架
  if (loading && !live) {
    return (
      <div data-fr-page="fundradar-home" className="fr-elder-page p-6">
        <div className="fr-fade-in mx-auto max-w-[1500px]">
          <span className="sr-only" role="status">正在加载资金雷达首页…</span>

          {/* 标题区骨架 */}
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="space-y-2">
              <FrSkeleton className="w-44 rounded-md" style={{ height: "calc(var(--fs-title) * 0.9)" }} />
              <FrSkeleton className="w-28 rounded-md" style={{ height: "calc(var(--fs-sub) * 1.1)" }} />
            </div>
            <FrSkeleton className="w-64 rounded-md" style={{ height: "calc(var(--fs-sub) * 1.7)" }} />
          </div>

          {/* 今日市场卡骨架 */}
          <section aria-label="加载中" className="fr-glass mb-5 rounded-xl p-5">
            <div className="mb-3 flex flex-wrap gap-3">
              {[0, 1, 2, 3].map((i) => (
                <FrSkeleton key={i} className="rounded-full" style={{ height: "calc(var(--fs-sub) * 1.7)", width: 120 }} />
              ))}
            </div>
            <FrSkeleton className="w-3/4 rounded-md" style={{ height: "calc(var(--fs-title) * 1.1)" }} />
          </section>

          {/* KPI 一排骨架 */}
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="fr-glass rounded-xl p-4">
                <FrSkeletonLine className="w-1/2" />
                <FrSkeleton className="mt-2 w-2/3 rounded-md" style={{ height: "calc(var(--fs-num) * 1.1)" }} />
              </div>
            ))}
          </div>

          {/* 持仓网格骨架 */}
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="fr-glass rounded-xl p-4">
                <FrSkeletonLine className="w-2/3" />
                <FrSkeleton className="mt-3 w-1/2 rounded-md" style={{ height: "calc(var(--fs-num) * 1.1)" }} />
                <FrSkeletonLine className="mt-3 w-1/3" />
              </div>
            ))}
          </div>

          {/* 全球要闻骨架 */}
          <section aria-label="加载中" className="fr-glass mb-5 rounded-xl p-5">
            <FrSkeleton className="mb-3 w-56 rounded-md" style={{ height: "calc(var(--fs-title) * 0.9)" }} />
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <FrSkeletonLine key={i} />
              ))}
            </div>
          </section>

          {/* 五功能入口骨架 */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <FrSkeleton key={i} className="rounded-xl" style={{ height: "calc(var(--fs-body) * 2)" }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-fr-page="fundradar-home" className="fr-elder-page p-6">
      <div className="fr-fade-in mx-auto max-w-[1500px]">
        <h1 className="sr-only">资金雷达 · 今日一屏总览</h1>

        {/* 1. 顶部标题区（一行，轻）：标题 + 今日日期｜搜索 + 自动刷新徽标 */}
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="fr-title font-bold">资金雷达</h2>
            <p className="fr-sub text-muted-foreground">{frDateCn(frTodayKey())}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* 个股搜索：输入 6 位代码直达个股详情页 */}
            <div className="flex flex-col items-end gap-1">
              <form
                className="flex items-center gap-1.5 rounded-input border border-border bg-muted px-2 py-1.5"
                onSubmit={(e) => { e.preventDefault(); submitSearch(); }}
              >
                <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <input
                  value={searchQ}
                  onChange={(e) => { setSearchQ(e.target.value); setSearchHint(""); }}
                  placeholder="搜个股：输 6 位代码（如 600183）"
                  aria-label="搜索个股代码"
                  className="fr-sub w-40 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none sm:w-48"
                />
                <button type="submit" disabled={searching} className="fr-sub fr-tap shrink-0 rounded-btn bg-primary px-3 py-1 font-bold text-primary-foreground disabled:opacity-60">
                  看个股
                </button>
              </form>
              {searchHint && (
                <span role="status" className="fr-sub text-destructive">{searchHint}</span>
              )}
            </div>
            <FrAutoRefreshBadge />
          </div>
        </header>

        <FrDataNotice loading={loading} missing={failed ? ["全部数据"] : live?.missing ?? []} onRetry={retry} />

        {/* 2. 今日市场卡（第一重点：primary 淡底 + 左描边） */}
        <section aria-label="今日市场" className="fr-glass mb-5 overflow-hidden rounded-xl">
          <div key={bannerFlash} className={`border-l-4 border-primary bg-primary-subtle px-5 py-4 sm:px-6 sm:py-5 ${bannerFlash > 0 ? "fr-flash-once" : ""}`}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="fr-sub font-semibold uppercase tracking-[0.2em] text-primary">今日市场</span>
              <span className="fr-body font-bold">情绪 {lamp}</span>
              <span className="fr-body">涨停 <span className="font-bold">{ztCount}</span> 家</span>
              {maxBoard != null && <span className="fr-body">最高 <span className="font-bold">{maxBoard}</span> 板</span>}
              <span className="fr-body">炸板率 <span className="font-bold">{zhaRateLabel}</span></span>
            </div>
            <p className="fr-title mt-2 font-bold leading-snug">
              主线：<span className="text-primary">{topLineName}</span> · 涨停 {topLineZt} 家
            </p>
            <p className="fr-sub mt-1.5 text-muted-foreground">
              {topLineFlow != null && `${topLineFlow > 0 ? "+" : ""}${topLineFlow}亿 · `}
              最高 {topLineHeight} 板{topLineCover ? " · 覆盖您的持仓" : ""}
              <Link to="/radar" className="ml-2 font-bold text-primary hover:underline">看雷达 →</Link>
            </p>
          </div>
          <p className="fr-sub border-t border-border px-5 py-2 text-muted-foreground">
            {usingSample ? "示例数据" : `数据日期 ${frDateLabel(dataDate)} · 盘后数据 · 来自底座数据端点`}
          </p>
        </section>

        {/* 3. KPI 卡片一排（4 张等宽网格） */}
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="fr-glass rounded-xl px-4 py-3.5">
            <p className="fr-sub text-muted-foreground">涨停家数</p>
            <p className="fr-num mt-1">
              <FrAnimatedNumber value={ztCount} format={(v) => String(Math.round(v))} />
              <span className="fr-sub ml-1.5 font-bold text-muted-foreground">家</span>
            </p>
          </div>
          <div className="fr-glass rounded-xl px-4 py-3.5">
            <p className="fr-sub text-muted-foreground">最高连板</p>
            <p className="fr-num mt-1">
              <FrAnimatedNumber value={maxBoard} format={(v) => String(Math.round(v))} />
              {maxBoard != null && <span className="fr-sub ml-1.5 font-bold text-muted-foreground">板</span>}
            </p>
          </div>
          <div className="fr-glass rounded-xl px-4 py-3.5">
            <p className="fr-sub text-muted-foreground">持仓今日盈亏</p>
            <p className={`fr-num mt-1 ${pnlTotal == null ? "fr-flat" : pnlTotal >= 0 ? "fr-up" : "fr-down"}`}>
              <FrAnimatedNumber value={pnlTotal} format={(v) => frSigned(v, "元")} />
            </p>
            <p className="fr-sub mt-0.5 text-muted-foreground">按（现价−成本）×数量</p>
          </div>
          <div className="fr-glass rounded-xl px-4 py-3.5">
            <p className="fr-sub text-muted-foreground">主线热度</p>
            <p className="fr-num mt-1">
              <FrAnimatedNumber value={topLineHot} format={(v) => v.toFixed(1)} />
              <span className="fr-sub ml-1.5 font-bold text-muted-foreground">分</span>
            </p>
            <p className="fr-sub truncate text-muted-foreground">{topLineName}</p>
          </div>
        </div>

        {/* 4. 世界股票指数卡（横排小卡，可横向滚动；原「我的持仓」模块已移至持仓页） */}
        <section aria-label="世界股票" className="mb-5">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="fr-sub font-semibold uppercase tracking-[0.2em] text-primary">Global Markets</p>
              <h2 className="fr-title mt-1 flex items-center gap-2 font-bold">
                <Globe className="h-5 w-5 text-primary" aria-hidden="true" />
                世界股票
              </h2>
            </div>
            <span className="fr-sub shrink-0 text-muted-foreground">横向滑动查看更多 →</span>
          </div>
          {worldIndices.loading && !worldIndices.live ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="fr-glass w-44 shrink-0 rounded-xl p-4">
                  <FrSkeletonLine className="w-2/3" />
                  <FrSkeleton className="mt-3 w-1/2 rounded-md" style={{ height: "calc(var(--fs-num) * 1.1)" }} />
                  <FrSkeletonLine className="mt-3 w-1/3" />
                  <FrSkeletonLine className="mt-3 w-full" />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {(worldIndices.live ?? []).map((idx) => (
                <FrWorldIndexCard key={idx.key} idx={idx} />
              ))}
            </div>
          )}
          <p className="fr-sub mt-2 leading-relaxed text-muted-foreground">
            数据源：现价与当日涨跌来自腾讯行情（日经225、韩国KOSPI来自新浪全球指数，仅现价与当日涨跌）；近5日/YTD/近20日由腾讯指数日K计算（日经/韩国无历史K线源，显示「—」）。涨红跌绿。
          </p>
        </section>

        {/* 5. 主线热度趋势：暂无板块级 20 日热度/资金流序列端点，按任务约定跳过，不造假数据 */}

        {/* 6. 全球要闻（简洁列表：时间戳 + 标题 + 来源 tag；点击展开详情弹层） */}
        <section aria-label="全球要闻" className="fr-glass mb-5 rounded-xl px-4 py-3 sm:px-5 sm:py-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <p className="fr-sub font-semibold uppercase tracking-[0.2em] text-primary">Global Briefing</p>
              <h2 className="fr-title mt-1 font-bold">全球要闻</h2>
            </div>
            <Link to="/intel" className="fr-sub text-muted-foreground hover:text-foreground">资讯雷达 →</Link>
          </div>
          <div className="divide-y divide-border">
            {pageNews.map((n, i) => (
              <button
                key={`${n.src}-${n.title}`}
                type="button"
                onClick={() => setOpenNewsIdx(newsStart + i)}
                title="点击查看新闻详情"
                className="fr-stagger-in flex w-full items-center gap-3 px-2 py-3 text-left transition-colors hover:bg-muted/60"
                style={frStaggerDelay(i)}
              >
                <span className="fr-sub shrink-0 tabular-nums text-muted-foreground">{n.time || "—"}</span>
                <span className="fr-body min-w-0 flex-1 truncate">{n.title}</span>
                <span className={`fr-sub shrink-0 rounded px-2 py-0.5 font-bold ${n.hot ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}>
                  {n.src}
                </span>
              </button>
            ))}
          </div>
          <FrPager page={curNewsPage} totalPages={totalNewsPages} totalItems={news.length} onChange={setNewsPage} />
          <p className="fr-sub mt-2 text-muted-foreground">
            {frEndpointCn("数据源：em_global_news（东财 7x24，主源）+ rss_news（106 策展源，备源）· 点击条目查看详情，详情内可让 AI 解读")}
          </p>
        </section>

        {/* 6.5 板块要闻（利好/利空新闻：四板块 tab，全部候选，每页 10 条，点击跳转来源） */}
        <FrSectorNews />

        {/* 新闻详情弹层（大字、醒目关闭、可点上下条、可让 AI 解读） */}
        {openNewsIdx !== null && openNews && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fr-news-detail-title"
            onClick={() => setOpenNewsIdx(null)}
          >
            <div
              className="fr-glass w-full max-w-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-border p-5">
                <p className="fr-sub font-semibold uppercase tracking-[0.2em] text-primary">新闻详情</p>
                <button
                  type="button"
                  onClick={() => setOpenNewsIdx(null)}
                  className="fr-tap flex shrink-0 items-center gap-1 rounded-btn border border-border bg-muted px-4 py-2 font-bold text-foreground hover:bg-primary-100 hover:text-primary"
                  aria-label="关闭新闻详情"
                >
                  ✕ 关闭
                </button>
              </div>

              <div className="max-h-[60vh] overflow-y-auto p-5">
                <h3 id="fr-news-detail-title" className="fr-title font-bold leading-snug">{openNews.title}</h3>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className={`fr-sub rounded px-2 py-0.5 font-bold ${openNews.hot ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}>{openNews.tag}</span>
                  <span className="fr-sub text-muted-foreground">{openNews.src}{openNews.time ? ` · ${openNews.time}` : ""}</span>
                </div>
                {openNews.summary ? (
                  <p className="fr-body mt-4 whitespace-pre-wrap leading-relaxed">{openNews.summary}</p>
                ) : (
                  <p className="fr-body mt-4 text-muted-foreground">该源仅提供标题，无正文。</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-border p-5">
                {openNews.url && (
                  <a
                    href={openNews.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="fr-tap inline-flex items-center gap-2 rounded-btn border border-border bg-muted px-4 py-2 font-bold text-foreground hover:bg-primary-100 hover:text-primary"
                  >
                    <ExternalLink className="h-5 w-5" aria-hidden="true" />
                    查看原文
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => askAiNews(openNews)}
                  className="fr-tap inline-flex items-center gap-2 rounded-btn bg-primary px-4 py-2 font-bold text-primary-foreground hover:opacity-90"
                >
                  让 AI 解读这条新闻
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
                <button
                  type="button"
                  disabled={openNewsIdx === 0}
                  onClick={() => goNewsIdx(openNewsIdx - 1)}
                  className="fr-tap inline-flex items-center gap-1 rounded-btn px-3 py-2 font-bold text-primary disabled:opacity-40"
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                  上一条
                </button>
                <span className="fr-sub text-muted-foreground">{openNewsIdx + 1} / {news.length}</span>
                <button
                  type="button"
                  disabled={openNewsIdx === news.length - 1}
                  onClick={() => goNewsIdx(openNewsIdx + 1)}
                  className="fr-tap inline-flex items-center gap-1 rounded-btn px-3 py-2 font-bold text-primary disabled:opacity-40"
                >
                  下一条
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Agent 对话入口（保留：轻量次级入口，不再是占满整行的大横幅） */}
        <Link to="/agent-chat"
          className="fr-body fr-press mb-5 flex w-full items-center justify-center gap-2.5 rounded-btn border border-border bg-card px-4 py-3 font-bold text-primary transition-colors hover:border-primary/50 hover:bg-muted">
          <Mic className="h-5 w-5" aria-hidden="true" />
          和 Agent 聊聊 —— 说话或打字，问什么都行
        </Link>

        {/* 7. 五功能快捷入口（底部一行：图标 + 短文字） */}
        <section aria-labelledby="fr-feature-heading" className="mt-6">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <p className="fr-sub font-semibold uppercase tracking-[0.2em] text-primary">Workbench</p>
              <h2 id="fr-feature-heading" className="fr-title mt-1 font-bold">研究工具，一站直达</h2>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {FR_FEATURE_GROUPS.map((g) => {
              const Icon = FEATURE_ICONS[g.title] ?? Radar;
              const to = g.features[0]?.to ?? "/radar";
              return (
                <Link key={g.title} to={to} title={g.detail}
                  className="fr-glass fr-press flex items-center gap-2.5 rounded-xl px-3 py-3 transition-colors hover:border-primary/40">
                  <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  <span className="fr-sub min-w-0 truncate font-semibold">{g.title}</span>
                </Link>
              );
            })}
          </div>
        </section>

        <p className="fr-sub mt-5 leading-relaxed text-muted-foreground/80">{FR_DISCLAIMER}</p>
      </div>
    </div>
  );
}
