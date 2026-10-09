/**
 * 资金雷达工作台 · 评分榜页（/scoreboard）
 * ------------------------------------------------------------
 * 模块卡片墙（首页）：12 个行业模块卡片（名称/股票数/平均分/Top3），点卡片进入板块榜单。
 * 板块内榜单：双榜 —— 综合榜（评分 ≥60 且 Top20，纯评分排序）+ 资金榜（主力净流入金额排序）。
 * - 顶部常驻免责横幅 + 更新于；板块内工具栏「重新计算」+ 双榜 Tab + 进度提示。
 * - Top3 大卡（第 1 名蓝框 + 蓝序号）+ 列表（排名/名称代码/评分大字/涨跌幅/资金方向）。
 * - 点击 → 跳转 /report?code=<code>，复用报告页下钻（评分构成/结论/短长期倾向/风险）。
 * - 自选：手动输 6 位代码加，与持仓分开（lib/fundradarWatchlist）。
 * - 缺失处理：资金/估值缺失 → 该项记 0 分并标注「数据缺」（见 fundradarScoreBatch）。
 * - 批量评分：板块内手动「重新计算」触发，复用 scoreComposite 同一口径，并发限流 3。
 * 红线：评分仅基于公开数据计算，不构成任何投资建议。
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, BarChart3, Check, ChevronRight, Info, LoaderCircle, ListChecks, Plus, RefreshCw, TrendingUp, Trophy, X } from "lucide-react";

import {
  FR_SCORE_CACHE_CHANGED,
  loadScoreCache,
  loadScoreCacheUpdated,
  runBatchScore,
  type BatchProgress,
  type ScoreCacheItem,
} from "@/lib/fundradarScoreBatch";
import { SCORE_POOL_SECTORS, scorePoolSector, type ScorePoolSectorId } from "@/lib/fundradarScorePool";
import { addScorePoolCustomItem, removeScorePoolCustomItem, useScorePoolCustom } from "@/lib/fundradarScorePoolCustom";
import { loadStockQuote } from "@/lib/fundradarStock";
import { frPctClass } from "@/lib/fundradarTheme";
import { addWatchItem, removeWatchItem, useWatchlist } from "@/lib/fundradarWatchlist";

const DISCLAIMER = "评分仅基于公开数据计算，不构成任何投资建议。股市有风险，投资需谨慎。";

/** 评分颜色：≥60 偏多红 / 40-59 中性灰 / <40 偏空绿（与报告页评分分级一致） */
const scoreClass = (s: number): string => (s >= 60 ? "fr-up" : s >= 40 ? "fr-flat" : "fr-down");
const fmtYi = (v: number | null): string => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v / 1e8).toFixed(2)}亿`);
const fmtChg = (v: number | null): string => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);

/** 一键加/移自选按钮：未加 → 蓝色「＋自选」；已加 → 灰「✓已加」，点按可移除。≥40px 触达。 */
function WatchToggleButton({ code, name, added, onToggle, compact = false }: {
  code: string;
  name: string;
  added: boolean;
  onToggle: (code: string, name: string) => void;
  compact?: boolean;
}) {
  const label = added ? "已加" : "自选";
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(code, name); }}
      aria-pressed={added}
      aria-label={added ? `已加入自选 ${name || code}，点击移出` : `加入自选 ${name || code}`}
      title={added ? "点击移出自选" : "加入自选"}
      className={`fr-sub fr-press inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-1 rounded-btn border font-bold transition-colors ${
        added
          ? "border-border bg-muted text-muted-foreground hover:border-destructive/40 hover:text-destructive"
          : "border-primary/60 bg-primary-subtle-strong text-primary hover:bg-primary-subtle-active"
      }`}
    >
      {added ? <Check className="h-5 w-5" aria-hidden="true" /> : <Plus className="h-5 w-5" aria-hidden="true" />}
      {!compact && <span>{label}</span>}
    </button>
  );
}

export function FundradarScoreboard() {
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const customPool = useScorePoolCustom();

  // null = 模块卡片墙（首页视图）；非 null = 该板块的榜单视图
  const [activeSector, setActiveSector] = useState<ScorePoolSectorId | null>(null);
  const [tab, setTab] = useState<"composite" | "flow">("composite");
  const [cache, setCache] = useState<ScoreCacheItem[]>(() => loadScoreCache());
  const [updatedAt, setUpdatedAt] = useState<string | null>(() => loadScoreCacheUpdated());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [addInput, setAddInput] = useState("");
  const [addHint, setAddHint] = useState("");
  const [customInput, setCustomInput] = useState("");
  const [customHint, setCustomHint] = useState("");
  const [customAdding, setCustomAdding] = useState(false);

  // 评分缓存落盘后（本页/其他标签页/盘后批）自动刷新
  useEffect(() => {
    const refresh = (): void => {
      setCache(loadScoreCache());
      setUpdatedAt(loadScoreCacheUpdated());
    };
    refresh();
    window.addEventListener(FR_SCORE_CACHE_CHANGED, refresh);
    return () => window.removeEventListener(FR_SCORE_CACHE_CHANGED, refresh);
  }, []);

  /* ---------------- 派生：候选池 / 榜单 ---------------- */

  // 代码 → 名称（板块清单 + 自定义 + 自选；行情端点取不到时回退用）
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of SCORE_POOL_SECTORS) for (const st of s.stocks) m.set(st.code, st.name);
    for (const x of customPool) m.set(x.code, x.name);
    for (const w of watchlist) m.set(w.code, w.name);
    return m;
  }, [customPool, watchlist]);

  // 纳入评分的候选池 = 当前板块 ∪ 自定义 ∪ 自选（去重）
  const selectedPool = useMemo(() => {
    const list: { code: string; name: string }[] = [];
    const seen = new Set<string>();
    const sector = activeSector ? scorePoolSector(activeSector) : undefined;
    if (sector) {
      for (const st of sector.stocks) {
        if (!seen.has(st.code)) {
          seen.add(st.code);
          list.push(st);
        }
      }
    }
    for (const x of customPool) {
      if (!seen.has(x.code)) {
        seen.add(x.code);
        list.push(x);
      }
    }
    for (const w of watchlist) {
      if (!seen.has(w.code)) {
        seen.add(w.code);
        list.push(w);
      }
    }
    return list;
  }, [activeSector, customPool, watchlist]);

  const visible = useMemo(() => {
    const set = new Set(selectedPool.map((s) => s.code));
    return cache.filter((it) => set.has(it.code));
  }, [cache, selectedPool]);

  // 综合榜：评分 ≥60 且 Top20，纯评分排序
  const compositeRank = useMemo(
    () => visible.filter((it) => it.score >= 60).sort((a, b) => b.score - a.score).slice(0, 20),
    [visible],
  );
  // 资金榜：主力净流入金额排序（缺失置底）
  const flowRank = useMemo(
    () => [...visible].sort((a, b) => (b.flow ?? -Infinity) - (a.flow ?? -Infinity)).slice(0, 20),
    [visible],
  );

  const activeRank = tab === "composite" ? compositeRank : flowRank;
  const top3 = activeRank.slice(0, 3);
  const rows = activeRank.slice(3);

  const scoredCodes = useMemo(() => new Set(cache.map((it) => it.code)), [cache]);
  const unscoredCount = selectedPool.filter((s) => !scoredCodes.has(s.code)).length;

  // 已在自选的代码集合（一键加/移自选按钮的「已加」态判断）
  const watchCodes = useMemo(() => new Set(watchlist.map((w) => w.code)), [watchlist]);
  // 候选池去重后的总只数（板块 + 自定义 + 自选，管理区展示用）
  const poolTotal = useMemo(() => {
    const set = new Set<string>();
    for (const s of SCORE_POOL_SECTORS) for (const st of s.stocks) set.add(st.code);
    for (const x of customPool) set.add(x.code);
    for (const w of watchlist) set.add(w.code);
    return set.size;
  }, [customPool, watchlist]);

  // 模块卡片墙：每个板块的评分概览（已评分数 / 平均分 / Top3），数据取自评分缓存
  const sectorStats = useMemo(() => {
    return SCORE_POOL_SECTORS.map((s) => {
      const codes = new Set(s.stocks.map((x) => x.code));
      const scored = cache.filter((it) => codes.has(it.code));
      const sorted = [...scored].sort((a, b) => b.score - a.score);
      const avg = scored.length > 0
        ? Math.round(scored.reduce((a, b) => a + b.score, 0) / scored.length)
        : null;
      return { sector: s, scoredCount: scored.length, avg, top3: sorted.slice(0, 3) };
    });
  }, [cache]);

  const displayName = (it: ScoreCacheItem): string =>
    it.name && it.name !== it.code ? it.name : (nameMap.get(it.code) ?? it.code);
  const hasDataGap = (it: ScoreCacheItem): boolean => it.missing.includes("资金") || it.missing.includes("估值");

  const updatedLabel = useMemo(() => {
    if (!updatedAt) return "尚未计算";
    const d = new Date(updatedAt);
    if (Number.isNaN(d.getTime())) return updatedAt;
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }, [updatedAt]);

  /* ---------------- 交互 ---------------- */

  const openStock = (code: string): void => {
    navigate(`/report?code=${code}`);
  };

  // 一键加/移自选：已在自选则移除，否则加入（复用 fundradarWatchlist，内部派发事件刷新）
  const toggleWatch = (code: string, name: string): void => {
    if (watchCodes.has(code)) removeWatchItem(code);
    else addWatchItem(code, name);
  };

  // 手动加自定义候选：查名（loadStockQuote）后落自定义清单，查不到回退 code
  const onAddCustom = async (): Promise<void> => {
    const c = customInput.trim();
    if (!/^\d{6}$/.test(c)) {
      setCustomHint("请输入 6 位 A 股代码（如 600183）");
      return;
    }
    if (customPool.some((x) => x.code === c)) {
      setCustomHint("该代码已在自定义候选池");
      return;
    }
    setCustomAdding(true);
    setCustomHint("");
    let name = "";
    try {
      const q = await loadStockQuote(c, false);
      name = q.name && q.name !== c ? q.name : "";
    } catch {
      name = "";
    }
    if (addScorePoolCustomItem(c, name)) {
      setCustomInput("");
    } else {
      setCustomHint("该代码已在自定义候选池");
    }
    setCustomAdding(false);
  };

  const recompute = async (): Promise<void> => {
    if (running || selectedPool.length === 0) return;
    setRunning(true);
    setProgress({ total: selectedPool.length, done: 0, ok: 0, failed: 0, current: "" });
    try {
      await runBatchScore({
        codes: selectedPool.map((s) => s.code),
        concurrency: 2,
        refresh: false,
        onProgress: setProgress,
      });
    } finally {
      setRunning(false);
      setCache(loadScoreCache());
      setUpdatedAt(loadScoreCacheUpdated());
    }
  };

  const onAdd = (): void => {
    const c = addInput.trim();
    if (!/^\d{6}$/.test(c)) {
      setAddHint("请输入 6 位 A 股代码（如 600183）");
      return;
    }
    const known = nameMap.get(c) ?? "";
    if (addWatchItem(c, known)) {
      setAddInput("");
      setAddHint("");
    } else {
      setAddHint("该代码已在自选");
    }
  };

  const progressPct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const activeSectorObj = activeSector ? scorePoolSector(activeSector) : undefined;

  /* ---------------- 渲染 ---------------- */

  return (
    <div data-fr-page="fundradar-scoreboard" className="fr-elder-page p-6">
      <div className="fr-fade-in mx-auto max-w-[1500px]">
        <h1 className="sr-only">资金雷达 · 评分榜</h1>

        {/* 头（随视图变化：卡片墙标题 vs 板块标题 + 返回） */}
        <section className="mb-4 flex flex-wrap items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-btn bg-primary-subtle-strong text-primary">
            <Trophy className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            {activeSector ? (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setActiveSector(null)}
                  className="fr-sub fr-tap inline-flex items-center gap-1 rounded-btn border border-border px-2.5 py-1 font-bold text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" /> 全部模块
                </button>
                <h2 className="fr-title font-bold">{activeSectorObj?.label}评分榜</h2>
              </div>
            ) : (
              <h2 className="fr-title font-bold">评分榜</h2>
            )}
            <p className="fr-sub text-muted-foreground">
              {activeSector
                ? `${activeSectorObj?.label}候选池 · 综合榜 / 资金榜`
                : "12 个行业模块 · 点卡片进入板块榜单"}
            </p>
          </div>
          <span className="fr-sub text-muted-foreground">更新于 {updatedLabel}</span>
        </section>

        {/* 免责横幅（常驻） */}
        <div className="fr-glass mb-4 flex items-start gap-2.5 rounded-xl px-4 py-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <p className="fr-sub leading-relaxed text-muted-foreground">{DISCLAIMER}</p>
        </div>

        {activeSector === null ? (
          /* ============ 模块卡片墙（首页视图） ============ */
          <section aria-label="行业模块" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sectorStats.map(({ sector, scoredCount, avg, top3 }) => (
              <button key={sector.id} type="button" onClick={() => setActiveSector(sector.id)}
                className="group rounded-xl border border-border bg-card p-4 text-left shadow-[var(--fr-shadow-sm)] transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-[0_8px_24px_hsl(var(--primary)/0.18)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="fr-body font-bold">{sector.label}</span>
                  <span className="fr-sub text-muted-foreground">{sector.stocks.length} 只</span>
                </div>
                <div className="mt-3 flex items-end gap-2">
                  {avg !== null ? (
                    <>
                      <span className="fr-num leading-none" style={{ fontSize: "calc(var(--fs-num) * 1.1)" }}>
                        <span className={scoreClass(avg)}>{avg}</span>
                      </span>
                      <span className="fr-sub mb-0.5 text-muted-foreground">
                        平均分 · {scoredCount}/{sector.stocks.length} 已算
                      </span>
                    </>
                  ) : (
                    <span className="fr-sub text-muted-foreground">尚未计算 · 进入后点「重新计算」</span>
                  )}
                </div>
                {top3.length > 0 && (
                  <ul className="mt-3 space-y-1.5 border-t border-border pt-2.5">
                    {top3.map((it, i) => (
                      <li key={it.code} className="fr-sub flex items-center gap-2">
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`} aria-hidden="true">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate font-bold">{displayName(it)}</span>
                        <span className={`font-bold ${scoreClass(it.score)}`}>{it.score}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="fr-sub mt-3 inline-flex items-center gap-1 font-bold text-primary group-hover:underline">
                  进入板块 <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </p>
              </button>
            ))}
          </section>
        ) : (
          <>
            {/* ============ 板块内榜单视图 ============ */}

            {/* 工具栏：候选池说明 + 重新计算 */}
            <section aria-label="板块批量评分" className="fr-glass mb-4 rounded-xl p-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <span className="fr-sub font-bold text-muted-foreground">
                  {activeSectorObj?.label}候选池 {selectedPool.length} 只（板块 ∪ 自定义 ∪ 自选）
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void recompute()}
                    disabled={running || selectedPool.length === 0}
                    className="fr-sub fr-tap fr-press inline-flex items-center gap-2 rounded-btn bg-primary px-5 py-2 font-bold text-primary-foreground disabled:opacity-60"
                  >
                    {running ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-5 w-5" aria-hidden="true" />}
                    {running ? "计算中…" : "重新计算"}
                  </button>
                </div>
              </div>
              {running && progress && (
                <div className="mt-3">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progressPct}%` }} />
                  </div>
                  <p className="fr-sub mt-1.5 text-muted-foreground">
                    已算 {progress.done}/{progress.total} · 成功 {progress.ok} · 失败 {progress.failed}
                    {progress.current ? ` · 当前 ${progress.current}` : ""}
                  </p>
                </div>
              )}
              {!running && unscoredCount > 0 && (
                <p className="fr-sub mt-2 text-muted-foreground">
                  当前候选池内有 {unscoredCount} 只尚未计算，点击「重新计算」后纳入榜单。
                </p>
              )}
            </section>

        {/* 双榜 Tab */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-btn border border-border bg-muted/40 p-1">
            <button
              type="button"
              onClick={() => setTab("composite")}
              aria-pressed={tab === "composite"}
              className={`fr-sub fr-press inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 font-bold transition-colors ${tab === "composite" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <BarChart3 className="h-4 w-4" aria-hidden="true" /> 综合榜
            </button>
            <button
              type="button"
              onClick={() => setTab("flow")}
              aria-pressed={tab === "flow"}
              className={`fr-sub fr-press inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 font-bold transition-colors ${tab === "flow" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <TrendingUp className="h-4 w-4" aria-hidden="true" /> 资金榜
            </button>
          </div>
          <p className="fr-sub text-muted-foreground">
            {tab === "composite" ? "评分 ≥60 取 Top20，纯评分排序" : "按当日主力净流入金额排序"}
          </p>
        </div>

        {/* 空态 */}
        {!running && activeRank.length === 0 && (
          <section className="fr-glass rounded-xl p-6">
            <p className="fr-body font-bold">{visible.length === 0 ? "暂无评分数据" : "当前榜单无满足条件个股"}</p>
            <p className="fr-sub mt-2 text-muted-foreground">
              {visible.length === 0
                ? "点击上方「重新计算」对当前板块批量评分（首次计算需要一点时间）。"
                : "综合榜仅显示评分 ≥60 的个股；可切换资金榜。"}
            </p>
          </section>
        )}

        {/* Top3 大卡 */}
        {top3.length > 0 && (
          <section aria-label="前三名" className="mb-4 grid gap-3 md:grid-cols-3">
            {top3.map((it, idx) => {
              const first = idx === 0;
              return (
                <div
                  key={it.code}
                  role="button"
                  tabIndex={0}
                  onClick={() => openStock(it.code)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openStock(it.code); } }}
                  className={`relative cursor-pointer rounded-xl border bg-card p-5 text-left shadow-[var(--fr-shadow-sm)] transition-colors hover:border-primary/60 ${first ? "border-primary" : "border-border"}`}
                >
                  <span
                    className={`absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${first ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  >
                    {idx + 1}
                  </span>
                  <p className="fr-body pr-10 font-bold">{displayName(it)}</p>
                  <p className="fr-sub text-muted-foreground">{it.code}</p>
                  <p className="fr-num mt-2" style={{ fontSize: "calc(var(--fs-num) * 1.5)" }}>
                    <span className={scoreClass(it.score)}>{it.score}</span>
                  </p>
                  <p className="fr-sub mb-3 text-muted-foreground">综合评分{hasDataGap(it) ? " · 数据缺" : ""}</p>
                  <div className="fr-sub flex items-center justify-between gap-3 border-t border-border pt-2.5">
                    <div className="flex gap-4">
                      <span className={frPctClass(it.chg)}>{fmtChg(it.chg)}</span>
                      <span className={frPctClass(it.flow)}>主力 {fmtYi(it.flow)}</span>
                    </div>
                    <WatchToggleButton
                      code={it.code}
                      name={displayName(it)}
                      added={watchCodes.has(it.code)}
                      onToggle={toggleWatch}
                      compact
                    />
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* 列表 */}
        {rows.length > 0 && (
          <section aria-label="评分榜单列表" className="fr-glass overflow-hidden rounded-xl">
            <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
              <span className="fr-sub w-10 shrink-0 text-muted-foreground">排名</span>
              <span className="fr-sub min-w-0 flex-1 text-muted-foreground">股票</span>
              <span className="fr-sub w-16 shrink-0 text-right text-muted-foreground">评分</span>
              <span className="fr-sub w-20 shrink-0 text-right text-muted-foreground">涨跌</span>
              <span className="fr-sub w-24 shrink-0 text-right text-muted-foreground">主力资金</span>
              <span className="fr-sub w-20 shrink-0 text-right text-muted-foreground">自选</span>
            </div>
            <ul>
              {rows.map((it, idx) => {
                const rank = idx + 4; // 前三名在大卡
                return (
                  <li key={it.code} className="flex items-center border-b border-border last:border-b-0">
                    <button
                      type="button"
                      onClick={() => openStock(it.code)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
                    >
                      <span className="fr-sub w-10 shrink-0 text-muted-foreground">{rank}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block">
                          <span className="fr-body font-bold">{displayName(it)}</span>
                          {hasDataGap(it) && (
                            <span className="fr-sub ml-2 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">数据缺</span>
                          )}
                        </span>
                        <span className="fr-sub block text-muted-foreground">{it.code}</span>
                      </span>
                      <span className="fr-num w-16 shrink-0 text-right" style={{ fontSize: "var(--fs-title)" }}>
                        <span className={scoreClass(it.score)}>{it.score}</span>
                      </span>
                      <span className={`fr-sub w-20 shrink-0 text-right font-bold ${frPctClass(it.chg)}`}>{fmtChg(it.chg)}</span>
                      <span className={`fr-sub w-24 shrink-0 text-right font-bold ${frPctClass(it.flow)}`}>{fmtYi(it.flow)}</span>
                    </button>
                    <div className="flex w-20 shrink-0 justify-end pr-3">
                      <WatchToggleButton
                        code={it.code}
                        name={displayName(it)}
                        added={watchCodes.has(it.code)}
                        onToggle={toggleWatch}
                        compact
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
          </>
        )}

        {/* 自选管理（两个视图共用） */}
        <section aria-label="自选管理" className="fr-glass mt-4 rounded-xl p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="fr-sub font-bold text-muted-foreground">自选（与持仓分开）</span>
            <span className="fr-sub text-muted-foreground">{watchlist.length} 只</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-input border border-border bg-muted px-3 py-2">
              <input
                value={addInput}
                onChange={(e) => { setAddInput(e.target.value); setAddHint(""); }}
                placeholder="输入 6 位代码加自选"
                aria-label="输入自选代码"
                className="fr-sub w-44 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={onAdd}
              className="fr-sub fr-tap fr-press inline-flex items-center gap-1.5 rounded-btn border border-primary/60 bg-primary-subtle-strong px-4 py-2 font-bold text-primary"
            >
              <Plus className="h-5 w-5" aria-hidden="true" /> 添加
            </button>
            {addHint && <span role="status" className="fr-sub text-destructive">{addHint}</span>}
          </div>
          {watchlist.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {watchlist.map((w) => (
                <span key={w.code} className="fr-chip fr-sub gap-1.5">
                  {w.name && w.name !== w.code ? w.name : w.code}
                  <span className="text-muted-foreground">{w.code}</span>
                  <button
                    type="button"
                    onClick={() => removeWatchItem(w.code)}
                    aria-label={`移除自选 ${w.code}`}
                    className="inline-flex text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </section>

        {/* 候选池管理 */}
        <section aria-label="候选池管理" className="fr-glass mt-4 rounded-xl p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-btn bg-primary-subtle-strong text-primary">
              <ListChecks className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="fr-sub font-bold text-muted-foreground">管理候选池</span>
          </div>
          <p className="fr-sub text-muted-foreground">
            板块：{SCORE_POOL_SECTORS.map((s) => `${s.label} ${s.stocks.length}`).join(" · ")}
            {" · "}自定义 {customPool.length} · 自选 {watchlist.length} · 合计 {poolTotal}（去重）
          </p>
          <p className="fr-sub mt-1 text-muted-foreground">
            候选池 = 当前板块 ∪ 自定义 ∪ 自选（去重），在板块内点「重新计算」后纳入榜单评分。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-input border border-border bg-muted px-3 py-2">
              <input
                value={customInput}
                onChange={(e) => { setCustomInput(e.target.value); setCustomHint(""); }}
                placeholder="输入 6 位代码加自定义候选"
                aria-label="输入自定义候选代码"
                className="fr-sub w-48 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => void onAddCustom()}
              disabled={customAdding}
              className="fr-sub fr-tap fr-press inline-flex items-center gap-1.5 rounded-btn border border-primary/60 bg-primary-subtle-strong px-4 py-2 font-bold text-primary disabled:opacity-60"
            >
              {customAdding ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Plus className="h-5 w-5" aria-hidden="true" />}
              添加
            </button>
            {customHint && <span role="status" className="fr-sub text-destructive">{customHint}</span>}
          </div>
          {customPool.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {customPool.map((x) => (
                <span key={x.code} className="fr-chip fr-sub gap-1.5">
                  {x.name && x.name !== x.code ? x.name : x.code}
                  <span className="text-muted-foreground">{x.code}</span>
                  <button
                    type="button"
                    onClick={() => removeScorePoolCustomItem(x.code)}
                    aria-label={`移除自定义候选 ${x.code}`}
                    className="inline-flex text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
