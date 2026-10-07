/**
 * 资金雷达工作台 · 示例数据（刀3 前端演示用）
 * ------------------------------------------------------------
 * 数值与原型 v2.1/v2.6 保持一致，仅用于 UI 施工与联调。
 * TODO: 接入真实数据（刀4/测试阶段）—— 全部常量届时由
 *       数据服务（akshare/东财盘后批 + 本地 SQLite）替换。
 * 红线：所有数据仅为示例，不构成任何投资建议。
 */

/** 我的持仓：5 只科技链（详规 v0.2 §1.2 字段口径） */
export interface FrHolding {
  code: string;
  name: string;
  sector: string;
  price: number;   // 现价（元）
  chg: number;     // 涨跌幅 %
  pnl: number;     // 今日盈亏（元）
  flow: number;    // 主力净流入（亿元）
  cum: number;     // 累计盈亏 %
}

export const FR_HOLDINGS: FrHolding[] = [
  { code: "600183", name: "生益科技", sector: "PCB/覆铜板", price: 23.45, chg: 3.2, pnl: 1240, flow: 1.2, cum: 8.6 },
  { code: "300285", name: "国瓷材料", sector: "电子材料",   price: 31.20, chg: 1.1, pnl: 310,  flow: 0.3, cum: 2.4 },
  { code: "000938", name: "紫光股份", sector: "AI服务器",   price: 28.90, chg: 0.8, pnl: 180,  flow: -0.2, cum: 5.1 },
  { code: "000977", name: "浪潮信息", sector: "AI服务器",   price: 42.30, chg: 2.1, pnl: 890,  flow: 1.0, cum: -3.2 },
  { code: "002475", name: "立讯精密", sector: "消费电子",   price: 38.60, chg: -0.5, pnl: -210, flow: -0.6, cum: 12.3 },
];

/** 主线板块热度榜（原型 v2.6 同数值；热度 = 涨停×3 + 资金亿×2 + 高度×1） */
export interface FrHeatRow {
  name: string;
  zt: number;      // 涨停家数
  height: number;  // 最高连板
  flow: number;    // 资金净流入（亿元）
  hot: number;     // 热度分
  cover: boolean;  // 是否覆盖持仓
}

export const FR_HEAT_RANK: FrHeatRow[] = [
  { name: "PCB/覆铜板",   zt: 6, height: 4, flow: 8.2,  hot: 34.4, cover: true },
  { name: "AI服务器",     zt: 3, height: 2, flow: 5.1,  hot: 21.2, cover: true },
  { name: "机器人执行器", zt: 2, height: 1, flow: 4.4,  hot: 15.8, cover: false },
  { name: "卫星导航",     zt: 2, height: 1, flow: 3.9,  hot: 14.8, cover: false },
  { name: "消费电子",     zt: 2, height: 1, flow: 1.4,  hot: 9.8,  cover: true },
  { name: "半导体",       zt: 1, height: 1, flow: -0.8, hot: 4.2,  cover: false },
  { name: "光模块",       zt: 1, height: 1, flow: -1.2, hot: 2.6,  cover: false },
  { name: "存储",         zt: 0, height: 0, flow: -0.9, hot: -1.8, cover: false },
];

/** 涨停梯队（首板→5板+） */
export const FR_LADDER = [
  { t: "首板", n: 36 },
  { t: "2板", n: 9 },
  { t: "3板", n: 3 },
  { t: "4板", n: 2 },
  { t: "5板+", n: 2 },
];

/** 炸板池（示例 3 条 + 总数） */
export interface FrZhaRow { code: string; name: string; note: string; }
export const FR_ZHA_POOL: FrZhaRow[] = [
  { code: "300xxx", name: "某某科技", note: "触3板炸 14:32" },
  { code: "600xxx", name: "某某股份", note: "触2板炸 10:15" },
  { code: "002xxx", name: "某某电子", note: "触1板炸 09:47" },
];
export const FR_ZHA_TOTAL = 10;

/** 今日情绪（情绪档：偏暖 / 平稳 / 偏冷，不用红绿灯） */
export const FR_EMOTION = {
  lamp: "平稳",
  label: "情绪",
  ztTotal: 52,
  maxBoard: 5,
  zhaRate: "16%",
  coverCount: 3,
} as const;

/** 全球要闻（示例 4 条） */
export interface FrNews { src: string; tag: string; hot: boolean; title: string; }
export const FR_NEWS: FrNews[] = [
  { src: "财联社 7x24", tag: "财经", hot: true,  title: "央行开展 MLF 操作，利率维持不变，市场流动性预期平稳" },
  { src: "Reuters",     tag: "全球", hot: false, title: "美联储官员表态：通胀回落路径仍需更多数据确认" },
  { src: "东财全球",    tag: "股市", hot: true,  title: "美股三大指数收涨，科技股领涨，纳指涨 1.2%" },
  { src: "RSS 策展",    tag: "产业", hot: false, title: "欧盟芯片法案新一轮补贴落地，本土产能目标上调" },
];

/** Agent 对话建议问题（原型同款） */
export const FR_SUGGESTIONS = [
  "今天哪个方向最强？",
  "我的股今天资金是进是出？",
  "生益科技为什么涨停？",
  "大盘现在什么情绪？",
];

