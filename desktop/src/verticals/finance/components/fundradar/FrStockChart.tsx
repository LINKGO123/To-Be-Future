/**
 * 资金雷达工作台 · 个股页 K 线图（简洁 / 专业双模式）
 * ------------------------------------------------------------
 * - 简洁模式（默认）：日 K 蜡烛 + MA5/10/20 折线 + 成交量柱；高度 ≥ 400，
 *   坐标轴 / 提示字号加大，不放缩放、不放副图。
 * - 专业模式：主图（蜡烛 + MA + BOLL 上中下轨）+ 成交量 + MACD(12,26,9) +
 *   KDJ(9,3,3) 三副图，十字光标（axisPointer cross）+ dataZoom（滚轮+滑条）缩放；
 *   周期切换（日/周/月，由日 K 聚合）与分时标签由页面控制。
 * - 分时：tdx_bars 一分钟 / 腾讯分钟 K 序列（两源都断时页面隐藏该标签，本组件收不到数据）。
 * - 颜色走 A 股红涨绿跌 token（--color-up / --color-down）；指标计算在
 *   lib/fundradarIndicators.ts（纯函数，口径注释见该文件）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart, CandlestickChart, LineChart } from "echarts/charts";
import {
  DataZoomComponent, DataZoomInsideComponent, DataZoomSliderComponent, GridComponent, LegendComponent,
  MarkLineComponent, TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";

import { boll, kdj, macd, sma, type KlineBar, type KlinePeriod } from "@/lib/fundradarIndicators";
import { FR_FONT_TIER_CHANGED, loadFontTier, type FontTier } from "@/lib/fundradarTheme";

// 全局注册（echarts/core 是同一模块单例，与 EChart.tsx 的注册合并，不影响既有图表）
echarts.use([
  CandlestickChart, LineChart, BarChart,
  GridComponent, TooltipComponent, LegendComponent,
  DataZoomComponent, DataZoomInsideComponent, DataZoomSliderComponent,
  MarkLineComponent, CanvasRenderer,
]);

/** 红涨绿跌 token（画布读不到 CSS 变量，构建 option 时取一次） */
function frChartColors(): { up: string; down: string; flat: string; text: string; strongText: string; sub: string; border: string; tipBg: string; tipBorder: string } {
  if (typeof window === "undefined") return { up: "#E6443A", down: "#17A34A", flat: "#6B7280", text: "#333", strongText: "#374151", sub: "#999", border: "#ddd", tipBg: "#ffffff", tipBorder: "rgba(30,60,100,0.25)" };
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => {
    const v = cs.getPropertyValue(name).trim();
    return v || fallback;
  };
  // 🔴 深色判定走全局深浅开关：html.classList.contains("dark") 即深色（useDarkMode
  //    切 .dark/.light，与 .fr-elder-dark 同源同步）。不用 prefers-color-scheme 兜底，
  //    否则系统深色偏好会把浅色卡上的刻度/图例/tooltip 误判成「深色」→ 近白文字白上白。
  const dark = document.documentElement.classList.contains("dark");
  return {
    up: read("--color-up", "#E6443A"),
    down: read("--color-down", "#17A34A"),
    flat: read("--color-flat", "#6B7280"),
    text: dark ? "#e2e5ea" : "#1f2733",
    // 高对比刻度/提示文字：浅色深灰、深色近白，不用半透明灰
    strongText: dark ? "#E5E7EB" : "#374151",
    sub: dark ? "#8a93a3" : "#6b7280",
    border: dark ? "rgba(148,163,184,0.15)" : "rgba(30,60,100,0.12)",
    // tooltip 底色/描边：显式给不透明高对比底色（深色模式下 ECharts 默认仍是白底，近白文字会白上白）
    tipBg: dark ? "#1e2633" : "#ffffff",
    tipBorder: dark ? "rgba(148,163,184,0.4)" : "rgba(30,60,100,0.25)",
  };
}

const MA_COLORS = ["#E6A23C", "#409EFF", "#9C6ADE"]; // MA5 / MA10 / MA20
const BOLL_COLOR = "#6B7280"; // 加深：原 #909399 过浅，图上与 tooltip 都看不清

