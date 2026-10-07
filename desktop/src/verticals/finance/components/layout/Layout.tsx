import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigation } from "react-router-dom";
import {
  BarChart3, ChevronDown, ChevronsLeft, ChevronsRight, ClipboardList, Cog, Cpu, FileText, Flame, FlaskConical, Gauge, Home, LayoutGrid, Microscope, Menu, X, MessageCircle, Moon, Newspaper, NotebookPen, Puzzle, Radar, Rss, Settings, Star, Sun, Swords, Thermometer, TrendingUp, Trophy, Type, Wallet, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AiPageProvider } from "../../../../core/ai/pageContext";
import { FinanceAiDock } from "@/components/ui/FinanceAiDock";
import { useDarkMode } from "@/hooks/useDarkMode";
import { storageGet, storageSet } from "@/lib/storage";
import { useAiRuntime } from "@/hooks/useAiRuntime";
import { aiConnectionLabel } from "@/lib/aiConnection";
import { AgentToggle } from "@/components/ui/AgentToggle";
import { FONT_TIERS, FR_FONT_TIER_CHANGED, applyFontTier, loadFontTier, nextFontTier, saveFontTier, type FontTier } from "@/lib/fundradarTheme";
import { FrUpdateButton } from "@/components/fundradar/FrUpdateButton";
import { FrAppUpdateBanner, FrAppUpdateButton } from "@/components/fundradar/FrAppUpdateBanner";
import { FrAutoRefreshBadge } from "@/components/fundradar/FrDataStatus";
import { FrAlertWatcher } from "@/components/fundradar/FrAlertWatcher";
import { startAutoRefresh, stopAutoRefresh } from "@/lib/fundradarAutoRefresh";

interface NavItem { to: string; icon: LucideIcon; label: string; }

