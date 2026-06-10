export interface IntelAnalysis {
  summary: string;
  related_tickers: string[];
  portfolio_overlap: string[];
  impact_direction: "bullish" | "bearish" | "uncertain";
  urgency: "low" | "watch" | "alert";
  rationale: string;
}

export interface TickerSnapshot {
  baseline: number | null;
  current: number | null;
  since_pct: number | null;
  source: "quote" | "pending";
}

export interface TickerMeta {
  ticker: string;
  nameZh: string;
  sectorZh: string;
  subsectorZh: string;
}

export const TICKER_META: Record<string, TickerMeta> = {
  NVDA: { ticker: "NVDA", nameZh: "英伟达", sectorZh: "半导体", subsectorZh: "AI GPU / CUDA 生态" },
  AMD: { ticker: "AMD", nameZh: "超威半导体", sectorZh: "半导体", subsectorZh: "AI 加速器 / CPU" },
  ARM: { ticker: "ARM", nameZh: "Arm", sectorZh: "半导体 IP", subsectorZh: "CPU 架构授权 / 边缘 AI" },
  MRVL: { ticker: "MRVL", nameZh: "Marvell", sectorZh: "半导体", subsectorZh: "AI 网络 / ASIC / 光互连" },
  MU: { ticker: "MU", nameZh: "美光", sectorZh: "存储", subsectorZh: "DRAM / HBM" },
  NBIS: { ticker: "NBIS", nameZh: "Nebius", sectorZh: "AI 基建", subsectorZh: "云算力 / GPU 集群" },
  DRAM: { ticker: "DRAM", nameZh: "DRAM ETF", sectorZh: "存储", subsectorZh: "存储主题 ETF" },
  AVGO: { ticker: "AVGO", nameZh: "博通", sectorZh: "半导体", subsectorZh: "ASIC / 交换芯片 / 网络" },
  TSM: { ticker: "TSM", nameZh: "台积电", sectorZh: "半导体制造", subsectorZh: "先进制程 / 晶圆代工" },
  SMH: { ticker: "SMH", nameZh: "半导体 ETF", sectorZh: "ETF", subsectorZh: "美国半导体篮子" },
  QQQ: { ticker: "QQQ", nameZh: "纳指 ETF", sectorZh: "ETF", subsectorZh: "大型科技 / 成长股" },
  AAOI: { ticker: "AAOI", nameZh: "Applied Optoelectronics", sectorZh: "光通信", subsectorZh: "数据中心光模块" },
  INTC: { ticker: "INTC", nameZh: "英特尔", sectorZh: "半导体", subsectorZh: "晶圆代工 / CPU / 美国供应链" },
  LITE: { ticker: "LITE", nameZh: "Lumentum", sectorZh: "光通信", subsectorZh: "光器件 / 激光器" },
  COHR: { ticker: "COHR", nameZh: "Coherent", sectorZh: "光通信", subsectorZh: "光器件 / 材料" },
  FN: { ticker: "FN", nameZh: "Fabrinet", sectorZh: "电子制造", subsectorZh: "光通信代工" },
  JBL: { ticker: "JBL", nameZh: "捷普", sectorZh: "电子制造", subsectorZh: "AI 服务器供应链" },
  SMTC: { ticker: "SMTC", nameZh: "Semtech", sectorZh: "半导体", subsectorZh: "模拟 / 信号链" },
  SIVE: { ticker: "SIVE", nameZh: "Sivers Semiconductors", sectorZh: "光通信 / 射频", subsectorZh: "硅光激光器 / 毫米波" },
  SIVEF: { ticker: "SIVEF", nameZh: "Sivers Semiconductors ADR", sectorZh: "光通信 / 射频", subsectorZh: "硅光激光器 / 毫米波" },
  AXTI: { ticker: "AXTI", nameZh: "AXT", sectorZh: "半导体材料", subsectorZh: "磷化铟 / 砷化镓衬底" },
  SOI: { ticker: "SOI", nameZh: "Soitec", sectorZh: "半导体材料", subsectorZh: "SOI 晶圆 / 硅基材料" },
  IQE: { ticker: "IQE", nameZh: "IQE", sectorZh: "半导体材料", subsectorZh: "外延片 / 化合物半导体" },
  TSEM: { ticker: "TSEM", nameZh: "Tower Semiconductor", sectorZh: "半导体制造", subsectorZh: "模拟 / 硅光晶圆代工" },
  POET: { ticker: "POET", nameZh: "POET Technologies", sectorZh: "光通信", subsectorZh: "光引擎 / 光互连封装" },
  AEHR: { ticker: "AEHR", nameZh: "Aehr Test Systems", sectorZh: "半导体设备", subsectorZh: "晶圆级老化测试 / SiC" },
  RDDT: { ticker: "RDDT", nameZh: "Reddit", sectorZh: "互联网平台", subsectorZh: "社区平台 / AI 数据授权" },
  IREN: { ticker: "IREN", nameZh: "Iris Energy", sectorZh: "AI 基建", subsectorZh: "电力算力 / GPU 数据中心" },
  RPI: { ticker: "RPI", nameZh: "Raspberry Pi", sectorZh: "边缘计算", subsectorZh: "单板计算机 / 边缘 AI" },
  GFS: { ticker: "GFS", nameZh: "GlobalFoundries", sectorZh: "半导体制造", subsectorZh: "成熟制程 / 美国晶圆代工" },
  MTSI: { ticker: "MTSI", nameZh: "MACOM", sectorZh: "半导体", subsectorZh: "射频 / 光通信 / 数据中心" },
  SNDK: { ticker: "SNDK", nameZh: "SanDisk", sectorZh: "存储", subsectorZh: "NAND / 消费与企业存储" },
  LPK: { ticker: "LPK", nameZh: "LPKF Laser", sectorZh: "工业设备", subsectorZh: "激光加工 / 先进封装设备" },
  XFAB: { ticker: "XFAB", nameZh: "X-FAB", sectorZh: "半导体制造", subsectorZh: "模拟 / MEMS / SiC 代工" },
  LWLG: { ticker: "LWLG", nameZh: "Lightwave Logic", sectorZh: "光通信材料", subsectorZh: "电光聚合物调制器" },
  HIMX: { ticker: "HIMX", nameZh: "Himax", sectorZh: "半导体", subsectorZh: "显示驱动 / 边缘 AI" },
  FORM: { ticker: "FORM", nameZh: "FormFactor", sectorZh: "半导体设备", subsectorZh: "探针卡 / 测试接口" },
  VECO: { ticker: "VECO", nameZh: "Veeco", sectorZh: "半导体设备", subsectorZh: "外延 / 离子束 / 先进封装" },
  AMAT: { ticker: "AMAT", nameZh: "应用材料", sectorZh: "半导体设备", subsectorZh: "晶圆制造设备" },
  ASML: { ticker: "ASML", nameZh: "阿斯麦", sectorZh: "半导体设备", subsectorZh: "EUV / 光刻机" },
  AMZN: { ticker: "AMZN", nameZh: "亚马逊", sectorZh: "大型科技", subsectorZh: "AWS / 电商 / 物流自动化" },
  GOOGL: { ticker: "GOOGL", nameZh: "Alphabet", sectorZh: "大型科技", subsectorZh: "TPU / 搜索 / YouTube" },
  MSFT: { ticker: "MSFT", nameZh: "微软", sectorZh: "大型科技", subsectorZh: "Azure / AI 软件" },
  META: { ticker: "META", nameZh: "Meta", sectorZh: "大型科技", subsectorZh: "社交平台 / AI 基建" },
  AAPL: { ticker: "AAPL", nameZh: "苹果", sectorZh: "大型科技", subsectorZh: "消费电子 / 端侧 AI" },
  RKLB: { ticker: "RKLB", nameZh: "Rocket Lab", sectorZh: "航天", subsectorZh: "小型火箭 / 卫星制造" },
  HOOD: { ticker: "HOOD", nameZh: "Robinhood", sectorZh: "金融科技", subsectorZh: "零售券商 / 加密交易" },
  IBKR: { ticker: "IBKR", nameZh: "盈透证券", sectorZh: "金融科技", subsectorZh: "全球券商 / 交易基础设施" },
  CRCL: { ticker: "CRCL", nameZh: "Circle", sectorZh: "金融科技", subsectorZh: "稳定币 / 支付基础设施" },
  IBIT: { ticker: "IBIT", nameZh: "iShares Bitcoin Trust", sectorZh: "ETF", subsectorZh: "比特币现货 ETF" },
  EWY: { ticker: "EWY", nameZh: "韩国 ETF", sectorZh: "ETF", subsectorZh: "韩国半导体 / 存储周期" },
  HIMS: { ticker: "HIMS", nameZh: "Hims & Hers", sectorZh: "医疗消费", subsectorZh: "远程医疗 / DTC 药品" },
  TSLA: { ticker: "TSLA", nameZh: "特斯拉", sectorZh: "电动车 / AI", subsectorZh: "自动驾驶 / 机器人" },
  FLNC: { ticker: "FLNC", nameZh: "Fluence Energy", sectorZh: "新能源", subsectorZh: "储能系统 / 电网" },
  "HPS.A": { ticker: "HPS.A", nameZh: "Hammond Power", sectorZh: "电力设备", subsectorZh: "变压器 / 电网设备" },
  POWL: { ticker: "POWL", nameZh: "Powell Industries", sectorZh: "电力设备", subsectorZh: "开关柜 / 电气系统" },
  VPG: { ticker: "VPG", nameZh: "Vishay Precision", sectorZh: "传感器", subsectorZh: "精密传感 / 机器人" },
  MP: { ticker: "MP", nameZh: "MP Materials", sectorZh: "稀土材料", subsectorZh: "美国稀土 / 永磁供应链" },
  XLU: { ticker: "XLU", nameZh: "公用事业 ETF", sectorZh: "ETF", subsectorZh: "电力 / 公用事业" },
  GLW: { ticker: "GLW", nameZh: "康宁", sectorZh: "材料 / 光通信", subsectorZh: "光纤 / 玻璃材料" },
  ORCL: { ticker: "ORCL", nameZh: "甲骨文", sectorZh: "云计算", subsectorZh: "OCI / 企业数据库" },
  PLTR: { ticker: "PLTR", nameZh: "Palantir", sectorZh: "AI 软件", subsectorZh: "企业 AI / 政府数据平台" },
  SPY: { ticker: "SPY", nameZh: "标普 500 ETF", sectorZh: "ETF", subsectorZh: "美国大盘股" },
  INHD: { ticker: "INHD", nameZh: "Inno Holdings", sectorZh: "工业 / 建筑科技", subsectorZh: "轻钢结构 / 建筑材料" },
  ASX: { ticker: "ASX", nameZh: "日月光投控", sectorZh: "半导体封测", subsectorZh: "先进封装 / OSAT" },
  BESI: { ticker: "BESI", nameZh: "BE Semiconductor", sectorZh: "半导体设备", subsectorZh: "混合键合 / 先进封装设备" },
  IFNNY: { ticker: "IFNNY", nameZh: "英飞凌", sectorZh: "功率半导体", subsectorZh: "汽车 / 工业功率芯片" },
  ON: { ticker: "ON", nameZh: "安森美", sectorZh: "功率半导体", subsectorZh: "SiC / 汽车功率器件" },
  QCOM: { ticker: "QCOM", nameZh: "高通", sectorZh: "半导体", subsectorZh: "移动 SoC / 端侧 AI" },
  VICR: { ticker: "VICR", nameZh: "Vicor", sectorZh: "电源管理", subsectorZh: "高密度电源模块 / AI 服务器" },
  VSH: { ticker: "VSH", nameZh: "Vishay", sectorZh: "电子元件", subsectorZh: "分立器件 / 被动元件" },
  LFUS: { ticker: "LFUS", nameZh: "Littelfuse", sectorZh: "电子元件", subsectorZh: "电路保护 / 功率控制" },
  CRWV: { ticker: "CRWV", nameZh: "CoreWeave", sectorZh: "AI 基建", subsectorZh: "GPU 云 / AI 算力租赁" },
  CIFR: { ticker: "CIFR", nameZh: "Cipher Mining", sectorZh: "AI / 加密算力", subsectorZh: "电力资产 / HPC 转型" },
  COIN: { ticker: "COIN", nameZh: "Coinbase", sectorZh: "加密金融", subsectorZh: "加密交易所 / 托管" },
  ETHA: { ticker: "ETHA", nameZh: "iShares Ethereum Trust", sectorZh: "ETF", subsectorZh: "以太坊现货 ETF" },
  ENPH: { ticker: "ENPH", nameZh: "Enphase Energy", sectorZh: "新能源", subsectorZh: "微型逆变器 / 户储" },
  PL: { ticker: "PL", nameZh: "Planet Labs", sectorZh: "航天数据", subsectorZh: "卫星影像 / 地理空间数据" },
  "BRK.A": { ticker: "BRK.A", nameZh: "伯克希尔哈撒韦 A", sectorZh: "综合控股", subsectorZh: "保险 / 工业 / 投资组合" },
};

