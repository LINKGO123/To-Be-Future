import { createBrowserRouter, Navigate } from "react-router-dom";
import { RouteErrorPage } from "../../core/components/RouteErrorPage";
import { Layout } from "@/components/layout/Layout";
import { FundradarHome } from "@/pages/FundradarHome";
import { Settings } from "@/pages/Settings";

/**
 * 资金雷达（刀3）路由：
 * - 常用区域八页（Fundradar*）挂在 /、/agent-chat、/radar、/daily-review、
 *   /report、/lhb、/portfolio、/settings；技能中心占位页挂 /skills。
 * - 进阶研究区底座原页面内容组件一律未动；其中「每日复盘 / 我的持仓 / 接入 AI」
 *   三页因常用区域占用原路径，改挂 /daily-review-adv、/portfolio-manage、/settings-ai。
 */
export const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <p role="status" className="p-6 text-sm text-muted-foreground">正在打开研究工作台…</p>,
    children: [
      // ===== 常用区域（刀3 新增七页）=====
      { path: "/", element: <FundradarHome /> },
      { path: "/agent-chat", lazy: async () => ({ Component: (await import("@/pages/FundradarAgentChat")).FundradarAgentChat }) },
      { path: "/radar", lazy: async () => ({ Component: (await import("@/pages/FundradarRadar")).FundradarRadar }) },
      { path: "/scoreboard", lazy: async () => ({ Component: (await import("@/pages/FundradarScoreboard")).FundradarScoreboard }) },
      { path: "/daily-review", lazy: async () => ({ Component: (await import("@/pages/FundradarDailyReview")).FundradarDailyReview }) },
      { path: "/report", lazy: async () => ({ Component: (await import("@/pages/FundradarReport")).FundradarReport }) },
      { path: "/lhb", lazy: async () => ({ Component: (await import("@/pages/FundradarLhb")).FundradarLhb }) },
      { path: "/portfolio", lazy: async () => ({ Component: (await import("@/pages/FundradarPortfolio")).FundradarPortfolio }) },
      { path: "/settings", lazy: async () => ({ Component: (await import("@/pages/FundradarSettings")).FundradarSettings }) },
      // 进阶研究区 · 技能中心（刀3 占位页，技能在刀4+ 由编排器提供）
      { path: "/skills", lazy: async () => ({ Component: (await import("@/pages/FundradarSkills")).FundradarSkills }) },
      // 个股详情页（刀6）：/stock/<6位A股代码>
      { path: "/stock/:code", lazy: async () => ({ Component: (await import("@/pages/FundradarStock")).FundradarStock }) },
      // ===== 进阶研究区 · 原功能（底座页面内容组件未动，仅挂载路径调整三页）=====
      { path: "/daily-review-adv", lazy: async () => ({ Component: (await import("@/pages/DailyReview")).DailyReview }) },
      { path: "/portfolio-manage", lazy: async () => ({ Component: (await import("@/pages/Portfolio")).Portfolio }) },
      { path: "/settings-ai", element: <Settings /> },
      { path: "/intel", lazy: async () => ({ Component: (await import("@/pages/Intel")).Intel }) },
      { path: "/intel/:tab", lazy: async () => ({ Component: (await import("@/pages/Intel")).Intel }) },
      { path: "/signals", lazy: async () => ({ Component: (await import("@/pages/Signals")).Signals }) },
      { path: "/signals/:tab", lazy: async () => ({ Component: (await import("@/pages/Signals")).Signals }) },
      { path: "/sectors", lazy: async () => ({ Component: (await import("@/pages/Sectors")).Sectors }) },
      { path: "/sectors/:key", lazy: async () => ({ Component: (await import("@/pages/SectorDetail")).SectorDetail }) },
      // 旧版「个股研究」链接保留兼容，但产品里只有一个研究页。
      { path: "/stock-data", element: <Navigate replace to="/research" /> },
      { path: "/debate", lazy: async () => ({ Component: (await import("@/pages/Debate")).Debate }) },
      { path: "/backtest", lazy: async () => ({ Component: (await import("@/pages/Backtest")).Backtest }) },
      { path: "/watchlist", lazy: async () => ({ Component: (await import("@/pages/Watchlist")).Watchlist }) },
      { path: "/research", lazy: async () => ({ Component: (await import("@/pages/Research")).Research }) },
      { path: "/my-reports", lazy: async () => ({ Component: (await import("@/pages/MyReports")).MyReports }) },
      { path: "/notes", lazy: async () => ({ Component: (await import("@/pages/Notes")).Notes }) },
    ],
  },
]);
