import { HoldingInfo, MarketType, StockConfigItem } from "../models/stock";
import { parseIsoDateOnly } from "./date";

const MARKET_TO_API: Record<MarketType, string> = {
  sz: "0",
  sh: "1",
  hk: "116",
  us: "105",
};

const API_TO_MARKET: Record<string, MarketType> = {
  "0": "sz",
  "1": "sh",
  "105": "us",
  "106": "us",
  "107": "us",
  "116": "hk",
};

export function inferMarket(code: string): MarketType {
  const normalized = code.trim().toUpperCase();
  if (/^[A-Z]+[A-Z0-9.]*$/.test(normalized)) {
    return "us";
  }
  if (/^688\d{3}$/.test(normalized) || /^60\d{4}$/.test(normalized)) {
    return "sh";
  }
  if (/^(00|30)\d{4}$/.test(normalized)) {
    return "sz";
  }
  if (/^\d{5}$/.test(normalized)) {
    return "hk";
  }
  return "sh";
}

export function toConfigId(item: StockConfigItem): string {
  if (item.type === "sector") {
    return `sector:${item.code}`;
  }
  if (item.type === "index") {
    return `index:${item.code}`;
  }
  if (item.type === "future") {
    return `future:${item.code}`;
  }
  return `stock:${item.market}.${item.code}`;
}

export function toApiSecId(item: StockConfigItem): string {
  if (item.type === "sector") {
    return `90.${item.code}`;
  }
  if (item.type === "index" || item.type === "future") {
    return item.code;
  }
  const marketCode = item.market ? MARKET_TO_API[item.market] : "1";
  return `${marketCode}.${item.code}`;
}

export function fromApiSecId(secId: string): { market: MarketType; code: string } | null {
  const [marketCode, code] = secId.split(".");
  const market = API_TO_MARKET[marketCode];
  if (!market || !code) {
    return null;
  }
  return { market, code };
}

export function displayTag(item: StockConfigItem): string {
  if (item.type === "sector") {
    return " ［板块］";
  }
  if (item.type === "index") {
    return " ［指数］";
  }
  if (item.type === "future") {
    return " ［期货］";
  }
  switch (item.market) {
    case "hk":
      return " ［港］";
    case "us":
      return " ［美］";
    case "sz":
      return item.code.startsWith("3") ? " ［创］" : "";
    case "sh":
      return item.code.startsWith("688") ? " ［科］" : "";
    default:
      return "";
  }
}

function normalizeMarket(input?: string): MarketType | undefined {
  if (!input) {
    return undefined;
  }
  const value = input.trim().toLowerCase();
  if (["sz", "sh", "hk", "us"].includes(value)) {
    return value as MarketType;
  }
  return API_TO_MARKET[value];
}

export function parseUserStockInput(input: string): { market?: MarketType; code: string } | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const explicit = trimmed.match(/^([a-zA-Z0-9]+)\.([A-Za-z0-9]+)$/);
  if (explicit) {
    const market = normalizeMarket(explicit[1]);
    if (!market) {
      return null;
    }
    return { market, code: explicit[2].toUpperCase() };
  }

  return { code: trimmed.toUpperCase() };
}

export function parseLegacyStockString(input: string): StockConfigItem | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(":").map((part) => part.trim());
  const stockInput = parseUserStockInput(parts[0]);
  if (!stockInput) {
    return null;
  }

  const isLikelySector = /^88\d{4}$/.test(stockInput.code);
  const item: StockConfigItem = isLikelySector
    ? { type: "sector", code: stockInput.code }
    : {
        type: "stock",
        code: stockInput.code,
        market: stockInput.market ?? inferMarket(stockInput.code),
      };

  if (parts[1] !== undefined && parts[1] !== "" && item.type === "stock") {
    const shares = Number(parts[1]);
    if (!Number.isInteger(shares) || shares < 0) {
      return null;
    }
    if (shares > 0) {
      item.shares = shares;
    }
  }

  if (parts[2] !== undefined && parts[2] !== "" && item.type === "stock") {
    const costPrice = Number(parts[2]);
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      return null;
    }
    if (costPrice > 0) {
      item.costPrice = costPrice;
    }
  }

  return item;
}

export function normalizeStockConfig(raw: unknown): StockConfigItem | null {
  if (!raw) {
    return null;
  }

  if (typeof raw === "string") {
    return parseLegacyStockString(raw);
  }

  if (typeof raw !== "object") {
    return null;
  }

  const obj = raw as Record<string, unknown>;
  const type = String(obj.type ?? "stock").toLowerCase();
  const code = String(obj.code ?? "").trim().toUpperCase();
  if (!code) {
    return null;
  }

  if (type === "sector") {
    const order = Number(obj.order);
    return {
      type: "sector",
      code,
      name: obj.name ? String(obj.name).trim() : undefined,
      order: Number.isFinite(order) && order >= 0 ? Math.floor(order) : undefined,
    };
  }

  if (type === "index" || type === "future") {
    const order = Number(obj.order);
    return {
      type,
      code,
      name: obj.name ? String(obj.name).trim() : undefined,
      order: Number.isFinite(order) && order >= 0 ? Math.floor(order) : undefined,
    };
  }

  const market = normalizeMarket(obj.market ? String(obj.market) : undefined) ?? inferMarket(code);
  const order = Number(obj.order);
  const item: StockConfigItem = {
    type: "stock",
    market,
    code,
    name: obj.name ? String(obj.name).trim() : undefined,
    order: Number.isFinite(order) && order >= 0 ? Math.floor(order) : undefined,
  };

  if (obj.shares !== undefined && obj.shares !== null && obj.shares !== "") {
    const shares = Number(obj.shares);
    if (!Number.isInteger(shares) || shares < 0) {
      return null;
    }
    if (shares > 0) {
      item.shares = shares;
    }
  }

  if (obj.costPrice !== undefined && obj.costPrice !== null && obj.costPrice !== "") {
    const costPrice = Number(obj.costPrice);
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      return null;
    }
    if (costPrice > 0) {
      item.costPrice = costPrice;
    }
  }

  if (obj.costDate !== undefined && obj.costDate !== null && obj.costDate !== "") {
    const date = parseIsoDateOnly(String(obj.costDate));
    if (date) {
      item.costDate = date.iso;
    }
  }

  return item;
}

export function toHoldingMap(items: StockConfigItem[]): Map<string, HoldingInfo> {
  const map = new Map<string, HoldingInfo>();
  for (const item of items) {
    if (item.type !== "stock") {
      continue;
    }
    if (item.shares && item.shares > 0) {
      map.set(toConfigId(item), { shares: item.shares, costPrice: item.costPrice, costDate: item.costDate });
    }
  }
  return map;
}

export function marketQuickPickItems(): Array<{ label: string; value: MarketType }> {
  return [
    { label: "sh（上海）", value: "sh" },
    { label: "sz（深圳）", value: "sz" },
    { label: "hk（港股）", value: "hk" },
    { label: "us（美股）", value: "us" },
  ];
}
