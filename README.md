# 侧边栏股票看盘工具 Sidebar Stock

一个在 VS Code 侧边栏查看股票、指数、期货和板块行情的插件，支持自选管理、持仓配置和实时盈亏展示。

> 此项目Fork from [coderwang/stock-investment](https://github.com/coderwang/stock-investment)

> 感谢原作者：[@coderwang](https://github.com/coderwang)

## 效果展示

在侧边栏中展示自选股涨跌情况，每隔3秒自动刷新，示例如下：

<img src="./src/assets/img-0.png" alt="示例图" width="40%">

---

## 使用方式

### 快捷方式：

点击标签栏右侧加号进行新增自选股票，支持A股，美股，板块

<img src="./src/assets/img-1.png" alt="操作示例" width="60%">

输入股票代码

<img src="./src/assets/img-2.png" alt="操作示例" width="60%">

自动识别股票市场

<img src="./src/assets/img-3.png" alt="操作示例" width="60%">

[可选] 输入持仓数（股）

<img src="./src/assets/img-4.png" alt="操作示例" width="60%">

[可选] 输入持仓成本

<img src="./src/assets/img-5.png" alt="操作示例" width="60%">

## 手动配置

在`VS Code Settings`中配置自选股代码与标签名称，示例如下：

```
"sidebarStock.tabName": "Sidebar Stock",    //自定义标签组标题
"sidebarStock.alerts.enabled": true,        //是否启用异动提示（3分钟内涨跌幅达4%）
"sidebarStock.alerts.windowMinutes": 3,     //异动监测时间范围/分钟
"sidebarStock.alerts.changePercent": 4,     //异动监测涨跌幅/%
"sidebarStock.alerts.cooldownMinutes": 10,  //异动提醒持续时长/分钟
"sidebarStock.stockCodeList": [
        {
            "type": "stock",    //类型 stock股票/sector板块
            "market": "sh",     //股票市场"sz" | "sh" | "hk" | "us";
            "code": "00001",    //股票代码
            "name": "上证指数",  //可选，自定义显示名称
            "shares": 200,      //持股数（股）
            "costPrice": 20,    //成本价
            "costDate": "2026-04-23" //购入时间（可选，影响今日盈亏和总盈亏数据 YYYY-MM-DD）
        },
        {
            "type": "sector",
            "code": "886078",
            "name": "商业航天"
        },
        {
            "type": "index",
            "code": "DJI",
            "name": "道琼斯指数"
        },
        {
            "type": "future",
            "code": "IF0",
            "name": "沪深300股指主连"
        },
        {
            "type": "stock",
            "market": "us",
            "code": "AAPL"
        }
    ]
```

列表顺序默认按 `sidebarStock.stockCodeList` 的数组顺序展示，拖拽排序会自动重排并持久化该数组，无需手动维护 `order` 字段。

添加股票命令支持批量输入，示例：`000001,000002,600519,300750`（英文逗号分隔）。

## 盈亏口径说明

- 持仓盈亏：`(现价 - 成本价) × 持仓数量`
- 今日盈亏：
    - 未设置 `costDate` 或 `costDate` 早于今天：按市场口径 `(现价 - 昨收价) × 持仓数量`
    - `costDate` 为今天：按 `(现价 - 成本价) × 持仓数量`
    - `costDate` 非法或晚于今天：自动降级为市场口径（不会导致插件报错）

## 股票异动

异动提醒默认开启：当股票在任意连续 3 分钟内涨跌幅达到 4% 时触发提醒，并按 `cooldownMinutes` 控制提醒持续时间与防抖。

开发者测试异动可开启：

```json
"sidebarStock.devMode": true,
"sidebarStock.dev.alertTestStockEnabled": true
```

开启后会自动注入一只 `[DEV] 异动测试股`（虚拟行情数据，不依赖后端接口），用于快速验证列表异动高亮、展开提示、标签栏提醒。

---

## Todo

1. 股票异动在标签栏提醒 ✅
2. 期货类型支持 ✅
3. 将获取的数据保存在本地，进行一个虚拟k线图渲染
4. 隐式配置项目的order属性，自动根据json项目排列，这样手动改setting无需在意order属性 ✅
5. 【基础优化】刷新请求并发保护（TreeView 高频轮询场景）
   问题：当前 3s 轮询 + 配置变更刷新可能重叠，存在重复请求、状态抖动风险。
   方案：在 StockTreeDataProvider.refresh() 增加 in-flight 锁与“最后一次刷新合并”机制（coalescing）；旧刷新未完成时仅记录一次 pending。
   优先级：高

【基础优化】数据源失败可视化与降级说明
问题：当前“加载失败”信息过于笼统，用户无法判断是代码无效、路由错误还是上游接口异常。
方案：在 provider 返回中附带错误类型（unsupported_symbol / network_error / parse_error），TreeItem description 显示简短错误码，tooltip 显示详细原因。
优先级：高

【基础优化】future/index 路由规则配置化
问题：nf*/hf*/gb\_/rt_hk 路由规则目前主要写死在代码，后续维护成本高。
方案：抽出 SymbolRoutingRegistry（按 type + pattern 匹配），支持集中维护和单元测试；先做代码内 registry，后续再考虑 settings 覆盖。
优先级：高

【基础优化】README 与 settings 示例自动对齐
问题：功能迭代后 README 示例易过期，导致用户配置误用。
方案：将 package.json contributes.configuration 的关键键和示例配置生成到 README（脚本化校验/生成）。
优先级：中

【基础优化】新增“移动排序”命令（键盘友好）
问题：拖拽排序对触控板/键盘用户不友好。
方案：增加 上移/下移 命令（作用于当前项），复用现有 reorder 持久化逻辑。
优先级：中

【进阶优化】异动提醒增加静默窗口与交易时段开关
问题：非交易时段或低流动时段提醒噪声较大。
方案：新增 alerts.tradingHoursOnly、alerts.quietHours，在 updateAlertStates 前做时段过滤；默认关闭以保持兼容。
优先级：中

【进阶优化】持仓统计扩展为“分组汇总”
问题：目前 summary 仅总量，不利于多市场/多类型观察。
方案：在 summary 下增加可展开分组（A/HK/US、index/future），保持 root 仍简洁。
优先级：中

【进阶优化】Provider 层增加 TTL 缓存与失败退避
问题：网络波动时会反复请求失败接口。
方案：给每个 provider 增加短 TTL 缓存与指数退避（仅失败路径），减少上游压力与 UI 抖动。
优先级：中

【长期方向】引入统一 QuoteDomain 模型
问题：stock/index/future/sector 在展示和计算逻辑中仍有分支散落。
方案：定义统一 QuoteInstrument + capability 标记（supportsHolding/supportsAlert），减少 Tree 层条件判断。
优先级：低

【长期方向】增加只读 Webview 详情页（非替代 TreeView）
问题：TreeView 适合速览，不适合展示多维历史信息。
方案：保留 TreeView 为主入口，新增可选 Webview 详情（分钟走势、异动历史、来源标记），按需打开。
优先级：低

【长期方向】回归测试基线（路由与解析）
问题：多源策略下，symbol 路由回归风险高。
方案：增加 provider 级 fixture 测试（DJI/IXIC/HSI/IF0/AU0/CL/XAU），CI 里跑解析快照与路由断言。
优先级：低
