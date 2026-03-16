#!/bin/bash

# 加密货币监控平台启动脚本

echo "正在启动加密货币监控平台..."
echo ""
echo "默认监控币种："
echo "  - BTCUSDT (比特币)"
echo "  - ETHUSDT (以太坊)"
echo "  - BNBUSDT (币安币)"
echo ""
echo "启动后可以使用以下命令："
echo "  add <SYMBOL>    - 添加监控币种"
echo "  remove <SYMBOL> - 移除监控币种"
echo "  list            - 列出所有监控币种"
echo "  exit            - 退出程序"
echo ""

npm run dev
