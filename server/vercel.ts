/**
 * Vercel serverless 入口（源文件）。
 * 构建时由 esbuild 打包为 api/[...all].js（见 package.json 的 build:api 脚本）。
 * 不能直接把 .ts 放在 api/ 下再 import ../server/*：
 * @vercel/node 不会把 api/ 目录之外的相对导入文件打进函数包，线上会报 ERR_MODULE_NOT_FOUND。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createApp } from './app';

const app = createApp();

export default function handler(req: VercelRequest, res: VercelResponse): void {
  // Express 的 app 函数本身可直接作为 (req, res) 处理器
  (app as unknown as (req: unknown, res: unknown) => void)(req, res);
}
