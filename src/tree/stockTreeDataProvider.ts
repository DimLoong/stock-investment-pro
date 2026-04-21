import * as vscode from "vscode";
import { StockApiService } from "../api/stockApiService";
import { StockConfigService } from "../config/stockConfigService";
import { HoldingInfo, StockConfigItem, StockData, SummaryData } from "../models/stock";
import { displayTag, toApiSecId, toConfigId, toHoldingMap } from "../utils/stockCode";
import { StockItem } from "./stockItem";

export class StockTreeDataProvider implements vscode.TreeDataProvider<StockItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

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
    private readonly apiService: StockApiService,
    private readonly onSummaryUpdated: (summary: SummaryData) => void
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
    if (element.isRoot && element.configId) {
      return Promise.resolve(this.getDetailItems(element.configId));
    }
    return Promise.resolve([]);
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
    const requestIds: string[] = [];
    this.apiToConfigId.clear();

    for (const item of this.stockItems) {
      const apiSecId = toApiSecId(item);
      requestIds.push(apiSecId);
      this.apiToConfigId.set(apiSecId, toConfigId(item));
    }

    if (requestIds.length === 0) {
      this.isLoading = false;
      this._onDidChangeTreeData.fire();
      return;
    }

    const updateTime = new Date().toLocaleTimeString("zh-CN");
    const apiData = await this.apiService.fetchBatchStocks(requestIds, updateTime);

    this.stocksData.clear();
    for (const [apiSecId, stockData] of apiData.entries()) {
      const configId = this.apiToConfigId.get(apiSecId);
      if (configId) {
        this.stocksData.set(configId, stockData);
      }
    }

    this.isLoading = false;
    this.summary = this.computeSummary(updateTime);
    this.onSummaryUpdated(this.summary);
    this._onDidChangeTreeData.fire();
  }

  private getRootItems(): StockItem[] {
    if (this.isLoading) {
      return [
        new StockItem(
          "行情列表",
          vscode.TreeItemCollapsibleState.None,
          "加载中...",
          new vscode.ThemeIcon("loading~spin")
        ),
      ];
    }

    return this.stockItems.map((config) => {
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
}
