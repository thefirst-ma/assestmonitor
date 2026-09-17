import { recommendationConfig } from './config';
import { RecommendationService, recommendationService } from './services/recommendation';

export class RecommendationScheduler {
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastRunDate = '';

  constructor(private readonly service: RecommendationService = recommendationService) {}

  start(): void {
    if (!recommendationConfig.enabled) {
      console.log('📌 长期股票推荐日报未启用（RECOMMENDATION_ENABLED=true 可开启）');
      return;
    }

    if (this.running) return;
    this.running = true;

    console.log(
      `📌 长期股票推荐日报已启用: 每天 ${recommendationConfig.timezone} ${this.pad(recommendationConfig.hour)}:${this.pad(recommendationConfig.minute)}`
    );

    if (recommendationConfig.runOnStart) {
      this.runNow('startup').catch(error => {
        console.error('长期股票推荐日报启动发送失败:', error.message);
      });
    }

    this.timer = setInterval(() => {
      this.tick().catch(error => {
        console.error('长期股票推荐日报调度失败:', error.message);
      });
    }, 60 * 1000);

    this.tick().catch(error => {
      console.error('长期股票推荐日报首次检查失败:', error.message);
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.running = false;
  }

  async runNow(reason = 'manual'): Promise<void> {
    const current = this.currentTimeParts();
    this.lastRunDate = current.date;
    console.log(`📌 正在生成长期股票推荐日报 (${reason})...`);
    const { recommendations } = await this.service.generateAndSaveRecommendations(reason);
    await this.service.sendTelegramReport(recommendations);
    console.log('📌 长期股票推荐日报已发送');
  }

  private async tick(): Promise<void> {
    const current = this.currentTimeParts();
    if (current.date === this.lastRunDate) return;
    if (current.hour !== recommendationConfig.hour || current.minute !== recommendationConfig.minute) return;
    await this.runNow('schedule');
  }

  private currentTimeParts(): { date: string; hour: number; minute: number } {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: recommendationConfig.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(new Date());
    const get = (type: string) => parts.find(part => part.type === type)?.value || '0';
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      hour: parseInt(get('hour'), 10),
      minute: parseInt(get('minute'), 10)
    };
  }

  private pad(value: number): string {
    return value.toString().padStart(2, '0');
  }
}

export const recommendationScheduler = new RecommendationScheduler();
