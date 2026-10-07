/**
 * 资金雷达工作台 · 板块利好利空新闻展示件（刀8）
 * ------------------------------------------------------------
 * - FrSectorNews：首页「板块要闻」区 —— 四板块 tab，每板块保留全部候选（科技链/新能源/医药各 25、
 *   金融 5），tab 内分页展示（每页 10 条）。每条 = 情绪标签（利好红 / 利空绿 / 中性灰）+
 *   标题 + 影响力分 + 时间，点击 <a target="_blank"> 跳转新闻来源。
 * - FrStockSectorNews：个股页「所属板块要闻」卡 —— 按 em_concept_blocks 板块名
 *   映射到四板块，取该板块全部候选并分页（每页 10 条）。
 * 两者都读 localStorage `fr-sector-news`（生成批写入），并监听生成完成事件即时重读。
 * 未生成显示占位；金融板块空则显示「数据源受限」。首页区带「刷新」按钮手动重新生成。
 */
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Layers, LoaderCircle, RefreshCw } from "lucide-react";
import {
  FR_SECTOR_NEWS_UPDATED, FR_SECTORS, generateSectorNews, readSectorNews, stockBoardsToSector,
  type FrNewsSentiment, type FrSectorKey, type FrSectorNews, type FrSectorNewsItem,
} from "@/lib/fundradarSectorNews";
import { FR_DATA_REFRESHED, frDateLabel } from "@/lib/fundradarData";
import { frStaggerDelay } from "@/components/fundradar/FrAnimatedNumber";
import { FR_NEWS_PAGE_SIZE, FrPager } from "@/components/fundradar/FrPager";

const SENTIMENT_META: Record<FrNewsSentiment, { label: string; cls: string }> = {
  利好: { label: "利好", cls: "fr-sent-bull" },
  利空: { label: "利空", cls: "fr-sent-bear" },
  中性: { label: "中性", cls: "fr-sent-flat" },
};

/** 情绪标签：利好红 / 利空绿 / 中性灰；AI 失败显示「情绪暂缺」 */
function SentimentTag({ item }: { item: FrSectorNewsItem }) {
  const meta = item.sentiment ? SENTIMENT_META[item.sentiment] : null;
  if (!meta) {
    return <span className="fr-tag">情绪暂缺</span>;
  }
  return <span className={`fr-sent-tag ${meta.cls}`}>{meta.label}</span>;
}

/** 语言标签：中 / 英（中性灰小标签，仅展示、不做筛选） */
function LangTag({ item }: { item: FrSectorNewsItem }) {
  return <span className="fr-lang-tag">{item.lang}</span>;
}

/** 单条新闻行：情绪标签 + 标题 + 影响力分 + 时间；有 URL 则整行可点跳转来源 */
function ItemRow({ item, idx }: { item: FrSectorNewsItem; idx: number }) {
  const inner = (
    <>
      <SentimentTag item={item} />
      <LangTag item={item} />
      <span className="fr-body min-w-0 flex-1 truncate">{item.title}</span>
      <span className={`fr-sub shrink-0 tabular-nums font-bold ${item.score == null ? "fr-flat" : ""}`}>
        {item.score == null ? "影响力 —" : `影响力 ${item.score}`}
      </span>
      <span className="fr-sub shrink-0 tabular-nums text-muted-foreground">{item.time || "—"}</span>
    </>
  );
  const cls = "fr-stagger-in flex w-full items-center gap-3 px-2 py-3 text-left transition-colors hover:bg-muted/60";
  const style = frStaggerDelay(idx);
  if (item.url) {
    return (
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        title="点击跳转新闻来源"
        className={cls}
        style={style}
      >
        {inner}
        <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </a>
    );
  }
  return (
    <div className={cls} style={style}>
      {inner}
    </div>
  );
}

/** 订阅 fr-sector-news 缓存：挂载读一次；数据刷新 / 生成完成事件触发时重读；暴露 reload 供手动刷新兜底。 */
function useSectorNews(): { data: FrSectorNews | null; reload: () => void } {
  const [data, setData] = useState<FrSectorNews | null>(() => readSectorNews());
  const reload = useCallback(() => setData(readSectorNews()), []);
  useEffect(() => {
    window.addEventListener(FR_DATA_REFRESHED, reload);
    window.addEventListener(FR_SECTOR_NEWS_UPDATED, reload);
    return () => {
      window.removeEventListener(FR_DATA_REFRESHED, reload);
      window.removeEventListener(FR_SECTOR_NEWS_UPDATED, reload);
    };
  }, [reload]);
  return { data, reload };
}

