/**
 * 资金雷达工作台 · 个股资金流向趋势图（双 y 轴）
 * ------------------------------------------------------------
 * - 柱状 = 主力净流入日序列（左轴，亿元）；折线 = 收盘价（右轴，元）。
 * - 可选叠加「超大单净流入」折线（新浪 r0_net 可得时；虚线，左轴亿元）。
 * - 红涨绿跌：净流入正红负绿（A 股 token）；收盘价折线用琥珀色与柱区区分。
 * - 可切 20/60 日（由页面控制，本组件只渲染传入窗口）。
 * - 坐标轴/提示字号跟 html[data-font-tier]（加大档 ≥16px），刻度高对比。
 * - 数据按日期升序传入，本组件只做确定性渲染，不算派生指标。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";

import { FR_FONT_TIER_CHANGED, loadFontTier, type FontTier } from "@/lib/fundradarTheme";

// 与 FrStockChart 共用的全局注册（echarts/core 同一模块单例，注册合并不影响既有图表）
echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

/** 红涨绿跌 token（画布读不到 CSS 变量，构建 option 时取一次） */
function flowChartColors(): { up: string; down: string; close: string; superLine: string; text: string; strongText: string; sub: string; border: string; tipBg: string; tipBorder: string } {
  const fallback = {
    up: "#E6443A", down: "#17A34A", close: "#E6A23C", superLine: "#8B5CF6",
    text: "#333", strongText: "#374151", sub: "#999", border: "#ddd", tipBg: "#ffffff", tipBorder: "rgba(30,60,100,0.25)",
  };
  if (typeof window === "undefined") return fallback;
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string, fb: string) => {
    const v = cs.getPropertyValue(name).trim();
    return v || fb;
  };
  // 🔴 深色判定走全局深浅开关：html.classList.contains("dark") 即深色（useDarkMode
  //    切 .dark/.light，与 .fr-elder-dark 同源同步）；不用 prefers-color-scheme 兜底，
  //    否则系统深色偏好会把浅色卡上的文字判成近白、白上白看不清。
  const dark = document.documentElement.classList.contains("dark");
  return {
    up: read("--color-up", fallback.up),
    down: read("--color-down", fallback.down),
    close: fallback.close,
    superLine: fallback.superLine,
    text: dark ? "#e2e5ea" : "#1f2733",
    strongText: dark ? "#E5E7EB" : "#374151",
    sub: dark ? "#8a93a3" : "#6b7280",
    border: dark ? "rgba(148,163,184,0.15)" : "rgba(30,60,100,0.12)",
    tipBg: dark ? "#1e2633" : "#ffffff",
    tipBorder: dark ? "rgba(148,163,184,0.4)" : "rgba(30,60,100,0.25)",
  };
}

/** 基础字号：跟随 html[data-font-tier]，默认「紧凑」= 12px */
function flowBaseFont(tier: FontTier): number {
  switch (tier) {
    case "compact": return 12;
    case "standard": return 14;
    case "xlarge": return 18;
    case "large":
    default: return 16;
  }
}

export interface FrFlowTrendPoint {
  date: string;
  /** 主力净流入（元） */
  main: number;
  /** 超大单净流入（元）；null = 该源不提供（整序列皆 null 则不画该折线） */
  superLarge: number | null;
  /** 收盘价（元，前复权；null = 该日无 K 线，折线留空） */
  close: number | null;
}

interface Props {
  points: FrFlowTrendPoint[];
  days: 20 | 60;
  height?: number;
}

/** 红涨绿跌：正红负绿；0 = 灰 */
function signColor(v: number, colors: { up: string; down: string; sub: string }): string {
  return v > 0 ? colors.up : v < 0 ? colors.down : colors.sub;
}

