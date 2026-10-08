import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("保留全部路由，但非首屏业务按需加载并保留加载/错误反馈", () => {
  const source = readFileSync(new URL("../src/verticals/finance/router.tsx", import.meta.url), "utf8");
  const paths = [...source.matchAll(/path: "([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(paths, ["/", "/agent-chat", "/radar", "/scoreboard", "/daily-review", "/report", "/lhb", "/portfolio", "/settings", "/skills", "/stock/:code", "/daily-review-adv", "/portfolio-manage", "/settings-ai", "/intel", "/intel/:tab", "/signals", "/signals/:tab", "/sectors", "/sectors/:key", "/stock-data", "/debate", "/backtest", "/watchlist", "/research", "/my-reports", "/notes"]);
  assert.equal((source.match(/lazy: async/g) ?? []).length, 24);
  // 只静态 import 首屏首页与固定设置页，其余全部走 lazy
  assert.doesNotMatch(source, /^import .* from "@\/pages\/(?!FundradarHome|Settings)/m);
  assert.match(source, /hydrateFallbackElement:/);
  assert.match(source, /errorElement: <RouteErrorPage/);
});
