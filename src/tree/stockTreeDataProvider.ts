import * as vscode from "vscode";
import { StockApiService } from "../api/stockApiService";
import { StockConfigService } from "../config/stockConfigService";
import { HoldingInfo, StockConfigItem, StockData, SummaryData } from "../models/stock";
import { displayTag, toApiSecId, toConfigId, toHoldingMap } from "../utils/stockCode";
import { StockItem } from "./stockItem";

const DND_MIME = "application/vnd.code.tree.stockView";
const SUMMARY_MARKET_VALUE_ID = "summary:marketValue";
const SUMMARY_DAILY_PNL_ID = "summary:dailyProfitLoss";

export class StockTreeDataProvider
  implements vscode.TreeDataProvider<StockItem>, vscode.TreeDragAndDropController<StockItem>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  readonly dropMimeTypes = [DND_MIME];
  readonly dragMimeTypes = [DND_MIME];

  private stocksData = new Map<string, StockData>();
  private stockItems: StockConfigItem[] = [];
  private holdings = new Map<string, HoldingInfo>();
  private apiToConfigId = new Map<string, string>();
  private isLoading = true;
  private summary: SummaryData = {
    marketValue: 0,
    dailyProfitLoss: 0,
    updateTime: "--",
    hasHoldings: false,
  };

  constructor(
    private readonly configService: StockConfigService,
    private readonly apiService: StockApiService
  ) {}

  async initialize(): Promise<void> {
    await this.loadStockCodes();
    await this.fetchAllStockData();
  }

  getTreeItem(element: StockItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: StockItem): Thenable<StockItem[]> {
    if (!element) {
      return Promise.resolve(this.getRootItems());
    }
    if (element.configId === SUMMARY_MARKET_VALUE_ID) {
      return Promise.resolve(this.getHoldingMarketValueItems());
    }
    if (element.configId === SUMMARY_DAILY_PNL_ID) {
      return Promise.resolve(this.getHoldingDailyPnlItems());
    }
    if (element.isRoot && element.configId) {
      return Promise.resolve(this.getDetailItems(element.configId));
    }
    return Promise.resolve([]);
  }

  async handleDrag(
    source: readonly StockItem[],
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const configIds = source.filter((item) => this.isSortableRoot(item)).map((item) => item.configId!);
    if (configIds.length === 0) {
      return;
    }
    dataTransfer.set(DND_MIME, new vscode.DataTransferItem(JSON.stringify(configIds)));
  }

  async handleDrop(
    target: StockItem | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const transferItem = dataTransfer.get(DND_MIME);
    if (!transferItem) {
      return;
    }

    const raw = await transferItem.value;
    const payload = typeof raw === "string" ? raw : String(raw);
    let movingConfigIds: string[] = [];

    try {
      const parsed = JSON.parse(payload);
      if (Array.isArray(parsed)) {
        movingConfigIds = parsed.filter((id): id is string => typeof id === "string");
      }
    } catch {
      return;
    }

    const targetConfigId = this.isSortableRoot(target) ? target.configId : undefined;
    const insertAtStart = target?.contextValue === "summaryItem";
    const reorderedIds = this.buildReorderedIds(movingConfigIds, targetConfigId, insertAtStart);
    const currentIds = this.stockItems.map((item) => toConfigId(item));

    if (JSON.stringify(reorderedIds) === JSON.stringify(currentIds)) {
      return;
    }

    await this.configService.reorder(reorderedIds);
    await this.refresh();
  }

  async refresh(): Promise<void> {
    await this.loadStockCodes();
    await this.fetchAllStockData();
  }

  getConfiguredItem(configId: string): StockConfigItem | undefined {
    return this.stockItems.find((item) => toConfigId(item) === configId);
  }

  async addItem(item: StockConfigItem): Promise<void> {
    await this.configService.add(item);
    await this.refresh();
  }

  async addItems(items: StockConfigItem[]): Promise<{ added: number; skipped: number }> {
    const result = await this.configService.addMany(items);
    await this.refresh();
    return result;
  }

  async deleteItem(configId: string): Promise<void> {
    await this.configService.remove(configId);
    await this.refresh();
  }

  async updateHolding(configId: string, shares: number, costPrice?: number): Promise<void> {
    await this.configService.updateHolding(configId, shares, costPrice);
    await this.refresh();
  }

  private async loadStockCodes(): Promise<void> {
    const { items, migrated } = await this.configService.load();
    this.stockItems = items;
    this.holdings = toHoldingMap(items);
    if (migrated) {
      vscode.window.showInformationMessage("已自动将旧版股票配置迁移为 JSON 结构");
    }
  }

  private async fetchAllStockData(): Promise<void> {
    const stockRequestIds: string[] = [];
    const sectorCodes: string[] = [];
    this.apiToConfigId.clear();

    for (const item of this.stockItems) {
      if (item.type === "sector") {
        sectorCodes.push(item.code);
        continue;
      }

      const apiSecId = toApiSecId(item);
      stockRequestIds.push(apiSecId);
      this.apiToConfigId.set(apiSecId, toConfigId(item));
    }

    const updateTime = new Date().toLocaleTimeString("zh-CN");
    const [stockApiData, sectorApiData] = await Promise.all([
      stockRequestIds.length > 0
        ? this.apiService.fetchBatchStocks(stockRequestIds, updateTime)
        : Promise.resolve(new Map<string, StockData>()),
      sectorCodes.length > 0
        ? this.apiService.fetchBatchSectors(sectorCodes, updateTime)
        : Promise.resolve(new Map<string, StockData>()),
    ]);

    this.stocksData.clear();
    for (const [apiSecId, stockData] of stockApiData.entries()) {
      const configId = this.apiToConfigId.get(apiSecId);
      if (configId) {
        this.stocksData.set(configId, stockData);
      }
    }

    for (const [sectorCode, sectorData] of sectorApiData.entries()) {
      this.stocksData.set(`sector:${sectorCode}`, sectorData);
    }

    this.isLoading = false;
    this.summary = this.computeSummary(updateTime);
    this._onDidChangeTreeData.fire();
  }

  private getRootItems(): StockItem[] {
    const summaryItems = this.getSummaryItems();

    if (this.isLoading) {
      return [
        ...summaryItems,
        new StockItem(
          "行情列表",
          vscode.TreeItemCollapsibleState.None,
          "加载中...",
          new vscode.ThemeIcon("loading~spin")
        ),
      ];
    }

    const stockRows = this.stockItems.map((config) => {
      const configId = toConfigId(config);
      const stockData = this.stocksData.get(configId);

      if (!stockData) {
        return new StockItem(
          config.name ?? config.code,
          vscode.TreeItemCollapsibleState.Collapsed,
          "加载失败",
          new vscode.ThemeIcon("error"),
          configId,
          config.type,
          true
        );
      }

      const changeNum = Number.parseFloat(stockData.change);
      const arrow = changeNum >= 0 ? "↑" : "↓";
      const color =
        changeNum > 0
          ? new vscode.ThemeColor("charts.red")
          : changeNum < 0
            ? new vscode.ThemeColor("charts.green")
            : new vscode.ThemeColor("disabledForeground");

      return new StockItem(
        config.name ?? stockData.name,
        vscode.TreeItemCollapsibleState.Collapsed,
        `${stockData.current} ${arrow} ${stockData.changePercent}%${displayTag(config)}`,
        new vscode.ThemeIcon("circle-filled", color),
        configId,
        config.type,
        true
      );
    });

    return [...summaryItems, ...stockRows];
  }

  private getSummaryItems(): StockItem[] {
    const marketValueText = this.summary.hasHoldings ? this.summary.marketValue.toFixed(2) : "--";
    const dailyProfitLossText = this.summary.hasHoldings
      ? this.summary.dailyProfitLoss >= 0
        ? `+${this.summary.dailyProfitLoss.toFixed(2)}`
        : this.summary.dailyProfitLoss.toFixed(2)
      : "--";

    return [
      new StockItem(
        "持仓市值",
        vscode.TreeItemCollapsibleState.Collapsed,
        marketValueText,
        new vscode.ThemeIcon("graph", new vscode.ThemeColor("charts.blue")),
        SUMMARY_MARKET_VALUE_ID,
        undefined,
        false,
        "summaryItem"
      ),
      new StockItem(
        "今日盈亏",
        vscode.TreeItemCollapsibleState.Collapsed,
        dailyProfitLossText,
        new vscode.ThemeIcon(
          this.summary.dailyProfitLoss >= 0 ? "arrow-up" : "arrow-down",
          new vscode.ThemeColor(this.summary.dailyProfitLoss >= 0 ? "charts.red" : "charts.green")
        ),
        SUMMARY_DAILY_PNL_ID,
        undefined,
        false,
        "summaryItem"
      ),
      new StockItem(
        "更新时间",
        vscode.TreeItemCollapsibleState.None,
        this.summary.updateTime || "--",
        new vscode.ThemeIcon("clock"),
        undefined,
        undefined,
        false,
        "summaryItem"
      ),
    ];
  }

  private getHoldingMarketValueItems(): StockItem[] {
    const items: StockItem[] = [];

    for (const [configId, holding] of this.holdings.entries()) {
      const stockData = this.stocksData.get(configId);
      const config = this.getConfiguredItem(configId);
      if (!stockData || !config || holding.shares <= 0) {
        continue;
      }

      const currentPrice = Number.parseFloat(stockData.current);
      const marketValue = currentPrice * holding.shares;
      items.push(
        new StockItem(
          config.name ?? stockData.name ?? config.code,
          vscode.TreeItemCollapsibleState.None,
          `${marketValue.toFixed(2)} (${holding.shares}股)`,
          new vscode.ThemeIcon("symbol-number", new vscode.ThemeColor("charts.blue")),
          configId,
          "stock",
          false,
          "stockHolding"
        )
      );
    }

    if (items.length === 0) {
      return [
        new StockItem(
          "暂无持仓",
          vscode.TreeItemCollapsibleState.None,
          "--",
          new vscode.ThemeIcon("info")
        ),
      ];
    }

    return items;
  }

  private getHoldingDailyPnlItems(): StockItem[] {
    const items: StockItem[] = [];

    for (const [configId, holding] of this.holdings.entries()) {
      const stockData = this.stocksData.get(configId);
      const config = this.getConfiguredItem(configId);
      if (!stockData || !config || holding.shares <= 0) {
        continue;
      }

      const change = Number.parseFloat(stockData.change);
      const dailyPnl = change * holding.shares;
      const isUp = dailyPnl >= 0;
      items.push(
        new StockItem(
          config.name ?? stockData.name ?? config.code,
          vscode.TreeItemCollapsibleState.None,
          isUp ? `+${dailyPnl.toFixed(2)}` : dailyPnl.toFixed(2),
          new vscode.ThemeIcon(
            isUp ? "arrow-up" : "arrow-down",
            new vscode.ThemeColor(isUp ? "charts.red" : "charts.green")
          ),
          configId,
          "stock",
          false,
          "stockHolding"
        )
      );
    }

    if (items.length === 0) {
      return [
        new StockItem(
          "暂无持仓",
          vscode.TreeItemCollapsibleState.None,
          "--",
          new vscode.ThemeIcon("info")
        ),
      ];
    }

    return items;
  }

  private getDetailItems(configId: string): StockItem[] {
    const config = this.getConfiguredItem(configId);
    const stockData = this.stocksData.get(configId);
    if (!config || !stockData) {
      return [];
    }

    const changeNum = Number.parseFloat(stockData.change);
    const isUp = changeNum >= 0;

    const items: StockItem[] = [
      new StockItem(
        "昨日收盘",
        vscode.TreeItemCollapsibleState.None,
        stockData.previousClose,
        new vscode.ThemeIcon("symbol-number", new vscode.ThemeColor("charts.blue"))
      ),
      new StockItem(
        "涨跌点数",
        vscode.TreeItemCollapsibleState.None,
        `${isUp ? "↑" : "↓"} ${stockData.change}`,
        new vscode.ThemeIcon(
          isUp ? "arrow-up" : "arrow-down",
          new vscode.ThemeColor(isUp ? "charts.red" : "charts.green")
        )
      ),
    ];

    if (config.type !== "stock") {
      return items;
    }

    const holding = this.holdings.get(configId);
    if (holding?.shares && holding.shares > 0) {
      items.push(
        new StockItem(
          "持有股数",
          vscode.TreeItemCollapsibleState.None,
          `${holding.shares}`,
          new vscode.ThemeIcon("database", new vscode.ThemeColor("charts.purple"))
        )
      );

      if (holding.costPrice && holding.costPrice > 0) {
        items.push(
          new StockItem(
            "成本价",
            vscode.TreeItemCollapsibleState.None,
            holding.costPrice.toFixed(2),
            new vscode.ThemeIcon("symbol-numeric", new vscode.ThemeColor("charts.yellow"))
          )
        );

        const floatingPnL =
          (Number.parseFloat(stockData.current) - holding.costPrice) * holding.shares;
        items.push(
          new StockItem(
            "持仓盈亏",
            vscode.TreeItemCollapsibleState.None,
            floatingPnL >= 0 ? `+${floatingPnL.toFixed(2)}` : floatingPnL.toFixed(2),
            new vscode.ThemeIcon(
              floatingPnL >= 0 ? "arrow-up" : "arrow-down",
              new vscode.ThemeColor(floatingPnL >= 0 ? "charts.red" : "charts.green")
            )
          )
        );
      }

      const dailyPnL = changeNum * holding.shares;
      items.push(
        new StockItem(
          "今日盈亏",
          vscode.TreeItemCollapsibleState.None,
          dailyPnL >= 0 ? `+${dailyPnL.toFixed(2)}` : dailyPnL.toFixed(2),
          new vscode.ThemeIcon(
            dailyPnL >= 0 ? "arrow-up" : "arrow-down",
            new vscode.ThemeColor(dailyPnL >= 0 ? "charts.red" : "charts.green")
          )
        )
      );
    }

    return items;
  }

  private computeSummary(updateTime: string): SummaryData {
    let marketValue = 0;
    let dailyProfitLoss = 0;
    let hasHoldings = false;

    for (const [configId, holding] of this.holdings.entries()) {
      const stockData = this.stocksData.get(configId);
      if (!stockData) {
        continue;
      }
      hasHoldings = true;
      const currentPrice = Number.parseFloat(stockData.current);
      const change = Number.parseFloat(stockData.change);
      marketValue += currentPrice * holding.shares;
      dailyProfitLoss += change * holding.shares;
    }

    return { marketValue, dailyProfitLoss, updateTime, hasHoldings };
  }

  private isSortableRoot(item: StockItem | undefined): item is StockItem {
    return Boolean(item?.isRoot && item.configId);
  }

  private buildReorderedIds(
    movingConfigIds: string[],
    targetConfigId?: string,
    insertAtStart: boolean = false
  ): string[] {
    const currentIds = this.stockItems.map((item) => toConfigId(item));
    const existing = new Set(currentIds);

    const moving = movingConfigIds.filter((id, index) => existing.has(id) && movingConfigIds.indexOf(id) === index);
    if (moving.length === 0) {
      return currentIds;
    }

    const remaining = currentIds.filter((id) => !moving.includes(id));
    const insertAt = insertAtStart
      ? 0
      : targetConfigId
        ? Math.max(remaining.indexOf(targetConfigId), 0)
        : remaining.length;

    return [...remaining.slice(0, insertAt), ...moving, ...remaining.slice(insertAt)];
  }
}
