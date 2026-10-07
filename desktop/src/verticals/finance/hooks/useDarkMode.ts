import { useEffect, useState } from "react";

import { storageGet, storageSet } from "@/lib/storage";

/** 深浅变化事件名（detail = "dark" | "light"）；外部改主题后各 useDarkMode 实例据此同步。 */
export const FR_THEME_CHANGED = "fr-theme-changed";

/** 只落 html class + localStorage（不派发事件），供 hook 内部与外部共用。 */
function applyThemeClasses(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("light", !dark);
  document.documentElement.classList.toggle("fr-elder-dark", dark);
  storageSet("vr-theme", dark ? "dark" : "light");
}

/**
 * 深浅模式（v2：整站统一切换）：
 * - 浅色（默认）：html 加 `.light`，全局变量（侧栏/顶栏/进阶区）与常用页都变浅色；
 * - 深色：html 加 `.dark`、去 `.light`，全局变量变暗 + 常用页 `.fr-elder-dark` 深色；
 * - 深色大屏三页（主线雷达/每日复盘/Agent 对话）自带 `.fr-screen-dark` 深色变量，保持不变。
 */

/**
 * 外部（如 Agent 操作确认卡的 set_theme）直接切深浅并广播：
 * 落 class + localStorage + 派发 fr-theme-changed，让在屏的 useDarkMode 实例即时同步。
 */
export function applyDarkMode(dark: boolean): void {
  applyThemeClasses(dark);
  window.dispatchEvent(new CustomEvent<string>(FR_THEME_CHANGED, { detail: dark ? "dark" : "light" }));
}

export function useDarkMode() {
  const [dark, setDark] = useState(() => storageGet("vr-theme") === "dark"); // 常用区域默认浅色

  useEffect(() => {
    applyThemeClasses(dark);
  }, [dark]);

  // 监听外部改主题（Agent 操作 set_theme 等），同步本实例状态（幂等，无事件回环）
  useEffect(() => {
    const onChanged = (e: Event) => {
      const d = (e as CustomEvent<string>).detail;
      if (d === "dark" || d === "light") setDark(d === "dark");
    };
    window.addEventListener(FR_THEME_CHANGED, onChanged);
    return () => window.removeEventListener(FR_THEME_CHANGED, onChanged);
  }, []);

  return { dark, toggle: () => setDark((d) => !d) };
}
