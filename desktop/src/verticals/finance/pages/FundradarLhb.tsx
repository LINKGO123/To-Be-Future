/**
 * 资金雷达工作台 · 龙虎榜页（常用区域 P4，详规 v0.2 §4）
 * 今日榜单（名称代码 + 上榜原因 + 净买额红/绿）+ 筛选大按钮（全部/游资/机构/量化）+ 点击展开详情 + 动向摘要。
 * 数据（刀5）：真实数据来自底座 em_daily_dragon_tiger（全市场龙虎榜，默认当天盘后；
 * 当日未发布自动回退最近有数据的交易日）。榜单行的买卖营业部明细由个股端点 em_dragon_tiger
 * 懒加载补充，并用 fundradarHotMoney 标签库匹配游资 / 机构标签；未命中显示营业部原名。
 * 取数失败 → 整页示例 + 顶部提示重试，页面不会崩。
 */
import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useAiPage } from "../../../core/ai/pageContext";
import { FrDataNotice } from "@/components/fundradar/FrDataNotice";
import { FrSkeleton, FrSkeletonCard, FrSkeletonList } from "@/components/fundradar/FrSkeleton";
import { FrChangePop, frStaggerDelay } from "@/components/fundradar/FrAnimatedNumber";
import { FrSourceFooter } from "@/components/fundradar/FrSourceFooter";
import { frDateLabel, loadLhbLive, useFrLoader, type FrLhbLive } from "@/lib/fundradarData";
import {
  FR_EMOTION, FR_LHB, FR_SUGGESTIONS, FR_YOUZI_SUMMARY, type FrLhbTag,
} from "@/data/fundradarSample";
import { frPctClass, frSigned } from "@/lib/fundradarTheme";
import { loadStockLhb, type FrLhbSeat, type FrLhbStock } from "@/lib/fundradarStock";
import { HOT_MONEY_SEAT_COUNT, seatTagOf } from "@/lib/fundradarHotMoney";

type Filter = "全部" | FrLhbTag;

const FILTERS: Filter[] = ["全部", "游资", "机构", "量化"];
const TAG_LABEL: Record<FrLhbTag, string> = {
  游资: "游资",
  机构: "机构",
  量化: "量化",
  北向: "北向",
};

/** 榜单行视图：示例数据带席位标签，真实数据没有标签（live=true） */
interface RowView {
  code: string;
  name: string;
  reason: string;
  net: number;
  chg: number | null;
  /** 交易所官方备源只给「成交金额」原值（主源无此字段） */
  amount?: string | null;
  live: boolean;
  tag?: FrLhbTag;
  seat?: string;
  seatNet?: number;
}

function SeatDetail({ row }: { row: { tag: FrLhbTag; seat: string; seatNet: number } }) {
  return (
    <div className="fr-body mt-2 rounded-btn border border-border bg-muted/50 p-4">
      <p className="fr-sub font-bold text-muted-foreground">买方前二席位（示例）：</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="fr-tag">{row.seat} · {TAG_LABEL[row.tag]}</span>
        <span className={`fr-body font-bold ${row.seatNet >= 0 ? "fr-up" : "fr-down"}`}>{frSigned(row.seatNet, "亿")}</span>
        <span className="fr-sub text-muted-foreground">卖方席位：营业部B -0.35亿</span>
      </div>
    </div>
  );
}

/** 真实席位一行：命中游资 / 机构 显示标签，否则显示营业部名；净额红绿 */
function LhbSeatRow({ seat }: { seat: FrLhbSeat }) {
  const tag = seatTagOf(seat.name);
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate">
        {tag ? (
          <span className="fr-tag">{tag.label}</span>
        ) : (
          <span className="fr-sub text-muted-foreground">{seat.name}</span>
        )}
      </span>
      <span className={`fr-sub shrink-0 font-bold ${frPctClass(seat.netWan)}`}>
        {seat.netWan >= 0 ? "+" : ""}{(seat.netWan / 10000).toFixed(2)}亿
      </span>
    </div>
  );
}

