/** 统一错误类型与响应信封。 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 成功响应：code 0 */
export function ok<T>(data: T, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return { code: 0, data, ...extras };
}

/** 失败响应：code 1 */
export function fail(message: string, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return { code: 1, msg: message, ...extras };
}
