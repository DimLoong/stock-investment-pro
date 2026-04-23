import * as vscode from "vscode";
import { MarketType, StockConfigItem } from "../models/stock";
import { StockTreeDataProvider } from "../tree/stockTreeDataProvider";
import { StockItem } from "../tree/stockItem";
import {
  inferMarket,
  marketQuickPickItems,
  parseUserStockInput,
} from "../utils/stockCode";

export function registerCommands(
  context: vscode.ExtensionContext,
  stockDataProvider: StockTreeDataProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("stockView.refresh", async () => {
      await stockDataProvider.refresh();
    }),
    vscode.commands.registerCommand("stockView.openWebsite", () => {
      vscode.env.openExternal(vscode.Uri.parse("https://www.eastmoney.com/"));
    }),
    vscode.commands.registerCommand("extension.showStockPanel", async () => {
      await vscode.commands.executeCommand("workbench.view.explorer");
      await vscode.commands.executeCommand("stockView.focus");
    }),
    vscode.commands.registerCommand("stockView.editHoldingShares", async (item: StockItem) => {
      await handleEditHolding(stockDataProvider, item);
    }),
    vscode.commands.registerCommand("stockView.deleteStock", async (item: StockItem) => {
      await handleDelete(stockDataProvider, item);
    }),
    vscode.commands.registerCommand("stockView.addStock", async () => {
      await handleAdd(stockDataProvider);
    })
  );
}

async function handleEditHolding(
  stockDataProvider: StockTreeDataProvider,
  item: StockItem | undefined
): Promise<void> {
  if (!item?.configId || item.itemType !== "stock") {
    vscode.window.showErrorMessage("仅股票支持编辑持仓");
    return;
  }

  const currentConfig = stockDataProvider.getConfiguredItem(item.configId);
  const currentShares = currentConfig?.shares ?? 0;
  const currentCost = currentConfig?.costPrice;

  const sharesInput = await vscode.window.showInputBox({
    prompt: `请输入 ${item.label} 的持有股数`,
    placeHolder: "输入大于等于0的整数，输入0或留空表示清除持仓",
    value: currentShares > 0 ? String(currentShares) : "",
    validateInput: (value) => {
      if (!value.trim()) {
        return null;
      }
      const num = Number(value);
      if (!Number.isInteger(num) || num < 0) {
        return "持有股数必须是大于等于0的整数";
      }
      return null;
    },
  });

  if (sharesInput === undefined) {
    return;
  }

  const shares = sharesInput.trim() ? Number(sharesInput.trim()) : 0;
  if (shares <= 0) {
    await stockDataProvider.updateHolding(item.configId, 0, undefined);
    vscode.window.showInformationMessage(`已更新 ${item.label} 持仓信息`);
    return;
  }

  const costInput = await vscode.window.showInputBox({
    prompt: `请输入 ${item.label} 的成本价（可选）`,
    placeHolder: "输入大于0的数字，留空表示不设置成本价",
    value: currentCost ? String(currentCost) : "",
    validateInput: (value) => {
      if (!value.trim()) {
        return null;
      }
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0) {
        return "成本价必须是大于0的数字";
      }
      return null;
    },
  });

  if (costInput === undefined) {
    return;
  }

  const costPrice = costInput.trim() ? Number(costInput.trim()) : undefined;

  await stockDataProvider.updateHolding(item.configId, shares, costPrice);
  vscode.window.showInformationMessage(`已更新 ${item.label} 持仓信息`);
}

async function handleDelete(
  stockDataProvider: StockTreeDataProvider,
  item: StockItem | undefined
): Promise<void> {
  if (!item?.configId) {
    vscode.window.showErrorMessage("无法定位条目");
    return;
  }

  const answer = await vscode.window.showWarningMessage(
    `确定要删除 ${item.label} 吗？`,
    { modal: true },
    "确定",
    "取消"
  );
  if (answer !== "确定") {
    return;
  }

  await stockDataProvider.deleteItem(item.configId);
  vscode.window.showInformationMessage(`已删除 ${item.label}`);
}