/** 首页五类功能卡（编号 01-05，原型 v2.6 同款） */
export interface FrFeature { title: string; detail: string; to: string; }
export interface FrFeatureGroup { title: string; detail: string; features: FrFeature[]; }

export const FR_FEATURE_GROUPS: FrFeatureGroup[] = [
  {
    title: "看主线", detail: "今天钱在哪个方向",
    features: [
      { title: "主线雷达", detail: "板块热度榜 · 涨停梯队 · 炸板池", to: "/radar" },
      { title: "次日关注清单", detail: "盘后自动生成的方向清单", to: "/daily-review" },
    ],
  },
  {
    title: "看资金", detail: "谁在买、谁在卖",
    features: [
      { title: "板块资金流", detail: "行业/概念资金净流入排名", to: "/radar" },
      { title: "龙虎榜席位", detail: "游资/机构/量化标签与动向", to: "/lhb" },
    ],
  },
  {
    title: "我的持仓", detail: "5 只科技链持仓",
    features: [
      { title: "持仓总览", detail: "今日盈亏 · 主力资金 · 累计", to: "/portfolio" },
      { title: "异常洞察", detail: "资金异动哨兵 · 大白话解读", to: "/portfolio" },
    ],
  },
  {
    title: "情报与晨报", detail: "每天听一遍就够",
    features: [
      { title: "今日晨报", detail: "08:30 自动生成 · 1分钟语音", to: "/daily-review" },
      { title: "盘后复盘", detail: "主线 · 游资 · 持仓吻合度", to: "/daily-review" },
    ],
  },
  {
    title: "设置", detail: "按自己的习惯用",
    features: [
      { title: "接入 AI", detail: "DeepSeek · 语音识别 · 提醒", to: "/settings" },
    ],
  },
];

/** 龙虎榜示例（详规 v0.2 §4：净买额红/绿，席位标签四色） */
export type FrLhbTag = "游资" | "机构" | "量化" | "北向";

export interface FrLhbRow {
  code: string;
  name: string;
  reason: string;   // 上榜原因
  net: number;      // 净买额（亿元）
  tag: FrLhbTag;    // 买方知名席位标签
  seat: string;     // 席位名
  seatNet: number;  // 席位买入额（亿元）
}

export const FR_LHB: FrLhbRow[] = [
  { code: "600183", name: "生益科技", reason: "日涨幅偏离值达 7%",          net: 1.24, tag: "游资", seat: "章盟主",   seatNet: 0.82 },
  { code: "000977", name: "浪潮信息", reason: "日换手率达 20%",            net: 0.96, tag: "机构", seat: "机构专用", seatNet: 0.61 },
  { code: "002475", name: "立讯精密", reason: "连续三日涨幅偏离 20%",       net: -0.35, tag: "量化", seat: "量化席位", seatNet: 0.21 },
  { code: "000938", name: "紫光股份", reason: "日振幅值达 15%",            net: 0.58, tag: "北向", seat: "北向资金", seatNet: 0.44 },
  { code: "300285", name: "国瓷材料", reason: "日涨幅偏离值达 7%",          net: 0.12, tag: "机构", seat: "机构专用", seatNet: 0.09 },
];

/** 游资动向摘要（详规 v0.2 §4.3，AI 生成摘要示例） */
export const FR_YOUZI_SUMMARY =
  "章盟主买入生益科技 +0.82亿；方新侠卖出光模块方向 -0.8亿；机构专用 3 席净买 AI服务器方向。";

/** 次日主线关注清单（详规 v0.2 §2.5 示例） */
export const FR_NEXT_FOCUS = [
  { name: "PCB/覆铜板", why: "连续 3 日资金净流入，今日 6 家涨停" },
  { name: "AI服务器", why: "连续 2 日净流入，3 家涨停，高度 2 板" },
  { name: "机器人执行器", why: "今日资金转正 +4.4 亿，首次进榜" },
];

/** 晨报正文（详规 v0.2 §5.1 精简版示例，约 1 分钟朗读） */
export const FR_MORNING_BRIEF = [
  { title: "盘面一句话", text: "今天大盘温度不高不低（温度中），涨停 52 家，最高 5 板，炸板率 16%。" },
  { title: "主线在哪", text: "钱主要集中在 PCB/覆铜板，6 家涨停、净流入 8.2 亿，覆盖您的持仓生益科技。" },
  { title: "要闻两则", text: "央行 MLF 利率维持不变，流动性预期平稳；美股三大指数收涨，纳指涨 1.2%。" },
];

/** 默认关注板块（详规 v0.2 §2.1 科技链 10 板块 + 兜底，设置页示例） */
export const FR_DEFAULT_SECTORS = [
  "PCB/覆铜板", "服务器/算力", "消费电子", "半导体", "CPO",
  "电子材料", "光模块", "存储", "AI应用", "机器人", "其他方向",
];

/** 免责声明（原型 v2.6 首页同款） */
export const FR_DISCLAIMER =
  "资金雷达仅基于公开市场数据提供信息解读，所有内容不构成任何投资建议。股市有风险，投资需谨慎。";
