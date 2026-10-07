/**
 * 资金雷达工作台 · 评分榜候选池（硬编码清单）
 * ------------------------------------------------------------
 * 候选池 = 4 个板块硬编码龙头清单（科技链 / 金融 / 新能源 / 医药，各约 40 只）
 *        + 自选（lib/fundradarWatchlist.ts 手动加，与持仓分开）
 *        + 手动加（自选输入框，落在 fr-watchlist）
 *
 * 说明：
 * - code/name 为静态兜底；批量评分时名称以行情端点（loadStockQuote 的
 *   security_name）返回为准，端点取不到时回退本清单里的名称。
 * - 清单只做「候选池」用途，不参与评分口径；评分完全复用
 *   lib/fundradarIndicators.ts 的 scoreComposite / reportLeaning。
 * - 红线：清单不构成任何投资建议，仅为筛选候选范围。
 */

export type ScorePoolSectorId = "tech" | "finance" | "newenergy" | "pharma";

export interface ScorePoolStock {
  /** 6 位 A 股代码 */
  code: string;
  /** 名称（兜底；行情端点可取到时以端点为准） */
  name: string;
}

export interface ScorePoolSector {
  id: ScorePoolSectorId;
  label: string;
  stocks: ScorePoolStock[];
}

export const SCORE_POOL_SECTORS: readonly ScorePoolSector[] = [
  {
    id: "tech",
    label: "科技链",
    stocks: [
      { code: "600183", name: "生益科技" },
      { code: "300285", name: "国瓷材料" },
      { code: "000938", name: "紫光股份" },
      { code: "000977", name: "浪潮信息" },
      { code: "002475", name: "立讯精密" },
      { code: "300308", name: "中际旭创" },
      { code: "002463", name: "沪电股份" },
      { code: "002916", name: "深南电路" },
      { code: "002371", name: "北方华创" },
      { code: "603501", name: "韦尔股份" },
      { code: "688981", name: "中芯国际" },
      { code: "688012", name: "中微公司" },
      { code: "688008", name: "澜起科技" },
      { code: "002049", name: "紫光国微" },
      { code: "603986", name: "兆易创新" },
      { code: "002415", name: "海康威视" },
      { code: "002236", name: "大华股份" },
      { code: "300782", name: "卓胜微" },
      { code: "300223", name: "北京君正" },
      { code: "688256", name: "寒武纪" },
      { code: "603160", name: "汇顶科技" },
      { code: "600584", name: "长电科技" },
      { code: "002185", name: "华天科技" },
      { code: "603005", name: "晶方科技" },
      { code: "688041", name: "海光信息" },
      { code: "002230", name: "科大讯飞" },
      { code: "688111", name: "金山办公" },
      { code: "300496", name: "中科创达" },
      { code: "000063", name: "中兴通讯" },
      { code: "600498", name: "烽火通信" },
      { code: "300502", name: "新易盛" },
      { code: "300394", name: "天孚通信" },
      { code: "601138", name: "工业富联" },
      { code: "002241", name: "歌尔股份" },
      { code: "002600", name: "领益智造" },
      { code: "300661", name: "圣邦股份" },
      { code: "688536", name: "思瑞浦" },
      { code: "300454", name: "深信服" },
      { code: "002920", name: "德赛西威" },
      { code: "688036", name: "传音控股" },
      { code: "300433", name: "蓝思科技" },
      { code: "002938", name: "鹏鼎控股" },
      { code: "600745", name: "闻泰科技" },
      { code: "603290", name: "斯达半导" },
      { code: "300373", name: "扬杰科技" },
    ],
  },
  {
    id: "finance",
    label: "金融",
    stocks: [
      { code: "600030", name: "中信证券" },
      { code: "601688", name: "华泰证券" },
      { code: "600837", name: "海通证券" },
      { code: "601211", name: "国泰君安" },
      { code: "600999", name: "招商证券" },
      { code: "601066", name: "中信建投" },
      { code: "000776", name: "广发证券" },
      { code: "600958", name: "东方证券" },
      { code: "601377", name: "兴业证券" },
      { code: "601788", name: "光大证券" },
      { code: "601108", name: "财通证券" },
      { code: "600109", name: "国金证券" },
      { code: "601995", name: "中金公司" },
      { code: "601881", name: "中国银河" },
      { code: "601555", name: "东吴证券" },
      { code: "300059", name: "东方财富" },
      { code: "601318", name: "中国平安" },
      { code: "601628", name: "中国人寿" },
      { code: "601601", name: "中国太保" },
      { code: "601319", name: "中国人保" },
      { code: "601336", name: "新华保险" },
      { code: "600036", name: "招商银行" },
      { code: "601398", name: "工商银行" },
      { code: "601288", name: "农业银行" },
      { code: "601939", name: "建设银行" },
      { code: "601988", name: "中国银行" },
      { code: "601328", name: "交通银行" },
      { code: "600016", name: "民生银行" },
      { code: "601166", name: "兴业银行" },
      { code: "600000", name: "浦发银行" },
      { code: "601818", name: "光大银行" },
      { code: "601998", name: "中信银行" },
      { code: "600015", name: "华夏银行" },
      { code: "601169", name: "北京银行" },
      { code: "601229", name: "上海银行" },
      { code: "601009", name: "南京银行" },
      { code: "002142", name: "宁波银行" },
      { code: "000001", name: "平安银行" },
      { code: "601838", name: "成都银行" },
      { code: "601658", name: "邮储银行" },
    ],
  },
  {
    id: "newenergy",
    label: "新能源",
    stocks: [
      { code: "300750", name: "宁德时代" },
      { code: "002594", name: "比亚迪" },
      { code: "300014", name: "亿纬锂能" },
      { code: "002460", name: "赣锋锂业" },
      { code: "002466", name: "天齐锂业" },
      { code: "002812", name: "恩捷股份" },
      { code: "300037", name: "新宙邦" },
      { code: "002709", name: "天赐材料" },
      { code: "300073", name: "当升科技" },
      { code: "688005", name: "容百科技" },
      { code: "300450", name: "先导智能" },
      { code: "002074", name: "国轩高科" },
      { code: "300568", name: "星源材质" },
      { code: "002850", name: "科达利" },
      { code: "603659", name: "璞泰来" },
      { code: "300769", name: "德方纳米" },
      { code: "002340", name: "格林美" },
      { code: "601012", name: "隆基绿能" },
      { code: "600438", name: "通威股份" },
      { code: "002459", name: "晶澳科技" },
      { code: "688599", name: "天合光能" },
      { code: "601865", name: "福莱特" },
      { code: "603806", name: "福斯特" },
      { code: "300274", name: "阳光电源" },
      { code: "002129", name: "TCL中环" },
      { code: "688223", name: "晶科能源" },
      { code: "300316", name: "晶盛机电" },
      { code: "300763", name: "锦浪科技" },
      { code: "605117", name: "德业股份" },
      { code: "300118", name: "东方日升" },
      { code: "300751", name: "迈为股份" },
      { code: "688390", name: "固德威" },
      { code: "600732", name: "爱旭股份" },
      { code: "603185", name: "弘元绿能" },
      { code: "600905", name: "三峡能源" },
      { code: "601615", name: "明阳智能" },
      { code: "002202", name: "金风科技" },
      { code: "600089", name: "特变电工" },
      { code: "300124", name: "汇川技术" },
      { code: "600522", name: "中天科技" },
      { code: "601877", name: "正泰电器" },
      { code: "002531", name: "天顺风能" },
      { code: "002176", name: "江特电机" },
    ],
  },
  {
    id: "pharma",
    label: "医药",
    stocks: [
      { code: "600276", name: "恒瑞医药" },
      { code: "688235", name: "百济神州" },
      { code: "688180", name: "君实生物" },
      { code: "688520", name: "神州细胞" },
      { code: "300558", name: "贝达药业" },
      { code: "600196", name: "复星医药" },
      { code: "300142", name: "沃森生物" },
      { code: "300122", name: "智飞生物" },
      { code: "300601", name: "康泰生物" },
      { code: "002007", name: "华兰生物" },
      { code: "600161", name: "天坛生物" },
      { code: "000661", name: "长春高新" },
      { code: "300347", name: "泰格医药" },
      { code: "603259", name: "药明康德" },
      { code: "300759", name: "康龙化成" },
      { code: "002821", name: "凯莱英" },
      { code: "300363", name: "博腾股份" },
      { code: "603456", name: "九洲药业" },
      { code: "300760", name: "迈瑞医疗" },
      { code: "688271", name: "联影医疗" },
      { code: "300003", name: "乐普医疗" },
      { code: "688029", name: "南微医学" },
      { code: "300529", name: "健帆生物" },
      { code: "300633", name: "开立医疗" },
      { code: "688016", name: "心脉医疗" },
      { code: "300595", name: "欧普康视" },
      { code: "603658", name: "安图生物" },
      { code: "300482", name: "万孚生物" },
      { code: "688050", name: "爱博医疗" },
      { code: "300015", name: "爱尔眼科" },
      { code: "600763", name: "通策医疗" },
      { code: "600085", name: "同仁堂" },
      { code: "600436", name: "片仔癀" },
      { code: "000538", name: "云南白药" },
      { code: "000423", name: "东阿阿胶" },
      { code: "600535", name: "天士力" },
      { code: "600867", name: "通化东宝" },
      { code: "603707", name: "健友股份" },
      { code: "688266", name: "泽璟制药" },
      { code: "688185", name: "康希诺" },
      { code: "300676", name: "华大基因" },
      { code: "688139", name: "海尔生物" },
    ],
  },
];

/** 板块 id → 板块对象（找不到返回 undefined）。 */
export function scorePoolSector(id: ScorePoolSectorId): ScorePoolSector | undefined {
  return SCORE_POOL_SECTORS.find((s) => s.id === id);
}

/** 板块清单里的总股票数（去重后按 code）。 */
export function scorePoolSize(): number {
  return new Set(SCORE_POOL_SECTORS.flatMap((s) => s.stocks.map((x) => x.code))).size;
}
