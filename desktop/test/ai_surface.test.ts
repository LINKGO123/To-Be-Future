import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file: string) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

test("AI 对话面板跟随全局蓝色主题，普通数据卡不染色", () => {
  for (const file of ["core/ai/AiDock.tsx", "core/ai/AiConsole.tsx",
    "verticals/finance/components/ui/FinanceAiDock.tsx", "verticals/finance/pages/Backtest.tsx",
    "verticals/finance/pages/MyReports.tsx"]) assert.match(read(file), /ai-surface/, file);
  assert.match(read("core/ai/AiMessages.tsx"), /ai-composer/);
  assert.match(read("core/ai/AiMessages.tsx"), /ai-message-assistant/);
  assert.match(read("core/ai/AiDock.tsx"), /ai-chat-trigger/);
  assert.doesNotMatch(read("verticals/finance/components/ui/GlassCard.tsx"), /ai-surface/);
  const css = read("index.css");
  assert.match(css, /\.ai-surface\s*\{/);
  assert.match(css, /\.ai-surface .prose/);
  assert.match(css, /color-scheme: dark/);
  assert.match(css, /\.light \{ color-scheme: light/);
  // 品牌已由暖橙换为科技蓝：ai-surface 用 hsl(var(--*)) 变量，不再硬编码暖橙/暖灰值
  assert.match(css, /\.ai-surface\s*\{[^}]*background-color: hsl\(var\(--card\)\)/);
  assert.match(css, /\.ai-surface \.ai-message-user\s*\{[^}]*background: hsl\(var\(--primary\)/);
  assert.match(css, /\.ai-surface \.ai-send\s*\{[^}]*background: hsl\(var\(--primary\)\)/);
  assert.doesNotMatch(css, /#fff7f0|#ff6429|#191a1e|#2c2d32|--primary: 20 80% 36%|--primary: 15 100% 60%/);
  for (const hook of ["ai-message-assistant", "ai-message-user", "ai-input", "ai-send"]) {
    assert.ok(css.includes(`.ai-surface .${hook}`), hook);
    assert.ok(read("verticals/finance/pages/Backtest.tsx").includes(hook), hook);
  }
  assert.match(css, /\.ai-surface \.ai-input:focus-within/);
});

test("侧栏 AI 状态与开关紧排，标签与开关在同一行", () => {
  const layout = read("verticals/finance/components/layout/Layout.tsx");
  assert.match(layout, /data-ai-identity/);
  assert.match(layout, /data-ai-identity className="mt-2\.5"/);
  assert.match(read("verticals/finance/components/ui/AgentToggle.tsx"), /inline-flex min-h-6 items-center/);
  assert.doesNotMatch(read("verticals/finance/components/ui/AgentToggle.tsx"), /flex-col/);
  assert.match(layout, /<AgentToggle \/>/);
  assert.match(read("verticals/finance/components/ui/AgentToggle.tsx"), /!compact && showHint/);
  assert.match(read("verticals/finance/components/ui/AgentToggle.tsx"), /（更深入·较慢·费Token）/);
});
