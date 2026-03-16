import { CryptoMonitor } from './monitor';
import * as readline from 'readline';

const monitor = new CryptoMonitor();

// 命令行交互
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function showHelp(): void {
  console.log('\n📖 可用命令:');
  console.log('  add <SYMBOL>    - 添加监控币种 (例: add BTCUSDT)');
  console.log('  remove <SYMBOL> - 移除监控币种');
  console.log('  list            - 列出所有监控币种');
  console.log('  help            - 显示帮助');
  console.log('  exit            - 退出程序\n');
}

async function handleCommand(input: string): Promise<void> {
  const [cmd, ...args] = input.trim().split(' ');

  switch (cmd.toLowerCase()) {
    case 'add':
      if (args.length === 0) {
        console.log('❌ 请指定币种，例: add BTCUSDT');
        break;
      }
      try {
        await monitor.addSymbol(args[0].toUpperCase());
      } catch (error: any) {
        console.error('❌', error.message);
      }
      break;

    case 'remove':
      if (args.length === 0) {
        console.log('❌ 请指定币种');
        break;
      }
      monitor.removeSymbol(args[0].toUpperCase());
      break;

    case 'list':
      monitor.listSymbols();
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
      console.log('❌ 未知命令，输入 help 查看帮助');
  }
}

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   加密货币市场监控平台 v1.0           ║');
  console.log('╚════════════════════════════════════════╝\n');

  showHelp();

  // 启动监控
  await monitor.start();

  // 命令行循环
  rl.on('line', async (input) => {
    await handleCommand(input);
    rl.prompt();
  });

  rl.setPrompt('crypto-monitor> ');
  rl.prompt();
}

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n\n👋 收到退出信号，正在关闭...');
  monitor.stop();
  rl.close();
  process.exit(0);
});

main().catch(console.error);
