import * as http from "http";
import { StockData } from "../models/stock";

export class StockApiService {
  async fetchBatchStocks(stockCodeList: string[], updateTime: string): Promise<Map<string, StockData>> {
    const secids = stockCodeList.join(",");
    const url = `http://push2delay.eastmoney.com/api/qt/ulist.np/get?secids=${secids}&fields=f12,f13,f14,f2,f4,f3,f18`;

    return new Promise((resolve) => {
      http
        .get(url, (res) => {
          let data = "";

          res.on("data", (chunk) => {
            data += chunk;
          });

          res.on("end", () => {
            const parsed = this.parseResponse(data, updateTime);
            resolve(parsed);
          });
        })
        .on("error", (error) => {
          console.error("批量获取股票数据失败:", error);
          resolve(new Map());
        });
    });
  }

  async fetchBatchSectors(sectorCodes: string[], updateTime: string): Promise<Map<string, StockData>> {
    const result = new Map<string, StockData>();
    if (sectorCodes.length === 0) {
      return result;
    }

    await Promise.all(
      sectorCodes.map(async (code) => {
        const data = await this.fetchSector(code, updateTime);
        if (data) {
          result.set(code, data);
        }
      })
    );

    return result;
  }

  private parseResponse(data: string, updateTime: string): Map<string, StockData> {
    const result = new Map<string, StockData>();

    try {
      const jsonData = JSON.parse(data);
      const stocks = jsonData?.data?.diff;
      if (!Array.isArray(stocks)) {
        return result;
      }

      for (const stockData of stocks) {
        if (!stockData) {
          continue;
        }

        const marketCode = stockData.f13;
        const code = stockData.f12;
        const stockCode = `${marketCode}.${code}`;
        const name = stockData.f14 || stockCode;

        const isHKorUS = marketCode === 116 || marketCode === 105 || marketCode === 106 || marketCode === 107;
        const divisor = isHKorUS ? 1000 : 100;
        const decimals = isHKorUS ? 3 : 2;

        const current = (stockData.f2 / divisor).toFixed(decimals);
        const changePercent = (stockData.f3 / 100).toFixed(2);
        const change = (stockData.f4 / divisor).toFixed(decimals);
        const previousClose = (stockData.f18 / divisor).toFixed(decimals);

        result.set(stockCode, {
          code: stockCode,
          name,
          current,
          change,
          changePercent,
          previousClose,
          updateTime,
        });
      }
    } catch (error) {
      console.error("批量解析股票数据错误:", error);
    }

    return result;
  }

  private fetchSector(code: string, updateTime: string): Promise<StockData | null> {
    const url = `http://d.10jqka.com.cn/v6/realhead/bk_${code}/last.js`;
    return new Promise((resolve) => {
      http
        .get(url, (res) => {
          let data = "";

          res.on("data", (chunk) => {
            data += chunk;
          });

          res.on("end", () => {
            resolve(this.parseSectorResponse(data, code, updateTime));
          });
        })
        .on("error", (error) => {
          console.error(`获取板块数据失败: ${code}`, error);
          resolve(null);
        });
    });
  }

  private parseSectorResponse(data: string, code: string, updateTime: string): StockData | null {
    try {
      const matched = data.match(/\((\{.*\})\)\s*$/);
      if (!matched?.[1]) {
        return null;
      }

      const parsed = JSON.parse(matched[1]);
      const items = parsed?.items;
      if (!items || typeof items !== "object") {
        return null;
      }

      const currentNum = this.toNumber(items["10"]);
      if (!Number.isFinite(currentNum)) {
        return null;
      }

      const previousNum = this.toNumber(items["6"]);
      const changeNum = this.toNumber(items["264648"]);
      const changePercentNum = this.toNumber(items["199112"]);

      const previousClose = Number.isFinite(previousNum)
        ? previousNum
        : currentNum - (Number.isFinite(changeNum) ? changeNum : 0);
      const change = Number.isFinite(changeNum) ? changeNum : currentNum - previousClose;
      const changePercent =
        Number.isFinite(changePercentNum)
          ? changePercentNum
          : previousClose !== 0
            ? (change / previousClose) * 100
            : 0;

      return {
        code: `bk.${code}`,
        name: String(items.name || code),
        current: currentNum.toFixed(3),
        change: change.toFixed(3),
        changePercent: changePercent.toFixed(2),
        previousClose: previousClose.toFixed(3),
        updateTime,
      };
    } catch (error) {
      console.error(`解析板块数据失败: ${code}`, error);
      return null;
    }
  }

  private toNumber(value: unknown): number {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value !== "string") {
      return Number.NaN;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return Number.NaN;
    }
    return Number(trimmed);
  }
}
