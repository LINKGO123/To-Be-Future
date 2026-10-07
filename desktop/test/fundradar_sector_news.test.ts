import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

/**
 * 板块新闻情绪解析（parseJudgeReply）单测。
 *
 * fundradarSectorNews.ts 顶层 import 了 backend / fundradarData / storage，
 * 其中 fundradarData 又经 `@/` 别名链到 fundradarPortfolio，Node 原生跑 .ts
 * 不解析 `@/` 路径，直接 import 整模块会失败。这里用 TypeScript AST 从源文件
 * 抽出「纯解析函数 + 依赖常量」再 transpile 后执行 —— 测的是真实实现，不是拷贝。
 */
function loadParser(): {
  parseJudgeReply: (reply: string, expected: number) => Map<number, { sentiment: string; score: number | null }> | null;
  normalizeSentiment: (raw: unknown) => string | null;
  normalizeScore: (raw: unknown) => number | null;
} {
  const text = fs.readFileSync(
    new URL("../src/verticals/finance/lib/fundradarSectorNews.ts", import.meta.url),
    "utf8",
  );
  const source = ts.createSourceFile("fundradarSectorNews.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const wanted = new Set(["SENTIMENT_SYNONYMS", "normalizeSentiment", "normalizeScore", "stripFences", "parseJudgeReply"]);
  const decls: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && wanted.has(d.name.text)) decls.push(node.getText(source));
      }
    } else if (ts.isFunctionDeclaration(node) && node.name && wanted.has(node.name.text)) {
      decls.push(node.getText(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(decls.some((d) => d.includes("parseJudgeReply")), "应能从源文件抽取 parseJudgeReply");
  const js = ts.transpileModule(decls.join("\n\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const factory = new Function(
    `${js}\nreturn { parseJudgeReply, normalizeSentiment, normalizeScore };`,
  );
  return factory() as ReturnType<typeof loadParser>;
}

const parser = loadParser();

test("带解释文字 + JSON 数组能解析", () => {
  const got = parser.parseJudgeReply(
    '以下是逐条情绪判断，仅供参考：\n```json\n[{"i":1,"sentiment":"利好","score":80},{"i":2,"sentiment":"中性","score":50}]\n```',
    2,
  );
  assert.ok(got);
  assert.equal(got.get(1)?.sentiment, "利好");
  assert.equal(got.get(1)?.score, 80);
  assert.equal(got.get(2)?.sentiment, "中性");
  assert.equal(got.get(2)?.score, 50);
});

test("同义词 sentiment 归一化到三档", () => {
  const got = parser.parseJudgeReply(
    '[{"i":1,"sentiment":"正面","score":90},{"i":2,"sentiment":"看多","score":70},{"i":3,"sentiment":"负面","score":80},{"i":4,"sentiment":"看空","score":60},{"i":5,"sentiment":"中立","score":40},{"i":6,"sentiment":"平稳","score":30}]',
    6,
  );
  assert.ok(got);
  assert.equal(got.get(1)?.sentiment, "利好");
  assert.equal(got.get(2)?.sentiment, "利好");
  assert.equal(got.get(3)?.sentiment, "利空");
  assert.equal(got.get(4)?.sentiment, "利空");
  assert.equal(got.get(5)?.sentiment, "中性");
  assert.equal(got.get(6)?.sentiment, "中性");
});

test("score 容错：数字字符串 / 空串 / 非法 → 整数或 null", () => {
  const got = parser.parseJudgeReply(
    '[{"i":1,"sentiment":"利好","score":"80"},{"i":2,"sentiment":"利好","score":""},{"i":3,"sentiment":"利好","score":"abc"},{"i":4,"sentiment":"利好","score":95.6}]',
    4,
  );
  assert.ok(got);
  assert.equal(got.get(1)?.score, 80);
  assert.equal(got.get(2)?.score, null);
  assert.equal(got.get(3)?.score, null);
  assert.equal(got.get(4)?.score, 96);
});

test("部分条目缺失 / 越界只跳过该条，不影响已解析条目", () => {
  const got = parser.parseJudgeReply(
    '[{"i":1,"sentiment":"利好","score":80},{"i":2,"sentiment":"不知道","score":60},{"i":99,"sentiment":"利好","score":10},{"i":4,"sentiment":"利空","score":70}]',
    4,
  );
  assert.ok(got);
  assert.equal(got.size, 2);
  assert.equal(got.get(1)?.sentiment, "利好");
  assert.equal(got.get(4)?.sentiment, "利空");
  assert.equal(got.has(2), false);
  assert.equal(got.has(99), false);
});

test("全空 / 非法形状返回 null", () => {
  assert.equal(parser.parseJudgeReply("抱歉，我无法判断", 3), null);
  assert.equal(parser.parseJudgeReply('[{"i":1,"sentiment":"怪异词","score":10}]', 1), null);
  assert.equal(parser.parseJudgeReply('{"a":1}', 1), null);
});
