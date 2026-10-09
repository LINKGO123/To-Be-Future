/**
 * 资金雷达工作台 · 主线雷达页（常用区域 P2，原型 v2.6 RadarPage 照做）
 * 深色大屏（fr-screen-dark）：热度榜横向条 + 涨停梯队柱状 + 炸板池 + 吻合度卡 + 顶部 KPI。
 * 数据（刀5）：真实数据来自底座 —— 涨停池 em_zt_pool（按行业聚合 + 梯队）、
 * 炸板池 em_zb_pool、情绪 em_limit_up_sentiment、板块资金 em_board_fund_flow（不可用则资金项显示「—」并按 0 计）、
 * 涨停原因 ths_limit_up_pool（tooltip 显示高度板原因）。核心取数失败 → 整页示例 + 顶部提示重试，页面不会崩。
 */
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { EChartsCoreOption } from "echarts/core";
import { EChart } from "@/components/ui/EChart";
import { useAiPage } from "../../../core/ai/pageContext";
import { FrDataNotice } from "@/components/fundradar/FrDataNotice";
import { FrSectionNav, type FrSection } from "@/components/fundradar/FrSectionNav";
import { FrSectionRail } from "@/components/fundradar/FrSectionRail";
import { FrBackToTop } from "@/components/fundradar/FrBackToTop";
import { FrSkeleton, FrSkeletonCard, FrSkeletonChart, FrSkeletonList } from "@/components/fundradar/FrSkeleton";
import {
  FR_HOLDING_META, frCoveredHoldings, frDateLabel, loadRadarCore, useFrLoader,
  type FrHeatRow, type FrLadderRow, type FrRadarLive,
} from "@/lib/fundradarData";
import { frChartGray, useFrDark } from "@/lib/fundradarTheme";
import {
  FR_EMOTION, FR_HEAT_RANK, FR_LADDER, FR_SUGGESTIONS, FR_ZHA_POOL, FR_ZHA_TOTAL, type FrZhaRow,
} from "@/data/fundradarSample";

/** 主线雷达页区块锚点（id 与下方各区块容器对应） */
const RADAR_SECTIONS: FrSection[] = [
  { id: "radar-heat", label: "热度榜" },
  { id: "radar-ladder", label: "涨停梯队" },
  { id: "radar-zha", label: "炸板池" },
  { id: "radar-fit", label: "持仓吻合度" },
];

