/**
 * 资金雷达工作台 · 我的持仓页（常用区域，详规 v0.2 §1.2 + 原型 ElderPage 照做）
 * 大字持仓卡（现价/涨跌幅 40 粗，今日盈亏/累计盈亏/累计收益率 24）+ 顶部情绪条 + 底部语音大按钮（演示）。
 * 清单读 loadHoldings()（设置页「持仓管理」增删改，全局生效）；现价/涨跌幅/昨收为真实行情
 * （tx_quotes_batch）；今日盈亏/累计盈亏/累计收益率按成本×数量前端计算（与 calc pnl 同口径，
 * 见组件内注释），未录成本/数量显示「—」。取数失败 → 行情与盈亏显示「—」+ 顶部提示重试，页面不会崩。
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAiPage } from "../../../core/ai/pageContext";
import { FrDataNotice } from "@/components/fundradar/FrDataNotice";
import { FrSkeleton } from "@/components/fundradar/FrSkeleton";
import { FrAnimatedNumber, FrChangePop, frStaggerDelay } from "@/components/fundradar/FrAnimatedNumber";
import { FR_HOLDING_META, frDateCn, frTodayKey, loadPortfolioLive, useFrLoader, type FrPortfolioLive } from "@/lib/fundradarData";
import { useHoldings } from "@/lib/fundradarPortfolio";
import { FR_DISCLAIMER, FR_EMOTION, FR_SUGGESTIONS } from "@/data/fundradarSample";
import { frPctClass, frSigned } from "@/lib/fundradarTheme";

type SortKey = "code" | "chg";
type VoiceStep = "idle" | "listening" | "reading" | "done";

/** 持仓卡视图：现价/涨跌幅/昨收来自真实行情；盈亏按「成本×数量」计算，未录成本/数量显示「—」 */
interface CardView {
  code: string;
  name: string;
  sector: string;
  price: number | null;
  chg: number | null;
  /** 今日盈亏（元）=(现价-昨收)×qty */
  pnl: number | null;
  /** 累计盈亏（元）=(现价-cost)×qty */
  cumPnl: number | null;
  /** 累计收益率（%）=(现价/cost-1)×100 */
  cumPct: number | null;
}

