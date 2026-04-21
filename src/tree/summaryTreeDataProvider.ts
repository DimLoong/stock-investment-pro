import * as vscode from "vscode";
import { SummaryData } from "../models/stock";
import { StockItem } from "./stockItem";

export class SummaryTreeDataProvider implements vscode.TreeDataProvider<StockItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private summary: SummaryData = {
    marketValue: 0,
    dailyProfitLoss: 0,
    updateTime: "--",
    hasHoldings: false,
  };

  getTreeItem(element: StockItem): vscode.TreeItem {
    return element;
  }

  getChildren(): Thenable<StockItem[]> {
    const dailyProfitLossText = this.summary.hasHoldings
      ? this.summary.dailyProfitLoss >= 0
        ? `+${this.summary.dailyProfitLoss.toFixed(2)}`
        : this.summary.dailyProfitLoss.toFixed(2)
      : "--";

    return Promise.resolve([
      new StockItem(
        "持仓市值",
        vscode.TreeItemCollapsibleState.None,
        this.summary.hasHoldings ? this.summary.marketValue.toFixed(2) : "--",
        new vscode.ThemeIcon("graph", new vscode.ThemeColor("charts.blue"))
      ),
      new StockItem(
        "今日盈亏",
        vscode.TreeItemCollapsibleState.None,
        dailyProfitLossText,
        new vscode.ThemeIcon(
          this.summary.dailyProfitLoss >= 0 ? "arrow-up" : "arrow-down",
          new vscode.ThemeColor(this.summary.dailyProfitLoss >= 0 ? "charts.red" : "charts.green")
        )
      ),
      new StockItem(
        "更新时间",
        vscode.TreeItemCollapsibleState.None,
        this.summary.updateTime || "--",
        new vscode.ThemeIcon("clock")
      ),
    ]);
  }

  update(summary: SummaryData): void {
    this.summary = summary;
    this._onDidChangeTreeData.fire();
  }
}
