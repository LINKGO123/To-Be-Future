/**
 * 资金雷达工作台 · 世界股票指数卡（单张）
 * ------------------------------------------------------------
 * 单张指数小卡：指数名 + 现价 + 当日涨跌 + 三个副指标（近5日 / YTD / 近20日）。
 * 红涨绿跌走 fr-up / fr-down / fr-flat；无 emoji、DSH 风（蓝主色 + 中性灰）。
 * 日经225 / 韩国KOSPI 现价+当日涨跌走新浪全球指数代理，历史涨跌无源 → 副指标显示「—」。
 * 指数暂无可下钻页面 → 卡片不可点（任务约定「指数暂不可下钻则去掉点击」）。
 */
import { cn } from "@/lib/utils";
import { frPctClass } from "@/lib/fundradarTheme";
import type { FrWorldIndex, FrWorldMarket } from "@/lib/fundradarWorldIndex";

/** 市场短标（大字清晰，不用图标猜） */
const MARKET_LABEL: Record<FrWorldMarket, string> = {
  CN: "A股",
  US: "美股",
  HK: "港股",
  JP: "日股",
  KR: "韩股",
};

/** 带正负号的两位小数百分比文案；null →「—」 */
function pctText(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

/** 现价文案（源单位两位小数）；null →「—」 */
function priceText(v: number | null): string {
  return v == null ? "—" : v.toFixed(2);
}

/** 副指标单格：标签 + 值（红涨绿跌） */
function SubMetric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="min-w-0 text-center">
      <p className="fr-sub text-muted-foreground">{label}</p>
      <p className={cn("fr-sub mt-0.5 font-bold tabular-nums", frPctClass(value))}>{pctText(value)}</p>
    </div>
  );
}

export function FrWorldIndexCard({ idx }: { idx: FrWorldIndex }) {
  const marketTag = MARKET_LABEL[idx.market] ?? "";

  return (
    <div
      className="fr-glass w-56 shrink-0 rounded-xl p-4"
      title={`${idx.name} · 现价 ${priceText(idx.price)} · 当日 ${pctText(idx.chg)}`}
      aria-label={`${idx.name} 现价 ${priceText(idx.price)} 当日 ${pctText(idx.chg)}`}
    >
      {/* 指数名 + 市场短标 */}
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="fr-body min-w-0 truncate font-bold">{idx.name}</h3>
        {marketTag && <span className="fr-sub shrink-0 rounded bg-primary-subtle px-1.5 py-0.5 font-semibold text-primary">{marketTag}</span>}
      </div>

      {/* 现价 + 当日涨跌 */}
      <p className="fr-num mt-2 tabular-nums">{priceText(idx.price)}</p>
      <p className={cn("fr-body mt-0.5 font-bold tabular-nums", frPctClass(idx.chg))}>{pctText(idx.chg)}</p>

      {/* 三个副指标：近5日 / YTD / 近20日 */}
      <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-border pt-3">
        <SubMetric label="近5日" value={idx.chg5} />
        <SubMetric label="YTD" value={idx.ytd} />
        <SubMetric label="近20日" value={idx.chg20} />
      </div>
    </div>
  );
}
