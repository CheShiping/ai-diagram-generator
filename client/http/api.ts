/** 后端接口封装。 */

import type { AiEntity, AiRelationship, AiResult, ParsedTable } from '@shared/er-model';

const BASE = '/api';
const ACCESS_CODE_KEY = 'sql2er.accessCode';

export interface ApiEnvelope<T> {
  code: number;
  data?: T;
  msg?: string;
  warnings?: string[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function getStoredAccessCode(): string {
  try {
    return localStorage.getItem(ACCESS_CODE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setStoredAccessCode(code: string): void {
  try {
    if (code) localStorage.setItem(ACCESS_CODE_KEY, code);
    else localStorage.removeItem(ACCESS_CODE_KEY);
  } catch {
    /* 忽略存储失败（隐私模式） */
  }
}

async function post<T>(path: string, body: unknown): Promise<ApiEnvelope<T>> {
  const accessCode = getStoredAccessCode();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessCode) headers['x-access-code'] = accessCode;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('网络连接失败，请检查服务是否已启动');
  }

  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(`服务返回了非 JSON 响应（HTTP ${res.status}）`, res.status);
  }

  if (!res.ok) {
    throw new ApiError(payload?.msg || `请求失败（HTTP ${res.status}）`, res.status);
  }
  if (payload.code !== 0) {
    throw new ApiError(payload.msg || '请求失败');
  }
  if (payload.data === undefined) {
    throw new ApiError('服务返回数据为空');
  }

  return payload;
}

/** SQL 建表语句 → 表结构 */
export async function parseSql(sql: string): Promise<{ tables: ParsedTable[]; warnings: string[] }> {
  const res = await post<{ tables: ParsedTable[] }>('/parseSQL', { sql });
  return { tables: res.data!.tables ?? [], warnings: res.warnings ?? [] };
}

/** 自然语言 → 实体与联系 */
export async function generateEr(prompt: string): Promise<{ result: AiResult; warnings: string[] }> {
  const res = await post<AiResult>('/ai/generate-er', { prompt });
  return { result: res.data!, warnings: res.warnings ?? [] };
}

/** 已有实体 → 补充联系。hint 用于明确指定「谁连谁」。 */
export async function generateRelationships(
  entities: AiEntity[],
  hint = '',
): Promise<{ relationships: AiRelationship[]; warnings: string[] }> {
  const body = hint.trim() ? { entities, hint: hint.trim() } : { entities };
  const res = await post<AiRelationship[]>('/ai/generate-relationships', body);
  return { relationships: res.data ?? [], warnings: res.warnings ?? [] };
}