/** 真实榜单详情：懒加载个股 em_dragon_tiger 席位明细 + 游资标签 */
function LiveSeatDetail({ net, chg, lhb, loading }: { net: number; chg: number | null; lhb: FrLhbStock | null | undefined; loading: boolean }) {
  const buy = lhb?.seats.buy.slice(0, 5) ?? [];
  const sell = lhb?.seats.sell.slice(0, 5) ?? [];
  return (
    <div className="fr-body mt-2 rounded-btn border border-border bg-muted/50 p-4">
      <p className="fr-sub text-muted-foreground">
        真实榜单：净买额 {frSigned(net, "亿")}{chg != null ? `、当日涨跌幅 ${frSigned(chg, "%")}` : ""}。
      </p>
      {loading ? (
        <p className="fr-sub mt-2 text-muted-foreground">席位明细加载中…（个股龙虎榜）</p>
      ) : lhb == null ? (
        <p className="fr-sub mt-2 text-muted-foreground">席位明细暂不可得（个股龙虎榜取数失败或席位未开放）。</p>
      ) : buy.length === 0 && sell.length === 0 ? (
        <p className="fr-sub mt-2 text-muted-foreground">该股最近上榜暂无营业部席位明细。</p>
      ) : (
        <>
          <p className="fr-sub mt-2 font-bold text-muted-foreground">买卖营业部明细（最近一次上榜）</p>
          <div className="mt-1.5 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="fr-sub font-bold text-muted-foreground">买入席位</p>
              {buy.length === 0 ? <p className="fr-sub mt-1 text-muted-foreground">—</p> : (
                <div className="mt-1 space-y-1.5">{buy.map((s, i) => <LhbSeatRow key={`b-${s.name}-${i}`} seat={s} />)}</div>
              )}
            </div>
            <div>
              <p className="fr-sub font-bold text-muted-foreground">卖出席位</p>
              {sell.length === 0 ? <p className="fr-sub mt-1 text-muted-foreground">—</p> : (
                <div className="mt-1 space-y-1.5">{sell.map((s, i) => <LhbSeatRow key={`s-${s.name}-${i}`} seat={s} />)}</div>
              )}
            </div>
          </div>
          <p className="fr-sub mt-2 text-muted-foreground">游资标签为公开经验口径，非官方，仅供提示。</p>
        </>
      )}
    </div>
  );
}

