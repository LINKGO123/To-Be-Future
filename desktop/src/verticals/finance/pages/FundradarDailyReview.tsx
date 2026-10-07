/**
 * 资金雷达工作台 · 每日复盘页（常用区域，选型 v0.1 §4：盘后复盘页 = To Be Future 深色大屏风格）
 * 内容：晨报重播 + 主线复盘 Top3 + 涨停梯队 + 炸板池 + 次日主线关注清单 + 游资动向摘要 + 持仓吻合度
 *       + 今日要闻（可翻页新闻列表）。
 * 数据（刀5）：真实数据来自底座 —— 涨停池 em_zt_pool（主线/梯队/吻合度）、炸板池 em_zb_pool、
 * 情绪 em_limit_up_sentiment、龙虎榜 em_daily_dragon_tiger（动向摘要）、全球要闻 em_global_news（晨报要闻 + 今日要闻列表）。
 * 核心取数失败 → 整页示例 + 顶部提示重试；晨报朗读沿用真实系统 TTS（刀4）。
 */
import { useMemo, useState } from "react";
import type { EChartsCoreOption } from "echarts/core";
import { Link } from "react-router-dom";
import { ExternalLink, Pause, Play, RotateCcw, Square, Volume2 } from "lucide-react";
import { EChart } from "@/components/ui/EChart";
import { useAiPage } from "../../../core/ai/pageContext";
import { FrDataNotice } from "@/components/fundradar/FrDataNotice";
import { FR_NEWS_PAGE_SIZE, FrPager } from "@/components/fundradar/FrPager";
import { FrSkeleton, FrSkeletonCard, FrSkeletonChart, FrSkeletonList } from "@/components/fundradar/FrSkeleton";
import { FrSourceFooter } from "@/components/fundradar/FrSourceFooter";
import { SPEECH_RATES, useSpeech } from "@/components/fundradar/useSpeech";
import { storageGet, storageSet } from "@/lib/storage";
import {
  FR_HOLDING_META, frCoveredHoldings, frDateLabel, frEndpointCn, loadReviewLive, useFrLoader,
  type FrHeatRow, type FrLadderRow, type FrNewsItem, type FrReviewLive,
} from "@/lib/fundradarData";
import { readDailyReview, readMorningBrief } from "@/lib/fundradarMorningBrief";
import { readNextWatch } from "@/lib/fundradarNextWatch";
import { frChartGray, frSigned, useFrDark } from "@/lib/fundradarTheme";
import {
  FR_EMOTION, FR_HEAT_RANK, FR_LADDER, FR_NEWS,
  FR_SUGGESTIONS, FR_YOUZI_SUMMARY, FR_ZHA_POOL, FR_ZHA_TOTAL, type FrZhaRow,
} from "@/data/fundradarSample";

/** 涨停梯队渐变配色：连板越高蓝色越深（首板浅蓝 → 5板+深蓝），体现「越高越强」 */
const LADDER_COLORS = [
  ["hsl(213 94% 68%)", "hsl(217 91% 60%)"],   // 首板：浅蓝
  ["hsl(217 91% 60%)", "hsl(221 83% 53%)"],   // 2板：蓝
  ["hsl(221 83% 53%)", "hsl(224 76% 48%)"],   // 3板：蓝
  ["hsl(224 76% 48%)", "hsl(226 71% 40%)"],   // 4板：深蓝
  ["hsl(226 71% 40%)", "hsl(224 64% 33%)"],   // 5板+：更深蓝
] as const;

