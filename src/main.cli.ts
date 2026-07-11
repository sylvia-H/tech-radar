import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PipelineService } from './pipeline/pipeline.service';
import { tryPostFailureAlert } from './discord/failure-alert';

/**
 * CLI 進入點：建立 application context（不啟 HTTP server）→ 執行 pipeline → 跑完即退。
 *
 * 失敗分層（FR-010 / FR-014）：
 * - context 建立失敗（env 驗證缺機密、DI 初始化失敗）：fail-fast，本層不推播；
 *   因未寫告警 marker，由 workflow 的補送步驟送 Discord 告警。
 * - pipeline 執行中失敗：由本層 catch → postFailureAlert 送紅色告警，成功後寫 marker
 *   供 workflow 去重；送出失敗則同樣交由 workflow 補送。之後以非零 exit 結束。
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    await app.get(PipelineService).run();
  } catch (err) {
    // app 內失敗：best-effort 送紅色告警（不遮蔽原始錯誤），再以非零 exit 結束。
    await tryPostFailureAlert(app, err);
    throw err;
  } finally {
    await app.close();
  }
}

bootstrap()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
