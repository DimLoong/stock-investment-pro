import { HoldingInfo, StockData } from "../models/stock";
import { compareIsoDateOnly, getTodayIsoDate, parseIsoDateOnly } from "./date";

export type DailyPnlMode =
  | "market"
  | "costToday"
  | "fallbackMissingPreviousClose"
  | "fallbackInvalidCostDate"
  | "fallbackFutureCostDate";

export interface DailyPnlResult {
  value: number;
  mode: DailyPnlMode;
}

export function computeHoldingProfitLoss(stockData: StockData, holding: HoldingInfo): number | null {
  const shares = normalizeShares(holding.shares);
  if (!shares) {
    return null;
  }

  const current = toFiniteNumber(stockData.current);
  const costPrice = toPositiveNumber(holding.costPrice);
  if (current === null || costPrice === null) {
    return null;
  }

  return (current - costPrice) * shares;
}

export function computeDailyProfitLoss(
  stockData: StockData,
  holding: HoldingInfo,
  options?: { todayIsoDate?: string; timeZone?: string }
): DailyPnlResult {
  const shares = normalizeShares(holding.shares);
  if (!shares) {
    return { value: 0, mode: "market" };
  }

  const current = toFiniteNumber(stockData.current);
  const previousClose = toFiniteNumber(stockData.previousClose);
  const change = toFiniteNumber(stockData.change);
  const marketChangePerShare =
    current !== null && previousClose !== null ? current - previousClose : change !== null ? change : 0;
  const marketResult = (mode: DailyPnlMode): DailyPnlResult => ({
    value: marketChangePerShare * shares,
    mode,
  });

  const costDate = parseIsoDateOnly(holding.costDate);
  if (!holding.costDate) {
    return marketResult(previousClose === null ? "fallbackMissingPreviousClose" : "market");
  }
  if (!costDate) {
    return marketResult("fallbackInvalidCostDate");
  }

  const todayIso = options?.todayIsoDate ?? getTodayIsoDate(options?.timeZone);
  const compare = compareIsoDateOnly(costDate.iso, todayIso);
  if (compare === null) {
    return marketResult("fallbackInvalidCostDate");
  }
  if (compare > 0) {
    return marketResult("fallbackFutureCostDate");
  }
  if (compare < 0) {
    return marketResult(previousClose === null ? "fallbackMissingPreviousClose" : "market");
  }

  const costPrice = toPositiveNumber(holding.costPrice);
  if (current === null || costPrice === null) {
    return marketResult(previousClose === null ? "fallbackMissingPreviousClose" : "market");
  }

  return {
    value: (current - costPrice) * shares,
    mode: "costToday",
  };
}

function toFiniteNumber(input: string | number | undefined): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : null;
  }
  if (typeof input !== "string") {
    return null;
  }

  const value = Number.parseFloat(input);
  return Number.isFinite(value) ? value : null;
}

function toPositiveNumber(input: number | undefined): number | null {
  if (!Number.isFinite(input) || input === undefined || input <= 0) {
    return null;
  }
  return input;
}

function normalizeShares(shares: number | undefined): number {
  if (typeof shares !== "number" || !Number.isInteger(shares) || shares <= 0) {
    return 0;
  }
  return shares;
}