/** 涨停梯队渐变柱状图（与主线雷达页同款）：每根柱自底部深色向上渐变浅色 + 跨柱逐级加深 */
function useLadderOption(ladder: FrLadderRow[]): EChartsCoreOption {
  const dark = useFrDark();
  return useMemo<EChartsCoreOption>(() => {
    const g = frChartGray(dark);
    return {
      backgroundColor: "transparent",
      grid: { left: 35, right: 15, top: 18, bottom: 22 },
      xAxis: {
        type: "category" as const,
        data: ladder.map((l) => l.t),
        axisLabel: { color: g.axisLabel, fontSize: 12 },
        axisLine: { lineStyle: { color: g.axisLine } },
      },
      yAxis: {
        type: "value" as const,
        splitLine: { lineStyle: { color: g.splitLine } },
        axisLabel: { color: g.axisSub, fontSize: 11 },
      },
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: g.tipBg,
        borderColor: g.tipBorder,
        textStyle: { color: g.tipText, fontSize: 12 },
      },
      series: [{
        type: "bar" as const,
        data: ladder.map((l, i) => {
          const [top, bottom] = LADDER_COLORS[Math.min(i, LADDER_COLORS.length - 1)]!;
          return {
            value: l.n,
            itemStyle: {
              borderRadius: [5, 5, 0, 0],
              color: {
                type: "linear" as const,
                x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: top },
                  { offset: 1, color: bottom },
                ],
              },
            },
            label: { color: bottom },
          };
        }),
        barWidth: 26,
        label: {
          show: true, position: "top" as const, fontSize: 12, fontWeight: 700,
          formatter: (p: { value?: unknown }) => String(p?.value ?? ""),
        },
      }],
    };
  }, [ladder, dark]);
}

const FR_MORNING_PLAYED_KEY = "fr-morning-played";

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/** 晨报播放器（刀4/刀6）：读 AI 生成的晨报文本（按行分六段），真实系统 TTS 朗读 + 段落高亮跟随；
 *  无文本（AI 未生成 / 数据日期不对）→ 显示「晨报暂未生成」占位，不崩。 */