export function FundradarPortfolio() {
  const { loading, live, failed, retry } = useFrLoader<FrPortfolioLive>(loadPortfolioLive);
  const holdings = useHoldings();
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [voice, setVoice] = useState<VoiceStep>("idle");

  const usingSample = !live;
  const radar = live?.radar ?? null;
  const sentiment = radar?.sentiment ?? null;
  const dataDate = live?.dataDate ?? "";
  const quotes = live?.quotes ?? [];

  /**
   * 盈亏口径（与 calc pnl 同口径，前端本地实现）：
   *   今日盈亏(元) = (现价 - 昨收) × 数量
   *   累计盈亏(元) = (现价 - 成本) × 数量
   *   累计收益率(%) = (现价 / 成本 - 1) × 100
   * 现价/昨收来自 tx_quotes_batch；成本/数量来自设置页录入（fr-holdings）。
   * 无成本/数量 → 显示「—」，不编值。
   */
  const cards: CardView[] = holdings.map((h) => {
    const q = quotes.find((x) => x.code === h.code);
    const price = q?.price ?? null;
    const chg = q?.chg ?? null;
    const lastClose = q?.lastClose ?? null;
    const cost = h.cost;
    const qty = h.qty;
    // 数据层先归一到两位小数：float 减法会留尾数（129.96−132.96=−3.000000000000002 ⇒ ×1000 后一长串）
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const pnl = cost != null && qty != null && price != null && lastClose != null
      ? r2((price - lastClose) * qty) : null;
    const cumPnl = cost != null && qty != null && price != null
      ? r2((price - cost) * qty) : null;
    const cumPct = cost != null && cost > 0 && price != null
      ? r2((price / cost - 1) * 100) : null;
    return {
      code: h.code, name: h.name,
      sector: FR_HOLDING_META.find((m) => m.code === h.code)?.sector ?? "",
      price, chg, pnl, cumPnl, cumPct,
    };
  });
  const rows = [...cards].sort((a, b) =>
    sortKey === "code" ? a.code.localeCompare(b.code) : (b.chg ?? 0) - (a.chg ?? 0));

  /** 语音问答演示：听 → 回答 → 完成（真实 SenseVoice/TTS 在后续版本接入） */
  const runVoice = () => {
    setVoice("listening");
    window.setTimeout(() => setVoice("reading"), 1200);
    window.setTimeout(() => setVoice("done"), 5000);
  };

  const aiContext = usingSample
    ? `我的持仓：${holdings.map((h) => `${h.name}${h.code}`).join("、") || "暂无"}。成本/数量未录，盈亏显示「—」。`
    : `我的持仓（真实行情 ${dataDate}）：${rows.map((c) => `${c.name}${c.code} 现价${c.price ?? "—"} ${c.chg == null ? "—" : frSigned(c.chg, "%")}${c.pnl == null ? "" : ` 今日${frSigned(c.pnl, "元")}`}${c.cumPnl == null ? "" : ` 累计${frSigned(c.cumPnl, "元")}（${c.cumPct == null ? "—" : frSigned(c.cumPct, "%")}）`}`).join("；")}。盈亏按 (现价-成本)×数量，成本/数量在设置页录入。`;

  useAiPage({
    key: "fundradar-portfolio",
    title: "资金雷达 · 我的持仓",
    context: aiContext,
    suggestions: FR_SUGGESTIONS,
  });

  // 首次加载（无数据）：整页骨架屏（5 张持仓卡占位），替代「正在取数…」小字
  if (loading && !live) {
    return (
      <div data-fr-page="fundradar-portfolio" className="fr-elder-page p-6">
        <div className="fr-fade-in mx-auto max-w-[1500px]">
          <span className="sr-only" role="status">正在加载我的持仓…</span>

          <div className="mb-5 flex flex-wrap items-center gap-4">
            <FrSkeleton className="w-44 rounded-md" style={{ height: "calc(var(--fs-title) * 0.9)" }} />
            <FrSkeleton className="rounded-full" style={{ height: "calc(var(--fs-sub) * 1.7)", width: 116 }} />
            <FrSkeleton className="rounded-full" style={{ height: "calc(var(--fs-sub) * 1.7)", width: 200 }} />
          </div>

          <div className="space-y-3">
            {Array.from({ length: holdings.length || 5 }, (_, i) => (
              <div key={i} className="fr-glass flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card p-4">
                <FrSkeleton className="w-40 rounded-md" style={{ height: "calc(var(--fs-body) * 1.1)" }} />
                <FrSkeleton className="rounded-md" style={{ height: "calc(var(--fs-num) * 0.9)", width: 150 }} />
                <FrSkeleton className="rounded-md" style={{ height: "calc(var(--fs-body) * 1.1)", width: 130 }} />
                <FrSkeleton className="rounded-md" style={{ height: "calc(var(--fs-body) * 1.1)", width: 120 }} />
                <FrSkeleton className="ml-auto rounded-md" style={{ height: "calc(var(--fs-sub) * 1.2)", width: 120 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-fr-page="fundradar-portfolio" className="fr-elder-page p-6">
      <div className="fr-fade-in mx-auto max-w-[1500px]">
        {/* 顶部：标题 + 情绪条 */}
        <div className="mb-5 flex flex-wrap items-center gap-4">
          <span className="fr-title font-bold">我的持仓</span>
          <span className="fr-body text-muted-foreground">{usingSample ? frDateCn(frTodayKey()) : frDateCn(dataDate)}</span>
          <span className="fr-chip fr-body">情绪 {sentiment ? sentiment.lamp : FR_EMOTION.lamp}</span>
          <span className="fr-body font-bold">
            涨停 {sentiment?.zt ?? FR_EMOTION.ztTotal} · 最高 {radar ? (radar.maxBoard ?? "—") : FR_EMOTION.maxBoard} 板
          </span>
          <div className="ml-auto flex gap-2" role="group" aria-label="排序方式">
            <button type="button" aria-pressed={sortKey === "code"} onClick={() => setSortKey("code")}
              className={`fr-sub fr-tap rounded-btn border px-3 font-bold ${sortKey === "code" ? "border-primary bg-primary-subtle-strong text-primary" : "border-border text-muted-foreground"}`}>
              按代码
            </button>
            <button type="button" aria-pressed={sortKey === "chg"} onClick={() => setSortKey("chg")}
              className={`fr-sub fr-tap rounded-btn border px-3 font-bold ${sortKey === "chg" ? "border-primary bg-primary-subtle-strong text-primary" : "border-border text-muted-foreground"}`}>
              按涨跌幅
            </button>
          </div>
        </div>

        <FrDataNotice loading={loading} missing={failed ? ["全部数据"] : live?.missing ?? []} onRetry={retry} />

        {/* 持仓卡（读 loadHoldings；点击进入个股详情页 /stock/<code>） */}
        {holdings.length === 0 ? (
          <div className="fr-glass rounded-card p-6 text-center">
            <p className="fr-body">暂无持仓。去设置页添加你的持仓股票（代码 + 成本 + 数量）。</p>
            <Link to="/settings" className="fr-body mt-2 inline-block font-bold text-primary hover:underline">打开持仓管理 →</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((h, i) => (
              <Link key={h.code} to={`/stock/${h.code}`} title={`${h.name} · 点击进入个股详情`}
                className="fr-glass fr-press fr-stagger-in fr-tap flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card p-4 transition-opacity hover:opacity-85"
                style={frStaggerDelay(i)}>
                <span className="fr-body min-w-[180px] font-bold">
                  {h.name}
                  <span className="fr-sub block font-normal text-muted-foreground">{h.code}{h.sector ? ` · ${h.sector}` : ""}</span>
                </span>
                <span className={`fr-title min-w-[120px] ${frPctClass(h.chg)}`}>
                  <FrAnimatedNumber value={h.price} format={(v) => `¥${v.toFixed(2)}`} placeholder="¥—" />
                </span>
                <span className={`fr-body min-w-[100px] font-bold ${frPctClass(h.chg)}`}>
                  <FrChangePop value={h.chg} className={frPctClass(h.chg)}>{h.chg == null ? "—" : frSigned(h.chg, "%")}</FrChangePop>
                </span>
                <span className={`fr-body min-w-[140px] ${frPctClass(h.pnl)}`}>
                  {h.pnl == null ? "今日盈亏 —" : `今日 ${frSigned(h.pnl, "元")}`}
                </span>
                {/* 第一重点：累计盈亏（每行最醒目，但字号收敛到标题档，不用数字档 24px 那么夸张） */}
                <span className={`min-w-[210px] ${frPctClass(h.cumPnl)}`}>
                  <span className="fr-sub block font-bold text-muted-foreground">累计盈亏</span>
                  <span className="fr-title font-bold">
                    <FrAnimatedNumber value={h.cumPnl} format={(v) => frSigned(v, "元")} placeholder="—" />
                  </span>
                </span>
                <span className={`fr-body font-bold ${frPctClass(h.cumPct)}`}>
                  {h.cumPct == null ? "累计收益 —" : <>收益率 <FrChangePop value={h.cumPct} className={frPctClass(h.cumPct)}>{frSigned(h.cumPct, "%")}</FrChangePop></>}
                </span>
                <span className="fr-sub ml-auto shrink-0 font-bold text-primary">个股详情 →</span>
              </Link>
            ))}
          </div>
        )}

        <p className="fr-sub mt-3 text-muted-foreground">
          {usingSample
            ? "行情未取到，现价/涨跌幅/盈亏显示「—」（持仓清单来自你的录入，仍可查看/管理）。"
            : `现价 / 涨跌幅 / 昨收为真实行情（数据日期 ${dataDate}）；今日盈亏 =（现价−昨收）×数量，累计盈亏 =（现价−成本）×数量，累计收益率 =（现价/成本−1）×100。成本与数量在设置页「持仓管理」录入，未录入显示「—」。`}
        </p>

        {/* 底部语音大按钮（主色蓝，按住态压暗） */}
        <button type="button" onClick={runVoice}
          style={{ background: "hsl(var(--primary))", filter: voice === "listening" ? "brightness(0.85)" : undefined }}
          className="fr-btn-h mt-5 w-full rounded-btn text-white transition-[filter,transform] duration-150 ease-out active:scale-[0.97]">
          <span className="fr-title font-extrabold">
            {voice === "idle" && "按住说话，问点什么 · 或按 F2"}
            {voice === "listening" && "正在听…（演示中）"}
            {voice === "reading" && "回答：PCB 覆铜板最强，6家涨停+8.2亿，覆盖生益科技（朗读中…）"}
            {voice === "done" && "回答完毕 · 出处：板块热度榜 · 仅供参考"}
          </span>
        </button>

        <p className="fr-sub mt-3 text-muted-foreground">
          持仓管理（增删改代码/成本/数量）：<Link to="/settings" className="text-primary hover:underline">设置页「持仓管理」→</Link>
        </p>
        <p className="fr-sub mt-4 text-muted-foreground/80">{FR_DISCLAIMER}</p>
      </div>
    </div>
  );
}