export function FundradarLhb() {
  const { loading, live, failed, retry } = useFrLoader<FrLhbLive>(loadLhbLive);
  const [filter, setFilter] = useState<Filter>("全部");
  const [openCode, setOpenCode] = useState<string | null>(null);
  // 懒加载个股席位明细（em_dragon_tiger 需 symbol）：展开真实行时按代码取一次并缓存
  const [seatCache, setSeatCache] = useState<Record<string, FrLhbStock | null>>({});
  const [seatLoading, setSeatLoading] = useState<Record<string, boolean>>({});
  const seatInFlight = useRef<Set<string>>(new Set());

  const loadSeats = useCallback((code: string) => {
    if (seatInFlight.current.has(code) || seatCache[code] !== undefined) return;
    seatInFlight.current.add(code);
    setSeatLoading((s) => ({ ...s, [code]: true }));
    loadStockLhb(code, false)
      .then((lhb) => setSeatCache((s) => ({ ...s, [code]: lhb })))
      .catch(() => setSeatCache((s) => ({ ...s, [code]: null })))
      .finally(() => {
        seatInFlight.current.delete(code);
        setSeatLoading((s) => ({ ...s, [code]: false }));
      });
  }, [seatCache]);

  const rows: RowView[] = live
    ? live.rows.map((r) => ({ ...r, live: true }))
    : FR_LHB.map((r) => ({ ...r, chg: null, live: false }));
  const filtered = rows.filter((r) => filter === "全部" || (!r.live && r.tag === filter));
  const dataDate = live?.dataDate ?? "";

  const aiContext = !live
    ? `龙虎榜（示例数据）：今日 ${FR_LHB.length} 条示例上榜记录，含游资/机构/量化/北向席位标签与净买额；游资动向摘要：${FR_YOUZI_SUMMARY}`
    : live.backup
      ? `龙虎榜（交易所官方备源 ${dataDate}）：${live.rows.length} 条深交所上榜记录（成交金额 + 上榜原因，无净买额口径）；上交所全文（含营业部席位）见 raw。东财主源被封时自动降级到此源。`
      : `龙虎榜（真实数据 ${dataDate}）：${live.rows.length} 条上榜记录，净买入合计 +${live.summary.netBuyTotal} 亿、净卖出合计 -${live.summary.netSellTotal} 亿；净买最高 ${live.summary.topName} ${frSigned(live.summary.topNet, "亿")}。席位明细与游资标签已接入（展开行查看营业部席位）。`;

  useAiPage({
    key: "fundradar-lhb",
    title: "资金雷达 · 龙虎榜",
    context: aiContext,
    suggestions: FR_SUGGESTIONS,
  });

  // 首次加载（无数据）：整页骨架屏，替代「正在取数…」小字
  if (loading && !live) {
    return (
      <div data-fr-page="fundradar-lhb" className="fr-elder-page p-6">
        <div className="fr-fade-in mx-auto max-w-[1500px]">
          <span className="sr-only" role="status">正在加载龙虎榜…</span>

          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <FrSkeleton className="w-40 rounded-md" style={{ height: "calc(var(--fs-title) * 0.9)" }} />
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2].map((i) => (
                <FrSkeleton key={i} className="rounded-full" style={{ height: "calc(var(--fs-sub) * 1.7)", width: 104 }} />
              ))}
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {[0, 1, 2, 3].map((i) => (
              <FrSkeleton key={i} className="rounded-xl" style={{ height: "calc(var(--fs-sub) * 2.2)", width: 120 }} />
            ))}
          </div>

          <section aria-label="加载中" className="fr-glass rounded-xl">
            <FrSkeletonList rows={6} />
          </section>

          <section aria-label="加载中" className="fr-glass mt-4 rounded-xl p-5">
            <FrSkeletonCard lines={3} />
          </section>
        </div>
      </div>
    );
  }

  return (
    <div data-fr-page="fundradar-lhb" className="fr-elder-page p-6">
      <div className="fr-fade-in mx-auto max-w-[1500px]">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="fr-title font-bold">龙虎榜</h1>
            <p className="fr-sub text-muted-foreground">
              {live ? frDateLabel(dataDate) : "示例数据"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              live ? `数据日期 ${dataDate}` : "示例数据",
              `${FR_EMOTION.label} ${FR_EMOTION.lamp}`,
              `涨停 ${FR_EMOTION.ztTotal}`,
            ].map((t) => (
              <span key={t} className="fr-chip fr-sub">{t}</span>
            ))}
          </div>
        </div>

        <FrDataNotice loading={loading} missing={failed ? ["全部数据"] : []} onRetry={retry} />

        {/* 筛选大按钮 */}
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="榜单筛选">
          {FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
              className={`fr-btn-h fr-tap rounded-btn border px-6 font-bold transition-colors ${filter === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:border-primary/50"}`}>
              {f === "全部" ? "全部" : f}
            </button>
          ))}
        </div>

        {/* 今日榜单 */}
        <section aria-label="今日榜单" className="fr-glass rounded-xl">
          {filtered.map((r, i) => {
            const tagLabel = r.tag ? TAG_LABEL[r.tag] : null;
            const open = openCode === r.code;
            return (
              <div key={r.code} className="fr-stagger-in border-b border-border px-5 py-4 transition-colors last:border-b-0 hover:bg-muted/40" style={frStaggerDelay(i)}>
                <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2">
                  <Link to={`/stock/${r.code}`} title={`${r.name} · 点击进入个股详情`}
                    className="fr-body min-w-[150px] font-bold hover:text-primary">
                    {r.name} <span className="fr-sub font-normal text-muted-foreground">{r.code}</span>
                  </Link>
                  <button type="button" onClick={() => {
                    const next = open ? null : r.code;
                    setOpenCode(next);
                    if (next && r.live) loadSeats(next);
                  }}
                    aria-expanded={open} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 text-left">
                    <span className="fr-sub min-w-0 flex-1 text-muted-foreground">{r.reason}</span>
                    {live?.backup ? (
                      <span className="fr-sub font-bold text-muted-foreground">
                        {r.amount != null ? `成交额 ${r.amount}` : "成交额 —"}
                      </span>
                    ) : (
                      <>
                        <span className={`fr-body font-bold ${frPctClass(r.net)}`}>
                          净买 <FrChangePop value={r.net} className={frPctClass(r.net)}>{frSigned(r.net, "亿")}</FrChangePop>
                        </span>
                        {r.live && r.chg != null && (
                          <span className={`fr-sub font-bold ${frPctClass(r.chg)}`}>
                            <FrChangePop value={r.chg} className={frPctClass(r.chg)}>{frSigned(r.chg, "%")}</FrChangePop>
                          </span>
                        )}
                      </>
                    )}
                    {tagLabel && r.seat ? (
                      <span className="fr-tag">{tagLabel} · {r.seat}</span>
                    ) : (
                      <span className="fr-sub text-muted-foreground">席位 —</span>
                    )}
                    {open ? <ChevronUp className="h-6 w-6 text-muted-foreground" /> : <ChevronDown className="h-6 w-6 text-muted-foreground" />}
                  </button>
                  <Link to={`/stock/${r.code}`} className="fr-sub shrink-0 font-bold text-primary hover:underline">
                    个股详情 →
                  </Link>
                </div>
                {open && (r.live ? (
                  <LiveSeatDetail net={r.net} chg={r.chg} lhb={seatCache[r.code]} loading={Boolean(seatLoading[r.code])} />
                ) : r.tag && r.seat ? (
                  <SeatDetail row={{ tag: r.tag, seat: r.seat, seatNet: r.seatNet ?? 0 }} />
                ) : null)}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="fr-body px-5 py-10 text-muted-foreground">
              {live
                ? "真实榜单暂不支持按席位标签筛选（游资/机构标签在展开的席位明细里），请先看「全部」再展开各行查看。"
                : "该分类暂无记录。"}
            </div>
          )}
        </section>

        {/* 游资动向摘要 */}
        <section aria-label="游资动向摘要" className="fr-glass mt-4 rounded-xl p-5">
          <h2 className="fr-body mb-2 font-bold">今日知名游资动向（摘要）</h2>
          <p className="fr-body leading-relaxed">
            {!live
              ? FR_YOUZI_SUMMARY
              : live.backup
                ? `${frDateLabel(dataDate)}龙虎榜官方备源共 ${live.summary.count} 条深交所记录（成交金额 + 上榜原因，净买额不可得）；上交所全文含营业部席位见 raw。东财主源被封时自动降级到此源。`
                : `${frDateLabel(dataDate)}龙虎榜共 ${live.summary.count} 条记录：净买入合计 +${live.summary.netBuyTotal} 亿，净卖出合计 -${live.summary.netSellTotal} 亿；净买最高 ${live.summary.topName} ${frSigned(live.summary.topNet, "亿")}。席位明细与游资标签已接入（展开榜单行查看）。`}
          </p>
          <FrSourceFooter
            items={[
              `数据源：${live ? (live.backup ? "交易所官方备源（深交所结构化 + 上交所全文）" : "龙虎榜榜单 + 个股龙虎榜席位（真实）") : "示例数据"}`,
              `盘后数据（当日未发布则显示最近交易日）`,
              `标签库：自建「营业部→游资」映射（首批 ${HOT_MONEY_SEAT_COUNT} 个席位关键词，公开经验口径，非官方）`,
              "不构成投资建议",
            ]}
          />
        </section>
      </div>
    </div>
  );
}
