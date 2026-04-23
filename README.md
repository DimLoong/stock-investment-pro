# 侧边栏股票看盘工具 Sidebar Stock

一个在 VS Code 侧边栏查看股票、指数、期货和板块行情的插件，支持自选管理、持仓配置和实时盈亏展示。

> 此项目Fork from [coderwang/stock-investment](https://github.com/coderwang/stock-investment)

> 感谢原作者：[@coderwang](https://github.com/coderwang)

## 效果展示

在侧边栏中展示自选股涨跌情况，每隔3秒自动刷新，示例如下：

<img src="./src/assets/img-0.webp" alt="示例图" width="40%">

---

## 使用方式

### 快捷方式：

点击标签栏右侧加号进行新增自选股票，支持A股，美股，板块

<img src="./src/assets/img-1.webp" alt="操作示例" width="60%">

输入股票代码

<img src="./src/assets/img-2.webp" alt="操作示例" width="60%">

自动识别股票市场

<img src="./src/assets/img-3.webp" alt="操作示例" width="60%">

[可选] 输入持仓数（股）

<img src="./src/assets/img-4.webp" alt="操作示例" width="60%">

[可选] 输入持仓成本

<img src="./src/assets/img-5.webp" alt="操作示例" width="60%">

## 手动配置

在`VS Code Settings`中配置自选股代码与标签名称，示例如下：

```json
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
右键普通列表项可使用 `置顶 / 取消置顶`。置顶项会显示为 `名称 📌`，并固定在 summary 区域下方；新置顶的项目会排在置顶区最上方。置顶状态由插件自动维护，无需手动编辑 `isPinned/pinnedAt`。

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

## 数据源失败提示

当某个标的加载失败时，列表会显示简短错误码：

- `ERR:UNSUPPORTED`：代码不支持或路由未命中
- `ERR:NETWORK`：网络请求失败或处于失败退避窗口
- `ERR:PARSE`：上游返回结构变化导致解析失败

将鼠标悬停在失败项上可查看详细原因（来源 provider + 错误详情）。

---

## Todo

1. 股票异动在标签栏提醒 ✅
2. 期货类型支持 ✅
3. 将获取的数据保存在本地，悬浮股票项时进行虚拟k线图渲染
4. 隐式配置项目的order属性，自动根据json项目排列，手动改setting无需在意order ✅
5. 右键股票项的菜单加入置顶/取消置顶选项 ✅
6. refresh增加in-flight锁与合并机制，避免轮询与手动刷新重叠导致重复请求与状态抖动 ✅
7. fetch数据源失败可视化 ✅
8. future/index 路由规则配置化 ✅
9. 缓存与退避机制 ✅
