export type StockItemType = "stock" | "sector";
export type MarketType = "sz" | "sh" | "hk" | "us";

export interface StockData {
  code: string;
  name: string;
  current: string;
  change: string;
  changePercent: string;
  previousClose: string;
  updateTime: string;
}

export interface StockConfigItem {
  type: StockItemType;
  code: string;
  name?: string;
  market?: MarketType;
  shares?: number;
  costPrice?: number;
}

export interface HoldingInfo {
  shares: number;
  costPrice?: number;
}

export interface SummaryData {
  marketValue: number;
  dailyProfitLoss: number;
  updateTime: string;
  hasHoldings: boolean;
}
