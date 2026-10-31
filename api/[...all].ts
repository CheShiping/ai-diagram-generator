/**
 * Vercel serverless 入口。
 * 把所有 /api/* 请求交给同一个 Express 应用处理（见 vercel.json 的函数配置）。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createApp } from '../server/app';

const app = createApp();

export default function handler(req: VercelRequest, res: VercelResponse): void {
  // Express 的 app 函数本身可直接作为 (req, res) 处理器
  (app as unknown as (req: unknown, res: unknown) => void)(req, res);
}
