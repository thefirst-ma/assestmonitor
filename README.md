# 投资标的监控平台

通用的投资标的价格监控系统，支持加密货币、股票、黄金、期权等多种资产类型。

## 功能特性

- ✅ 多资产类型支持（加密货币、股票、黄金、期权等）
- ✅ 实时价格监控
- ✅ 自定义涨跌幅阈值警报
- ✅ 多种通知方式（邮件、钉钉、企业微信、Telegram）
- ✅ 历史数据存储
- ✅ Web 可视化界面

## 支持的资产类型

### 1. 加密货币
- 数据源：Binance API
- 示例：BTC/USDT, ETH/USDT

### 2. 股票
- 数据源：Yahoo Finance API
- 示例：AAPL, TSLA, 600519.SS（贵州茅台）

### 3. 黄金/贵金属
- 数据源：金属价格 API
- 示例：XAU/USD（黄金）, XAG/USD（白银）

### 4. 外汇
- 数据源：外汇 API
- 示例：EUR/USD, GBP/USD

## 快速开始

```bash
npm install
npm run dev
```

访问：http://localhost:3001

## 配置说明

在 Web 界面中可以：
1. 添加任意资产进行监控
2. 设置监控间隔和涨跌幅阈值
3. 配置通知方式

## 添加监控示例

```
加密货币：CRYPTO:BTCUSDT
股票：STOCK:AAPL
黄金：METAL:XAUUSD
外汇：FOREX:EURUSD
```
