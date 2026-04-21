import * as vscode from "vscode";
import { StockItemType } from "../models/stock";

export class StockItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly description?: string,
    public readonly iconPath?: vscode.ThemeIcon,
    public readonly configId?: string,
    public readonly itemType?: StockItemType,
    public readonly isRoot: boolean = false
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.iconPath = iconPath;
    this.tooltip = "";

    if (isRoot && configId) {
      this.contextValue = itemType === "sector" ? "sectorRoot" : "stockRoot";
    }
  }
}