export function FrFlowTrendChart({ points, days, height = 360 }: Props) {
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
    const colors = flowChartColors();
    const baseFont = flowBaseFont(tier);
    const view = points.slice(-days);
    const dates = view.map((p) => p.date.slice(5, 10));

    // 资金净流入转「亿」；null 超大单保持 null（ECharts 折线按断点跳过）
    const mainYi = view.map((p) => p.main / 1e8);
    const superYi = view.map((p) => (p.superLarge == null ? null : p.superLarge / 1e8));
    const closes = view.map((p) => p.close);
    const hasSuper = superYi.some((v) => v !== null);
    const hasClose = closes.some((v) => v !== null);

    const mainColors = view.map((p) => signColor(p.main, colors));

    // tooltip：日期 + 主力/超大单（亿，红绿）+ 收盘价（元）
    const formatter = (p: unknown): string => {
      const arr = (Array.isArray(p) ? p : [p]) as { dataIndex?: number; seriesName?: string }[];
      const i = arr[0]?.dataIndex;
      if (i === undefined || !view[i]) return "";
      const pt = view[i]!;
      const pick = (name: string): number | null => {
        const s = arr.find((x) => x.seriesName === name) as { value?: unknown } | undefined;
        const v = Array.isArray(s?.value) ? s.value[1] : s?.value;
        return typeof v === "number" && Number.isFinite(v) ? v : null;
      };
      const m = pick("主力净流入"); // 亿
      const s = pick("超大单净流入"); // 亿
      const c = pick("收盘价"); // 元
      const colored = (v: number | null, unit: string) => {
        if (v == null) return "";
        const col = signColor(v, colors);
        return `<b style="color:${col}">${v > 0 ? "+" : ""}${v.toFixed(2)}${unit}</b>`;
      };
      const parts = [
        `<span style="font-size:${baseFont}px;font-weight:700;color:${colors.text}">${pt.date}</span>`,
        `主力净流入 ${colored(m, "亿")}`,
        hasSuper ? `超大单 ${colored(s, "亿")}` : "",
        c != null ? `收盘价 <b style="color:${colors.close}">${c.toFixed(2)}</b>` : "",
      ].filter(Boolean);
      return parts.join("<br/>");
    };

    const series: EChartsCoreOption["series"] = [
      {
        type: "bar" as const, name: "主力净流入", data: mainYi, barWidth: "55%",
        itemStyle: { color: (p: { dataIndex: number }) => mainColors[p.dataIndex] ?? colors.sub },
      },
      ...(hasSuper
        ? [{
            type: "line" as const, name: "超大单净流入", data: superYi, showSymbol: false,
            lineStyle: { width: 1.4, type: "dashed" as const, color: colors.superLine },
            itemStyle: { color: colors.superLine },
          }]
        : []),
      ...(hasClose
        ? [{
            type: "line" as const, name: "收盘价", yAxisIndex: 1, data: closes, showSymbol: false,
            lineStyle: { width: 1.6, color: colors.close }, itemStyle: { color: colors.close },
          }]
        : []),
    ];

    return {
      backgroundColor: "transparent",
      animation: false,
      legend: {
        top: 0, left: 8,
        textStyle: { fontSize: baseFont, fontWeight: 700, color: colors.text },
        itemWidth: 16, itemHeight: 9,
        data: hasSuper ? ["主力净流入", "超大单净流入", "收盘价"] : ["主力净流入", "收盘价"],
      },
      tooltip: {
        trigger: "axis" as const,
        axisPointer: { type: "shadow" as const },
        backgroundColor: colors.tipBg,
        borderColor: colors.tipBorder,
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { fontSize: baseFont, fontWeight: "bold", color: colors.strongText },
        formatter,
      },
      grid: { left: 66, right: 66, top: 34, bottom: 8, containLabel: true },
      xAxis: {
        type: "category" as const, data: dates,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: colors.border } },
        axisLabel: { color: colors.strongText, fontSize: baseFont, fontWeight: "bold" },
      },
      yAxis: [
        {
          type: "value" as const, name: "资金(亿)", scale: true,
          nameTextStyle: { color: colors.sub, fontSize: baseFont },
          axisLabel: { color: colors.strongText, fontSize: baseFont, fontWeight: "bold" },
          splitLine: { lineStyle: { color: colors.border } },
        },
        {
          type: "value" as const, name: "价格(元)", scale: true,
          nameTextStyle: { color: colors.sub, fontSize: baseFont },
          axisLabel: { color: colors.sub, fontSize: baseFont },
          splitLine: { show: false },
        },
      ],
      series,
    };
  }, [points, days, tier]);

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