/** 简洁模式蜡烛/成交量实心高饱和色：固定红涨绿跌、不透明度 1.0，不随 CSS 变量漂移 */
const UP_SOLID = "#E6443A"; // 涨 = 红
const DOWN_SOLID = "#17A34A"; // 跌 = 绿

/** K 线基础字号：跟随全局字号档位（html[data-font-tier]）；默认「紧凑」= 12px */
function klineBaseFont(tier: FontTier): number {
  switch (tier) {
    case "compact": return 12;  // 紧凑
    case "standard": return 14; // 标准
    case "xlarge": return 18;   // 超大
    case "large":
    default: return 16;         // 加大
  }
}

/** 蜡烛数据 [open, close, low, high]（ECharts candlestick 顺序） */
function candleData(rows: KlineBar[]): number[][] {
  return rows.map((r) => [r.open, r.close, r.low, r.high]);
}

interface Props {
  rows: KlineBar[];
  mode: "simple" | "pro";
  /** 展示用标签（日/周/月） */
  period: KlinePeriod;
  /** 分时视图（tdx_bars / 腾讯分钟 K；为 true 时忽略 rows 画分时线） */
  intraday: boolean;
  height?: number;
}

/** 主图 tooltip：OHLC + MA + BOLL（专业模式；指标值按各自线色着色，加粗） */
function mainTooltip(rows: KlineBar[], colors: { up: string; down: string; sub: string }): (p: unknown) => string {
  return (p: unknown) => {
    const arr = Array.isArray(p) ? p : [p];
    const item = (arr as { dataIndex?: number; seriesName?: string; value?: unknown }[])[0];
    const i = item?.dataIndex;
    if (i === undefined || !rows[i]) return "";
    const r = rows[i]!;
    const chg = r.close >= r.open;
    const c = chg ? colors.up : colors.down;
    const line = (name: string, color: string) => {
      const s = (arr as { seriesName?: string; value?: unknown }[]).find((x) => x.seriesName === name);
      const v = Array.isArray(s?.value) ? s.value[1] : s?.value;
      return typeof v === "number" && Number.isFinite(v)
        ? `<span style="color:${color};font-weight:700">${name} ${v.toFixed(2)}</span>`
        : "";
    };
    const lines = [
      line("MA5", MA_COLORS[0]!), line("MA10", MA_COLORS[1]!), line("MA20", MA_COLORS[2]!),
      line("BOLL上轨", BOLL_COLOR), line("BOLL中轨", BOLL_COLOR), line("BOLL下轨", BOLL_COLOR),
    ].filter(Boolean);
    return `<span style="font-size:14px;font-weight:700">${r.date}</span><br/>` +
      `开 ${r.open.toFixed(2)}　收 <b style="color:${c}">${r.close.toFixed(2)}</b>　高 ${r.high.toFixed(2)}　低 ${r.low.toFixed(2)}<br/>量 ${r.volume}` +
      (lines.length ? `<br/>${lines.join("　")}` : "");
  };
}

/** 简洁模式tooltip：大字日期/开高低量 + 收盘价与涨跌幅红绿大字 */
function mainTooltipBig(
  rows: KlineBar[],
  colors: { up: string; down: string; text: string },
  fontSize: number,
  accentSize: number,
): (p: unknown) => string {
  return (p: unknown) => {
    const arr = Array.isArray(p) ? p : [p];
    const item = (arr as { dataIndex?: number }[])[0];
    const i = item?.dataIndex;
    if (i === undefined || !rows[i]) return "";
    const r = rows[i]!;
    const c = r.close >= r.open ? colors.up : colors.down;
    // 涨跌幅：以相邻上一根收盘为基准（首根以今开为基准），纯展示口径
    const prevClose = i > 0 ? rows[i - 1]!.close : r.open;
    const chgPct = prevClose && prevClose !== 0 ? ((r.close - prevClose) / prevClose) * 100 : 0;
    const pctColor = chgPct >= 0 ? colors.up : colors.down;
    return `<span style="font-size:${fontSize}px;font-weight:700;color:${colors.text}">${r.date}</span><br/>` +
      `开 ${r.open.toFixed(2)}　高 ${r.high.toFixed(2)}　低 ${r.low.toFixed(2)}　量 ${r.volume}<br/>` +
      `<b style="font-size:${accentSize}px;color:${c}">收 ${r.close.toFixed(2)}</b>　` +
      `<b style="font-size:${accentSize}px;color:${pctColor}">${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(2)}%</b>`;
  };
}

