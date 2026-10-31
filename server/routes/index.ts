/** API 路由。所有路径都挂在 /api 下（本地 Vite 代理与 Vercel 函数一致）。 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import type { AiEntity } from '../../shared/er-model';
import { HttpError, fail, ok } from '../http';
import { createGuard } from '../middleware/guard';
import { generateErFromRequirement, generateRelationships } from '../services/ai';
import { parseSqlToTables } from '../services/sql-parser';

type AsyncHandler = (req: Request, res: Response) => Promise<void>;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function createApiRouter(): Router {
  const router = Router();

  const guard = createGuard({
    accessCode: (process.env.ACCESS_CODE || '').trim(),
    rateLimitPerMin: Number.parseInt(process.env.RATE_LIMIT_PER_MIN || '20', 10) || 0,
  });

  router.get('/health', (_req, res) => {
    res.json(ok({ status: 'ok', time: new Date().toISOString() }));
  });

  /** SQL → 表结构。接受 { sql: string } 或 { sqls: string[] } */
  router.post(
    '/parseSQL',
    guard,
    asyncHandler(async (req, res) => {
      let sql = readString(req.body?.sql);

      if (!sql && Array.isArray(req.body?.sqls)) {
        sql = (req.body.sqls as unknown[]).filter((s): s is string => typeof s === 'string').join('\n;\n');
      }

      if (!sql.trim()) {
        throw new HttpError(400, '请提供 SQL 文本（字段 sql 或 sqls）');
      }
      if (sql.length > 512 * 1024) {
        throw new HttpError(413, 'SQL 文本过大，请控制在 512KB 以内');
      }

      const { tables, warnings } = await parseSqlToTables(sql);
      res.json(ok({ tables }, { warnings }));
    }),
  );

  /** 自然语言 → 实体 + 联系 */
  router.post(
    '/ai/generate-er',
    guard,
    asyncHandler(async (req, res) => {
      const prompt = readString(req.body?.prompt).trim();
      if (!prompt) throw new HttpError(400, '请提供需求描述（字段 prompt）');
      if (prompt.length > 10000) throw new HttpError(400, '需求描述过长，请控制在 10000 字以内');

      const { data, warnings } = await generateErFromRequirement(prompt);
      res.json(ok(data, { warnings }));
    }),
  );

  /** 已有实体 → 补充联系 */
  router.post(
    '/ai/generate-relationships',
    guard,
    asyncHandler(async (req, res) => {
      const entities = req.body?.entities;
      if (!Array.isArray(entities) || entities.length === 0) {
        throw new HttpError(400, '请提供实体列表（字段 entities）');
      }
      if (entities.length > 40) {
        throw new HttpError(400, '实体数量过多，请控制在 40 个以内');
      }

      const sanitized: AiEntity[] = entities
        .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
        .map((e) => ({
          name: readString(e.name).trim(),
          attributes: Array.isArray(e.attributes)
            ? (e.attributes as unknown[])
                .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
                .map((a) => ({ name: readString(a.name).trim(), primaryKey: Boolean(a.primaryKey) }))
                .filter((a) => a.name)
            : [],
        }))
        .filter((e) => e.name);

      if (sanitized.length < 2) {
        throw new HttpError(400, '至少需要 2 个有效实体才能推断联系');
      }

      // 用户明确指定「谁连谁」的补充说明（可选）
      const hint = readString(req.body?.hint).trim();
      if (hint.length > 2000) throw new HttpError(400, '补充说明过长，请控制在 2000 字以内');

      const { data, warnings } = await generateRelationships(sanitized, hint);
      res.json(ok(data, { warnings }));
    }),
  );

  // 统一兜底
  router.use((_req, res) => {
    res.status(404).json(fail('接口不存在'));
  });

  return router;
}
