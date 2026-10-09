/**
 * 资金雷达工作台 · 侧栏导航单一数据源。
 * Layout 侧栏与菜单搜索（Cmd+K）共用这一份数据，避免两处维护。
 */
import type { LucideIcon } from "lucide-react";
import {
  BarChart3, ClipboardList, Cog, Cpu, FileText, Flame, FlaskConical, Gauge, Home,
  LayoutGrid, Microscope, MessageCircle, Newspaper, NotebookPen, Puzzle, Radar, Rss,
  Settings, Star, Swords, Thermometer, TrendingUp, Trophy, Wallet,
} from "lucide-react";

export interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
}

/** 常用区域（八页常用大字 UI） */
export const NAV_CORE: NavItem[] = [
  { to: "/", icon: Home, label: "首页" },
  { to: "/agent-chat", icon: MessageCircle, label: "Agent 对话" },
  { to: "/radar", icon: Radar, label: "主线雷达" },
  { to: "/scoreboard", icon: Trophy, label: "评分榜" },
  { to: "/daily-review", icon: BarChart3, label: "每日复盘" },
  { to: "/report", icon: ClipboardList, label: "报告" },
  { to: "/lhb", icon: Flame, label: "龙虎榜" },
  { to: "/portfolio", icon: Wallet, label: "我的持仓" },
  { to: "/settings", icon: Settings, label: "设置" },
];

/** 进阶研究区（底座原功能入口保留） */
export const NAV_ADV: NavItem[] = [
  { to: "/skills", icon: Puzzle, label: "技能中心" },
  { to: "/intel", icon: Radar, label: "资讯雷达" },
  { to: "/signals", icon: Thermometer, label: "产业信号" },
  { to: "/sectors", icon: LayoutGrid, label: "板块中心" },
  { to: "/research", icon: Microscope, label: "个股研究" },
  { to: "/debate", icon: Swords, label: "多空辩论" },
  { to: "/backtest", icon: FlaskConical, label: "回测" },
  { to: "/watchlist", icon: Star, label: "自选股" },
  { to: "/my-reports", icon: FileText, label: "我的研报" },
  { to: "/notes", icon: NotebookPen, label: "研究记录" },
];

/** 资讯雷达的小栏目（缩进子项，顺序即页内 Tab 顺序） */
export const INTEL_LINKS: NavItem[] = [
  { to: "/intel/investment-news", icon: Rss, label: "Investment News" },
  { to: "/intel/news", icon: Newspaper, label: "公开新闻" },
  { to: "/intel/filings", icon: FileText, label: "A股公告" },
  { to: "/intel/events", icon: TrendingUp, label: "事件概率" },
];

/** 产业信号的小栏目 */
export const SIGNAL_LINKS: NavItem[] = [
  { to: "/signals/gpu-rent", icon: Gauge, label: "GPU租金" },
];

/** 板块中心的快捷入口（只放环节已核实的） */
export const SECTOR_LINKS: NavItem[] = [
  { to: "/sectors/humanoid", icon: Cog, label: "人形机器人" },
  { to: "/sectors/ai-computing", icon: Cpu, label: "AI 算力" },
];

/** 带子栏目的导航组：父项右侧小三角展开/收起，展开状态按组记忆 */
export const NAV_GROUPS: Record<string, { storageKey: string; links: NavItem[] }> = {
  "/intel": { storageKey: "vr-intel-open2", links: INTEL_LINKS },
  "/signals": { storageKey: "vr-signals-open2", links: SIGNAL_LINKS },
  "/sectors": { storageKey: "vr-sectors-open2", links: SECTOR_LINKS },
};

/** 菜单搜索（Cmd+K）的搜索结果条目：带所属分组，便于结果里展示来源。 */
export interface NavSearchEntry extends NavItem {
  zone: string;
}

/** 构建菜单搜索索引：常用 + 进阶 + 全部子栏目，扁平化并带分组标签。 */
export function buildNavSearchIndex(): NavSearchEntry[] {
  const core = NAV_CORE.map((n) => ({ ...n, zone: "常用" }));
  const adv = NAV_ADV.map((n) => ({ ...n, zone: "进阶" }));
  const sub = Object.entries(NAV_GROUPS).flatMap(([parentTo, g]) => {
    const parent = adv.find((n) => n.to === parentTo);
    return g.links.map((n) => ({ ...n, zone: parent?.label ?? "子栏目" }));
  });
  return [...core, ...adv, ...sub];
}

/** 过滤：大小写不敏感的关键词包含匹配（中文 label 或路由路径）。空查询返回全部。 */
export function filterNavItems(query: string, items: NavSearchEntry[]): NavSearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) =>
    i.label.toLowerCase().includes(q) || i.to.toLowerCase().includes(q));
}

/** 从报告 markdown 提取二级标题（六阶段报告的章节名），供研报锚点导航使用。 */
export function extractMarkdownH2(markdown: string): string[] {
  const labels: string[] = [];
  for (const m of markdown.matchAll(/^##\s+(.+)$/gm)) {
    const label = (m[1] ?? "").trim();
    if (label) labels.push(label);
  }
  return labels;
}
