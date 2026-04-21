import * as vscode from "vscode";
import { StockConfigItem } from "../models/stock";
import { normalizeStockConfig, toConfigId } from "../utils/stockCode";

const CONFIG_KEY = "stockCodeList";
const DEFAULT_ITEM: StockConfigItem = { type: "stock", market: "sh", code: "000001" };

export class StockConfigService {
  private readonly config = vscode.workspace.getConfiguration("stockInvestment");

  async load(): Promise<{ items: StockConfigItem[]; migrated: boolean }> {
    const rawList = this.config.get<unknown[]>(CONFIG_KEY, []);
    const normalized: StockConfigItem[] = [];
    let shouldMigrate = false;

    for (const raw of rawList) {
      if (typeof raw === "string") {
        shouldMigrate = true;
      }
      const item = normalizeStockConfig(raw);
      if (item) {
        normalized.push(item);
      }
    }

    const finalItems = this.deduplicate(normalized);
    if (finalItems.length === 0) {
      finalItems.push(DEFAULT_ITEM);
    }

    if (shouldMigrate) {
      await this.persist(finalItems);
    }

    return { items: finalItems, migrated: shouldMigrate };
  }

  async add(item: StockConfigItem): Promise<void> {
    const { items } = await this.load();
    const id = toConfigId(item);
    if (items.some((it) => toConfigId(it) === id)) {
      throw new Error(`${id} 已存在`);
    }
    await this.persist([...items, item]);
  }

  async remove(configId: string): Promise<void> {
    const { items } = await this.load();
    await this.persist(items.filter((it) => toConfigId(it) !== configId));
  }

  async updateHolding(configId: string, shares: number, costPrice?: number): Promise<void> {
    const { items } = await this.load();
    const updated = items.map((it) => {
      if (toConfigId(it) !== configId || it.type !== "stock") {
        return it;
      }
      const next: StockConfigItem = {
        type: "stock",
        market: it.market,
        code: it.code,
        name: it.name,
      };
      if (shares > 0) {
        next.shares = shares;
      }
      if (costPrice !== undefined && costPrice > 0) {
        next.costPrice = costPrice;
      }
      return next;
    });
    await this.persist(updated);
  }

  private async persist(items: StockConfigItem[]): Promise<void> {
    await this.config.update(CONFIG_KEY, this.deduplicate(items), vscode.ConfigurationTarget.Global);
  }

  private deduplicate(items: StockConfigItem[]): StockConfigItem[] {
    const seen = new Set<string>();
    const result: StockConfigItem[] = [];

    for (const item of items) {
      const id = toConfigId(item);
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      result.push(item);
    }

    return result;
  }
}