/** 热度榜横向条形图（原型同款配色与密度；tooltip 按真实数据行渲染） */
function useHeatOption(rows: FrHeatRow[]): EChartsCoreOption {
  const dark = useFrDark();
  return useMemo<EChartsCoreOption>(() => {
    const g = frChartGray(dark);
    return {
      backgroundColor: "transparent",
      grid: { left: 110, right: 50, top: 8, bottom: 8 },
      xAxis: {
        type: "value" as const,
        splitLine: { lineStyle: { color: g.splitLine } },
        axisLabel: { color: g.axisSub, fontSize: 11 },
      },
      yAxis: {
        type: "category" as const,
        inverse: true,
        data: [...rows].reverse().map((h) => h.name),
        axisLabel: { color: g.axisLabel, fontSize: 12, fontWeight: 600 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: g.tipBg,
        borderColor: g.tipBorder,
        textStyle: { color: g.tipText, fontSize: 12 },
        formatter: (p: any) => {
          const name: string | undefined = p?.[0]?.name;
          const h = rows.find((x) => x.name === name);
          if (!h) return "";
          const cover = h.cover ? (h.coverNames.length > 0 ? ` ●持仓覆盖 ${h.coverNames.join("、")}` : " ●持仓覆盖") : "";
          const flow = h.flow == null ? "—" : `${h.flow > 0 ? "+" : ""}${h.flow}亿`;
          const reason = h.reason ? `<br/>涨停原因：${h.reason}` : "";
          return `${h.name}${cover}<br/>热度分 ${h.hot} = 涨停${h.zt}×3 + 资金${flow}×2 + 高度${h.height}×1${reason}`;
        },
      },
      series: [{
        type: "bar" as const,
        data: [...rows].reverse().map((h) => ({
          value: h.hot,
          itemStyle: { color: h.hot > 0 ? (dark ? "hsl(217 91% 60%)" : "hsl(221 83% 53%)") : g.axisSub, borderRadius: 5 },
        })),
        barWidth: 13,
        label: {
          show: true, position: "right" as const, color: g.axisLabel, fontSize: 11,
          formatter: (p: any) => String(p?.value ?? ""),
        },
      }],
    };
  }, [rows, dark]);
}

/** 涨停梯队渐变配色：连板越高蓝色越深（首板浅蓝 → 5板+深蓝），体现「越高越强」 */
const LADDER_COLORS = [
  ["hsl(213 94% 68%)", "hsl(217 91% 60%)"],   // 首板：浅蓝
  ["hsl(217 91% 60%)", "hsl(221 83% 53%)"],   // 2板：蓝
  ["hsl(221 83% 53%)", "hsl(224 76% 48%)"],   // 3板：蓝
  ["hsl(224 76% 48%)", "hsl(226 71% 40%)"],   // 4板：深蓝
  ["hsl(226 71% 40%)", "hsl(224 64% 33%)"],   // 5板+：更深蓝
] as const;

/** 涨停梯队渐变柱状图（与每日复盘页同款）：每根柱自底部深色向上渐变浅色 + 跨柱逐级加深 */
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

export function FundradarRadar() {
  const { loading, live, failed, retry } = useFrLoader<FrRadarLive>(loadRadarCore);
  const navigate = useNavigate();
  const usingSample = !live;
  const heatRows: FrHeatRow[] = live?.heat
    ?? FR_HEAT_RANK.map((h) => ({ ...h, coverNames: [], reason: null, topName: null, topCode: null }));
  const ladderRows: FrLadderRow[] = live?.ladder ?? FR_LADDER;
  const sentiment = live?.sentiment ?? null;
  // 炸板池端点失败 → 该块降级为示例数据（顶部提示会点名「炸板池」）
  const zhaMissing = live ? live.missing.includes("炸板池") : false;
  const zhaRows: FrZhaRow[] = live && !zhaMissing
    ? live.zha.rows.map((z) => ({
        code: z.code,
        name: z.name,
        note: z.days != null ? `触${z.days}板炸 ${z.sealTime}` : `炸板 ${z.sealTime}`,
      }))
    : FR_ZHA_POOL;
  const zhaTotal = live && !zhaMissing ? live.zha.total : FR_ZHA_TOTAL;
  const dataDate = live?.dataDate ?? "";
  const coveredHoldings = live ? frCoveredHoldings(live.heat) : [];
  const coveredRows = heatRows.filter((r) => r.cover);

  const heatOption = useHeatOption(heatRows);
  const ladderOption = useLadderOption(ladderRows);

  /** 热度榜柱点击：映射到该板块最高连板股代码 → 个股详情（取不到代码则忽略点击，可点击性降级） */
  const onBarClick = (p: { name?: string }) => {
    const h = heatRows.find((x) => x.name === p.name);
    if (h?.topCode) navigate(`/stock/${h.topCode}`);
  };

  const aiContext = usingSample
    ? `主线雷达（示例数据）：热度榜首 PCB/覆铜板（涨停6、资金+8.2亿、最高4板、覆盖持仓）；梯队 ${FR_LADDER.map((l) => `${l.t}${l.n}`).join("、")}；炸板池 ${FR_ZHA_TOTAL} 家。`
    : `主线雷达（真实数据 ${dataDate}）：${heatRows.slice(0, 3).map((h) => `${h.name}（涨停${h.zt}、资金${h.flow == null ? "—" : `${h.flow > 0 ? "+" : ""}${h.flow}亿`}、最高${h.height}板）`).join("；")}；涨停${sentiment?.zt ?? "—"}家、炸板${sentiment?.zb ?? "—"}家、炸板率${sentiment?.zhaRatePct ?? "—"}%；炸板池 ${zhaTotal} 家。`;

  useAiPage({
    key: "fundradar-radar",
    title: "资金雷达 · 主线雷达",
    context: aiContext,
    suggestions: FR_SUGGESTIONS,
  });

  // 首次加载（无数据）：整页骨架屏（深色大屏），替代「正在取数…」小字
  if (loading && !live) {
    return (
      <div data-fr-page="fundradar-radar" className="p-6">
        <div className="fr-screen-dark fr-fade-in mx-auto max-w-[1700px] rounded-2xl p-6">
          <span className="sr-only" role="status">正在加载主线雷达…</span>

          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <FrSkeleton className="w-44 rounded-md" style={{ height: "calc(var(--fs-title) * 0.9)" }} />
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3].map((i) => (
                <FrSkeleton key={i} className="rounded-full" style={{ height: "calc(var(--fs-sub) * 1.7)", width: 104 }} />
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <div className="fr-glass p-5">
              <FrSkeleton className="mb-3 w-56 rounded-md" style={{ height: "calc(var(--fs-body) * 1.1)" }} />
              <FrSkeletonChart height={320} />
            </div>
            <div className="flex flex-col gap-4">
              <div className="fr-glass p-5">
                <FrSkeleton className="mb-2 w-40 rounded-md" style={{ height: "calc(var(--fs-body) * 1.1)" }} />
                <FrSkeletonChart height={145} spinner={false} />
              </div>
              <div className="fr-glass flex-1 p-5">
                <FrSkeleton className="mb-3 w-40 rounded-md" style={{ height: "calc(var(--fs-body) * 1.1)" }} />
                <FrSkeletonList rows={4} />
              </div>
            </div>
          </div>

          <div className="fr-glass mt-4 p-5">
            <FrSkeletonCard lines={3} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-fr-page="fundradar-radar" className="p-6">
      <div className="fr-screen-dark fr-fade-in mx-auto max-w-[1700px] rounded-2xl p-6">
        <FrDataNotice loading={loading} missing={failed ? ["全部数据"] : live?.missing ?? []} onRetry={retry} />

        {/* 页内锚点导航 + 右侧章节导轨 */}
        <FrSectionNav sections={RADAR_SECTIONS} />
        <FrSectionRail sections={RADAR_SECTIONS} />

        {/* 顶部：标题 + KPI 条 */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="fr-title font-bold">主线雷达</h1>
            <p className="fr-sub text-muted-foreground">
              {usingSample
                ? "示例数据 · 热度 = 涨停×3 + 资金亿×2 + 高度×1"
                : `${frDateLabel(dataDate)} · 盘后数据 · 热度 = 涨停×3 + 资金亿×2 + 高度×1`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              usingSample ? "示例数据" : `数据日期 ${dataDate}`,
              `涨停 ${sentiment?.zt ?? FR_EMOTION.ztTotal}`,
              `最高 ${live ? (live.maxBoard ?? "—") : FR_EMOTION.maxBoard} 板`,
              `炸板率 ${sentiment?.zhaRatePct ?? FR_EMOTION.zhaRate}%`,
            ].map((t) => (
              <span key={t} className="fr-chip fr-sub">{t}</span>
            ))}
          </div>
        </div>

        {/* 主区：热度榜 + 右侧（梯队/炸板池） */}
        <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <div id="radar-heat" className="fr-glass scroll-mt-16 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="fr-body font-bold">主线板块热度榜</h2>
              <button type="button" className="fr-sub rounded-btn border border-border px-2.5 py-1 text-muted-foreground hover:border-primary/40 hover:text-primary">
                查看全部 →
              </button>
            </div>
            <EChart option={heatOption} height={320} onClick={onBarClick} />
            {/* 主线龙头个股名（涨停池映射代码）：有代码可点进个股详情，取不到则降级为不可点 */}
            <div className="fr-sub mt-3 flex flex-wrap gap-2">
              {heatRows.slice(0, 8).map((h, i) => {
                const rank = i < 3 ? i + 1 : null;
                return h.topCode ? (
                  <Link key={h.name} to={`/stock/${h.topCode}`} title={`${h.topName} · 个股详情`}
                    className={`flex items-center gap-1.5 rounded-btn border px-2.5 py-1 font-bold ${rank ? "border-primary/40 bg-primary-subtle-strong text-primary hover:bg-primary-200" : "border-border text-muted-foreground hover:text-foreground"}`}>
                    {rank && (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground" aria-hidden="true">{rank}</span>
                    )}
                    龙头 {h.topName} ↗
                  </Link>
                ) : (
                  <span key={h.name} title="示例数据无涨停池代码映射，个股入口不可点"
                    className="rounded-btn border border-border px-2.5 py-1 text-muted-foreground">
                    {h.name}（无代码映射）
                  </span>
                );
              })}
            </div>
            <p className="fr-sub mt-2 text-muted-foreground">
              ● = 覆盖您的持仓 · 热度榜为盘后批数据（{usingSample ? "示例" : "真实"}）
              {live && !live.flowAvailable ? " · 板块资金端点暂不可用（资金项按 0 计）" : ""}
              {live ? " · 点柱形或龙头可进个股详情" : " · 示例数据无代码，个股入口不可点"}
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <div id="radar-ladder" className="fr-glass scroll-mt-16 p-5">
              <h2 className="fr-body mb-2 font-bold">涨停梯队</h2>
              <EChart option={ladderOption} height={145} />
            </div>
            <div id="radar-zha" className="fr-glass flex-1 scroll-mt-16 p-5">
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
              <p className="fr-sub mt-2 text-muted-foreground">
                炸板率 = 炸板数 ÷（涨停 + 炸板）· {usingSample || zhaMissing ? "炸板池为示例数据" : "真实数据"}
              </p>
            </div>
          </div>
        </div>

        {/* 吻合度（如实陈述，不构成建议） */}
        <div id="radar-fit" className="fr-glass mt-4 scroll-mt-16 p-5">
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
      </div>
      <FrBackToTop />
    </div>
  );
}