/** 首页「板块要闻」区：四板块 tab + 全部候选（影响力降序）+ 每页 10 条分页 + 手动刷新按钮 */
export function FrSectorNews() {
  const { data, reload } = useSectorNews();
  const [tab, setTab] = useState<FrSectorKey>("科技链");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"ok" | "err" | null>(null);
  const list = data?.sectors[tab] ?? [];
  const note = data?.notes[tab] ?? "";
  const totalPages = Math.max(1, Math.ceil(list.length / FR_NEWS_PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const pageStart = (curPage - 1) * FR_NEWS_PAGE_SIZE;
  const pageItems = list.slice(pageStart, pageStart + FR_NEWS_PAGE_SIZE);

  const refresh = async () => {
    if (busy) return; // 刷新中禁点，防连点
    setBusy(true);
    setResult(null);
    try {
      const out = await generateSectorNews();
      // 成功后 generateSectorNews 已派发 FR_SECTOR_NEWS_UPDATED（useSectorNews 会重读）；
      // 这里再显式 reload 兜底，确保完成后立即刷新展示。
      reload();
      setResult(out ? "ok" : "err");
    } catch {
      setResult("err");
    } finally {
      setBusy(false);
      // 结果提示 3 秒后自动消失，避免常驻干扰
      window.setTimeout(() => setResult(null), 3000);
    }
  };

  return (
    <section aria-label="板块要闻" className="fr-glass mb-5 rounded-xl px-4 py-3 sm:px-5 sm:py-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="fr-sub font-semibold uppercase tracking-[0.2em] text-primary">Sector Briefing</p>
          <h2 className="fr-title mt-1 flex items-center gap-2 font-bold">
            <Layers className="h-5 w-5 text-primary" aria-hidden="true" />
            板块要闻
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {data && (
            <span className="fr-sub text-muted-foreground">
              {data.aiOk ? `数据日期 ${frDateLabel(data.dataDate)}` : "情绪判断暂不可用"}
            </span>
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            aria-busy={busy}
            title={busy ? "正在刷新板块新闻…" : "立即刷新板块新闻（取最新 RSS + AI 判断）"}
            className="fr-tap inline-flex items-center gap-1.5 rounded-btn border border-border bg-card px-2.5 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:cursor-wait disabled:opacity-60"
          >
            {busy
              ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            {busy ? "刷新中…" : "刷新"}
          </button>
        </div>
      </div>

      {result && (
        <p
          role={result === "err" ? "alert" : "status"}
          className={`fr-sub mb-2 font-bold ${result === "err" ? "text-destructive" : "text-success"}`}
        >
          {result === "err" ? "刷新失败，稍后可重试（上次结果保留）" : "已刷新为最新板块新闻"}
        </p>
      )}

      {/* 四板块 tab */}
      <div className="mb-2 flex flex-wrap gap-2" role="tablist" aria-label="板块切换">
        {FR_SECTORS.map((s) => {
          const count = data ? data.sectors[s]?.length ?? 0 : 0;
          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={tab === s}
              onClick={() => { setTab(s); setPage(1); }}
              className={`fr-sub fr-tap rounded-btn border px-4 font-bold ${
                tab === s ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary/50"
              }`}
            >
              {s}{data ? ` ${count}` : ""}
            </button>
          );
        })}
      </div>

      {!data ? (
        <div className="fr-body rounded-btn border border-dashed border-border bg-muted/40 px-5 py-8 text-muted-foreground">
          板块利好利空新闻每小时自动刷新，或点击右上角「刷新」立即生成，现在还没有数据。
        </div>
      ) : list.length === 0 ? (
        <div className="fr-body rounded-btn border border-dashed border-border bg-muted/40 px-5 py-8 text-muted-foreground">
          {note ? `${note}，暂无可展示新闻` : "该板块暂无可展示新闻。"}
        </div>
      ) : (
        <>
          <div className="divide-y divide-border">
            {pageItems.map((item, i) => (
              <ItemRow key={`${item.industry}-${item.title}`} item={item} idx={i} />
            ))}
          </div>
          <FrPager page={curPage} totalPages={totalPages} totalItems={list.length} onChange={setPage} />
        </>
      )}

      <p className="fr-sub mt-2 leading-relaxed text-muted-foreground">
        {note ? `${note}；` : ""}数据源：RSS 新闻雷达（按行业映射到四大板块）；情绪与影响力分由 AI 每小时批量判断（利好=红 / 利空=绿 / 中性=灰），点击标题跳转原文。
      </p>
    </section>
  );
}

/** 个股页「所属板块要闻」卡：按个股概念板块映射到四板块，取该板块全部候选并分页（每页 10 条）。 */
export function FrStockSectorNews({ boards }: { boards: string[] }) {
  const { data } = useSectorNews();
  const [page, setPage] = useState(1);
  const sector = stockBoardsToSector(boards);
  const all = sector ? (data?.sectors[sector] ?? []) : [];
  const totalPages = Math.max(1, Math.ceil(all.length / FR_NEWS_PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const pageStart = (curPage - 1) * FR_NEWS_PAGE_SIZE;
  const items = all.slice(pageStart, pageStart + FR_NEWS_PAGE_SIZE);

  return (
    <section aria-label="所属板块要闻" className="fr-glass mb-4 rounded-xl p-5">
      <h2 className="fr-body font-bold">
        所属板块要闻
        {sector && <span className="fr-sub ml-2 font-normal text-muted-foreground">{sector}</span>}
      </h2>

      {!sector ? (
        <p className="fr-sub mt-2 text-muted-foreground">
          该股概念板块未命中四大板块（科技链 / 新能源 / 医药 / 金融），暂不关联板块新闻。
        </p>
      ) : !data ? (
        <p className="fr-sub mt-2 text-muted-foreground">
          板块要闻每小时自动刷新，现在还没有数据。
        </p>
      ) : all.length === 0 ? (
        <p className="fr-sub mt-2 text-muted-foreground">
          {data.notes[sector] ? `${data.notes[sector]}，暂无可展示新闻。` : `${sector}板块暂无可展示新闻。`}
        </p>
      ) : (
        <>
          <div className="mt-2 divide-y divide-border">
            {items.map((item, i) => (
              <ItemRow key={`${item.industry}-${item.title}`} item={item} idx={i} />
            ))}
          </div>
          <FrPager page={curPage} totalPages={totalPages} totalItems={all.length} onChange={setPage} />
        </>
      )}

      {data && sector && (
        <p className="fr-sub mt-2 text-muted-foreground">
          数据日期 {frDateLabel(data.dataDate)} · 按个股概念板块归属关联，全部候选（影响力降序，每页 10 条）。
        </p>
      )}
    </section>
  );
}
