import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("资金雷达侧栏：常用/进阶双区、子栏目与真实 AI 入口", () => {
  const layout = read("verticals/finance/components/layout/Layout.tsx");
  const core = layout.slice(layout.indexOf("const NAV_CORE"), layout.indexOf("const NAV_ADV"));
  const adv = layout.slice(layout.indexOf("const NAV_ADV"), layout.indexOf("const INTEL_LINKS"));
  assert.deepEqual([...core.matchAll(/label: "([^"]+)"/g)].map(m => m[1]),
    ["首页", "Agent 对话", "主线雷达", "评分榜", "每日复盘", "报告", "龙虎榜", "我的持仓", "设置"]);
  assert.deepEqual([...adv.matchAll(/label: "([^"]+)"/g)].map(m => m[1]),
    ["技能中心", "资讯雷达", "产业信号", "板块中心", "个股研究", "多空辩论", "回测", "自选股", "我的研报", "研究记录"]);
  for (const route of ["/intel/investment-news", "/intel/news", "/intel/filings", "/intel/events", "/signals/gpu-rent", "/sectors/humanoid", "/sectors/ai-computing"]) assert.ok(layout.includes(route));
  assert.doesNotMatch(layout, /FinanceAiConsole|consoleOpen|vr-ai-console|openAgent|打开普通对话/);
  assert.match(layout, /<FinanceAiDock/);
  assert.match(layout, /workspace-sidebar/);
  assert.match(layout, /aria-expanded=\{groupOpen\}/);
  assert.match(layout, /aria-label=\{label\}/);
  assert.match(layout, /<AgentToggle/);
  assert.ok(layout.includes("收起侧栏"));
  assert.ok(layout.includes("进阶研究区"));
});

test("DSH 科技玻璃蓝主题：蓝主色、玻璃质感与可访问性", () => {
  const css = read("index.css");
  assert.match(css, /--radius: 1rem/);
  assert.match(css, /--primary: 217 91% 60%/);   // 暗色蓝主色
  assert.match(css, /--primary: 221 83% 53%/);   // 亮色蓝主色
  assert.match(css, /radial-gradient/);
  assert.match(css, /backdrop-filter: blur\(14px\)/);
  assert.doesNotMatch(css, /--workspace-grid|217 92% 72%|263 78% 78%|Songti|STSong|Georgia/);
  assert.match(css, /focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media \(forced-colors: active\)/);
});

test("左上角使用 To Be Future 品牌标识，不引入外部资源", () => {
  const layout = read("verticals/finance/components/layout/Layout.tsx");
  assert.match(layout, /to="\/" aria-label="To Be Future 首页"/);
  assert.match(layout, /workspace-brand/);
  assert.doesNotMatch(layout, /<img[ >]|https?:\/\/[^"]+\.(png|jpe?g|svg|gif)/);
});

test("首页以 Agent 为首屏，保留数据组件但不自动取数或启动任务", () => {
  const home = read("verticals/finance/pages/Home.tsx");
  const overview = read("verticals/finance/components/HomeOverview.tsx");
  assert.doesNotMatch(home, /<HomeOverview|backend\.fetch|backend\.research/);
  assert.match(home, /<FinanceHomeAgent/);
  assert.match(overview, /backend\.fetch\("tx_quotes_batch"/);
  assert.match(overview, /backend\.runs\(/);
  assert.match(overview, /fetched_at/);
  assert.match(overview, /\.id/);
  assert.match(overview, /test_scenario/);
  assert.doesNotMatch(overview, /云川|DEMO-|3,268|chatStream|backend\.research\(/);
});