function MorningBriefPlayer({ text, subtitle }: { text: string | null; subtitle: string }) {
  const speech = useSpeech();
  // 页面加载时检查：今日 08:30 后且当天未朗读过 → 提示「今天的晨报可以听了」（简易调度）
  const [morningReady, setMorningReady] = useState<boolean>(() => {
    const now = new Date();
    const after0830 = now.getHours() > 8 || (now.getHours() === 8 && now.getMinutes() >= 30);
    return after0830 && storageGet(FR_MORNING_PLAYED_KEY) !== todayKey();
  });
  const [para, setPara] = useState(-1); // 当前/上次读到的段落（绝对下标）
  // 晨报按行分「段」（每段即模板的一段话），TTS 逐段朗读并高亮跟随
  const sections = useMemo(() => (text ? text.split(/\n+/).map((s) => s.trim()).filter(Boolean) : []), [text]);

  /** 从第 start 段开始朗读，并把「今天已播」记进 localStorage（当天不再重复提示） */
  const playFrom = (start: number) => {
    storageSet(FR_MORNING_PLAYED_KEY, todayKey());
    setMorningReady(false);
    setPara(start);
    speech.speak(sections.slice(start), { onSegment: (i) => setPara(start + i) });
  };

  const playing = speech.speaking;

  if (sections.length === 0) {
    return (
      <div className="fr-glass p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="fr-body font-bold">今日晨报（精简版 · 约 1 分钟）</h2>
          <span className="fr-sub text-muted-foreground">{subtitle}</span>
        </div>
        <div className="rounded-btn border border-border bg-muted/40 px-4 py-5">
          <p className="fr-body font-bold text-muted-foreground">晨报暂未生成</p>
          <p className="fr-sub mt-1 text-muted-foreground">
            盘后（15:30 后）自动用真实数据生成，明天盘中即可朗读；生成需要已接入 AI。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fr-glass p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="fr-body font-bold">今日晨报（精简版 · 约 1 分钟）</h2>
        <span className="fr-sub text-muted-foreground">{subtitle}</span>
      </div>

      {morningReady && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-btn border border-border bg-muted/40 px-4 py-3">
          <span className="fr-body font-bold text-primary">今天的晨报可以听了</span>
          <button type="button" disabled={!speech.supported} onClick={() => playFrom(0)}
            className="fr-sub fr-tap rounded-btn bg-primary px-4 py-2 font-bold text-primary-foreground hover:opacity-85 disabled:opacity-50">
            朗读晨报
          </button>
        </div>
      )}

      <div className="space-y-2">
        {sections.map((s, i) => {
          const active = playing && para === i;
          return (
            <div key={i} className={`rounded-btn border p-3 transition-colors ${active ? "fr-reading-pulse border-primary/60 bg-primary-subtle-strong" : "border-border bg-muted/40"}`}>
              <p className={`fr-body leading-relaxed ${active ? "text-foreground" : "text-muted-foreground"}`}>{s}</p>
              {active && <p className="fr-sub text-primary">正在读这一段…</p>}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!playing ? (
          <button type="button" disabled={!speech.supported} onClick={() => playFrom(0)}
            className="fr-btn-h fr-tap flex items-center gap-2 rounded-btn bg-primary px-6 font-bold text-primary-foreground disabled:opacity-50">
            <Play className="h-6 w-6" /> 朗读晨报
          </button>
        ) : speech.paused ? (
          <button type="button" onClick={speech.resume}
            className="fr-btn-h fr-tap flex items-center gap-2 rounded-btn bg-primary px-6 font-bold text-primary-foreground">
            <Play className="h-6 w-6" /> 继续
          </button>
        ) : (
          <button type="button" onClick={speech.pause}
            className="fr-btn-h fr-tap flex items-center gap-2 rounded-btn bg-primary px-6 font-bold text-primary-foreground">
            <Pause className="h-6 w-6" /> 暂停
          </button>
        )}
        {(playing || para >= 0) && (
          <button type="button" onClick={() => playFrom(Math.max(0, para))}
            className="fr-btn-h fr-tap flex items-center gap-2 rounded-btn border border-border bg-muted px-4 font-bold">
            <RotateCcw className="h-6 w-6" /> 重听本段
          </button>
        )}
        {playing && (
          <button type="button" onClick={speech.stop}
            className="fr-btn-h fr-tap flex items-center gap-2 rounded-btn border border-border bg-muted px-4 font-bold">
            <Square className="h-6 w-6" /> 停止
          </button>
        )}
        <span className="fr-sub ml-auto flex items-center gap-1 text-muted-foreground">
          <Volume2 className="h-5 w-5" /> 语速
          {SPEECH_RATES.map((r) => (
            <button key={r} type="button" aria-pressed={speech.rate === r} onClick={() => speech.setRate(r)}
              className={`fr-tap rounded-btn border px-3 py-1 font-bold ${speech.rate === r ? "border-primary bg-primary-subtle-strong text-primary" : "border-border text-muted-foreground"}`}>
              {r}×
            </button>
          ))}
        </span>
      </div>

      {!speech.supported && (
        <p className="fr-sub mt-2 text-destructive">当前浏览器不支持语音朗读，请用 Chrome / Edge 打开后重试。</p>
      )}
      <p className="fr-sub mt-2 text-muted-foreground">
        非交易日不自动生成晨报；完整晨报与历史回看在后续版本提供。当天已播记录只存在本机。
      </p>
    </div>
  );
}

/** 单条今日要闻：时间 + 标题 + 来源；有原文链接则整行可点跳转（新标签页） */
function TodayNewsRow({ item }: { item: FrNewsItem }) {
  const inner = (
    <>
      <span className="fr-sub shrink-0 tabular-nums text-muted-foreground">{item.time || "—"}</span>
      <span className="fr-body min-w-0 flex-1 truncate" title={item.title}>{item.title}</span>
      <span className={`fr-sub shrink-0 rounded px-2 py-0.5 font-bold ${item.hot ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}>
        {item.src}
      </span>
    </>
  );
  const cls = "flex w-full items-center gap-3 px-2 py-3 text-left transition-colors hover:bg-muted/60";
  if (item.url) {
    return (
      <a href={item.url} target="_blank" rel="noopener noreferrer" title="点击跳转原文" className={cls}>
        {inner}
        <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </a>
    );
  }
  return <div className={cls}>{inner}</div>;
}

/** 今日要闻：复用全球要闻（frNews 扩大后数据），每页 10 条 + FrPager 翻页 */
function TodayNewsSection({ news, usingSample }: { news: FrNewsItem[]; usingSample: boolean }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(news.length / FR_NEWS_PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const pageStart = (curPage - 1) * FR_NEWS_PAGE_SIZE;
  const pageItems = news.slice(pageStart, pageStart + FR_NEWS_PAGE_SIZE);

  return (
    <section aria-label="今日要闻" className="fr-glass mt-4 p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="fr-body font-bold">今日要闻</h2>
        <span className="fr-sub text-muted-foreground">{usingSample ? "示例数据" : `共 ${news.length} 条`}</span>
      </div>
      {news.length === 0 ? (
        <p className="fr-body py-4 text-muted-foreground">今日暂无要闻数据。</p>
      ) : (
        <>
          <div className="divide-y divide-border">
            {pageItems.map((n) => (
              <TodayNewsRow key={`${n.src}-${n.title}`} item={n} />
            ))}
          </div>
          <FrPager page={curPage} totalPages={totalPages} totalItems={news.length} onChange={setPage} />
        </>
      )}
      <p className="fr-sub mt-2 leading-relaxed text-muted-foreground">
        {frEndpointCn("数据源：em_global_news（东财 7x24）+ rss_news（策展源）· 有原文链接的条目点击跳转原文")}
      </p>
    </section>
  );
}

export function FundradarDailyReview() {
  const { loading, live, failed, retry } = useFrLoader<FrReviewLive>(loadReviewLive);
  const usingSample = !live;
  const radar = live?.radar ?? null;
  const sentiment = radar?.sentiment ?? null;
  const dataDate = live?.dataDate ?? "";
  const news: FrNewsItem[] = live?.news ?? FR_NEWS.map((n) => ({ ...n, time: "" }));

  const heatRows: FrHeatRow[] = radar
    ? radar.heat
    : FR_HEAT_RANK.map((h) => ({ ...h, coverNames: [], reason: null, topName: null, topCode: null }));
  const ladderRows: FrLadderRow[] = radar?.ladder ?? FR_LADDER;
  const ladderOption = useLadderOption(ladderRows);

  // 炸板池端点失败 → 该块降级为示例数据（顶部提示会点名「炸板池」）
  const zhaMissing = radar ? radar.missing.includes("炸板池") : false;
  const zhaRows: FrZhaRow[] = radar && !zhaMissing
    ? radar.zha.rows.map((z) => ({
        code: z.code,
        name: z.name,
        note: z.days != null ? `触${z.days}板炸 ${z.sealTime}` : `炸板 ${z.sealTime}`,
      }))
    : FR_ZHA_POOL;
  const zhaTotal = radar && !zhaMissing ? radar.zha.total : FR_ZHA_TOTAL;

  // 晨报与复盘文案：读盘后 AI 生成结果（按 dataDate 与当日数据对齐，防止读到旧一天的数据）
  const morningBrief = readMorningBrief();
  const briefText = morningBrief && morningBrief.dataDate === dataDate ? morningBrief.text : null;
  const dailyReview = readDailyReview();
  const reviewText = dailyReview && dailyReview.dataDate === dataDate ? dailyReview.text : null;

  // 次日主线关注清单：读盘后生成的清单（按 dataDate 与当日数据对齐，防止读旧一天的数据）
  const nextWatch = readNextWatch();
  const nextWatchLive = nextWatch && nextWatch.dataDate === dataDate && nextWatch.list.length > 0 ? nextWatch : null;

  const youziText = !live?.lhb
    ? FR_YOUZI_SUMMARY
    : live.lhb.backup
      ? `${frDateLabel(live.lhb.dataDate)}龙虎榜官方备源共 ${live.lhb.summary.count} 条深交所记录（成交金额 + 上榜原因，净买额不可得）。`
      : `${frDateLabel(live.lhb.dataDate)}龙虎榜共 ${live.lhb.summary.count} 条记录：净买入合计 +${live.lhb.summary.netBuyTotal} 亿，净卖出合计 -${live.lhb.summary.netSellTotal} 亿；净买最高 ${live.lhb.summary.topName} ${frSigned(live.lhb.summary.topNet, "亿")}。席位标签库待接入，明细见「龙虎榜」页。`;

  const coveredHoldings = radar ? frCoveredHoldings(radar.heat) : [];
  const coveredRows = heatRows.filter((r) => r.cover);

  const aiContext = usingSample
    ? `每日复盘（示例数据）：情绪${FR_EMOTION.lamp}、涨停${FR_EMOTION.ztTotal}家；主线榜首 PCB/覆铜板 6家涨停+8.2亿；次日关注清单 Top3；游资动向与持仓吻合度见页面。`
    : `每日复盘（真实数据 ${dataDate}）：涨停${sentiment?.zt ?? "—"}家、最高${radar?.maxBoard ?? "—"}板、炸板率${sentiment?.zhaRatePct ?? "—"}%；主线 Top3：${radar?.heat.slice(0, 3).map((h) => h.name).join("、") ?? "—"}；龙虎榜 ${live?.lhb?.summary.count ?? "—"} 条。`;

  useAiPage({
    key: "fundradar-review",
    title: "资金雷达 · 每日复盘",
    context: aiContext,
    suggestions: FR_SUGGESTIONS,
  });

  // 首次加载（无数据）：整页骨架屏（深色大屏），替代「正在取数…」小字
  if (loading && !live) {
    return (
      <div data-fr-page="fundradar-daily-review" className="p-6">
        <div className="fr-screen-dark fr-fade-in mx-auto max-w-[1700px] rounded-2xl p-6">
          <span className="sr-only" role="status">正在加载每日复盘…</span>

          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <FrSkeleton className="w-44 rounded-md" style={{ height: "calc(var(--fs-title) * 0.9)" }} />
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3].map((i) => (
                <FrSkeleton key={i} className="rounded-full" style={{ height: "calc(var(--fs-sub) * 1.7)", width: 104 }} />
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="fr-glass p-5"><FrSkeletonCard lines={3} /></div>
            <div className="fr-glass p-5"><FrSkeletonCard lines={3} /></div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="fr-glass p-5">
              <FrSkeleton className="mb-2 w-40 rounded-md" style={{ height: "calc(var(--fs-body) * 1.1)" }} />
              <FrSkeletonChart height={170} spinner={false} />
            </div>
            <div className="fr-glass p-5">
              <FrSkeleton className="mb-3 w-40 rounded-md" style={{ height: "calc(var(--fs-body) * 1.1)" }} />
              <FrSkeletonList rows={4} />
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="fr-glass p-5"><FrSkeletonCard lines={3} /></div>
            <div className="fr-glass p-5"><FrSkeletonCard lines={3} /></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-fr-page="fundradar-daily-review" className="p-6">
      <div className="fr-screen-dark fr-fade-in mx-auto max-w-[1700px] rounded-2xl p-6">
        {/* 顶部 */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="fr-title font-bold">每日复盘</h1>
            <p className="fr-sub text-muted-foreground">主线 · 游资 · 持仓吻合度</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              usingSample ? "示例数据" : `数据日期 ${dataDate}`,
              `${FR_EMOTION.label} ${sentiment?.lamp ?? FR_EMOTION.lamp}`,
              `涨停 ${sentiment?.zt ?? FR_EMOTION.ztTotal}`,
              `炸板率 ${sentiment?.zhaRatePct ?? FR_EMOTION.zhaRate}%`,
            ].map((t) => (
              <span key={t} className="fr-chip fr-sub">{t}</span>
            ))}
          </div>
        </div>

        <FrDataNotice loading={loading} missing={failed ? ["全部数据"] : live?.missing ?? []} onRetry={retry} />

        {/* 盘后复盘结论（AI 生成） */}
        <div className="fr-glass mt-4 p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="fr-body font-bold">今日复盘结论（AI 生成）</h2>
            <span className="fr-sub text-muted-foreground">{usingSample ? "示例数据不生成" : `盘后生成 · 数据日期 ${dataDate}`}</span>
          </div>
          {reviewText ? (
            <p className="fr-body leading-relaxed whitespace-pre-wrap">{reviewText}</p>
          ) : (
            <div className="rounded-btn border border-border bg-muted/40 px-4 py-4">
              <p className="fr-body font-bold text-muted-foreground">复盘生成中</p>
              <p className="fr-sub mt-1 text-muted-foreground">
                {usingSample
                  ? "示例数据不生成复盘文案；接入真实数据后，盘后 15:30 起自动生成。"
                  : "盘后（15:30 后）自动用真实数据生成；生成需要已接入 AI，稍后刷新即可查看。"}
              </p>
            </div>
          )}
        </div>

        {/* 今日要闻（可翻页新闻列表：复用全球要闻，每页 10 条） */}
        <TodayNewsSection news={news} usingSample={usingSample} />

        {/* 晨报 + 主线复盘 Top3 */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <MorningBriefPlayer
            text={briefText}
            subtitle={usingSample ? "示例数据不生成" : (briefText ? `AI 生成 · 数据日期 ${dataDate}` : "待盘后生成")}
          />
          <div className="fr-glass p-5">
            <h2 className="fr-body mb-3 font-bold">今日主线（Top 3）</h2>
            <div className="space-y-2">
              {heatRows.slice(0, 3).map((h, i) => (
                <Link key={h.name} to="/radar" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-btn border border-border bg-muted/40 px-4 py-3 transition-colors hover:border-primary/40">
                  <span className="fr-sub flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground" aria-hidden="true">{i + 1}</span>
                  <span className="fr-body min-w-0 flex-1 font-bold text-primary">
                    {h.name}{" "}
                    <span className="fr-sub font-normal text-muted-foreground">{h.cover ? "● 覆盖您的持仓" : "— 未覆盖"}</span>
                  </span>
                  <span className="fr-num fr-up">{h.zt} 家涨停</span>
                  <span className={`fr-body font-bold ${h.flow == null ? "fr-flat" : h.flow >= 0 ? "fr-up" : "fr-down"}`}>
                    {h.flow == null ? "资金 —" : `${h.flow >= 0 ? "+" : ""}${h.flow}亿`}
                  </span>
                  <span className="fr-sub text-muted-foreground">最高 {h.height} 板</span>
                </Link>
              ))}
            </div>
            <p className="fr-sub mt-2 text-muted-foreground">
              点击行 → 主线雷达对应板块 · {usingSample ? "示例数据" : "真实数据"}
              {radar && !radar.flowAvailable ? " · 板块资金端点暂不可用" : ""}
            </p>
          </div>
        </div>

        {/* 梯队 + 炸板池 */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="fr-glass p-5">
            <h2 className="fr-body mb-2 font-bold">涨停梯队</h2>
            <EChart option={ladderOption} height={170} />
          </div>
          <div className="fr-glass p-5">
            <h2 className="fr-body mb-3 font-bold">炸板池（{zhaTotal}）</h2>
            {zhaRows.length === 0 && (
              <p className="fr-body py-4 text-muted-foreground">数据日炸板池为空。</p>
            )}
            {zhaRows.map((z) => (
              <div key={z.code} className="fr-body flex items-center justify-between border-b border-border py-2.5 last:border-b-0">
                <span className="text-destructive">{z.code} {z.name} · {z.note}</span>
                <span className="fr-sub text-muted-foreground" aria-hidden="true">↗</span>
              </div>
            ))}
          </div>
        </div>

        {/* 次日关注清单 + 游资动向 */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="fr-glass p-5">
            <h2 className="fr-body mb-3 font-bold">次日主线关注清单（盘后自动生成）</h2>
            {nextWatchLive ? (
              <div className="space-y-2">
                {nextWatchLive.list.map((item, i) => (
                  <div key={item.direction} className="rounded-btn border border-border bg-muted/40 px-4 py-3">
                    <p className="fr-body font-bold text-primary">
                      <span className="fr-sub mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground" aria-hidden="true">{i + 1}</span>
                      {item.direction}
                      {item.stocks.length > 0 && (
                        <span className="fr-sub font-normal text-muted-foreground"> · {item.stocks.join("、")}</span>
                      )}
                    </p>
                    <p className="fr-sub text-muted-foreground">{item.reason}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-btn border border-border bg-muted/40 px-4 py-5">
                <p className="fr-body font-bold text-muted-foreground">次日关注清单暂未生成</p>
                <p className="fr-sub mt-1 text-muted-foreground">
                  {usingSample
                    ? "示例数据不生成；接入真实数据后，盘后 15:30 起自动生成。"
                    : "盘后（15:30 后）自动用真实主线数据生成，稍后刷新即可查看。"}
                </p>
              </div>
            )}
          </div>
          <div className="fr-glass p-5">
            <h2 className="fr-body mb-3 font-bold">今日知名游资动向</h2>
            <p className="fr-body leading-relaxed">{youziText}</p>
            <FrSourceFooter
              items={live?.lhb
                ? ["数据源：龙虎榜（全市场）", "席位标签库待接入"]
                : ["AI 生成摘要 · 席位数据见「龙虎榜」页 · 示例"]}
            />
            <Link to="/lhb" className="fr-body mt-3 inline-block font-bold text-primary hover:underline">看龙虎榜席位 →</Link>
          </div>
        </div>

        {/* 吻合度（如实陈述） */}
        <div className="fr-glass mt-4 p-5">
          <h2 className="fr-body mb-3 font-bold">主线与持仓吻合度</h2>
          {usingSample ? (
            <p className="fr-body leading-relaxed">
              <span className="fr-down">主线覆盖</span>：PCB/覆铜板（生益科技）、AI服务器（浪潮信息、紫光股份）、消费电子（立讯精密）
              <br />
              <span className="fr-flat">— 未覆盖</span>：国瓷材料（电子材料，今日热度第 6）
              <span className="fr-sub mt-2 block text-muted-foreground">以上为事实陈述，不构成投资建议</span>
            </p>
          ) : (
            <p className="fr-body leading-relaxed">
              <span className="fr-down">主线覆盖</span>：
              {coveredRows.length > 0
                ? coveredRows.map((r) => `${r.name}（${r.coverNames.join("、")}）`).join("、")
                : "今日涨停股未命中持仓"}
              <br />
              <span className="fr-flat">— 未覆盖</span>：
              {FR_HOLDING_META.filter((h) => !coveredHoldings.includes(h.name)).map((h) => `${h.name}（${h.sector}）`).join("、") || "无（全部覆盖）"}
              <span className="fr-sub mt-2 block text-muted-foreground">
                覆盖口径：板块含持仓代码，或板块名命中持仓板块关键词（展示用）· 以上为事实陈述，不构成投资建议
              </span>
            </p>
          )}
        </div>

        <FrSourceFooter
          className="mt-4"
          items={[
            usingSample ? "数据：示例数据" : `数据日期：${frDateLabel(dataDate)} · 盘后数据`,
            "涨停池（主线 / 梯队 / 吻合度）",
            "炸板池",
            "市场情绪",
            "龙虎榜（游资动向摘要）",
            "东财全球要闻（晨报要闻）",
          ]}
        />

        <p className="fr-sub mt-4 text-muted-foreground">
          进阶版原功能复盘页仍可用：<Link to="/daily-review-adv" className="text-primary hover:underline">原版每日复盘（进阶研究区）→</Link>
        </p>
      </div>
    </div>
  );
}
