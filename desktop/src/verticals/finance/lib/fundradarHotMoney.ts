/**
 * 资金雷达工作台 · 知名游资席位标签库
 * ------------------------------------------------------------
 * 席位-游资映射为公开经验口径，非官方，仅供提示（不构成任何投资建议）。
 *
 * 数据来源：东财龙虎榜个股端点 em_dragon_tiger 的 extra.seats（买方/卖方营业部明细），
 * 营业部名形如「国泰君安证券股份有限公司上海江苏路证券营业部」。本库只做「营业部名
 * 含关键词 → 游资昵称」的子串匹配，命中后由页面显示「游资昵称」文字标签；机构专用席位
 * 单独识别为「机构」，其余显示营业部原名。
 *
 * 匹配前会先做一次规范化（去空格、去「股份有限公司/有限责任公司/有限公司/证券营业部」），
 * 让关键词能对齐不同券商的正式全称写法；关键词按公开常见口径收录，不同来源对同一
 * 游资的席位说法可能不同，仅作提示，不作为任何交易依据。
 */

/** 一条「营业部关键词 → 游资昵称」映射（同一游资可挂多个席位） */
export interface HotMoneySeat {
  /** 游资昵称（界面显示） */
  nickname: string;
  /** 营业部名称关键词（规范化后子串匹配，含任一关键词即命中） */
  keywords: string[];
}

/**
 * 知名游资席位（公开经验口径，非官方，仅供提示）
 * ------------------------------------------------------------
 * 覆盖 A 股公开常见口径的顶级/一线/新生代游资、老牌席位昵称、量化/散户席位。
 * 数据整理自东财/同花顺/淘股吧等公开龙虎榜游资席位对照口径，仅作提示，
 * 不同来源对同一游资的席位说法可能不同，不作为任何交易依据。
 */
