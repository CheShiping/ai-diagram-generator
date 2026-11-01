/** 后端接口封装。 */

import type {
  AiAttributePatch,
  AiCompletionResult,
  AiEntity,
  AiRelationship,
  AiResult,
  ParsedTable,
} from '@shared/er-model';
import type { ModuleTree } from '@shared/module-tree';

const BASE = '/api';
const ACCESS_CODE_KEY = 'sql2er.accessCode';
const MODEL_CONFIG_KEY = 'sql2er.modelConfig';

export type AiGenerateMode = 'core' | 'full';

export interface StoredModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

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

/** 读取界面里保存的自定义模型配置（留空表示沿用服务端 .env） */
export function getStoredModelConfig(): StoredModelConfig {
  try {
    const raw = localStorage.getItem(MODEL_CONFIG_KEY);
    if (!raw) return { baseUrl: '', apiKey: '', model: '' };
    const parsed = JSON.parse(raw) as Partial<StoredModelConfig>;
    return {
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
    };
  } catch {
    return { baseUrl: '', apiKey: '', model: '' };
  }
}

export function setStoredModelConfig(config: StoredModelConfig): void {
  try {
    if (config.baseUrl || config.apiKey || config.model) {
      localStorage.setItem(MODEL_CONFIG_KEY, JSON.stringify(config));
    } else {
      localStorage.removeItem(MODEL_CONFIG_KEY);
    }
  } catch {
    /* 忽略存储失败（隐私模式） */
  }
}

async function post<T>(path: string, body: unknown): Promise<ApiEnvelope<T>> {
  const accessCode = getStoredAccessCode();
  const modelConfig = getStoredModelConfig();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessCode) headers['x-access-code'] = accessCode;
  if (modelConfig.baseUrl) headers['x-llm-base-url'] = modelConfig.baseUrl;
  if (modelConfig.apiKey) headers['x-llm-api-key'] = modelConfig.apiKey;
  if (modelConfig.model) headers['x-llm-model'] = modelConfig.model;

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

/** 自然语言 → 实体与联系。mode=full 时服务端会追加一轮补全。 */
export async function generateEr(
  prompt: string,
  mode: AiGenerateMode = 'core',
): Promise<{ result: AiResult; warnings: string[] }> {
  const res = await post<AiResult>('/ai/generate-er', { prompt, mode });
  return { result: res.data!, warnings: res.warnings ?? [] };
}

/** 已有实体 → 补充联系 + 描述中提到但图中没有的属性。hint 为业务描述或补充说明。 */
export async function completeEr(
  entities: AiEntity[],
  hint = '',
): Promise<{ relationships: AiRelationship[]; attributes: AiAttributePatch[]; warnings: string[] }> {
  const body = hint.trim() ? { entities, hint: hint.trim() } : { entities };
  const res = await post<AiCompletionResult>('/ai/complete-er', body);
  return {
    relationships: res.data?.relationships ?? [],
    attributes: res.data?.attributes ?? [],
    warnings: res.warnings ?? [],
  };
}

/** 自然语言 → 功能结构树（层级深度由描述决定） */
export async function generateModuleTree(
  prompt: string,
): Promise<{ tree: ModuleTree; warnings: string[] }> {
  const res = await post<{ tree: ModuleTree }>('/ai/generate-module-tree', { prompt });
  return { tree: res.data!.tree, warnings: res.warnings ?? [] };
}
