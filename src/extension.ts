import * as vscode from "vscode";
import { StockApiService } from "./api/stockApiService";
import { registerCommands } from "./commands/registerCommands";
import { StockConfigService } from "./config/stockConfigService";
import { AutoRefreshService } from "./services/autoRefreshService";
import { StockTreeDataProvider } from "./tree/stockTreeDataProvider";
import { SummaryTreeDataProvider } from "./tree/summaryTreeDataProvider";

const REFRESH_INTERVAL = 3000;

let autoRefreshService: AutoRefreshService | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const configService = new StockConfigService();
  const apiService = new StockApiService();
  const summaryProvider = new SummaryTreeDataProvider();
  const stockDataProvider = new StockTreeDataProvider(configService, apiService, (summary) => {
    summaryProvider.update(summary);
  });
  autoRefreshService = new AutoRefreshService();

  await stockDataProvider.initialize();

  const summaryView = vscode.window.createTreeView("stockSummaryView", {
    treeDataProvider: summaryProvider,
    showCollapseAll: false,
  });

  const stockView = vscode.window.createTreeView("stockView", {
    treeDataProvider: stockDataProvider,
    showCollapseAll: false,
  });

  autoRefreshService.start(() => {
    stockDataProvider.refresh();
  }, REFRESH_INTERVAL);

  const configChangeListener = vscode.workspace.onDidChangeConfiguration(async (e) => {
    if (e.affectsConfiguration("stockInvestment.stockCodeList")) {
      await stockDataProvider.refresh();
    }
  });

  registerCommands(context, stockDataProvider);
  context.subscriptions.push(summaryView, stockView, configChangeListener);
}

export function deactivate() {
  autoRefreshService?.stop();
  autoRefreshService = undefined;
}
