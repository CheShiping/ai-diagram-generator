/** OpenAI 兼容的 Chat Completions 客户端（跑在 Node 原生 fetch 上）。 */

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function readLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const baseUrl = (env.LLM_BASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (env.LLM_API_KEY || '').trim();
  const model = (env.LLM_MODEL || '').trim();

  if (!baseUrl || !apiKey || !model) {
    throw new LlmError(
      '未配置大模型：请在环境变量中设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL（参考 .env.example）',
    );
  }

  return { baseUrl, apiKey, model };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const TIMEOUT_MS = 300_000;

/**
 * 请求模型并返回纯文本内容。
 * 会自动尝试 JSON 模式（response_format=json_object），
 * 遇到不支持的服务商则降级为普通模式重试一次。
 */
export async function chat(
  config: LlmConfig,
  messages: ChatMessage[],
  options: { temperature?: number; jsonMode?: boolean } = {},
): Promise<string> {
  const { temperature = 0.2, jsonMode = true } = options;

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  try {
    return await request(config, body);
  } catch (err) {
    const isClientError = err instanceof LlmError && err.status !== undefined && err.status < 500;
    if (jsonMode && isClientError) {
      delete body.response_format;
      return await request(config, body);
    }
    throw err;
  }
}

async function request(config: LlmConfig, body: Record<string, unknown>): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LlmError(`大模型接口返回 ${res.status}：${text.slice(0, 300) || res.statusText}`, res.status);
    }

    const data = (await res.json()) as any;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new LlmError('大模型返回内容为空');
    }
    return content;
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new LlmError('大模型请求超时，请稍后重试或缩小需求范围');
    }
    throw new LlmError(`大模型请求失败：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 从模型输出里抠出 JSON（容忍 ```json 围栏、前后废话、尾随注释） */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // 退化：从第一个 { 或 [ 开始，到最后一个 } 或 ] 结束
    const startObj = candidate.indexOf('{');
    const startArr = candidate.indexOf('[');
    const start = startObj === -1 ? startArr : startArr === -1 ? startObj : Math.min(startObj, startArr);
    if (start === -1) throw new LlmError('大模型输出中未找到 JSON');

    const lastObj = candidate.lastIndexOf('}');
    const lastArr = candidate.lastIndexOf(']');
    const end = Math.max(lastObj, lastArr);
    if (end <= start) throw new LlmError('大模型输出中未找到完整 JSON');

    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      throw new LlmError('大模型输出的 JSON 无法解析');
    }
  }
}
