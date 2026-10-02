import { config, databaseConfig } from './config';
import { InvestmentMonitor } from './monitor';

const DEFAULT_PLAN_REFRESH_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 30_000;

function planRefreshInterval(): number {
  const value = Number(process.env.MONITOR_PLAN_REFRESH_MS ?? DEFAULT_PLAN_REFRESH_MS);
  if (!Number.isSafeInteger(value) || value < 5_000) {
    throw new Error('MONITOR_PLAN_REFRESH_MS 必须是至少 5000 的整数（毫秒）');
  }
  return value;
}

async function main(): Promise<void> {
  if (databaseConfig.driver !== 'mysql') {
    throw new Error('价格监控 worker 必须配置 DATABASE_DRIVER=mysql，以便与 Vercel API 共享资产和价格数据');
  }
  if (!Number.isSafeInteger(config.interval) || config.interval < 1_000 || config.interval > 2_147_483_647) {
    throw new Error('MONITOR_INTERVAL 必须是 1000 至 2147483647 的整数（毫秒）');
  }

  const refreshMs = planRefreshInterval();
  const monitor = new InvestmentMonitor();
  const startup = monitor.start();
  let refreshing = false;
  let refreshTimer: NodeJS.Timeout | undefined;
  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    if (refreshTimer) clearInterval(refreshTimer);
    console.log(`\n收到 ${signal}，等待当前采价和通知完成...`);
    const timeout = setTimeout(() => {
      console.error('❌ 监控停止超时');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timeout.unref();
    void startup.then(() => monitor.stop())
      .then(() => {
        clearTimeout(timeout);
        process.exit(0);
      })
      .catch(error => {
        clearTimeout(timeout);
        console.error('❌ 监控停止失败:', error);
        process.exit(1);
      });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  await startup;
  if (stopping) return;
  refreshTimer = setInterval(() => {
    if (refreshing) return;
    refreshing = true;
    void monitor.scheduleAll()
      .catch(error => console.error('❌ 刷新监控资产计划失败:', error))
      .finally(() => { refreshing = false; });
  }, refreshMs);
  console.log(`🔄 每 ${refreshMs / 1000} 秒从共享 MySQL 刷新监控资产计划`);
}

void main().catch(error => {
  console.error('❌ 价格监控 worker 启动失败:', error);
  process.exit(1);
});
