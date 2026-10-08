import assert from "node:assert/strict";
import test from "node:test";

import {
  LLM_KEY, clearUserLlm, readAiRuntime, saveExecutionMode, saveUserLlm,
} from "../src/verticals/finance/lib/llmStore.ts";

function storageFixture(initial?: string) {
  const values = new Map<string, string>();
  if (initial) values.set(LLM_KEY, initial);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  return values;
}

const api = { provider: "deepseek", baseURL: "https://api.deepseek.com", apiKey: "test-key", model: "deepseek-v4" };

test("旧版平铺配置读入后默认开启 Agent（统一 Agent 模式），不在读取时改写存储", () => {
  const values = storageFixture(JSON.stringify(api));
  const before = values.get(LLM_KEY);
  const read = readAiRuntime();
  assert.equal(read.status, "ok");
  assert.equal(read.config?.executionMode, "agent");
  assert.equal(read.config?.directSupported, false);
  assert.equal(values.get(LLM_KEY), before);
});

test("API 通过直连能力探针后可切换，密钥只保存一份", () => {
  const values = storageFixture();
  saveUserLlm(api, { directSupported: true, directReason: "verified" });
  saveExecutionMode("direct");
  const read = readAiRuntime();
  assert.equal(read.config?.executionMode, "direct");
  assert.equal(read.config?.source.apiKey, "test-key");
  assert.equal((values.get(LLM_KEY)?.match(/test-key/g) ?? []).length, 1);
});

test("重新连接 AI 后默认 Agent 模式，不继承旧来源的显式直连偏好", () => {
  storageFixture();
  saveUserLlm(api, { directSupported: true, directReason: "verified" });
  saveExecutionMode("direct");
  saveUserLlm({ ...api, model: "deepseek-new" }, { directSupported: true, directReason: "verified" });
  assert.equal(readAiRuntime().config?.executionMode, "agent");
});

test("重新测试同一来源保留用户明确开启的 Agent", () => {
  storageFixture();
  saveUserLlm(api);
  saveExecutionMode("agent");
  saveUserLlm(api, { directSupported: true, directReason: "verified" });
  assert.equal(readAiRuntime().config?.executionMode, "agent");
});

test("订阅与 API 均能关闭 Agent，传输能力标记不被伪造", () => {
  storageFixture();
  saveUserLlm({ provider: "cli-codex", baseURL: "", apiKey: "", model: "codex" },
    { directSupported: false, directReason: "订阅登录只能使用 Agent" });
  saveExecutionMode("direct");
  assert.equal(readAiRuntime().config?.executionMode, "direct");
  assert.equal(readAiRuntime().config?.directSupported, false);
  saveUserLlm(api, { directSupported: false, directReason: "该端点未通过直连能力契约" });
  saveExecutionMode("agent");
  assert.equal(readAiRuntime().config?.executionMode, "agent");
  saveExecutionMode("direct");
  assert.equal(readAiRuntime().config?.executionMode, "direct");
  clearUserLlm();
  assert.equal(readAiRuntime().status, "none");
});

test("旧 v2 值在统一 Agent 模式下保持为 Agent，显式关闭跨刷新保持", () => {
  const old = { schemaVersion: 2, source: api, executionMode: "agent", directSupported: false, directReason: "" };
  const values = storageFixture(JSON.stringify(old));
  assert.equal(readAiRuntime().config?.executionMode, "agent");
  assert.deepEqual(JSON.parse(values.get(LLM_KEY)!), old, "读取不改密钥存储");
  saveExecutionMode("direct");
  assert.equal(readAiRuntime().config?.executionMode, "direct");
  assert.deepEqual(readAiRuntime().config?.source, api);
  assert.equal(readAiRuntime().config?.executionMode, "direct", "重新读取保留显式开关");
});