async function handleAdd(stockDataProvider: StockTreeDataProvider): Promise<void> {
  const typePick = await vscode.window.showQuickPick(
    [
      { label: "股票", value: "stock" as const },
      { label: "板块 / 指数", value: "sector" as const },
    ],
    { placeHolder: "请选择要添加的类型" }
  );

  if (!typePick) {
    return;
  }

  if (typePick.value === "sector") {
    await handleAddSector(stockDataProvider);
    return;
  }

  await handleAddStock(stockDataProvider);
}

async function handleAddStock(stockDataProvider: StockTreeDataProvider): Promise<void> {
  const rawCode = await vscode.window.showInputBox({
    prompt: "输入股票代码（支持逗号分隔批量输入，如 000001,000002,600519）",
    placeHolder: "可输入 sh.600519、sz.300316、AAPL，多个请用英文逗号分隔",
    validateInput: (value) => {
      const parts = splitStockInputs(value);
      if (parts.length === 0) {
        return "股票代码不能为空";
      }

      const hasInvalid = parts.some((part) => !parseUserStockInput(part));
      if (hasInvalid) {
        return "格式错误，示例：600519 / sh.600519 / AAPL，多个用英文逗号分隔";
      }
      return null;
    },
  });

  if (rawCode === undefined) {
    return;
  }

  const parts = splitStockInputs(rawCode);
  if (parts.length === 1) {
    await handleAddSingleStock(stockDataProvider, parts[0]);
    return;
  }

  await handleAddBatchStock(stockDataProvider, parts);
}

async function handleAddSingleStock(
  stockDataProvider: StockTreeDataProvider,
  rawCode: string
): Promise<void> {
  const parsed = parseUserStockInput(rawCode);
  if (!parsed) {
    return;
  }

  const detectedMarket = parsed.market ?? inferMarket(parsed.code);
  const selectedMarket = await chooseMarket(detectedMarket);
  if (!selectedMarket) {
    return;
  }

  const sharesInput = await vscode.window.showInputBox({
    prompt: "请输入持股数量（可选）",
    placeHolder: "输入大于等于0的整数，留空或0表示仅看行情",
    validateInput: (value) => {
      if (!value.trim()) {
        return null;
      }
      const num = Number(value);
      if (!Number.isInteger(num) || num < 0) {
        return "持股数量必须是大于等于0的整数";
      }
      return null;
    },
  });

  if (sharesInput === undefined) {
    return;
  }

  const shares = sharesInput.trim() ? Number(sharesInput.trim()) : 0;
  if (shares <= 0) {
    const item: StockConfigItem = {
      type: "stock",
      market: selectedMarket,
      code: parsed.code,
    };

    try {
      await stockDataProvider.addItem(item);
      vscode.window.showInformationMessage(`已添加股票 ${selectedMarket}.${parsed.code}`);
    } catch (error) {
      vscode.window.showErrorMessage(error instanceof Error ? error.message : "添加失败");
    }
    return;
  }

  const costPriceInput = await vscode.window.showInputBox({
    prompt: "请输入成本价（可选）",
    placeHolder: "输入大于0的数字，留空表示不设置",
    validateInput: (value) => {
      if (!value.trim()) {
        return null;
      }
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0) {
        return "成本价必须是大于0的数字";
      }
      return null;
    },
  });

  if (costPriceInput === undefined) {
    return;
  }

  const item: StockConfigItem = {
    type: "stock",
    market: selectedMarket,
    code: parsed.code,
    shares,
    costPrice: costPriceInput.trim() ? Number(costPriceInput.trim()) : undefined,
  };

  try {
    await stockDataProvider.addItem(item);
    vscode.window.showInformationMessage(`已添加股票 ${selectedMarket}.${parsed.code}`);
  } catch (error) {
    vscode.window.showErrorMessage(error instanceof Error ? error.message : "添加失败");
  }
}

