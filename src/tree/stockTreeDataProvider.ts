import * as vscode from "vscode";
import { StockApiService } from "../api/stockApiService";
import { StockConfigService } from "../config/stockConfigService";
import {
    HoldingInfo,
    StockConfigItem,
    StockData,
    SummaryData
} from "../models/stock";
import {
    displayTag,
    toApiSecId,
    toConfigId,
    toHoldingMap
} from "../utils/stockCode";
import { computeDailyProfitLoss, computeHoldingProfitLoss } from "../utils/pnl";
import { StockItem } from "./stockItem";

const DND_MIME = "application/vnd.code.tree.stockView";
const SUMMARY_MARKET_VALUE_ID = "summary:marketValue";
const SUMMARY_FLOATING_PNL_ID = "summary:floatingProfitLoss";
const SUMMARY_DAILY_PNL_ID = "summary:dailyProfitLoss";
const DEV_TEST_STOCK_CODE = "ALERTTEST";
const DEV_TEST_STOCK_CONFIG_ID = `stock:us.${DEV_TEST_STOCK_CODE}`;

type AlertStateType = "none" | "surgeUp" | "surgeDown";

interface AlertConfig {
    enabled: boolean;
    windowMinutes: number;
    changePercent: number;
    cooldownMinutes: number;
}

interface DevConfig {
    devMode: boolean;
    alertTestStockEnabled: boolean;
}

interface PricePoint {
    timestamp: number;
    price: number;
}

interface StockAlertState {
    type: AlertStateType;
    changePercent: number;
    windowStart: number;
    windowEnd: number;
    activeUntil: number;
}

export interface AlertOverview {
    upCount: number;
    downCount: number;
    dominant: AlertStateType;
}

