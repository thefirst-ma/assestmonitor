import { InvestmentMonitor } from './monitor';
import { AssetType } from './types';
import * as readline from 'readline';

const monitor = new InvestmentMonitor();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function showHelp(): void {
  console.log('\n📖 可用命令:');
  console.log('  add <type> <symbol> [name] - 添加监控 (例: add crypto BTCUSDT Bitcoin)');
  console.log('  remove <id>               - 移除监控 (例: remove crypto:BTCUSDT)');
  console.log('  list                      - 列出所有监控资产');
  console.log('  help                      - 显示帮助');
  console.log('  exit                      - 退出程序');
  console.log('\n  支持的类型: crypto(加密货币), stock(股票), metal(贵金属), forex(外汇)\n');
}

async function handleCommand(input: string): Promise<void> {
  const [cmd, ...args] = input.trim().split(' ');

  switch (cmd.toLowerCase()) {
    case 'add':
      if (args.length < 2) {
        console.log('❌ 用法: add <type> <symbol> [name]');
        console.log('   例: add crypto BTCUSDT Bitcoin/USDT');
        break;
      }
      try {
        const type = args[0] as AssetType;
        const symbol = args[1].toUpperCase();
        const name = args.slice(2).join(' ') || symbol;
        await monitor.addAsset(type, symbol, name);
      } catch (error: any) {
        console.error('❌', error.message);
      }
      break;

    case 'remove':
      if (args.length === 0) {
        console.log('❌ 请指定资产 ID，例: remove crypto:BTCUSDT');
        break;
      }
      monitor.removeAsset(args[0]);
      break;

    case 'list':
      monitor.listAssets();
      break;

    case 'help':
      showHelp();
      break;

    case 'exit':
      console.log('👋 再见！');
      monitor.stop();
      rl.close();
      process.exit(0);
      break;

    default:
      if (cmd) console.log('❌ 未知命令，输入 help 查看帮助');
  }
}

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   投资标的监控平台 CLI v1.0            ║');
  console.log('╚════════════════════════════════════════╝\n');

  showHelp();

  await monitor.start();

  rl.on('line', async (input) => {
    await handleCommand(input);
    rl.prompt();
  });

  rl.setPrompt('monitor> ');
  rl.prompt();
}

process.on('SIGINT', () => {
  console.log('\n\n👋 收到退出信号，正在关闭...');
  monitor.stop();
  rl.close();
  process.exit(0);
});

main().catch(console.error);
