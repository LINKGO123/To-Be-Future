import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const financeAgent = readFileSync(
  new URL("../src/verticals/finance/components/ui/FinanceAiDock.tsx", import.meta.url),
  "utf8",
);
const coreMessages = readFileSync(
  new URL("../src/core/ai/AiMessages.tsx", import.meta.url),
  "utf8",
);

test("聊天入口已开放实际联网与取数能力，保留工作流衔接", () => {
  assert.doesNotMatch(financeAgent, /notice="直接问市场、公司、行业或研究方法。"/);
  assert.match(financeAgent, /placeholder="说说要查什么、研究什么…（Shift\+Enter 换行）"/);
  assert.match(financeAgent, /suggestionStyle="tasks"/);
  assert.match(financeAgent, /onPick=\{\(text\) => \{ setDraft\(text\)/);
  assert.doesNotMatch(financeAgent, /onPick=\{\(x\) => void chat\.submit\(x\)\}/);
  assert.match(financeAgent, /<AiComposer[\s\S]*?highlighted[\s\S]*?\/>/);

  const layout = readFileSync(new URL("../src/verticals/finance/components/layout/Layout.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(layout, /<Navigate/);
  assert.match(financeAgent, /<QuickAiConnect/);
  assert.match(financeAgent, /disabled=\{chat\.loading \|\| !configured\}/);
  assert.match(financeAgent, /今天市场有哪些值得关注的变化/);
  assert.match(financeAgent, /Agent 可以联网搜索、取数、计算并跟进研究任务/);
  assert.doesNotMatch(financeAgent, /不会自动取数或收集全网研报|不自动取数、不调用工具/);
  assert.match(financeAgent, /pending_research/);
  assert.match(financeAgent, /window.confirm/);
  assert.doesNotMatch(financeAgent, /200份研报|所有研报/);
});

test("Core 只在有说明时渲染提醒框，长任务使用统一卡片样式", () => {
  assert.match(coreMessages, /msgs\.length === 0 && notice &&/);
  assert.match(coreMessages, /suggestionStyle === "tasks" \? "grid gap-2 sm:grid-cols-2"/);
  assert.match(coreMessages, /highlighted \? "border-warning\/30 bg-warning\/\[0\.035\]"/);
  assert.match(coreMessages, /const v = value \?\? ref\.current\?\.value \?\? ""/);
  assert.match(coreMessages, /onValueChange\?\.\(""\)/);
});
