/**
 * 资金雷达工作台 · 报告页趋势图（K线 + 均线 + 成交量 + MACD + RSI）
 * ------------------------------------------------------------
 * - 主图：日 K 蜡烛 + MA5/10/20 折线；成交量柱（红涨绿跌）。
 * - 副图：MACD(12,26,9)（柱 + DIF/DEA）、RSI(14)（带 30/70 参考线）。
 * - 坐标轴 / 提示字号跟 html[data-font-tier]（加大档 ≥16px），刻度高对比。
 * - 指标全部走 lib/fundradarIndicators.ts 纯函数（MA/MACD/RSI），只渲染不算数。
 * - 数据按日期升序传入；只展示最近 90 根（更易读），不缩放。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart, CandlestickChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";

import { macd, rsi, sma, type KlineBar } from "@/lib/fundradarIndicators";
import { FR_FONT_TIER_CHANGED, loadFontTier, type FontTier } from "@/lib/fundradarTheme";

// 全局注册（echarts/core 是同一模块单例，与 FrStockChart/FrFlowTrendChart 的注册合并）
echarts.use([
  CandlestickChart, LineChart, BarChart,
  GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, CanvasRenderer,
]);

/** 红涨绿跌 token（画布读不到 CSS 变量，构建 option 时取一次） */
function reportChartColors(): { up: string; down: string; flat: string; text: string; strongText: string; sub: string; border: string; tipBg: string; tipBorder: string } {
  if (typeof window === "undefined") return { up: "#E6443A", down: "#17A34A", flat: "#6B7280", text: "#333", strongText: "#374151", sub: "#999", border: "#ddd", tipBg: "#ffffff", tipBorder: "rgba(30,60,100,0.25)" };
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => {
    const v = cs.getPropertyValue(name).trim();
    return v || fallback;
  };
  // 深色判定走全局深浅开关：html.classList.contains("dark") 即深色，否则浅色。
  const dark = document.documentElement.classList.contains("dark");
  return {
    up: read("--color-up", "#E6443A"),
    down: read("--color-down", "#17A34A"),
    flat: read("--color-flat", "#6B7280"),
    text: dark ? "#e2e5ea" : "#1f2733",
    strongText: dark ? "#E5E7EB" : "#374151",
    sub: dark ? "#8a93a3" : "#6b7280",
    border: dark ? "rgba(148,163,184,0.15)" : "rgba(30,60,100,0.12)",
    tipBg: dark ? "#1e2633" : "#ffffff",
    tipBorder: dark ? "rgba(148,163,184,0.4)" : "rgba(30,60,100,0.25)",
  };
}

const MA_COLORS = ["#E6A23C", "#409EFF", "#9C6ADE"]; // MA5 / MA10 / MA20
const UP_SOLID = "#E6443A";
const DOWN_SOLID = "#17A34A";

/** K 线基础字号：跟随全局字号档位（html[data-font-tier]）；默认「紧凑」= 12px */
function baseFontOf(tier: FontTier): number {
  switch (tier) {
    case "compact": return 12;
    case "standard": return 14;
    case "xlarge": return 18;
    case "large":
    default: return 16;
  }
}

function candleData(rows: KlineBar[]): number[][] {
  return rows.map((r) => [r.open, r.close, r.low, r.high]);
}

interface Props {
  rows: KlineBar[];
  height?: number;
}

