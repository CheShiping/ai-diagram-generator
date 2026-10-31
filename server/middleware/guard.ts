/** 访问码校验 + 限流中间件。 */

import type { NextFunction, Request, Response } from 'express';
import { fail } from '../http';
import { consumeRateLimit } from '../services/rate-limit';

export interface GuardOptions {
  accessCode: string;
  rateLimitPerMin: number;
}

function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function createGuard(options: GuardOptions) {
  return function guard(req: Request, res: Response, next: NextFunction): void {
    // 1) 访问码（未配置则跳过）
    if (options.accessCode) {
      const provided =
        (req.headers['x-access-code'] as string | undefined) ??
        (typeof req.body?.accessCode === 'string' ? req.body.accessCode : undefined);

      if (!provided || provided.trim() !== options.accessCode) {
        res.status(401).json(fail('访问码无效'));
        return;
      }
    }

    // 2) 限流
    const result = consumeRateLimit(clientIp(req), options.rateLimitPerMin);
    if (!result.ok) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
      res.status(429).json(fail(`请求过于频繁，请 ${result.retryAfterSec} 秒后重试`));
      return;
    }

    next();
  };
}