const WATCHLIST = Object.keys(TICKER_META);
const CURRENT_PORTFOLIO = ["AMD", "ARM", "MRVL", "MU", "NBIS", "NOK", "DRAM"];

const KEYWORD_MAP: Array<{ re: RegExp; tickers: string[]; reason: string }> = [
  { re: /\b(hbm|dram|memory|bandwidth)\b/i, tickers: ["MU", "DRAM", "NVDA", "AVGO"], reason: "存储 / HBM 瓶颈" },
  { re: /\b(blackwell|rubin|cuda|gpu|ai accelerator|ai chip)\b/i, tickers: ["NVDA", "AMD", "SMH"], reason: "AI 加速器路线图" },
  { re: /\b(ethernet|switch|networking|optics|optical|dsp)\b/i, tickers: ["MRVL", "AVGO", "AAOI", "LITE", "COHR", "FN"], reason: "AI 网络 / 光通信供应链" },
  { re: /\b(custom silicon|asic|xpu|hyperscaler)\b/i, tickers: ["AVGO", "MRVL", "NVDA", "AMD"], reason: "定制芯片 / 云厂商资本开支" },
  { re: /\b(export control|china|tariff|taiwan)\b/i, tickers: ["NVDA", "AMD", "MU", "SMH", "QQQ"], reason: "政策敏感半导体敞口" },
  { re: /\b(risc-v|arm)\b/i, tickers: ["ARM"], reason: "ARM / CPU 生态" },
];

