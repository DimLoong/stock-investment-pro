import * as https from "https";
import { TextDecoder } from "util";
import { StockData } from "../../models/stock";
import { ProviderResilienceCache } from "./providerResilienceCache";
import { SymbolRoutingRegistry } from "./symbolRoutingRegistry";
import { BatchFetchResult, QuoteErrorInfo, QuoteErrorType } from "./types";

type FetchMode = "index" | "future";
interface SingleFetchResult {
  data: StockData | null;
  errorType?: QuoteErrorType;
  message?: string;
}

export class SinaIndexFutureProvider {
  private readonly providerName = "sina_index_future";
  private readonly routingRegistry = SymbolRoutingRegistry.createDefault();
  private readonly resilience = new ProviderResilienceCache<StockData>({
    successTtlMs: 2000,
    failureBaseBackoffMs: 2000,
    failureMaxBackoffMs: 30000,
  });

  async fetchIndices(rawCodes: string[], updateTime: string): Promise<BatchFetchResult> {
    return this.fetchByMode(rawCodes, updateTime, "index");
  }

  async fetchFutures(rawCodes: string[], updateTime: string): Promise<BatchFetchResult> {
    return this.fetchByMode(rawCodes, updateTime, "future");
  }

  private async fetchByMode(rawCodes: string[], updateTime: string, mode: FetchMode): Promise<BatchFetchResult> {
    const result = new Map<string, StockData>();
    const errors = new Map<string, QuoteErrorInfo>();
    if (rawCodes.length === 0) {
      return { data: result, errors };
    }

    await Promise.all(
      rawCodes.map(async (rawCode) => {
        const normalized = rawCode.trim().toUpperCase();
        if (!normalized) {
          return;
        }

        const key = `${mode}:${normalized}`;
        const now = Date.now();
        const fresh = this.resilience.getFresh(key, now);
        if (fresh) {
          result.set(normalized, fresh);
          return;
        }

        if (!this.resilience.canAttempt(key, now)) {
          const fallback = this.resilience.getAny(key);
          if (fallback) {
            result.set(normalized, fallback);
          } else {
            errors.set(normalized, this.buildError("network_error", "请求处于失败退避窗口中"));
          }
          return;
        }

        const fetched = await this.fetchSingle(normalized, updateTime, mode);
        if (fetched.data) {
          this.resilience.onSuccess(key, fetched.data);
          result.set(normalized, fetched.data);
          return;
        }

        this.resilience.onFailure(key);
        const fallback = this.resilience.getAny(key);
        if (fallback) {
          result.set(normalized, fallback);
          return;
        }
        errors.set(
          normalized,
          this.buildError(fetched.errorType ?? "unsupported_symbol", fetched.message ?? "未查询到有效行情")
        );
      })
    );

    return { data: result, errors };
  }

  private async fetchSingle(rawCode: string, updateTime: string, mode: FetchMode): Promise<SingleFetchResult> {
    const normalized = rawCode.trim().toUpperCase();
    if (!normalized) {
      return { data: null, errorType: "unsupported_symbol", message: "代码为空" };
    }

    const candidates =
      mode === "future"
        ? this.routingRegistry.resolve("future", normalized)
        : this.routingRegistry.resolve("index", normalized);
    let sawNetworkError = false;
    let sawPayload = false;

    for (const candidate of candidates) {
      const response = await this.requestSinaPayload(candidate);
      if (response.networkError) {
        sawNetworkError = true;
      }
      const payload = response.payload;
      if (!payload) {
        continue;
      }
      sawPayload = true;

      const parsed = this.parseByCode(candidate, normalized, payload, updateTime, mode);
      if (parsed) {
        return { data: parsed };
      }
    }

    if (sawPayload) {
      return {
        data: null,
        errorType: "parse_error",
        message: "返回数据存在但解析失败（结构可能变化）",
      };
    }
    if (sawNetworkError) {
      return {
        data: null,
        errorType: "network_error",
        message: "上游接口网络请求失败",
      };
    }
    return {
      data: null,
      errorType: "unsupported_symbol",
      message: "未命中可用路由或上游返回空数据",
    };
  }

