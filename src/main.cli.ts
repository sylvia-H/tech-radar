import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PipelineService } from './pipeline/pipeline.service';
import { DiscordWebhookService } from './discord/discord.webhook.service';

/**
 * CLI 進入點：建立 application context（不啟 HTTP server）→ 執行 pipeline → 跑完即退。
 *
 * 失敗分層（FR-010 / FR-014）：
 * - context 建立失敗（env 驗證缺機密）：fail-fast，不推播（無有效 webhook；FR-003），交由 job 失敗可見。
 * - pipeline 執行中失敗：由本層 catch → postFailureAlert 送紅色告警後以非零 exit 結束。
 */
async function bootstrap(): Promise<void> {
  // env 驗證於此發生；缺機密即擲錯 → fail-fast，不推播。
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    await app.get(PipelineService).run();
  } catch (err) {
    // app 內失敗：送紅色告警（best-effort，不遮蔽原始錯誤），再以非零 exit 結束。
    await tryPostFailureAlert(app, err);
    throw err;
  } finally {
    await app.close();
  }
}

async function tryPostFailureAlert(
  app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>,
  err: unknown,
): Promise<void> {
  try {
    const summary = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await app.get(DiscordWebhookService).postFailureAlert(summary);
  } catch (alertErr) {
    console.error('送出失敗告警時再度失敗：', alertErr);
  }
}

bootstrap()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
