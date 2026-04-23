export type SymbolRouteType = "index" | "future";

interface SymbolRouteRule {
  type: SymbolRouteType;
  pattern: RegExp | ((code: string) => boolean);
  build: (code: string) => string[];
}

export class SymbolRoutingRegistry {
  constructor(private readonly rules: SymbolRouteRule[]) {}

  static createDefault(): SymbolRoutingRegistry {
    const rules: SymbolRouteRule[] = [
      // Index routing
      {
        type: "index",
        pattern: /^(GB_|RT_HK)/,
        build: (code) => [code.toLowerCase()],
      },
      {
        type: "index",
        pattern: /^HSI$/,
        build: () => ["rt_hkHSI"],
      },
      {
        type: "index",
        pattern: /^IXIC$/,
        build: () => ["gb_ixic"],
      },
      {
        type: "index",
        pattern: /^DJI$/,
        build: () => ["gb_dji", "gb_djia"],
      },
      {
        type: "index",
        pattern: /^SPX$/,
        build: () => ["gb_inx", "gb_spx"],
      },
      {
        type: "index",
        pattern: /.*/,
        build: (code) => [`gb_${code.toLowerCase()}`],
      },
      // Future routing
      {
        type: "future",
        pattern: /^(NF_|HF_)/,
        build: (code) => {
          const [prefix, ...rest] = code.split("_");
          const symbol = rest.join("_").toUpperCase();
          return [`${prefix.toLowerCase()}_${symbol}`];
        },
      },
      {
        type: "future",
        pattern: /^[A-Z]{2,6}$/,
        build: (code) => [`hf_${code.toUpperCase()}`, `nf_${code.toUpperCase()}`],
      },
      {
        type: "future",
        pattern: /.*/,
        build: (code) => [`nf_${code.toUpperCase()}`, `hf_${code.toUpperCase()}`],
      },
    ];

    return new SymbolRoutingRegistry(rules);
  }

  resolve(type: SymbolRouteType, code: string): string[] {
    const normalized = code.trim().toUpperCase();
    if (!normalized) {
      return [];
    }

    for (const rule of this.rules) {
      if (rule.type !== type) {
        continue;
      }
      if (this.matches(rule.pattern, normalized)) {
        return this.unique(rule.build(normalized));
      }
    }

    return [];
  }

  private matches(pattern: SymbolRouteRule["pattern"], code: string): boolean {
    if (typeof pattern === "function") {
      return pattern(code);
    }
    return pattern.test(code);
  }

  private unique(items: string[]): string[] {
    return [...new Set(items.filter((item) => item.trim().length > 0))];
  }
}