// ============================================================
// 资金雷达（刀3）· 侧栏双区：
// 1. 常用区域 —— 八页常用大字 UI（首页/Agent 对话/主线雷达/每日复盘/报告/龙虎榜/我的持仓/设置）
// 2. 进阶研究区 · 原功能 —— 底座原页面入口保留（内容组件未动）
// ============================================================
const NAV_CORE: NavItem[] = [
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

const NAV_ADV: NavItem[] = [
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

// 资讯雷达的小栏目（缩进子项，顺序即页内 Tab 顺序）。
const INTEL_LINKS = [
  { to: "/intel/investment-news", icon: Rss, label: "Investment News" },
  { to: "/intel/news", icon: Newspaper, label: "公开新闻" },
  { to: "/intel/filings", icon: FileText, label: "A股公告" },
  { to: "/intel/events", icon: TrendingUp, label: "事件概率" },
];

// 产业信号的小栏目（缩进子项，逐期在此添加；带小三角可展开收起）。
const SIGNAL_LINKS = [
  { to: "/signals/gpu-rent", icon: Gauge, label: "GPU租金" },
];

// 常看的板块，作为「板块中心」下的快捷入口（缩进显示）。
// 板块中心下的快捷入口。🔴 只放**环节已核实**的那些 —— 指向空页面的入口比没有入口更糟:
// 用户点进去看到一片空白,分不清是"还没做"还是"坏了"。要加先把环节核实了。
const SECTOR_LINKS = [
  { to: "/sectors/humanoid", icon: Cog, label: "人形机器人" },
  { to: "/sectors/ai-computing", icon: Cpu, label: "AI 算力" },
];

// 带子栏目的导航组：父项右侧小三角展开/收起，展开状态按组记忆。
// 带子栏目的导航组。
// 🔴 存储键**带版本号**：默认值从"展开"改成"收起"时，老键里存着的 "open"
//    会让已经用过的人照旧全展开 —— 那不是 bug（它在记住你的选择），但新默认就等于没生效。
//    换个键 = 旧记忆不再适用，所有人重新从收起开始；之后手动展开的仍然会被记住。
const NAV_GROUPS: Record<string, { storageKey: string; links: typeof SIGNAL_LINKS }> = {
  "/intel": { storageKey: "vr-intel-open2", links: INTEL_LINKS },
  "/signals": { storageKey: "vr-signals-open2", links: SIGNAL_LINKS },
  "/sectors": { storageKey: "vr-sectors-open2", links: SECTOR_LINKS },
};

export function Layout() {
  const { pathname } = useLocation();
  const navigation = useNavigation();
  const aiRuntime = useAiRuntime();
  const { dark, toggle } = useDarkMode();
  const navRef = useRef<HTMLElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLButtonElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobileNav = () => {
    setMobileOpen(false);
    // The opener is inert until React commits the closed state.
    requestAnimationFrame(() => menuRef.current?.focus());
  };
  const [collapsed, setCollapsed] = useState(() => storageGet("vr-sidebar") === "collapsed");
  // 各导航组子栏目的展开状态（默认展开；按组记住用户的选择）
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    // 🔴 **默认收起**：一打开先看到一层干净的总览，要什么再展开。
    //    默认全展开时侧栏一屏塞十几条，一级栏目反而被子项淹掉。
    //    （`=== "open"` 而不是 `!== "closed"`：没存过就是收起。）
    Object.fromEntries(Object.entries(NAV_GROUPS).map(([path, g]) => [path, storageGet(g.storageKey) === "open"])));
  // 进阶研究区（NAV_ADV）整区折叠：用户主用常用区域，进阶区默认收起、需要时点开。
  // 用独立版本化键，旧偏好不污染新默认（`=== "open"`：没存过即收起）。
  const [advOpen, setAdvOpen] = useState(() => storageGet("vr-adv-open2") === "open");
  // 资金雷达 · 四档字号（紧凑[默认]/标准/加大/超大）：<html data-font-tier> 只记录档位，
  // fundradar-theme.css 只在 .fr-elder-page（常用区域页面）作用域按档生效；
  // 进阶研究区与深色大屏走固定兜底值，不受档位切换影响。
  const [fontTier, setFontTier] = useState<FontTier>(loadFontTier);
  useEffect(() => { applyFontTier(fontTier); }, [fontTier]);
  // 双向同步：设置页改档 → saveFontTier 派发 fr-font-tier-changed → 侧栏高亮跟上（反之亦然）
  useEffect(() => {
    const onTierChanged = (e: Event) => {
      const detail = (e as CustomEvent<FontTier>).detail;
      if (FONT_TIERS.some((t) => t.key === detail)) setFontTier((cur) => (cur === detail ? cur : detail));
    };
    window.addEventListener(FR_FONT_TIER_CHANGED, onTierChanged);
    return () => window.removeEventListener(FR_FONT_TIER_CHANGED, onTierChanged);
  }, []);
  const selectFontTier = (tier: FontTier) => {
    if (tier === fontTier) return;
    setFontTier(tier);
    saveFontTier(tier);
  };
  const cycleFontTier = () => selectFontTier(nextFontTier(fontTier));
  const tierLabel = FONT_TIERS.find((t) => t.key === fontTier)!.label;

  const toggleGroup = (path: string) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [path]: !prev[path] };
      storageSet(NAV_GROUPS[path]!.storageKey, next[path] ? "open" : "closed");
      return next;
    });
  };

  const toggleAdv = () => {
    setAdvOpen((prev) => {
      const next = !prev;
      storageSet("vr-adv-open2", next ? "open" : "closed");
      return next;
    });
  };

  useEffect(() => {
    storageSet("vr-sidebar", collapsed ? "collapsed" : "expanded");
  }, [collapsed]);

  // 盘中定时自动刷新（产品打开即自动盯盘）；卸载时 stop 清理定时器，避免泄漏
  useEffect(() => {
    startAutoRefresh();
    return () => stopAutoRefresh();
  }, []);

  // 品牌区与底部链接固定，导航本身会滚动。窗口偏矮时当前页可能刚好落在
  // 可视区外（例如最底部的「接入 AI」只露出一条边）—— 路由变化后把当前项拉回视野。
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    const n = nav.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    const breathingRoom = 8;
    if (a.top < n.top + breathingRoom) nav.scrollTop -= n.top + breathingRoom - a.top;
    if (a.bottom > n.bottom - breathingRoom) nav.scrollTop += a.bottom - (n.bottom - breathingRoom);
  }, [pathname, collapsed]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => {
      setMobile(query.matches);
      setMobileOpen(false);
      if (query.matches && sidebarRef.current?.contains(document.activeElement)) {
        requestAnimationFrame(() => menuRef.current?.focus());
      }
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    if (!mobileOpen || !mobile) return;
    sidebarRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeMobileNav(); }
      if (event.key !== "Tab") return;
      const items = [...(sidebarRef.current?.querySelectorAll<HTMLElement>("a,button:not(:disabled)") ?? [])];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [mobile, mobileOpen]);
  const compact = collapsed && !mobile;
  const currentTitle = [...NAV_CORE, ...NAV_ADV].find(n => n.to === pathname)?.label
    ?? Object.values(NAV_GROUPS).flatMap(g => g.links).find(n => n.to === pathname)?.label
    ?? "工作空间";

  /** 一个导航项（含带子栏目的组：资讯雷达/产业信号/板块中心） */
  const renderNavItem = ({ to, icon: Icon, label }: NavItem) => {
    const active = pathname === to;
    const group = NAV_GROUPS[to];
    const groupOpen = group ? !!openGroups[to] : false;
    return <div key={to}>
      <div className="flex items-center">
        <Link to={to} aria-label={label} aria-current={active ? "page" : undefined} title={compact ? label : undefined}
          onClick={() => { if (mobile) { setMobileOpen(false); requestAnimationFrame(() => mainRef.current?.focus()); } }}
          className={cn("workspace-nav-link flex min-w-0 flex-1 items-center text-[13px] transition-colors",
            compact ? "justify-center p-2.5" : "gap-3 px-3 py-2.5",
            active ? "font-semibold" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground")}>
          <Icon className="h-4 w-4 shrink-0" />{!compact && <span>{label}</span>}
        </Link>
        {group && !compact && <button type="button" aria-label={`${groupOpen ? "收起" : "展开"}${label}子栏目`}
          aria-expanded={groupOpen} onClick={() => toggleGroup(to)}
          className="rounded p-2 text-muted-foreground hover:bg-muted/60">
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !groupOpen && "-rotate-90")} />
        </button>}
      </div>
      {group && (groupOpen || compact) && <div className={cn("mt-1 space-y-0.5", !compact && "ml-5 border-l border-border pl-2")}>
        {group.links.map(({ to: st, icon: SIcon, label: slabel }) => <Link key={st} to={st}
          aria-label={slabel} title={compact ? slabel : undefined} aria-current={pathname === st ? "page" : undefined}
          onClick={() => { if (mobile) { setMobileOpen(false); requestAnimationFrame(() => mainRef.current?.focus()); } }}
          className={cn("workspace-nav-link flex items-center text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground",
            compact ? "justify-center p-2" : "gap-2 px-2 py-1.5")}>
          <SIcon className="h-3.5 w-3.5 shrink-0" />{!compact && slabel}
        </Link>)}
      </div>}
    </div>;
  };

  return (
    <AiPageProvider>
      <a className="workspace-skip" href="#workspace-main" onClick={e => {
        e.preventDefault(); setMobileOpen(false);
        requestAnimationFrame(() => mainRef.current?.focus());
      }}>跳到内容</a>
      <div className="flex h-dvh overflow-hidden">
        {mobile && mobileOpen && <button className="fixed inset-0 z-40 bg-black/60" tabIndex={-1}
          aria-label="关闭导航遮罩" onClick={closeMobileNav} />}
        <aside ref={sidebarRef} aria-label="产品侧栏" className={cn(
          "workspace-sidebar z-50 flex shrink-0 flex-col",
          mobile ? (mobileOpen ? "fixed inset-y-0 left-0 w-[228px]" : "hidden") : compact ? "w-14" : "w-[228px]",
        )}>
          <div className={cn("border-b border-border", compact ? "p-2.5" : "px-5 py-4")}>
            <div className={cn("flex items-center", compact ? "justify-center" : "justify-between")}>
              <Link to="/" aria-label="To Be Future 首页" className="flex items-center gap-3">
                <span className={cn("flex shrink-0 items-center justify-center rounded-btn bg-primary-subtle-strong", compact ? "size-8" : "size-9")}>
                  <svg viewBox="0 0 24 24" fill="none" className={cn("shrink-0 text-primary", compact ? "h-5 w-5" : "h-6 w-6")} aria-hidden="true">
                    <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
                    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1" opacity="0.4" strokeDasharray="2 2" />
                    <line x1="12" y1="12" x2="18.5" y2="7.5" stroke="currentColor" strokeWidth="1.5" />
                    <polyline points="6,15 9,12 12,13 18,7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="18" cy="7" r="1.2" fill="currentColor" />
                  </svg>
                </span>
                {!compact && <span className="workspace-brand text-lg font-semibold tracking-tight">To Be <span className="text-primary">Future</span></span>}
              </Link>
              {mobile && <button aria-label="关闭导航" className="p-1" onClick={closeMobileNav}><X className="h-4 w-4" /></button>}
            </div>
            {!compact && <div data-ai-identity className="mt-2.5">
                <Link to="/settings" data-testid="ai-runtime-badge" title="查看或更改已保存的 AI 接入" className="flex min-w-0 items-start gap-1.5 text-xs leading-5 text-muted-foreground hover:text-primary">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" /><span>{aiConnectionLabel(aiRuntime)}</span>
                </Link>
            </div>}
          </div>
          <nav ref={navRef} aria-label="常用区域与进阶研究区导航" className={cn("min-h-0 flex-1 space-y-0.5 overflow-auto py-3", compact ? "px-1.5" : "px-3")}>
            {!compact && <p className="fr-nav-zone fr-nav-zone-core">常用区域</p>}
            {NAV_CORE.map(renderNavItem)}
            {!compact && (
              <button type="button" onClick={toggleAdv} aria-expanded={advOpen}
                aria-label={advOpen ? "收起进阶研究区" : "展开进阶研究区"}
                className="fr-nav-zone fr-nav-zone-adv fr-nav-zone-toggle flex w-full items-center justify-between gap-2 rounded-md text-left">
                <span>进阶研究区 · 原功能</span>
                <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", !advOpen && "-rotate-90")} />
              </button>
            )}
            {(advOpen || compact) && NAV_ADV.map(renderNavItem)}
          </nav>
          <div className={cn("border-t border-border", compact ? "p-1.5" : "p-3")}>
            {/* 底部控制：开关类（Agent 开关一行）/ 工具类（更新·字号·深浅 图标按钮均匀排开） */}
            {!compact && <div className="mb-3 flex flex-col gap-3 px-1">
              {/* 开关类：Agent 开关，单独一行（分组 + 留白） */}
              <div className="flex items-center justify-between rounded-btn border border-border bg-muted/30 px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground">Agent 开关</span>
                <AgentToggle />
              </div>
              {/* 字号四档：显式分段选择（直接点选，不循环） */}
              <div className="grid grid-cols-4 gap-1 rounded-btn border border-border bg-muted/30 p-1">
                {FONT_TIERS.map((t) => (
                  <button key={t.key} onClick={() => selectFontTier(t.key)}
                    aria-label={`字号：${t.label}`} title={`常用区字号：${t.label}`}
                    className={cn("rounded-md px-1 py-1.5 text-xs font-medium transition-colors",
                      fontTier === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                    {t.label}
                  </button>
                ))}
              </div>
              {/* 工具类：更新 / 深浅，图标按钮均匀排开，hover 有明确反馈（.fr-icon-btn） */}
              <div className="flex items-center justify-evenly py-1">
                <FrUpdateButton variant="icon" />
                <FrAppUpdateButton />
                <button onClick={toggle} aria-label={dark ? "切换为浅色" : "切换为深色"} title={dark ? "切换为浅色" : "切换为深色"}
                  className="fr-icon-btn text-muted-foreground hover:text-foreground">
                  {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </button>
              </div>
            </div>}
            {compact && <div className="mb-2 flex flex-col items-center gap-2">
              <AgentToggle compact />
              <FrUpdateButton variant="icon" />
              <FrAppUpdateButton />
              <button onClick={cycleFontTier} aria-label="切换常用区字号档位" title={`常用区字号：${tierLabel}（点击切换 紧凑→标准→加大→超大）`} className="fr-icon-btn text-muted-foreground hover:text-foreground">
                <Type className="h-4 w-4" />
              </button>
              <button onClick={toggle} aria-label={dark ? "切换为浅色" : "切换为深色"} className="fr-icon-btn text-muted-foreground hover:text-foreground">
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            </div>}
            <div className={cn("flex items-center text-muted-foreground", compact ? "flex-col gap-3" : "justify-between gap-2")}>
              <div className={cn("flex gap-2", compact && "flex-col")}>
                {!mobile && <button onClick={() => setCollapsed(!collapsed)} aria-label={compact ? "展开侧栏" : "收起侧栏"} title={compact ? "展开侧栏" : "收起侧栏"}>
                  {compact ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
                </button>}
              </div>
            </div>
          </div>
        </aside>
        <div inert={mobile && mobileOpen} className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="workspace-topbar flex h-16 shrink-0 items-center justify-between gap-3 px-4 md:px-8">
            <div className="flex min-w-0 items-center gap-3 text-xs">
              <button ref={menuRef} aria-label="打开导航" onClick={() => setMobileOpen(true)} className="p-1 md:hidden"><Menu className="h-4 w-4" /></button>
              <span className="hidden text-muted-foreground sm:inline">工作空间 /</span><strong className="truncate font-medium">{currentTitle}</strong>
            </div>
            <div className={cn("flex items-center gap-3", pathname !== "/" && "mr-24")}>
              <FrAutoRefreshBadge />
              <span className="hidden text-xs text-muted-foreground lg:inline">本地金融研究工作台</span>
              <button onClick={toggle} className="fr-icon-btn text-muted-foreground hover:text-foreground" aria-label={dark ? "切换为浅色" : "切换为深色"}>
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            </div>
          </header>
          <main ref={mainRef} id="workspace-main" tabIndex={-1} className="min-h-0 flex-1 overflow-auto">
            <div className="workspace-content" aria-busy={navigation.state !== "idle"}>
              {navigation.state !== "idle" && <p role="status" className="mb-3 text-sm text-muted-foreground">正在打开页面…</p>}
              {/* key={pathname}：路由变化重挂容器，触发 fr-page-enter 滑动入场（P0 刀6） */}
              <div key={pathname} className="fr-page-enter">
                <Outlet />
              </div>
            </div>
          </main>
        </div>
        {/* Agent 对话有独立大页（/agent-chat），不再叠加浮动对话坞 */}
        <div inert={mobile && mobileOpen}>{pathname !== "/" && pathname !== "/agent-chat" && <FinanceAiDock />}</div>
        {/* 异动提醒弹层（刀7）：监听 fr-data-refreshed，检出异动后右上角弹 toast */}
        <FrAlertWatcher />
        {/* 应用自动更新横幅：发现新版本 / 下载中 / 下载完成 / 检查失败时右下角弹出 */}
        <FrAppUpdateBanner />
      </div>
    </AiPageProvider>
  );
}