function uniq(values: string[]) {
  return [...new Set(values.map((v) => v.toUpperCase()))].filter(Boolean);
}

function firstSentence(text: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 180) return cleaned;
  return `${cleaned.slice(0, 177)}...`;
}

export function analyzeIntelText(rawText: string): IntelAnalysis {
  const text = rawText.trim();
  const explicit = [...text.matchAll(/\$?\b([A-Z]{2,5})\b/g)]
    .map((m) => m[1])
    .filter((t) => WATCHLIST.includes(t));

  const reasons: string[] = [];
  const mapped: string[] = [];
  for (const item of KEYWORD_MAP) {
    if (item.re.test(text)) {
      mapped.push(...item.tickers);
      reasons.push(item.reason);
    }
  }

  const related = uniq([...explicit, ...mapped]);
  const overlap = related.filter((t) => CURRENT_PORTFOLIO.includes(t));
  const lower = text.toLowerCase();
  const bearish = /\b(shortage|delay|risk|ban|cut|weak|miss|down|problem|constraint)\b/.test(lower);
  const bullish = /\b(upside|beat|strong|growth|demand|accelerat|breakout|tight|bottleneck)\b/.test(lower);
  const urgency: IntelAnalysis["urgency"] =
    overlap.length >= 2 || /\b(alert|urgent|breaking|major)\b/i.test(text) ? "alert" :
    overlap.length > 0 || related.length > 0 ? "watch" : "low";

  return {
    summary: firstSentence(text),
    related_tickers: related,
    portfolio_overlap: overlap,
    impact_direction: bullish && !bearish ? "bullish" : bearish && !bullish ? "bearish" : "uncertain",
    urgency,
    rationale:
      reasons.length > 0
        ? `匹配到主题：${uniq(reasons).join("、")}。`
        : related.length > 0
          ? "匹配到正文中的明确 ticker。"
          : "暂未匹配到已配置 ticker 或供应链关键词。",
  };
}

export function emptyTickerSnapshot(tickers: string[]): Record<string, TickerSnapshot> {
  return Object.fromEntries(
    tickers.map((t) => [
      t,
      { baseline: null, current: null, since_pct: null, source: "pending" as const },
    ]),
  );
}
