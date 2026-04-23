export type StockItemType = "stock" | "sector" | "index" | "future";
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
  costDate?: string;
}

export interface HoldingInfo {
  shares: number;
  costPrice?: number;
  costDate?: string;
}

export interface SummaryData {
  marketValue: number;
  floatingProfitLoss: number;
  dailyProfitLoss: number;
  updateTime: string;
  hasHoldings: boolean;
  hasFloatingProfitLoss: boolean;
}
