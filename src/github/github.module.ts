import { Module } from '@nestjs/common';
import { GithubHttpService } from './github-http';

/**
 * GitHub HTTP 客戶端共享模組：全 app 單一 `GithubHttpService` 實例，讓 rate-limit 節流
 * 狀態（`low`）與 core/search 呼叫計數在所有資料流（榜單、簡介 README…）間共用——避免各
 * 模組各自 `providers` 造成平行實例、繞過免費層限額護欄並低估用量（憲章 I／SC-006）。
 * ConfigModule 為全域，`GithubHttpService` 直接注入 ConfigService 取 GH_API_TOKEN。
 */
@Module({
  providers: [GithubHttpService],
  exports: [GithubHttpService],
})
export class GithubModule {}
