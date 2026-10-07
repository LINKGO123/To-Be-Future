/**
 * 资金雷达工作台 · 常用主题工具（刀3）
 * 四档字号（详规 v0.2 §0.1）：紧凑（默认）/ 标准 / 加大 / 超大。
 * 落点：<html data-font-tier="..."> 只记录当前档；fundradar-theme.css
 * 只在 .fr-elder-page（常用区域页面容器）作用域内按档覆盖 --fs-* 变量，
 * 进阶研究区与深色大屏（.fr-screen-dark）走 :root 固定兜底值，不受档位影响。
 *
 * 档位同步：applyFontTier 在档位实际变化时派发 window 自定义事件
 * fr-font-tier-changed（detail = 新档位）。侧栏（Layout）与设置页都监听它，
 * 任意一侧改档后另一侧的控件高亮即时同步。
 */
import { useEffect, useState } from "react";

import { storageGet, storageSet } from "@/lib/storage";

export type FontTier = "compact" | "standard" | "large" | "xlarge";

export const FONT_TIERS: ReadonlyArray<{ key: FontTier; label: string }> = [
  { key: "compact", label: "紧凑" },
  { key: "standard", label: "标准" },
  { key: "large", label: "加大" },
  { key: "xlarge", label: "超大" },
];

const STORAGE_KEY = "fr-font-tier";

/** 档位变化的 window 自定义事件名；detail 为新的 FontTier。 */
export const FR_FONT_TIER_CHANGED = "fr-font-tier-changed";

function isFontTier(v: string | null | undefined): v is FontTier {
  return v === "compact" || v === "standard" || v === "large" || v === "xlarge";
}

/** 读取已保存的字号档，没存过/存坏了一律回默认「紧凑」。 */
export function loadFontTier(): FontTier {
  const saved = storageGet(STORAGE_KEY);
  return isFontTier(saved) ? saved : "compact";
}

/** 应用到 <html data-font-tier>；CSS 侧只在 .fr-elder-page 作用域按档切换变量；返回实际档位。 */
export function applyFontTier(tier: FontTier): FontTier {
  const prev = document.documentElement.dataset.fontTier;
  document.documentElement.dataset.fontTier = tier;
  // 档位真正变了才广播：Layout / 设置页两侧都监听该事件同步高亮（幂等，重复触发无副作用）
  if (prev !== tier) {
    window.dispatchEvent(new CustomEvent<FontTier>(FR_FONT_TIER_CHANGED, { detail: tier }));
  }
  return tier;
}

/** 保存并立即生效。 */
export function saveFontTier(tier: FontTier): void {
  storageSet(STORAGE_KEY, tier);
  applyFontTier(tier);
}

/** 循环切换：紧凑 → 标准 → 加大 → 超大 → 紧凑（侧栏折叠态字号按钮用）。 */
export function nextFontTier(current: FontTier): FontTier {
  const idx = FONT_TIERS.findIndex((t) => t.key === current);
  return FONT_TIERS[(idx + 1) % FONT_TIERS.length]!.key;
}

/** A 股红涨绿跌：>0 红、<0 绿、=0/无值 灰（详规 v0.2 §0.2）。 */
export function frPctClass(v: number | null | undefined): string {
  if (v == null || v === 0) return "fr-flat";
  return v > 0 ? "fr-up" : "fr-down";
}

/**
 * 带正负号的百分比/金额文案：正数补 +，负数自带 -。
 * 🔴 必须格式化：直接 `${v}` 会把浮点误差原样显示（-3019.9999999999982元）。
 *   - 百分比（suffix="%"）：两位小数，不加千分位；
 *   - 金额（其他）：两位小数 + 千分位。
 *   非有限值（NaN/Infinity）给「—」而不是把 NaN 渲染给用户。
 */
export function frSigned(v: number, suffix = ""): string {
  if (!Number.isFinite(v)) return `—${suffix}`;
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const text = suffix === "%"
    ? abs.toFixed(2)
    : abs.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${text}${suffix}`;
}

/** 全局深色判定：html.classList.contains("dark") 即深色；否则浅色（SSR 兜底浅色）。 */
export function isFrDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

/** 订阅全局深浅：html 的 class（.dark/.light）变化时即时更新，供图表 option 重建配色。 */
export function useFrDark(): boolean {
  const [dark, setDark] = useState<boolean>(isFrDark);
  useEffect(() => {
    const ro = new MutationObserver(() => setDark(isFrDark()));
    ro.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => ro.disconnect();
  }, []);
  return dark;
}

/** 深色大屏雷达/复盘图表（EChart）灰阶配色：画布读不到 CSS 变量，构建 option 时按全局深浅取一次。 */
export interface FrChartGray {
  splitLine: string;
  axisLine: string;
  axisLabel: string;
  axisSub: string;
  tipBg: string;
  tipBorder: string;
  tipText: string;
}

/** 深色大屏图表灰阶：深色沿用 220 深蓝黑灰阶；浅色用中性灰阶（与 .fr-screen-dark token 对齐）。 */
export function frChartGray(dark: boolean): FrChartGray {
  return dark
    ? {
        splitLine: "hsl(220 12% 18%)",
        axisLine: "hsl(220 12% 22%)",
        axisLabel: "hsl(220 14% 85%)",
        axisSub: "hsl(220 10% 58%)",
        tipBg: "hsl(220 16% 12%)",
        tipBorder: "hsl(220 12% 26%)",
        tipText: "hsl(220 14% 90%)",
      }
    : {
        splitLine: "hsl(220 12% 90%)",
        axisLine: "hsl(220 10% 82%)",
        axisLabel: "hsl(220 12% 28%)",
        axisSub: "hsl(220 8% 45%)",
        tipBg: "#ffffff",
        tipBorder: "rgba(30,60,100,0.25)",
        tipText: "hsl(220 12% 20%)",
      };
}
