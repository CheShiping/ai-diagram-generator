/** Express 应用装配（本地运行与 Vercel serverless 共用）。 */

import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { HttpError, fail } from './http';
import { createApiRouter } from './routes';

export function createApp() {
  const app = express();

  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(cors({ origin: true, credentials: false }));
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', createApiRouter());

  // 健康检查也挂在根路径，方便探活
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json(fail('Not Found'));
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json(fail(err.message));
      return;
    }
    if (err instanceof SyntaxError && 'body' in (err as object)) {
      res.status(400).json(fail('请求体不是合法 JSON'));
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sql2er] 未处理异常:', err);
    res.status(500).json(fail(message || '服务器内部错误'));
  });

  return app;
}
