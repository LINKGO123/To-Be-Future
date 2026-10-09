import assert from "node:assert/strict";
import test from "node:test";
import { buildNavSearchIndex, extractMarkdownH2, filterNavItems } from "../src/verticals/finance/lib/fundradarNav.ts";

test("搜索索引：全部一级页面与子栏目扁平化，带正确分组标签", () => {
  const idx = buildNavSearchIndex();
  // 常用 9 + 进阶 10 + 子栏目（资讯雷达 4 + 产业信号 1 + 板块中心 2 = 7）= 26
  assert.equal(idx.length, 26);
  assert.equal(idx.find((i) => i.to === "/")?.zone, "常用");
  assert.equal(idx.find((i) => i.to === "/research")?.zone, "进阶");
  assert.equal(idx.find((i) => i.to === "/intel/news")?.zone, "资讯雷达");
  assert.equal(idx.find((i) => i.to === "/signals/gpu-rent")?.zone, "产业信号");
  assert.equal(idx.find((i) => i.to === "/sectors/humanoid")?.zone, "板块中心");
  // 路由唯一（无重复条目）
  assert.equal(new Set(idx.map((i) => i.to)).size, idx.length);
});

test("关键词过滤：中文包含、路径包含、大小写不敏感、空查询与无匹配", () => {
  const idx = buildNavSearchIndex();
  assert.equal(filterNavItems("", idx).length, idx.length);
  assert.equal(filterNavItems("   ", idx).length, idx.length);
  assert.ok(filterNavItems("龙虎榜", idx).some((i) => i.to === "/lhb"));
  assert.ok(filterNavItems("复盘", idx).some((i) => i.to === "/daily-review"));
  assert.ok(filterNavItems("radar", idx).some((i) => i.to === "/radar"), "路径包含也算命中");
  assert.ok(filterNavItems("INVESTMENT", idx).some((i) => i.to === "/intel/investment-news"), "英文大小写不敏感");
  assert.equal(filterNavItems("不存在的页面xyz", idx).length, 0);
});

test("研报标题提取：二级标题逐行提取，忽略其他层级与空行", () => {
  const md = [
    "# 个股研究报告",
    "",
    "开头引言段落。",
    "## 结论摘要",
    "正文……",
    "## 事实",
    "## 推断",
    "### 三级小标题（不提取）",
    "## 估值",
    "",
    "结尾。",
  ].join("\n");
  assert.deepEqual(extractMarkdownH2(md), ["结论摘要", "事实", "推断", "估值"]);
  assert.deepEqual(extractMarkdownH2(""), []);
  assert.deepEqual(extractMarkdownH2("没有标题的正文"), []);
});
