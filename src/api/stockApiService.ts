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
}
