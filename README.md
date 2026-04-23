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
            "order": 0,         //序号
            "shares": 200,      //持股数（股）
            "costPrice": 20     //成本价
        },
        {
            "type": "sector",
            "code": "886078",
            "name": "商业航天",
            "order": 1
        },
        {
            "type": "index",
            "code": "DJI",
            "name": "道琼斯指数",
            "order": 2
        },
        {
            "type": "future",
            "code": "IF0",
            "name": "沪深300股指主连",
            "order": 3
        },
        {
            "type": "stock",
            "market": "us",
            "code": "AAPL",
            "order": 4
        }
    ]
```

添加股票命令支持批量输入，示例：`000001,000002,600519,300750`（英文逗号分隔）。

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