export class StockTreeDataProvider
    implements
        vscode.TreeDataProvider<StockItem>,
        vscode.TreeDragAndDropController<StockItem>
{
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private readonly _onDidChangeAlerts = new vscode.EventEmitter<void>();
    readonly onDidChangeAlerts = this._onDidChangeAlerts.event;

    readonly dropMimeTypes = [DND_MIME];
    readonly dragMimeTypes = [DND_MIME];

    private stocksData = new Map<string, StockData>();
    private stockItems: StockConfigItem[] = [];
    private holdings = new Map<string, HoldingInfo>();
    private apiToConfigId = new Map<string, string>();
    private isLoading = true;
    private summary: SummaryData = {
        marketValue: 0,
        floatingProfitLoss: 0,
        dailyProfitLoss: 0,
        updateTime: "--",
        hasHoldings: false,
        hasFloatingProfitLoss: false
    };
    private priceHistory = new Map<string, PricePoint[]>();
    private alertStates = new Map<string, StockAlertState>();
    private alertConfig: AlertConfig = {
        enabled: true,
        windowMinutes: 3,
        changePercent: 4,
        cooldownMinutes: 10
    };
    private devConfig: DevConfig = {
        devMode: false,
        alertTestStockEnabled: false
    };
    private devTick = 0;
    private devLastPrice = 100;

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
        if (element.configId === SUMMARY_FLOATING_PNL_ID) {
            return Promise.resolve(this.getHoldingFloatingPnlItems());
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
        const configIds = source
            .filter((item) => this.isSortableRoot(item))
            .map((item) => item.configId!);
        if (configIds.length === 0) {
            return;
        }
        dataTransfer.set(
            DND_MIME,
            new vscode.DataTransferItem(JSON.stringify(configIds))
        );
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
                movingConfigIds = parsed.filter(
                    (id): id is string => typeof id === "string"
                );
            }
        } catch {
            return;
        }

        const targetConfigId = this.isSortableRoot(target)
            ? target.configId
            : undefined;
        const insertAtStart = target?.contextValue === "summaryItem";
        const reorderedIds = this.buildReorderedIds(
            movingConfigIds,
            targetConfigId,
            insertAtStart
        );
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

    getAlertOverview(): AlertOverview {
        let upCount = 0;
        let downCount = 0;
        for (const item of this.stockItems) {
            if (item.type === "sector") {
                continue;
            }
            const state = this.alertStates.get(toConfigId(item));
            if (state?.type === "surgeUp") {
                upCount += 1;
            } else if (state?.type === "surgeDown") {
                downCount += 1;
            }
        }

        const dominant: AlertStateType =
            upCount === 0 && downCount === 0
                ? "none"
                : upCount >= downCount
                  ? "surgeUp"
                  : "surgeDown";

        return { upCount, downCount, dominant };
    }

    async addItem(item: StockConfigItem): Promise<void> {
        await this.configService.add(item);
        await this.refresh();
    }

    async addItems(
        items: StockConfigItem[]
    ): Promise<{ added: number; skipped: number }> {
        const result = await this.configService.addMany(items);
        await this.refresh();
        return result;
    }

    async deleteItem(configId: string): Promise<void> {
        await this.configService.remove(configId);
        await this.refresh();
    }

    async updateHolding(
        configId: string,
        shares: number,
        costPrice?: number,
        costDate?: string
    ): Promise<void> {
        await this.configService.updateHolding(
            configId,
            shares,
            costPrice,
            costDate
        );
        await this.refresh();
    }

    private async loadStockCodes(): Promise<void> {
        const { items, migrated } = await this.configService.load();
        this.devConfig = this.getDevConfig();
        this.stockItems = this.applyDevTestStock(items);
        this.holdings = toHoldingMap(items);
        this.alertConfig = this.getAlertConfig();
        this.pruneStateForConfiguredItems();
        if (migrated) {
            vscode.window.showInformationMessage(
                "已自动将旧版股票配置迁移为 JSON 结构"
            );
        }
    }

    private async fetchAllStockData(): Promise<void> {
        const stockRequestIds: string[] = [];
        const sectorCodes: string[] = [];
        const indexCodes: string[] = [];
        const futureCodes: string[] = [];
        this.apiToConfigId.clear();

        for (const item of this.stockItems) {
            if (this.isDevTestStock(item)) {
                continue;
            }
            if (item.type === "sector") {
                sectorCodes.push(item.code);
                continue;
            }
            if (item.type === "index") {
                indexCodes.push(item.code);
                continue;
            }
            if (item.type === "future") {
                futureCodes.push(item.code);
                continue;
            }

            const apiSecId = toApiSecId(item);
            stockRequestIds.push(apiSecId);
            this.apiToConfigId.set(apiSecId, toConfigId(item));
        }

        const updateTime = new Date().toLocaleTimeString("zh-CN");
        const [stockApiData, sectorApiData, indexApiData, futureApiData] =
            await Promise.all([
                stockRequestIds.length > 0
                    ? this.apiService.fetchBatchStocks(
                          stockRequestIds,
                          updateTime
                      )
                    : Promise.resolve(new Map<string, StockData>()),
                sectorCodes.length > 0
                    ? this.apiService.fetchBatchSectors(sectorCodes, updateTime)
                    : Promise.resolve(new Map<string, StockData>()),
                indexCodes.length > 0
                    ? this.apiService.fetchBatchIndices(indexCodes, updateTime)
                    : Promise.resolve(new Map<string, StockData>()),
                futureCodes.length > 0
                    ? this.apiService.fetchBatchFutures(futureCodes, updateTime)
                    : Promise.resolve(new Map<string, StockData>())
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
        for (const [indexCode, indexData] of indexApiData.entries()) {
            this.stocksData.set(`index:${indexCode}`, indexData);
        }
        for (const [futureCode, futureData] of futureApiData.entries()) {
            this.stocksData.set(`future:${futureCode}`, futureData);
        }

        if (this.devConfig.devMode && this.devConfig.alertTestStockEnabled) {
            this.stocksData.set(
                DEV_TEST_STOCK_CONFIG_ID,
                this.buildDevTestStockData(updateTime)
            );
        }

        this.updateAlertStates();
        this.isLoading = false;
        this.summary = this.computeSummary(updateTime);
        this._onDidChangeAlerts.fire();
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
                )
            ];
        }

        const stockRows = this.stockItems.map((config) => {
            const configId = toConfigId(config);
            const stockData = this.stocksData.get(configId);
            const isHoldingStock =
                config.type === "stock" &&
                (this.holdings.get(configId)?.shares ?? 0) > 0;

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
            const alertState =
                config.type === "sector"
                    ? undefined
                    : this.alertStates.get(configId);
            const isAlertUp = alertState?.type === "surgeUp";
            const isAlertDown = alertState?.type === "surgeDown";
            const alertPrefix = isAlertUp ? "⇧⇧ " : isAlertDown ? "⇩⇩ " : "";
            const contextValue = this.isDevTestStock(config)
                ? "devTestStock"
                : undefined;
            const isSector = config.type === "sector";
            const isIndex =
                config.type === "index" ||
                this.isIndexLikeStock(config, stockData);
            const isFuture = config.type === "future";
            const color = isAlertUp
                ? new vscode.ThemeColor("charts.red")
                : isAlertDown
                  ? new vscode.ThemeColor("charts.green")
                  : changeNum > 0
                    ? new vscode.ThemeColor("charts.red")
                    : changeNum < 0
                      ? new vscode.ThemeColor("charts.green")
                      : new vscode.ThemeColor("disabledForeground");
            const icon = isHoldingStock
                ? new vscode.ThemeIcon("database", color)
                : isSector
                  ? new vscode.ThemeIcon("symbol-namespace", color)
                  : isIndex
                    ? new vscode.ThemeIcon("graph", color)
                    : isFuture
                      ? new vscode.ThemeIcon("pulse", color)
                      : new vscode.ThemeIcon(
                            isAlertUp
                                ? "arrow-up"
                                : isAlertDown
                                  ? "arrow-down"
                                  : "circle-filled",
                            color
                        );

            return new StockItem(
                `${alertPrefix}${config.name ?? stockData.name}`,
                vscode.TreeItemCollapsibleState.Collapsed,
                `${stockData.current} ${arrow} ${stockData.changePercent}%${displayTag(config)}${this.alertHintText(alertState)}`,
                icon,
                configId,
                config.type,
                true,
                contextValue
            );
        });

        return [...summaryItems, ...stockRows];
    }

    private getSummaryItems(): StockItem[] {
        const marketValueText = this.summary.hasHoldings
            ? this.summary.marketValue.toFixed(2)
            : "--";
        const floatingProfitLossText = this.summary.hasFloatingProfitLoss
            ? this.summary.floatingProfitLoss >= 0
                ? `+${this.summary.floatingProfitLoss.toFixed(2)}`
                : this.summary.floatingProfitLoss.toFixed(2)
            : "--";
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
                new vscode.ThemeIcon(
                    "graph",
                    new vscode.ThemeColor("charts.blue")
                ),
                SUMMARY_MARKET_VALUE_ID,
                undefined,
                false,
                "summaryItem"
            ),
            new StockItem(
                "浮动盈亏",
                vscode.TreeItemCollapsibleState.Collapsed,
                floatingProfitLossText,
                new vscode.ThemeIcon(
                    this.summary.floatingProfitLoss >= 0
                        ? "arrow-up"
                        : "arrow-down",
                    new vscode.ThemeColor(
                        this.summary.floatingProfitLoss >= 0
                            ? "charts.red"
                            : "charts.green"
                    )
                ),
                SUMMARY_FLOATING_PNL_ID,
                undefined,
                false,
                "summaryItem"
            ),
            new StockItem(
                "今日盈亏",
                vscode.TreeItemCollapsibleState.Collapsed,
                dailyProfitLossText,
                new vscode.ThemeIcon(
                    this.summary.dailyProfitLoss >= 0
                        ? "arrow-up"
                        : "arrow-down",
                    new vscode.ThemeColor(
                        this.summary.dailyProfitLoss >= 0
                            ? "charts.red"
                            : "charts.green"
                    )
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
            )
        ];
    }

    private getHoldingFloatingPnlItems(): StockItem[] {
        const items: StockItem[] = [];

        for (const [configId, holding] of this.holdings.entries()) {
            const stockData = this.stocksData.get(configId);
            const config = this.getConfiguredItem(configId);
            if (!stockData || !config || holding.shares <= 0) {
                continue;
            }

            const floatingPnl = computeHoldingProfitLoss(stockData, holding);
            if (floatingPnl === null) {
                continue;
            }
            const isUp = floatingPnl >= 0;
            items.push(
                new StockItem(
                    config.name ?? stockData.name ?? config.code,
                    vscode.TreeItemCollapsibleState.None,
                    isUp
                        ? `+${floatingPnl.toFixed(2)}`
                        : floatingPnl.toFixed(2),
                    new vscode.ThemeIcon(
                        isUp ? "arrow-up" : "arrow-down",
                        new vscode.ThemeColor(
                            isUp ? "charts.red" : "charts.green"
                        )
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
                    "暂无可计算浮动盈亏的持仓",
                    vscode.TreeItemCollapsibleState.None,
                    "--",
                    new vscode.ThemeIcon("info")
                )
            ];
        }

        return items;
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
            if (!Number.isFinite(currentPrice)) {
                continue;
            }
            const marketValue = currentPrice * holding.shares;
            items.push(
                new StockItem(
                    config.name ?? stockData.name ?? config.code,
                    vscode.TreeItemCollapsibleState.None,
                    `${marketValue.toFixed(2)} (${holding.shares}股)`,
                    new vscode.ThemeIcon(
                        "symbol-number",
                        new vscode.ThemeColor("charts.blue")
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
                )
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

            const dailyPnl = computeDailyProfitLoss(stockData, holding).value;
            const isUp = dailyPnl >= 0;
            items.push(
                new StockItem(
                    config.name ?? stockData.name ?? config.code,
                    vscode.TreeItemCollapsibleState.None,
                    isUp ? `+${dailyPnl.toFixed(2)}` : dailyPnl.toFixed(2),
                    new vscode.ThemeIcon(
                        isUp ? "arrow-up" : "arrow-down",
                        new vscode.ThemeColor(
                            isUp ? "charts.red" : "charts.green"
                        )
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
                )
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
                new vscode.ThemeIcon(
                    "symbol-number",
                    new vscode.ThemeColor("charts.blue")
                )
            ),
            new StockItem(
                "涨跌点数",
                vscode.TreeItemCollapsibleState.None,
                `${isUp ? "↑" : "↓"} ${stockData.change}`,
                new vscode.ThemeIcon(
                    isUp ? "arrow-up" : "arrow-down",
                    new vscode.ThemeColor(isUp ? "charts.red" : "charts.green")
                )
            )
        ];

        const alertState = this.alertStates.get(configId);
        if (alertState && alertState.type !== "none") {
            const isUpAlert = alertState.type === "surgeUp";
            const startTime = new Date(
                alertState.windowStart
            ).toLocaleTimeString("zh-CN");
            const endTime = new Date(alertState.windowEnd).toLocaleTimeString(
                "zh-CN"
            );
            items.unshift(
                new StockItem(
                    "异动提醒",
                    vscode.TreeItemCollapsibleState.None,
                    `${startTime}-${endTime} ${isUpAlert ? "上涨" : "下跌"} ${alertState.changePercent.toFixed(2)}%`,
                    new vscode.ThemeIcon(
                        isUpAlert ? "arrow-up" : "arrow-down",
                        new vscode.ThemeColor(
                            isUpAlert ? "charts.red" : "charts.green"
                        )
                    )
                )
            );
        }

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
                    new vscode.ThemeIcon(
                        "database",
                        new vscode.ThemeColor("charts.purple")
                    )
                )
            );

            if (holding.costPrice && holding.costPrice > 0) {
                items.push(
                    new StockItem(
                        "成本价",
                        vscode.TreeItemCollapsibleState.None,
                        holding.costPrice.toFixed(2),
                        new vscode.ThemeIcon(
                            "symbol-numeric",
                            new vscode.ThemeColor("charts.yellow")
                        )
                    )
                );

                if (holding.costDate) {
                    items.push(
                        new StockItem(
                            "购入时间",
                            vscode.TreeItemCollapsibleState.None,
                            holding.costDate,
                            new vscode.ThemeIcon(
                                "calendar",
                                new vscode.ThemeColor("charts.blue")
                            )
                        )
                    );
                }

                const floatingPnL = computeHoldingProfitLoss(
                    stockData,
                    holding
                );
                if (floatingPnL !== null) {
                    items.push(
                        new StockItem(
                            "持仓盈亏",
                            vscode.TreeItemCollapsibleState.None,
                            floatingPnL >= 0
                                ? `+${floatingPnL.toFixed(2)}`
                                : floatingPnL.toFixed(2),
                            new vscode.ThemeIcon(
                                floatingPnL >= 0 ? "arrow-up" : "arrow-down",
                                new vscode.ThemeColor(
                                    floatingPnL >= 0
                                        ? "charts.red"
                                        : "charts.green"
                                )
                            )
                        )
                    );
                }
            }

            const dailyPnL = computeDailyProfitLoss(stockData, holding).value;
            items.push(
                new StockItem(
                    "今日盈亏",
                    vscode.TreeItemCollapsibleState.None,
                    dailyPnL >= 0
                        ? `+${dailyPnL.toFixed(2)}`
                        : dailyPnL.toFixed(2),
                    new vscode.ThemeIcon(
                        dailyPnL >= 0 ? "arrow-up" : "arrow-down",
                        new vscode.ThemeColor(
                            dailyPnL >= 0 ? "charts.red" : "charts.green"
                        )
                    )
                )
            );
        }

        return items;
    }

    private computeSummary(updateTime: string): SummaryData {
        let marketValue = 0;
        let floatingProfitLoss = 0;
        let dailyProfitLoss = 0;
        let hasHoldings = false;
        let hasFloatingProfitLoss = false;

        for (const [configId, holding] of this.holdings.entries()) {
            const stockData = this.stocksData.get(configId);
            if (!stockData) {
                continue;
            }
            hasHoldings = true;
            const currentPrice = Number.parseFloat(stockData.current);
            if (!Number.isFinite(currentPrice)) {
                continue;
            }
            const dailyPnL = computeDailyProfitLoss(stockData, holding).value;
            marketValue += currentPrice * holding.shares;
            dailyProfitLoss += dailyPnL;

            const floatingPnl = computeHoldingProfitLoss(stockData, holding);
            if (floatingPnl !== null) {
                floatingProfitLoss += floatingPnl;
                hasFloatingProfitLoss = true;
            }
        }

        return {
            marketValue,
            floatingProfitLoss,
            dailyProfitLoss,
            updateTime,
            hasHoldings,
            hasFloatingProfitLoss
        };
    }

    private updateAlertStates(): void {
        if (!this.alertConfig.enabled) {
            this.alertStates.clear();
            return;
        }

        const now = Date.now();
        const windowMs = this.alertConfig.windowMinutes * 60 * 1000;
        const cooldownMs = this.alertConfig.cooldownMinutes * 60 * 1000;
        const keepHistoryMs = Math.max(windowMs, cooldownMs) + 2 * 60 * 1000;
        const configuredStockIds = new Set(
            this.stockItems
                .filter(
                    (item) =>
                        item.type === "stock" ||
                        item.type === "index" ||
                        item.type === "future"
                )
                .map((item) => toConfigId(item))
        );

        for (const stockId of configuredStockIds) {
            const stockData = this.stocksData.get(stockId);
            if (!stockData) {
                continue;
            }

            const current = Number.parseFloat(stockData.current);
            if (!Number.isFinite(current) || current <= 0) {
                continue;
            }

            const history = this.priceHistory.get(stockId) ?? [];
            history.push({ timestamp: now, price: current });
            const trimmedHistory = history.filter(
                (point) => now - point.timestamp <= keepHistoryMs
            );
            this.priceHistory.set(stockId, trimmedHistory);

            const pointsInWindow = trimmedHistory.filter(
                (point) => now - point.timestamp <= windowMs
            );
            const minPoint = pointsInWindow.reduce<PricePoint | undefined>(
                (acc, point) =>
                    acc === undefined || point.price < acc.price ? point : acc,
                undefined
            );
            const maxPoint = pointsInWindow.reduce<PricePoint | undefined>(
                (acc, point) =>
                    acc === undefined || point.price > acc.price ? point : acc,
                undefined
            );

            const upChangePercent =
                minPoint && minPoint.price > 0
                    ? ((current - minPoint.price) / minPoint.price) * 100
                    : 0;
            const downChangePercent =
                maxPoint && maxPoint.price > 0
                    ? ((current - maxPoint.price) / maxPoint.price) * 100
                    : 0;

            let nextType: AlertStateType = "none";
            let magnitude = 0;
            let windowStart = now;

            if (
                upChangePercent >= this.alertConfig.changePercent ||
                downChangePercent <= -this.alertConfig.changePercent
            ) {
                if (upChangePercent >= Math.abs(downChangePercent)) {
                    nextType = "surgeUp";
                    magnitude = upChangePercent;
                    windowStart = minPoint?.timestamp ?? now;
                } else {
                    nextType = "surgeDown";
                    magnitude = Math.abs(downChangePercent);
                    windowStart = maxPoint?.timestamp ?? now;
                }
            }

            const previous = this.alertStates.get(stockId);
            if (nextType === "none") {
                if (previous && previous.activeUntil > now) {
                    this.alertStates.set(stockId, previous);
                } else {
                    this.alertStates.delete(stockId);
                }
                continue;
            }

            this.alertStates.set(stockId, {
                type: nextType,
                changePercent: magnitude,
                windowStart,
                windowEnd: now,
                activeUntil: now + cooldownMs
            });
        }

        for (const [stockId, state] of this.alertStates.entries()) {
            if (!configuredStockIds.has(stockId) || state.activeUntil <= now) {
                this.alertStates.delete(stockId);
            }
        }

        for (const stockId of this.priceHistory.keys()) {
            if (!configuredStockIds.has(stockId)) {
                this.priceHistory.delete(stockId);
            }
        }
    }

    private getAlertConfig(): AlertConfig {
        const enabled = this.readAlertSetting("enabled", true);
        const windowMinutes = Math.max(
            1,
            this.readAlertSetting("windowMinutes", 3)
        );
        const changePercent = Math.max(
            0.5,
            this.readAlertSetting("changePercent", 4)
        );
        const cooldownMinutes = Math.max(
            1,
            this.readAlertSetting("cooldownMinutes", 10)
        );

        return {
            enabled: Boolean(enabled),
            windowMinutes,
            changePercent,
            cooldownMinutes
        };
    }

    private readAlertSetting<T extends boolean | number>(
        key: string,
        defaultValue: T
    ): T {
        const section = "sidebarStock";
        const legacySection = "stockInvestment";
        const path = `alerts.${key}`;
        const config = vscode.workspace.getConfiguration(section);
        const legacyConfig = vscode.workspace.getConfiguration(legacySection);

        const inspected = config.inspect<T>(path);
        const hasPrimaryValue =
            inspected?.workspaceFolderValue !== undefined ||
            inspected?.workspaceValue !== undefined ||
            inspected?.globalValue !== undefined;
        if (hasPrimaryValue) {
            return config.get<T>(path, defaultValue);
        }

        const legacyInspected = legacyConfig.inspect<T>(path);
        const hasLegacyValue =
            legacyInspected?.workspaceFolderValue !== undefined ||
            legacyInspected?.workspaceValue !== undefined ||
            legacyInspected?.globalValue !== undefined;
        if (hasLegacyValue) {
            return legacyConfig.get<T>(path, defaultValue);
        }

        return config.get<T>(path, defaultValue);
    }

    private getDevConfig(): DevConfig {
        const cfg = vscode.workspace.getConfiguration("sidebarStock");
        return {
            devMode: cfg.get<boolean>("devMode", false),
            alertTestStockEnabled: cfg.get<boolean>(
                "dev.alertTestStockEnabled",
                false
            )
        };
    }

    private applyDevTestStock(items: StockConfigItem[]): StockConfigItem[] {
        if (!this.devConfig.devMode || !this.devConfig.alertTestStockEnabled) {
            return items;
        }

        if (
            items.some((item) => toConfigId(item) === DEV_TEST_STOCK_CONFIG_ID)
        ) {
            return items;
        }

        return [
            {
                type: "stock",
                market: "us",
                code: DEV_TEST_STOCK_CODE,
                name: "[DEV] 异动测试股"
            },
            ...items
        ];
    }

    private isDevTestStock(item: StockConfigItem): boolean {
        return (
            item.type === "stock" &&
            item.market === "us" &&
            item.code === DEV_TEST_STOCK_CODE
        );
    }

    private buildDevTestStockData(updateTime: string): StockData {
        this.devTick += 1;
        const cycle = this.devTick % 40;
        const ratio = cycle < 20 ? cycle / 20 : (40 - cycle) / 20;
        const current = 100 * (1 + (ratio * 0.12 - 0.06));

        const previousClose = this.devLastPrice;
        const change = current - previousClose;
        const changePercent =
            previousClose === 0 ? 0 : (change / previousClose) * 100;
        this.devLastPrice = current;

        return {
            code: `105.${DEV_TEST_STOCK_CODE}`,
            name: "[DEV] 异动测试股",
            current: current.toFixed(3),
            change: change.toFixed(3),
            changePercent: changePercent.toFixed(2),
            previousClose: previousClose.toFixed(3),
            updateTime
        };
    }

    private pruneStateForConfiguredItems(): void {
        const configuredStockIds = new Set(
            this.stockItems
                .filter(
                    (item) =>
                        item.type === "stock" ||
                        item.type === "index" ||
                        item.type === "future"
                )
                .map((item) => toConfigId(item))
        );
        for (const stockId of this.alertStates.keys()) {
            if (!configuredStockIds.has(stockId)) {
                this.alertStates.delete(stockId);
            }
        }
        for (const stockId of this.priceHistory.keys()) {
            if (!configuredStockIds.has(stockId)) {
                this.priceHistory.delete(stockId);
            }
        }

        if (!configuredStockIds.has(DEV_TEST_STOCK_CONFIG_ID)) {
            this.devTick = 0;
            this.devLastPrice = 100;
        }
    }

    private alertHintText(state?: StockAlertState): string {
        if (!state || state.type === "none") {
            return "";
        }
        const direction = state.type === "surgeUp" ? "异动⇧⇧" : "异动⇩⇩";
        return `  ${direction}${state.changePercent.toFixed(2)}%`;
    }

    private isIndexLikeStock(
        config: StockConfigItem,
        stockData: StockData
    ): boolean {
        if (config.type !== "stock") {
            return false;
        }

        const configuredName = (config.name ?? "").trim();
        const realtimeName = (stockData.name ?? "").trim();
        if (configuredName.includes("指数") || realtimeName.includes("指数")) {
            return true;
        }

        if (!config.market) {
            return false;
        }

        return (
            (config.market === "sh" || config.market === "sz") &&
            /^(000|399)\d{3}$/.test(config.code)
        );
    }

    private isSortableRoot(item: StockItem | undefined): item is StockItem {
        return Boolean(
            item?.isRoot &&
            item.configId &&
            item.configId !== DEV_TEST_STOCK_CONFIG_ID
        );
    }

    private buildReorderedIds(
        movingConfigIds: string[],
        targetConfigId?: string,
        insertAtStart: boolean = false
    ): string[] {
        const currentIds = this.stockItems.map((item) => toConfigId(item));
        const existing = new Set(currentIds);

        const moving = movingConfigIds.filter(
            (id, index) =>
                existing.has(id) && movingConfigIds.indexOf(id) === index
        );
        if (moving.length === 0) {
            return currentIds;
        }

        const remaining = currentIds.filter((id) => !moving.includes(id));
        const insertAt = insertAtStart
            ? 0
            : targetConfigId
              ? Math.max(remaining.indexOf(targetConfigId), 0)
              : remaining.length;

        return [
            ...remaining.slice(0, insertAt),
            ...moving,
            ...remaining.slice(insertAt)
        ];
    }
}