  private requestSinaPayload(requestCode: string): Promise<{ payload: string; networkError: boolean }> {
    return new Promise((resolve) => {
      const req = https.request(
        {
          method: "GET",
          hostname: "hq.sinajs.cn",
          path: `/list=${requestCode}`,
          headers: {
            Referer: "https://finance.sina.com.cn",
            "User-Agent": "Mozilla/5.0",
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          res.on("end", () => {
            const body = this.decodeBody(chunks);
            const line = body
              .split("\n")
              .find((it) => it.startsWith(`var hq_str_${requestCode}=`));
            if (!line) {
              resolve({ payload: "", networkError: false });
              return;
            }
            const matched = line.match(/^var\s+hq_str_[^=]+=\"(.*)\";?$/);
            resolve({ payload: matched?.[1] ?? "", networkError: false });
          });
        }
      );

      req.on("error", (error) => {
        console.error("获取新浪指数/期货数据失败:", error);
        resolve({ payload: "", networkError: true });
      });

      req.end();
    });
  }

  private decodeBody(chunks: Buffer[]): string {
    const buffer = Buffer.concat(chunks);
    if (buffer.length === 0) {
      return "";
    }

    try {
      return new TextDecoder("gb18030").decode(buffer);
    } catch {
      return buffer.toString("utf8");
    }
  }

  private parseByCode(
    requestCode: string,
    code: string,
    payload: string,
    updateTime: string,
    mode: FetchMode
  ): StockData | null {
    if (mode === "index") {
      if (requestCode.startsWith("gb_")) {
        return this.parseGlobalIndex(code, requestCode, payload, updateTime);
      }
      if (requestCode.startsWith("rt_hk")) {
        return this.parseRealtimeHkIndex(code, requestCode, payload, updateTime);
      }
      return null;
    }

    if (requestCode.startsWith("nf_")) {
      return this.parseDomesticFuture(code, requestCode, payload, updateTime);
    }
    if (requestCode.startsWith("hf_")) {
      return this.parseOverseasFuture(code, requestCode, payload, updateTime);
    }
    return null;
  }

  private parseGlobalIndex(code: string, requestCode: string, payload: string, updateTime: string): StockData | null {
    const p = payload.split(",");
    const name = p[0] || code;
    const current = this.toNumber(p[1]);
    const changePercent = this.toNumber(p[2]);
    const change = this.toNumber(p[4]);

    if (!Number.isFinite(current)) {
      return null;
    }

    const previousClose = Number.isFinite(change) ? current - change : Number.NaN;

    return {
      code: requestCode,
      name,
      current: current.toFixed(3),
      change: Number.isFinite(change) ? change.toFixed(3) : "0.000",
      changePercent: Number.isFinite(changePercent) ? changePercent.toFixed(2) : "0.00",
      previousClose: Number.isFinite(previousClose) ? previousClose.toFixed(3) : current.toFixed(3),
      updateTime,
    };
  }

  private parseRealtimeHkIndex(code: string, requestCode: string, payload: string, updateTime: string): StockData | null {
    const p = payload.split(",");
    const name = p[1] || code;
    const current = this.toNumber(p[2]);
    const previousClose = this.toNumber(p[6]);
    const change = this.toNumber(p[7]);
    const changePercent = this.toNumber(p[8]);

    if (!Number.isFinite(current)) {
      return null;
    }

    return {
      code: requestCode,
      name,
      current: current.toFixed(3),
      change: Number.isFinite(change) ? change.toFixed(3) : "0.000",
      changePercent: Number.isFinite(changePercent) ? changePercent.toFixed(2) : "0.00",
      previousClose: Number.isFinite(previousClose) ? previousClose.toFixed(3) : current.toFixed(3),
      updateTime,
    };
  }

  private parseDomesticFuture(code: string, requestCode: string, payload: string, updateTime: string): StockData | null {
    const p = payload.split(",");

    let name = code;
    let current = Number.NaN;
    let previousClose = Number.NaN;

    if (p.length > 6 && Number.isNaN(this.toNumber(p[0]))) {
      // Commodity futures: name,time,open,prevClose,current,...
      name = p[0] || code;
      previousClose = this.toNumber(p[3]);
      current = this.toNumber(p[4]);
    } else {
      // Financial futures: open,high,low,current,...,prevClose(index 13)
      current = this.toNumber(p[3]);
      previousClose = this.toNumber(p[13]);
    }

    if (!Number.isFinite(current)) {
      return null;
    }

    const change = Number.isFinite(previousClose) ? current - previousClose : Number.NaN;
    const changePercent =
      Number.isFinite(previousClose) && previousClose !== 0 ? (change / previousClose) * 100 : Number.NaN;

    return {
      code: requestCode,
      name,
      current: current.toFixed(3),
      change: Number.isFinite(change) ? change.toFixed(3) : "0.000",
      changePercent: Number.isFinite(changePercent) ? changePercent.toFixed(2) : "0.00",
      previousClose: Number.isFinite(previousClose) ? previousClose.toFixed(3) : current.toFixed(3),
      updateTime,
    };
  }

  private parseOverseasFuture(code: string, requestCode: string, payload: string, updateTime: string): StockData | null {
    const p = payload.split(",");
    // hf_* usually: latest, bid/ask..., high, low, time, open, prevClose, ..., date, name
    const current = this.toNumber(p[0]);
    const previousClose = this.toNumber(p[8]);
    const fallbackPrev = this.toNumber(p[7]);
    const name = p[13] || code;

    if (!Number.isFinite(current)) {
      return null;
    }

    const prev = Number.isFinite(previousClose)
      ? previousClose
      : Number.isFinite(fallbackPrev)
        ? fallbackPrev
        : Number.NaN;
    const change = Number.isFinite(prev) ? current - prev : Number.NaN;
    const changePercent = Number.isFinite(prev) && prev !== 0 ? (change / prev) * 100 : Number.NaN;

    return {
      code: requestCode,
      name,
      current: current.toFixed(3),
      change: Number.isFinite(change) ? change.toFixed(3) : "0.000",
      changePercent: Number.isFinite(changePercent) ? changePercent.toFixed(2) : "0.00",
      previousClose: Number.isFinite(prev) ? prev.toFixed(3) : current.toFixed(3),
      updateTime,
    };
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

  private buildError(type: QuoteErrorType, message: string): QuoteErrorInfo {
    return {
      type,
      provider: this.providerName,
      message,
    };
  }
}
