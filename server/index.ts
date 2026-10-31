/** 本地开发/自托管入口。 */

import { createApp } from './app';

// Node 20.12+ 内置 .env 加载，无需额外依赖
try {
  process.loadEnvFile('.env');
} catch {
  // 没有 .env 时忽略
}

const port = Number.parseInt(process.env.PORT || '3001', 10);
const app = createApp();

app.listen(port, () => {
  console.log(`[sql2er] API 已启动： http://127.0.0.1:${port}/api/health`);
});
