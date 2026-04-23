import * as vscode from "vscode";
import { StockApiService } from "./api/stockApiService";
import { registerCommands } from "./commands/registerCommands";
import { StockConfigService } from "./config/stockConfigService";
import { AutoRefreshService } from "./services/autoRefreshService";
import { StockTreeDataProvider } from "./tree/stockTreeDataProvider";

const REFRESH_INTERVAL = 3000;
const STOCK_CONFIG_SECTION = "sidebarStock";
const STOCK_CONFIG_KEY = "sidebarStock.stockCodeList";
const LEGACY_STOCK_CONFIG_KEY = "stockInvestment.stockCodeList";
const TAB_NAME_KEY = "sidebarStock.tabName";

let autoRefreshService: AutoRefreshService | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const configService = new StockConfigService();
  const apiService = new StockApiService();
  const stockDataProvider = new StockTreeDataProvider(configService, apiService);
  autoRefreshService = new AutoRefreshService();

  await stockDataProvider.initialize();

  const stockView = vscode.window.createTreeView("stockView", {
    treeDataProvider: stockDataProvider,
    showCollapseAll: false,
    dragAndDropController: stockDataProvider,
  });
  applyStockViewTitle(stockView);

  autoRefreshService.start(() => {
    stockDataProvider.refresh();
  }, REFRESH_INTERVAL);

  const configChangeListener = vscode.workspace.onDidChangeConfiguration(async (e) => {
    const affectsSidebarStock = e.affectsConfiguration(STOCK_CONFIG_SECTION);
    if (
      affectsSidebarStock ||
      e.affectsConfiguration(STOCK_CONFIG_KEY) ||
      e.affectsConfiguration(LEGACY_STOCK_CONFIG_KEY)
    ) {
      await stockDataProvider.refresh();
    }
    if (affectsSidebarStock || e.affectsConfiguration(TAB_NAME_KEY)) {
      applyStockViewTitle(stockView);
    }
  });

  registerCommands(context, stockDataProvider);
  context.subscriptions.push(stockView, configChangeListener);
}

export function deactivate() {
  autoRefreshService?.stop();
  autoRefreshService = undefined;
}

function applyStockViewTitle(stockView: vscode.TreeView<unknown>): void {
  const tabName = vscode.workspace.getConfiguration("sidebarStock").get<string>("tabName", "Stock").trim();
  stockView.title = tabName || "Stock";
}