async function handleAddBatchStock(
  stockDataProvider: StockTreeDataProvider,
  parts: string[]
): Promise<void> {
  const validItems: StockConfigItem[] = [];
  const invalidCodes: string[] = [];
  const unknownMarketCodes: string[] = [];

  for (const part of parts) {
    const parsed = parseUserStockInput(part);
    if (!parsed) {
      invalidCodes.push(part);
      continue;
    }

    const market = resolveMarket(parsed.market, parsed.code);
    if (!market) {
      unknownMarketCodes.push(part);
      continue;
    }

    validItems.push({
      type: "stock",
      market,
      code: parsed.code,
    });
  }

  if (validItems.length === 0) {
    const reasons = [
      invalidCodes.length > 0 ? `格式错误 ${invalidCodes.length} 项` : "",
      unknownMarketCodes.length > 0 ? `无法识别市场 ${unknownMarketCodes.length} 项` : "",
    ]
      .filter(Boolean)
      .join("，");
    vscode.window.showErrorMessage(`批量添加失败：未找到有效股票代码${reasons ? `（${reasons}）` : ""}`);
    return;
  }

  const result = await stockDataProvider.addItems(validItems);
  const messages = [
    `批量添加完成：新增 ${result.added} 项`,
    result.skipped > 0 ? `已跳过重复 ${result.skipped} 项` : "",
    invalidCodes.length > 0 ? `格式错误 ${invalidCodes.length} 项` : "",
    unknownMarketCodes.length > 0 ? `无法识别市场 ${unknownMarketCodes.length} 项` : "",
  ].filter(Boolean);

  vscode.window.showInformationMessage(messages.join("，"));
}

async function handleAddSector(stockDataProvider: StockTreeDataProvider): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: "请输入板块 / 指数名称",
    placeHolder: "如：航天",
    validateInput: (value) => (value.trim() ? null : "名称不能为空"),
  });
  if (name === undefined) {
    return;
  }

  const code = await vscode.window.showInputBox({
    prompt: "请输入板块 / 指数代码",
    placeHolder: "如：886078",
    validateInput: (value) => (/^\d+$/.test(value.trim()) ? null : "代码必须为数字"),
  });
  if (code === undefined) {
    return;
  }

  const item: StockConfigItem = {
    type: "sector",
    name: name.trim(),
    code: code.trim(),
  };

  try {
    await stockDataProvider.addItem(item);
    vscode.window.showInformationMessage(`已添加板块/指数 ${item.name}`);
  } catch (error) {
    vscode.window.showErrorMessage(error instanceof Error ? error.message : "添加失败");
  }
}

async function chooseMarket(defaultMarket: MarketType): Promise<MarketType | undefined> {
  const picks = marketQuickPickItems().map((item) => ({
    label: item.label,
    value: item.value,
    description: item.value === defaultMarket ? "自动识别" : undefined,
  }));

  const quickPick = vscode.window.createQuickPick<(typeof picks)[number]>();
  quickPick.title = "请选择股票市场";
  quickPick.placeholder = "请确认股票市场（可修改自动识别结果）";
  quickPick.items = picks;

  const defaultItem = picks.find((item) => item.value === defaultMarket);
  if (defaultItem) {
    quickPick.activeItems = [defaultItem];
  }

  const picked = await new Promise<(typeof picks)[number] | undefined>((resolve) => {
    const onAccept = quickPick.onDidAccept(() => {
      resolve(quickPick.selectedItems[0] ?? quickPick.activeItems[0]);
      quickPick.hide();
    });
    const onHide = quickPick.onDidHide(() => {
      resolve(undefined);
    });
    quickPick.show();

    quickPick.onDidHide(() => {
      onAccept.dispose();
      onHide.dispose();
      quickPick.dispose();
    });
  });

  return picked?.value;
}

function splitStockInputs(input: string): string[] {
  return input
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function resolveMarket(explicitMarket: MarketType | undefined, code: string): MarketType | null {
  if (explicitMarket) {
    return explicitMarket;
  }

  const normalized = code.trim().toUpperCase();
  if (/^688\d{3}$/.test(normalized) || /^60\d{4}$/.test(normalized)) {
    return "sh";
  }
  if (/^(00|30)\d{4}$/.test(normalized)) {
    return "sz";
  }
  if (/^\d{5}$/.test(normalized)) {
    return "hk";
  }
  if (/^[A-Z]+[A-Z0-9.]*$/.test(normalized)) {
    return "us";
  }

  return null;
}
