import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PipelineService } from './pipeline/pipeline.service';
import { NewsIngestService } from './news/news-ingest.service';
import { PublishService } from './publish/publish.service';
import { tryPostFailureAlert } from './discord/failure-alert';

/** 設為 `1` 時只跑 F4 階段 A 新聞漏斗、印出候選清單觀測（不推播）。 */
const NEWS_OBSERVE_ENV = 'NEWS_INGEST_OBSERVE';
/** 設為 `1` 時只跑 F8 發佈段（獨立 `publish` job 用），不跑 `PipelineService`（research D2）。 */
const PUBLISH_MODE_ENV = 'PUBLISH_MODE';

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
    if (process.env[NEWS_OBSERVE_ENV] === '1') {
      // F4 觀測模式：只跑階段 A 新聞漏斗、印出候選清單（不推播；正式串接進 pipeline 屬 F7）。
      await app.get(NewsIngestService).ingest();
    } else if (process.env[PUBLISH_MODE_ENV] === '1') {
      // F8 發佈段：PublishService.run() 永不 throw（頂層 catch-all，best-effort 告警），
      // 故此分支自然一律以 exit 0 結束，不進入既有 PipelineService 失敗路徑（research D10）。
      await app.get(PublishService).run();
    } else {
      await app.get(PipelineService).run();
    }
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