export function FrReportChart({ rows, height = 560 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);

  const [tier, setTier] = useState<FontTier>(() => {
    if (typeof document === "undefined") return "large";
    const attr = document.documentElement.dataset.fontTier;
    return attr === "compact" || attr === "standard" || attr === "large" || attr === "xlarge" ? attr : loadFontTier();
  });

  useEffect(() => {
    const onTierChanged = (e: Event) => {
      const detail = (e as CustomEvent<FontTier>).detail;
      if (detail === "compact" || detail === "standard" || detail === "large" || detail === "xlarge") setTier(detail);
    };
    window.addEventListener(FR_FONT_TIER_CHANGED, onTierChanged);
    return () => window.removeEventListener(FR_FONT_TIER_CHANGED, onTierChanged);
  }, []);

  const option = useMemo<EChartsCoreOption>(() => {
    const colors = reportChartColors();
    const baseFont = baseFontOf(tier);
    const viewRows = rows.length <= 90 ? rows : rows.slice(-90);
    const closes = viewRows.map((r) => r.close);
    const ma = [5, 10, 20].map((n) => sma(closes, n));
    const macdPts = macd(closes);
    const rsiPts = rsi(closes, 14);
    const dates = viewRows.map((r) => r.date.slice(5, 10));
    const volColors = viewRows.map((r) => (r.close >= r.open ? UP_SOLID : DOWN_SOLID));
    const macdBars = macdPts.map((m) => m.hist);
    const macdBarColors = macdBars.map((v) => (v === null ? colors.flat : v >= 0 ? UP_SOLID : DOWN_SOLID));

    const axisCommon = {
      type: "category" as const,
      data: dates,
      axisLine: { lineStyle: { color: colors.border } },
      axisLabel: { color: colors.sub, fontSize: baseFont },
    };

    const formatter = (p: unknown): string => {
      const arr = (Array.isArray(p) ? p : [p]) as { dataIndex?: number; seriesName?: string; value?: unknown }[];
      const i = arr[0]?.dataIndex;
      if (i === undefined || !viewRows[i]) return "";
      const r = viewRows[i]!;
      const c = r.close >= r.open ? colors.up : colors.down;
      const pick = (name: string): number | null => {
        const s = arr.find((x) => x.seriesName === name);
        const v = Array.isArray(s?.value) ? s.value[1] : s?.value;
        return typeof v === "number" && Number.isFinite(v) ? v : null;
      };
      const line = (name: string, color: string): string => {
        const v = pick(name);
        return v == null ? "" : `<span style="color:${color};font-weight:700">${name} ${v.toFixed(2)}</span>`;
      };
      const dif = pick("DIF");
      const dea = pick("DEA");
      const hist = pick("MACD柱");
      const rsiV = pick("RSI14");
      const lines = [
        `开 ${r.open.toFixed(2)}　收 <b style="color:${c}">${r.close.toFixed(2)}</b>　高 ${r.high.toFixed(2)}　低 ${r.low.toFixed(2)}`,
        `量 ${r.volume}`,
        [line("MA5", MA_COLORS[0]!), line("MA10", MA_COLORS[1]!), line("MA20", MA_COLORS[2]!)].filter(Boolean).join("　"),
        dif != null || dea != null || hist != null
          ? `DIF ${dif == null ? "—" : dif.toFixed(3)}　DEA ${dea == null ? "—" : dea.toFixed(3)}　MACD ${hist == null ? "—" : hist.toFixed(3)}`
          : "",
        rsiV != null ? `RSI14 <b style="color:${MA_COLORS[1]}">${rsiV.toFixed(1)}</b>` : "",
      ].filter(Boolean);
      return `<span style="font-size:${baseFont}px;font-weight:700;color:${colors.text}">${r.date}</span><br/>${lines.join("<br/>")}`;
    };

    return {
      backgroundColor: "transparent",
      animation: false,
      legend: {
        top: 0, left: 8, type: "scroll" as const,
        textStyle: { fontSize: baseFont, fontWeight: 700, color: colors.text }, itemWidth: 16, itemHeight: 9,
        data: ["MA5", "MA10", "MA20", "DIF", "DEA", "RSI14"],
      },
      tooltip: {
        trigger: "axis" as const,
        axisPointer: { type: "cross" as const },
        backgroundColor: colors.tipBg,
        borderColor: colors.tipBorder,
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { fontSize: baseFont, fontWeight: "bold", color: colors.strongText },
        formatter,
      },
      grid: [
        { left: 64, right: 24, top: 30, height: "38%" },
        { left: 64, right: 24, top: "51%", height: "10%" },
        { left: 64, right: 24, top: "64%", height: "13%" },
        { left: 64, right: 24, top: "80%", height: "13%" },
      ],
      xAxis: [
        { ...axisCommon, axisLabel: { show: false } },
        { ...axisCommon, gridIndex: 1, axisLabel: { show: false } },
        { ...axisCommon, gridIndex: 2, axisLabel: { show: false } },
        { ...axisCommon, gridIndex: 3, axisLabel: { color: colors.strongText, fontWeight: "bold" } },
      ],
      yAxis: [
        {
          type: "value" as const, scale: true,
          axisLabel: { color: colors.strongText, fontSize: baseFont, fontWeight: "bold" },
          splitLine: { lineStyle: { color: colors.border } },
        },
        { type: "value" as const, gridIndex: 1, axisLabel: { show: false }, splitLine: { show: false } },
        {
          type: "value" as const, gridIndex: 2, scale: true,
          axisLabel: { color: colors.sub, fontSize: baseFont - 2 },
          splitLine: { lineStyle: { color: colors.border } },
        },
        {
          type: "value" as const, gridIndex: 3, min: 0, max: 100,
          axisLabel: { color: colors.sub, fontSize: baseFont - 2 },
          splitLine: { lineStyle: { color: colors.border } },
        },
      ],
      series: [
        {
          type: "candlestick" as const, name: "K线",
          data: candleData(viewRows),
          itemStyle: { color: UP_SOLID, color0: DOWN_SOLID, borderColor: UP_SOLID, borderColor0: DOWN_SOLID },
        },
        ...ma.map((m, idx) => ({
          type: "line" as const, name: `MA${[5, 10, 20][idx]}`, data: m, showSymbol: false, smooth: true,
          lineStyle: { width: 1.5, color: MA_COLORS[idx] }, itemStyle: { color: MA_COLORS[idx] },
        })),
        {
          type: "bar" as const, name: "成交量", xAxisIndex: 1, yAxisIndex: 1, data: viewRows.map((r) => r.volume),
          itemStyle: { color: (p: { dataIndex: number }) => volColors[p.dataIndex] ?? colors.flat },
        },
        {
          type: "bar" as const, name: "MACD柱", xAxisIndex: 2, yAxisIndex: 2, data: macdBars, barWidth: "55%",
          itemStyle: { color: (p: { dataIndex: number }) => macdBarColors[p.dataIndex] ?? colors.flat },
        },
        {
          type: "line" as const, name: "DIF", xAxisIndex: 2, yAxisIndex: 2, data: macdPts.map((m) => m.dif), showSymbol: false,
          lineStyle: { width: 1.1, color: MA_COLORS[0] }, itemStyle: { color: MA_COLORS[0] },
        },
        {
          type: "line" as const, name: "DEA", xAxisIndex: 2, yAxisIndex: 2, data: macdPts.map((m) => m.dea), showSymbol: false,
          lineStyle: { width: 1.1, color: MA_COLORS[1] }, itemStyle: { color: MA_COLORS[1] },
        },
        {
          type: "line" as const, name: "RSI14", xAxisIndex: 3, yAxisIndex: 3, data: rsiPts, showSymbol: false,
          lineStyle: { width: 1.5, color: MA_COLORS[1] }, itemStyle: { color: MA_COLORS[1] },
          markLine: {
            silent: true,
            symbol: "none",
            label: { color: colors.sub, fontSize: baseFont - 2 },
            lineStyle: { color: colors.border, type: "dashed" as const },
            data: [
              { yAxis: 70, label: { formatter: "超买70" } },
              { yAxis: 30, label: { formatter: "超卖30" } },
            ],
          },
        },
      ],
    };
  }, [rows, tier]);

  useEffect(() => {
    if (!ref.current) return;
    inst.current = echarts.init(ref.current);
    const ro = new ResizeObserver(() => inst.current?.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      inst.current?.dispose();
      inst.current = null;
    };
  }, []);

  useEffect(() => {
    inst.current?.setOption(option, true);
  }, [option]);

  return <div ref={ref} style={{ height, width: "100%" }} />;
}
