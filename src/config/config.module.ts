import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema';

/**
 * 全域設定模組：載入環境變數並以 zod schema 驗證，缺失/無效即 fail-fast（憲章 VII、FR-003）。
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: validateEnv,
    }),
  ],
})
export class ConfigModule {}