export const HOT_MONEY_SEATS: readonly HotMoneySeat[] = [
  // ── 顶级游资（个人）──────────────────────────────
  { nickname: "章盟主", keywords: ["国泰君安证券上海江苏路", "国泰君安证券上海海阳西路", "海通证券上海建国西路", "中信证券杭州四季路", "中信证券杭州延安路"] },
  { nickname: "炒股养家", keywords: ["华鑫证券上海宛平南路", "华鑫证券上海茅台路", "华鑫证券上海淞滨路", "华鑫证券上海红宝石路"] },
  { nickname: "赵老哥", keywords: ["中国银河证券绍兴", "中国银河证券杭州庆春路", "浙商证券绍兴"] },
  { nickname: "孙哥", keywords: ["光大证券深圳金田路", "中信证券上海溧阳路", "中信证券上海淮海中路", "光大证券杭州庆春路"] },
  { nickname: "方新侠", keywords: ["兴业证券陕西分公司", "中信证券西安朱雀大街", "国投证券西安曲江池南路"] },
  { nickname: "作手新一", keywords: ["国泰君安证券南京太平南路", "国泰君安证券南京金融城"] },
  { nickname: "小鳄鱼", keywords: ["南京证券南京大钟亭", "华泰证券上海武定路"] },
  { nickname: "陈小群", keywords: ["中国银河证券大连黄河路", "中国银河证券大连金马路", "东亚前海证券苏州留园路"] },
  { nickname: "消闲派", keywords: ["国泰君安证券宜昌沿江大道", "国泰君安证券宜昌珍珠路"] },
  { nickname: "佛山系", keywords: ["光大证券佛山绿景路", "光大证券佛山季华六路", "中信证券佛山桂澜中路", "国泰君安证券三亚迎宾路"] },
  { nickname: "著名刺客", keywords: ["海通证券北京阜外大街", "东莞证券北京分公司"] },
  { nickname: "宁波桑田路", keywords: ["国盛证券宁波桑田路"] },
  { nickname: "呼家楼", keywords: ["中信建投证券北京呼家楼", "中信证券北京呼家楼", "中信证券上海凯滨路", "中信建投证券北京中信大厦"] },
  { nickname: "深南哥", keywords: ["国泰君安证券深圳益田路", "申万宏源证券深圳金田路", "中天证券台州市府大道"] },
  { nickname: "欢乐海岸", keywords: ["华泰证券深圳益田路荣超", "中泰证券深圳欢乐海岸"] },

  // ── 一线 / 新生代游资 ────────────────────────────
  { nickname: "六一中路", keywords: ["招商证券福州六一中路", "华泰证券天津东丽开发区二纬路"] },
  { nickname: "92科比", keywords: ["国泰君安证券泰州鼓楼南路", "兴业证券南京天元东路"] },
  { nickname: "上塘路", keywords: ["财通证券杭州上塘路", "财通证券杭州体育馆路"] },
  { nickname: "思明南路", keywords: ["东莞证券湖北分公司", "东亚前海证券上海分公司"] },
  { nickname: "腾得系", keywords: ["东吴证券苏州干将东路", "湘财证券杭州五星路"] },
  { nickname: "余哥", keywords: ["财通证券普陀山", "申港证券湖北分公司"] },
  { nickname: "毛老板", keywords: ["方正证券乐山龙游路", "广发证券上海东方路"] },
  { nickname: "一瞬流光", keywords: ["中泰证券湖北分公司"] },
  { nickname: "乔帮主", keywords: ["招商证券深圳蛇口工业七路", "招商证券深圳蛇口工业三路"] },
  { nickname: "敢死队", keywords: ["光大证券宁波解放南路", "中国银河证券宁波解放南路"] },
  { nickname: "成都帮", keywords: ["国泰君安证券成都北一环路", "华泰证券成都蜀金路"] },
  { nickname: "北京炒家", keywords: ["长城证券绵阳飞云大道"] },
  { nickname: "西湖国贸", keywords: ["财信证券杭州西湖国贸中心"] },
  { nickname: "东北猛男", keywords: ["广发证券辽阳民主路"] },
  { nickname: "ASKing", keywords: ["兴业证券福州湖东路"] },
  { nickname: "落升", keywords: ["光大证券金华宾虹路"] },
  { nickname: "王海祥", keywords: ["财通证券绍兴人民中路"] },
  { nickname: "徐柏良", keywords: ["东方证券上海肇嘉浜路"] },
  { nickname: "徐晓", keywords: ["国元证券上海虹桥路"] },
  { nickname: "歌神", keywords: ["中信证券杭州金城路", "中信证券杭州市心南路", "兴业证券杭州体育场路"] },
  { nickname: "流沙河", keywords: ["招商证券北京车公庄西路", "中信证券北京远大路"] },
  { nickname: "瑞鹤仙", keywords: ["中信建投证券宜昌解放路", "中国银河证券宜昌新世纪"] },
  { nickname: "葛老大", keywords: ["国泰君安证券上海分公司"] },
  { nickname: "上海超短帮", keywords: ["东方证券上海浦东新区银城中路", "国泰君安证券上海新闸路"] },

  // ── 老牌 / 顶级席位昵称 ──────────────────────────
  { nickname: "中信上海分公司", keywords: ["中信证券上海分公司"] },
  { nickname: "招商益田路", keywords: ["招商证券深圳益田路"] },
  { nickname: "国信振华路", keywords: ["国信证券深圳振华路"] },
  { nickname: "红岭中路", keywords: ["国信证券深圳红岭中路"] },
  { nickname: "泰然九路", keywords: ["国信证券深圳泰然九路"] },
  { nickname: "世纪大道", keywords: ["招商证券上海世纪大道"] },
  { nickname: "源深路", keywords: ["东方证券上海浦东新区源深路"] },
  { nickname: "零陵路", keywords: ["平安证券上海零陵路"] },
  { nickname: "环球金融中心", keywords: ["中信证券上海环球金融中心"] },
  { nickname: "厦门帮", keywords: ["华泰证券厦门厦禾路"] },
  { nickname: "国金上海分公司", keywords: ["国金证券上海互联网证券分公司"] },

  // ── 量化 / 散户席位 ─────────────────────────────
  { nickname: "量化席", keywords: ["华鑫证券上海分公司", "中泰证券上海花园石桥路", "华泰证券总部", "中国国际金融上海黄浦区湖滨路"] },
  { nickname: "拉萨天团", keywords: ["东方财富证券拉萨团结路第一", "东方财富证券拉萨团结路第二", "东方财富证券拉萨东环路第一", "东方财富证券拉萨东环路第二"] },
];

/** 映射的总条数（营业部关键词条数，验收用） */
export const HOT_MONEY_SEAT_COUNT = HOT_MONEY_SEATS.reduce((n, s) => n + s.keywords.length, 0);

/** 规范化营业部名：去空格（含全角）、去公司/营业部后缀，对齐关键词写法 */
function normalizeBranch(name: string): string {
  return name
    .replace(/[\s\u3000]/g, "")
    .replace(/股份有限公司|有限责任公司|有限公司/g, "")
    .replace(/证券营业部/g, "");
}

/**
 * 营业部名 → 游资昵称匹配。
 * @returns 命中的游资昵称；未命中返回 null。
 */
export function matchHotMoney(branchName: string | null | undefined): string | null {
  if (!branchName) return null;
  const n = normalizeBranch(branchName);
  if (!n) return null;
  for (const seat of HOT_MONEY_SEATS) {
    for (const kw of seat.keywords) {
      if (n.includes(normalizeBranch(kw))) return seat.nickname;
    }
  }
  return null;
}

/** 是否机构专用席位（东财龙虎榜「机构专用」） */
export function isInstitutionSeat(branchName: string | null | undefined): boolean {
  return typeof branchName === "string" && branchName.includes("机构专用");
}

/**
 * 席位展示标签：命中游资 → 昵称；机构专用 → 机构；否则 null（由调用方回退显示营业部原名）。
 * 金额红绿由调用方按 buyWan/sellWan/netWan 正负自行着色。
 */
export function seatTagOf(branchName: string | null | undefined): { label: string; hot: boolean } | null {
  const hot = matchHotMoney(branchName);
  if (hot) return { label: hot, hot: true };
  if (isInstitutionSeat(branchName)) return { label: "机构", hot: false };
  return null;
}