export function FrStockChart({ rows, mode, period, intraday, height = 440 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);

  // 字号档位：初始读 html[data-font-tier]，监听全局档位变化事件实时联动
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
    const colors = frChartColors();
    const baseFont = klineBaseFont(tier);
    // 简洁模式：无缩放工具，只显示最近 90 根，蜡烛更大更易读；专业模式全量+dataZoom。
    const viewRows = intraday || mode === "pro" || rows.length <= 90 ? rows : rows.slice(-90);
    const closes = viewRows.map((r) => r.close);
    const ma = [5, 10, 20].map((n) => sma(closes, n));
    const macdPts = macd(closes);
    const bollPts = boll(closes);
    const kdjPts = kdj(viewRows.map((r) => r.high), viewRows.map((r) => r.low), closes);

    if (intraday) {
      // 分时：价格折线 + 成交量柱（分钟序列，时间标签取 HH:MM）
      const times = viewRows.map((r) => (r.date.length > 10 ? r.date.slice(11, 16) : r.date.slice(5, 10)));
      return {
        backgroundColor: "transparent",
        animation: false,
        legend: { show: false },
        tooltip: {
          trigger: "axis" as const,
          axisPointer: { type: "cross" as const },
          textStyle: { fontSize: 14, color: colors.text },
          formatter: (p: unknown) => {
            const arr = (Array.isArray(p) ? p : [p]) as { dataIndex?: number }[];
            const i = arr[0]?.dataIndex;
            if (i === undefined || !viewRows[i]) return "";
            const r = viewRows[i]!;
            return `${r.date}<br/>价 ${r.close.toFixed(2)}　量 ${r.volume}`;
          },
        },
        grid: [
          { left: 66, right: 20, top: 20, height: "60%" },
          { left: 66, right: 20, top: "72%", height: "16%" },
        ],
        xAxis: [
          { type: "category" as const, data: times, boundaryGap: false, axisLabel: { color: colors.sub, fontSize: 12 }, axisLine: { lineStyle: { color: colors.border } } },
          { type: "category" as const, gridIndex: 1, data: times, axisLabel: { show: false }, axisLine: { lineStyle: { color: colors.border } } },
        ],
        yAxis: [
          { type: "value" as const, scale: true, axisLabel: { color: colors.sub, fontSize: 12 }, splitLine: { lineStyle: { color: colors.border } } },
          { type: "value" as const, gridIndex: 1, axisLabel: { show: false }, splitLine: { show: false } },
        ],
        series: [
          {
            type: "line" as const, name: "价格", data: closes, showSymbol: false,
            lineStyle: { width: 1.5, color: colors.up }, areaStyle: { color: "rgba(230,68,58,0.08)" },
          },
          {
            type: "bar" as const, name: "量", xAxisIndex: 1, yAxisIndex: 1, data: viewRows.map((r) => r.volume),
            itemStyle: { color: colors.sub, opacity: 0.6 },
          },
        ],
      };
    }

    const labelFont = mode === "simple" ? baseFont : 11;
    const tooltipFont = mode === "simple" ? baseFont : 12;
    const accentFont = mode === "simple" ? baseFont + 4 : 12;
    const dates = viewRows.map((r) => r.date.slice(5, 10));
    // 简洁模式用实心高饱和红/绿（不透明度 1.0）；专业模式沿用 token 色
    const volUp = mode === "simple" ? UP_SOLID : colors.up;
    const volDown = mode === "simple" ? DOWN_SOLID : colors.down;
    const volColors = viewRows.map((r) => (r.close >= r.open ? volUp : volDown));

    const axisCommon = {
      type: "category" as const,
      data: dates,
      axisLine: { lineStyle: { color: colors.border } },
      axisLabel: { color: colors.sub, fontSize: labelFont },
    };

    if (mode === "simple") {
      // 简洁模式（默认）：蜡烛 + MA + 成交量，无副图无缩放；字号跟全局档位、刻度高对比加粗
      return {
        backgroundColor: "transparent",
        animation: false,
        legend: {
          top: 0, left: 8, textStyle: { fontSize: baseFont, fontWeight: 700, color: colors.text }, itemWidth: 16, itemHeight: 9,
          data: ["MA5", "MA10", "MA20"],
        },
        tooltip: {
          trigger: "axis" as const,
          axisPointer: { type: "shadow" as const },
          backgroundColor: colors.tipBg,
          borderColor: colors.tipBorder,
          borderWidth: 1,
          padding: [8, 12],
          textStyle: { fontSize: tooltipFont, fontWeight: "bold", color: colors.strongText },
          formatter: mainTooltipBig(viewRows, colors, tooltipFont, accentFont),
        },
        grid: [
          { left: 70, right: 24, top: 34, height: "58%" },
          { left: 70, right: 24, top: "76%", height: "16%" },
        ],
        xAxis: [
          {
            ...axisCommon,
            axisTick: { show: false },
            axisLabel: { color: colors.strongText, fontSize: baseFont, fontWeight: "bold" },
          },
          { ...axisCommon, gridIndex: 1, axisLabel: { show: false } },
        ],
        yAxis: [
          {
            type: "value" as const, scale: true,
            axisTick: { show: false },
            axisLabel: { color: colors.strongText, fontSize: baseFont, fontWeight: "bold" },
            // 只留水平淡线，删多余网格
            splitLine: { lineStyle: { color: colors.border } },
          },
          { type: "value" as const, gridIndex: 1, axisLabel: { show: false }, splitLine: { show: false } },
        ],
        series: [
          {
            type: "candlestick" as const, name: "日K",
            data: candleData(viewRows),
            barWidth: "68%",
            itemStyle: { color: UP_SOLID, color0: DOWN_SOLID, borderColor: UP_SOLID, borderColor0: DOWN_SOLID, opacity: 1 },
          },
          ...ma.map((m, idx) => ({
            type: "line" as const, name: `MA${[5, 10, 20][idx]}`, data: m, showSymbol: false, smooth: true,
            lineStyle: { width: 1.6, color: MA_COLORS[idx] }, itemStyle: { color: MA_COLORS[idx] },
          })),
          {
            type: "bar" as const, name: "成交量", xAxisIndex: 1, yAxisIndex: 1, data: viewRows.map((r) => r.volume),
            itemStyle: { color: (p: { dataIndex: number }) => volColors[p.dataIndex] ?? colors.flat },
          },
        ],
      };
    }

    // 专业模式：主图（蜡烛+MA+BOLL）+ 量 + MACD + KDJ，cross 光标 + dataZoom
    const macdBars = macdPts.map((m) => m.hist);
    const macdBarColors = macdBars.map((v) => (v === null ? colors.flat : v >= 0 ? colors.up : colors.down));
    const bollUpper = bollPts.map((b) => b.upper);
    const bollMid = bollPts.map((b) => b.mid);
    const bollLower = bollPts.map((b) => b.lower);
    const kLine = kdjPts.map((k) => k.k);
    const dLine = kdjPts.map((k) => k.d);
    const jLine = kdjPts.map((k) => k.j);

    return {
      backgroundColor: "transparent",
      animation: false,
      legend: {
        top: 0, left: 8, type: "scroll" as const,
        textStyle: { fontSize: 11, color: colors.text }, itemWidth: 12, itemHeight: 8,
        data: ["MA5", "MA10", "MA20", "BOLL上轨", "BOLL中轨", "BOLL下轨", "DIF", "DEA", "K", "D", "J"],
      },
      tooltip: {
        trigger: "axis" as const,
        axisPointer: { type: "cross" as const },
        backgroundColor: colors.tipBg,
        borderColor: colors.tipBorder,
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { fontSize: tooltipFont, color: colors.text },
        formatter: mainTooltip(viewRows, colors),
      },
      grid: [
        { left: 62, right: 24, top: 26, height: "40%" },
        { left: 62, right: 24, top: "54%", height: "9%" },
        { left: 62, right: 24, top: "67%", height: "11%" },
        { left: 62, right: 24, top: "82%", height: "11%" },
      ],
      xAxis: [
        { ...axisCommon, axisLabel: { show: false } },
        { ...axisCommon, gridIndex: 1, axisLabel: { show: false } },
        { ...axisCommon, gridIndex: 2, axisLabel: { show: false } },
        { ...axisCommon, gridIndex: 3 },
      ],
      yAxis: [
        {
          type: "value" as const, scale: true, axisLabel: { color: colors.sub, fontSize: labelFont },
          splitLine: { lineStyle: { color: colors.border } },
        },
        { type: "value" as const, gridIndex: 1, axisLabel: { show: false }, splitLine: { show: false } },
        {
          type: "value" as const, gridIndex: 2, axisLabel: { color: colors.sub, fontSize: 10 },
          splitLine: { lineStyle: { color: colors.border } },
        },
        {
          type: "value" as const, gridIndex: 3, axisLabel: { color: colors.sub, fontSize: 10 },
          splitLine: { lineStyle: { color: colors.border } },
        },
      ],
      dataZoom: [
        { type: "inside" as const, xAxisIndex: [0, 1, 2, 3], start: 55, end: 100 },
        { type: "slider" as const, xAxisIndex: [0, 1, 2, 3], bottom: 0, height: 16, borderColor: colors.border, textStyle: { color: colors.sub, fontSize: 10 } },
      ],
      series: [
        {
          type: "candlestick" as const, name: "K线",
          data: candleData(viewRows),
          itemStyle: { color: colors.up, color0: colors.down, borderColor: colors.up, borderColor0: colors.down },
        },
        ...ma.map((m, idx) => ({
          type: "line" as const, name: `MA${[5, 10, 20][idx]}`, data: m, showSymbol: false, smooth: true,
          lineStyle: { width: 1.3, color: MA_COLORS[idx] }, itemStyle: { color: MA_COLORS[idx] },
        })),
        {
          type: "line" as const, name: "BOLL上轨", data: bollUpper, showSymbol: false,
          lineStyle: { width: 1, type: "dashed" as const, color: BOLL_COLOR }, itemStyle: { color: BOLL_COLOR },
        },
        {
          type: "line" as const, name: "BOLL中轨", data: bollMid, showSymbol: false,
          lineStyle: { width: 1, type: "dashed" as const, color: "#b7bcc4" }, itemStyle: { color: "#b7bcc4" },
        },
        {
          type: "line" as const, name: "BOLL下轨", data: bollLower, showSymbol: false,
          lineStyle: { width: 1, type: "dashed" as const, color: BOLL_COLOR }, itemStyle: { color: BOLL_COLOR },
        },
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
          type: "line" as const, name: "K", xAxisIndex: 3, yAxisIndex: 3, data: kLine, showSymbol: false,
          lineStyle: { width: 1.1, color: MA_COLORS[1] }, itemStyle: { color: MA_COLORS[1] },
        },
        {
          type: "line" as const, name: "D", xAxisIndex: 3, yAxisIndex: 3, data: dLine, showSymbol: false,
          lineStyle: { width: 1.1, color: MA_COLORS[0] }, itemStyle: { color: MA_COLORS[0] },
        },
        {
          type: "line" as const, name: "J", xAxisIndex: 3, yAxisIndex: 3, data: jLine, showSymbol: false,
          lineStyle: { width: 1.1, color: MA_COLORS[2] }, itemStyle: { color: MA_COLORS[2] },
        },
      ],
    };
  }, [rows, mode, intraday, period, tier]);

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
