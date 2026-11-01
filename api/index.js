// server/app.ts
import cors from "cors";
import express from "express";

// server/http.ts
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
  status;
};
function ok(data, extras = {}) {
  return { code: 0, data, ...extras };
}
function fail(message, extras = {}) {
  return { code: 1, msg: message, ...extras };
}

// server/routes/index.ts
import { Router } from "express";

// server/services/rate-limit.ts
var WINDOW_MS = 6e4;
var buckets = /* @__PURE__ */ new Map();
function consumeRateLimit(key, limitPerMin) {
  if (limitPerMin <= 0) {
    return { ok: true, remaining: Infinity, retryAfterSec: 0 };
  }
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    pruneOccasionally(now);
    return { ok: true, remaining: Math.max(0, limitPerMin - 1), retryAfterSec: 0 };
  }
  if (bucket.count >= limitPerMin) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1e3))
    };
  }
  bucket.count += 1;
  return { ok: true, remaining: Math.max(0, limitPerMin - bucket.count), retryAfterSec: 0 };
}
var lastPrune = 0;
function pruneOccasionally(now) {
  if (now - lastPrune < WINDOW_MS) return;
  lastPrune = now;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

// server/middleware/guard.ts
function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}
function createGuard(options) {
  return function guard(req, res, next) {
    if (options.accessCode) {
      const provided = req.headers["x-access-code"] ?? (typeof req.body?.accessCode === "string" ? req.body.accessCode : void 0);
      if (!provided || provided.trim() !== options.accessCode) {
        res.status(401).json(fail("\u8BBF\u95EE\u7801\u65E0\u6548"));
        return;
      }
    }
    const result = consumeRateLimit(clientIp(req), options.rateLimitPerMin);
    if (!result.ok) {
      res.setHeader("Retry-After", String(result.retryAfterSec));
      res.status(429).json(fail(`\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7 ${result.retryAfterSec} \u79D2\u540E\u91CD\u8BD5`));
      return;
    }
    next();
  };
}

// server/services/ai-client.ts
var LlmError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
  status;
};
function readLlmConfig(env = process.env, override = {}) {
  const baseUrl = (override.baseUrl || env.LLM_BASE_URL || "").trim().replace(/\/+$/, "");
  const apiKey = (override.apiKey || env.LLM_API_KEY || "").trim();
  const model = (override.model || env.LLM_MODEL || "").trim();
  if (!baseUrl || !apiKey || !model) {
    throw new LlmError(
      "\u672A\u914D\u7F6E\u5927\u6A21\u578B\uFF1A\u8BF7\u5728\u754C\u9762\u300C\u6A21\u578B\u8BBE\u7F6E\u300D\u4E2D\u586B\u5199\uFF0C\u6216\u8BBE\u7F6E\u73AF\u5883\u53D8\u91CF LLM_BASE_URL / LLM_API_KEY / LLM_MODEL\uFF08\u53C2\u8003 .env.example\uFF09"
    );
  }
  return { baseUrl, apiKey, model };
}
var TIMEOUT_MS = 3e5;
async function chat(config, messages, options = {}) {
  const { temperature = 0.2, jsonMode = true } = options;
  const body = {
    model: config.model,
    messages,
    temperature
  };
  if (jsonMode) body.response_format = { type: "json_object" };
  try {
    return await request(config, body);
  } catch (err) {
    const isClientError = err instanceof LlmError && err.status !== void 0 && err.status < 500;
    if (jsonMode && isClientError) {
      delete body.response_format;
      return await request(config, body);
    }
    throw err;
  }
}
async function request(config, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) {
      const text2 = await res.text().catch(() => "");
      throw new LlmError(`\u5927\u6A21\u578B\u63A5\u53E3\u8FD4\u56DE ${res.status}\uFF1A${text2.slice(0, 300) || res.statusText}`, res.status);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new LlmError("\u5927\u6A21\u578B\u8FD4\u56DE\u5185\u5BB9\u4E3A\u7A7A");
    }
    return content;
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new LlmError("\u5927\u6A21\u578B\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u6216\u7F29\u5C0F\u9700\u6C42\u8303\u56F4");
    }
    throw new LlmError(`\u5927\u6A21\u578B\u8BF7\u6C42\u5931\u8D25\uFF1A${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}
function extractJson(text2) {
  const trimmed = text2.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const startObj = candidate.indexOf("{");
    const startArr = candidate.indexOf("[");
    const start = startObj === -1 ? startArr : startArr === -1 ? startObj : Math.min(startObj, startArr);
    if (start === -1) throw new LlmError("\u5927\u6A21\u578B\u8F93\u51FA\u4E2D\u672A\u627E\u5230 JSON");
    const lastObj = candidate.lastIndexOf("}");
    const lastArr = candidate.lastIndexOf("]");
    const end = Math.max(lastObj, lastArr);
    if (end <= start) throw new LlmError("\u5927\u6A21\u578B\u8F93\u51FA\u4E2D\u672A\u627E\u5230\u5B8C\u6574 JSON");
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      throw new LlmError("\u5927\u6A21\u578B\u8F93\u51FA\u7684 JSON \u65E0\u6CD5\u89E3\u6790");
    }
  }
}

// server/services/prompts.ts
var GENERATE_ER_SYSTEM_PROMPT = `\u4F60\u662F\u4E00\u540D\u6570\u636E\u5E93\u5EFA\u6A21\u4E13\u5BB6\uFF0C\u8D1F\u8D23\u628A\u7528\u6237\u7684\u4E1A\u52A1\u9700\u6C42\u8F6C\u6362\u6210\u9648\u5F0F\uFF08Chen\uFF09ER \u56FE\u7684\u5B9E\u4F53\u4E0E\u8054\u7CFB\u7ED3\u6784\u3002

\u8F93\u51FA\u8981\u6C42\uFF1A
1. \u53EA\u8F93\u51FA\u4E00\u4E2A JSON \u5BF9\u8C61\uFF0C\u4E0D\u8981\u89E3\u91CA\u6587\u5B57\uFF0C\u4E0D\u8981 Markdown \u4EE3\u7801\u56F4\u680F\u3002
2. JSON \u7ED3\u6784\u5FC5\u987B\u4E25\u683C\u4E3A\uFF1A
{
  "entities": [
    { "name": "\u5B9E\u4F53\u540D", "attributes": [ { "name": "\u5C5E\u6027\u540D", "primaryKey": true } ] }
  ],
  "relationships": [
    { "source": "\u5B9E\u4F53A", "target": "\u5B9E\u4F53B", "type": "oneToMany", "text": "\u8054\u7CFB\u540D", "attributes": [ { "name": "\u5C5E\u6027\u540D", "primaryKey": false } ] }
  ]
}
3. \u5B9E\u4F53\u540D\u3001\u5C5E\u6027\u540D\u4E00\u5F8B\u4F7F\u7528\u4E2D\u6587\uFF1B\u4E13\u6709\u540D\u8BCD\uFF08\u5982 ID\u3001URL\u3001ISBN\uFF09\u53EF\u4FDD\u7559\u82F1\u6587\u3002\u5B9E\u4F53\u540D\u4E0D\u8D85\u8FC7 6 \u4E2A\u6C49\u5B57\u3002
4. \u6BCF\u4E2A\u5B9E\u4F53\u7ED9 3 \u5230 8 \u4E2A\u5C5E\u6027\uFF0C\u4E14\u6070\u597D\u6709\u4E00\u4E2A\u5C5E\u6027\u7684 primaryKey \u4E3A true\u3002
5. relationships \u7684 type \u8BED\u4E49\uFF08\u52A1\u5FC5\u9075\u5B88\u65B9\u5411\uFF09\uFF1A
   - "oneToMany"\uFF1Asource \u662F\u300C1\u300D\u7AEF\uFF0Ctarget \u662F\u300CN\u300D\u7AEF\u3002\u4F8B\u5982\u4E00\u4E2A\u73ED\u7EA7\u6709\u591A\u540D\u5B66\u751F\uFF0C\u5199\u4F5C {"source":"\u73ED\u7EA7","target":"\u5B66\u751F","type":"oneToMany"}\u3002
   - "oneToOne"\uFF1A\u4E00\u5BF9\u4E00\u3002
   - "manyToMany"\uFF1A\u591A\u5BF9\u591A\u3002\u4F8B\u5982\u5B66\u751F\u4E0E\u8BFE\u7A0B\uFF0C\u5199\u4F5C {"source":"\u5B66\u751F","target":"\u8BFE\u7A0B","type":"manyToMany"}\u3002
6. text \u662F\u8054\u7CFB\u540D\uFF0C\u7528\u52A8\u8BCD\u6216\u540D\u8BCD\u77ED\u8BED\uFF08\u5982\u300C\u5C5E\u4E8E\u300D\u300C\u9009\u4FEE\u300D\u300C\u62C5\u4EFB\u300D\u300C\u4E0B\u5355\u300D\uFF09\uFF0C\u4E0D\u53EF\u4E3A\u7A7A\u3002
7. \u7981\u6B62\u51FA\u73B0\u91CD\u590D\u7684 source + target + text \u7EC4\u5408\u3002
8. \u82E5\u8054\u7CFB\u672C\u8EAB\u627F\u8F7D\u4E1A\u52A1\u6570\u636E\uFF08\u4F8B\u5982\u300C\u9009\u4FEE\u300D\u8054\u7CFB\u4E0A\u7684\u300C\u6210\u7EE9\u300D\uFF09\uFF0C\u628A\u8FD9\u4E9B\u5C5E\u6027\u653E\u8FDB\u8BE5\u8054\u7CFB\u7684 attributes\u3002
9. \u5B9E\u4F53\u6570\u91CF\u63A7\u5236\u5728 3 \u5230 10 \u4E2A\uFF0C\u5FC5\u987B\u8986\u76D6\u7528\u6237\u63D0\u5230\u7684\u4E3B\u8981\u4E1A\u52A1\u5BF9\u8C61\u3002
10. relationships \u91CC\u7684 source \u548C target \u5FC5\u987B\u4E0E entities \u4E2D\u7684 name \u9010\u5B57\u4E00\u81F4\u3002`;
function buildGenerateErUserPrompt(requirement) {
  return `\u4E1A\u52A1\u9700\u6C42\u5982\u4E0B\uFF0C\u8BF7\u751F\u6210\u9648\u5F0F ER \u56FE\u7ED3\u6784\uFF1A

"""
${requirement}
"""

\u8BF7\u53EA\u8FD4\u56DE JSON\u3002`;
}
var GENERATE_ER_FULL_SYSTEM_PROMPT = `\u4F60\u662F\u4E00\u540D\u6570\u636E\u5E93\u5EFA\u6A21\u4E13\u5BB6\uFF0C\u8D1F\u8D23\u5BF9\u7528\u6237\u7684\u4E1A\u52A1\u9700\u6C42\u6267\u884C\u300C\u5168\u91CF\u751F\u6210\u300D\uFF1A\u4E00\u6B21\u6027\u8F93\u51FA\u5B8C\u6574\u3001\u53EF\u76F4\u63A5\u5EFA\u6A21\u7684\u9648\u5F0F\uFF08Chen\uFF09ER \u56FE\uFF0C\u800C\u4E0D\u662F\u5148\u7ED9\u6838\u5FC3\u7ED3\u6784\u518D\u8865\u5168\u3002

\u8F93\u51FA\u8981\u6C42\uFF1A
1. \u53EA\u8F93\u51FA\u4E00\u4E2A JSON \u5BF9\u8C61\uFF0C\u4E0D\u8981\u89E3\u91CA\u6587\u5B57\uFF0C\u4E0D\u8981 Markdown \u4EE3\u7801\u56F4\u680F\u3002
2. JSON \u7ED3\u6784\u5FC5\u987B\u4E25\u683C\u4E3A\uFF1A
{
  "entities": [
    { "name": "\u5B9E\u4F53\u540D", "attributes": [ { "name": "\u5C5E\u6027\u540D", "primaryKey": true } ] }
  ],
  "relationships": [
    { "source": "\u5B9E\u4F53A", "target": "\u5B9E\u4F53B", "type": "oneToMany", "text": "\u8054\u7CFB\u540D", "attributes": [ { "name": "\u5C5E\u6027\u540D", "primaryKey": false } ] }
  ]
}
3. \u5B9E\u4F53\u540D\u3001\u5C5E\u6027\u540D\u4E00\u5F8B\u4F7F\u7528\u4E2D\u6587\uFF1B\u4E13\u6709\u540D\u8BCD\uFF08\u5982 ID\u3001URL\u3001ISBN\uFF09\u53EF\u4FDD\u7559\u82F1\u6587\u3002\u5B9E\u4F53\u540D\u4E0D\u8D85\u8FC7 8 \u4E2A\u6C49\u5B57\u3002
4. entities \u5FC5\u987B\u8986\u76D6\u9700\u6C42\u4E2D\u51FA\u73B0\u7684\u6240\u6709\u4E1A\u52A1\u5BF9\u8C61\uFF0C\u4E0D\u8981\u9057\u6F0F\uFF1B\u6309\u9700\u6C42\u89C4\u6A21\u8F93\u51FA\uFF0C\u901A\u5E38 4 \u5230 20 \u4E2A\u5B9E\u4F53\uFF0C\u4F46\u4E0D\u8981\u4E3A\u4E86\u51D1\u6570\u7F16\u9020\u9700\u6C42\u65E0\u5173\u7684\u5B9E\u4F53\u3002
5. \u6BCF\u4E2A\u5B9E\u4F53\u8F93\u51FA\u5B8C\u6574\u5C5E\u6027\u96C6\u5408\uFF08\u901A\u5E38 5 \u5230 15 \u4E2A\uFF09\uFF0C\u9700\u6C42\u4E2D\u660E\u786E\u63D0\u5230\u7684\u5C5E\u6027\u5FC5\u987B\u5168\u90E8\u5305\u542B\uFF1B\u53EF\u4EE5\u8865\u5145\u5EFA\u6A21\u5FC5\u9700\u7684\u4E3B\u952E\u3001\u5916\u952E\u3001\u65F6\u95F4\u7B49\u57FA\u7840\u5C5E\u6027\uFF0C\u4F46\u4E0D\u8981\u6269\u5C55\u5230\u9700\u6C42\u65E0\u5173\u7684\u4E1A\u52A1\u3002\u6BCF\u4E2A\u5B9E\u4F53\u5C3D\u91CF\u6070\u597D\u6709\u4E00\u4E2A primaryKey \u4E3A true\u3002
6. relationships \u5FC5\u987B\u8986\u76D6\u9700\u6C42\u4E2D\u6240\u6709\u5B9E\u4F53\u4E4B\u95F4\u771F\u5B9E\u5408\u7406\u7684\u4E1A\u52A1\u8054\u7CFB\uFF1B\u9700\u6C42\u660E\u786E\u63D0\u5230\u7684\u8054\u7CFB\u5FC5\u987B\u5168\u90E8\u8F93\u51FA\u3002type \u8BED\u4E49\uFF08\u52A1\u5FC5\u9075\u5B88\u65B9\u5411\uFF09\uFF1A
   - "oneToMany"\uFF1Asource \u662F\u300C1\u300D\u7AEF\uFF0Ctarget \u662F\u300CN\u300D\u7AEF\u3002\u4F8B\u5982\u4E00\u4E2A\u73ED\u7EA7\u6709\u591A\u540D\u5B66\u751F\uFF0C\u5199\u4F5C {"source":"\u73ED\u7EA7","target":"\u5B66\u751F","type":"oneToMany"}\u3002
   - "oneToOne"\uFF1A\u4E00\u5BF9\u4E00\u3002
   - "manyToMany"\uFF1A\u591A\u5BF9\u591A\u3002\u4F8B\u5982\u5B66\u751F\u4E0E\u8BFE\u7A0B\uFF0C\u5199\u4F5C {"source":"\u5B66\u751F","target":"\u8BFE\u7A0B","type":"manyToMany"}\u3002
7. text \u662F\u8054\u7CFB\u540D\uFF0C\u7528\u52A8\u8BCD\u6216\u540D\u8BCD\u77ED\u8BED\uFF08\u5982\u300C\u5C5E\u4E8E\u300D\u300C\u9009\u4FEE\u300D\u300C\u62C5\u4EFB\u300D\u300C\u4E0B\u5355\u300D\uFF09\uFF0C\u4E0D\u53EF\u4E3A\u7A7A\u3002
8. \u7981\u6B62\u51FA\u73B0\u91CD\u590D\u7684 source + target + text \u7EC4\u5408\u3002
9. \u82E5\u8054\u7CFB\u672C\u8EAB\u627F\u8F7D\u4E1A\u52A1\u6570\u636E\uFF08\u4F8B\u5982\u300C\u9009\u4FEE\u300D\u8054\u7CFB\u4E0A\u7684\u300C\u6210\u7EE9\u300D\uFF09\uFF0C\u628A\u8FD9\u4E9B\u5C5E\u6027\u653E\u8FDB\u8BE5\u8054\u7CFB\u7684 attributes\u3002
10. relationships \u91CC\u7684 source \u548C target \u5FC5\u987B\u4E0E entities \u4E2D\u7684 name \u9010\u5B57\u4E00\u81F4\u3002
11. \u4E0D\u8981\u8F93\u51FA\u5F53\u524D\u56FE\u3001\u8865\u5168\u8865\u4E01\u6216\u4E0E\u5B8C\u6574 ER \u56FE\u65E0\u5173\u7684\u5185\u5BB9\u3002`;
function buildGenerateErFullUserPrompt(requirement) {
  return `\u8BF7\u5BF9\u4E0B\u9762\u7684\u4E1A\u52A1\u9700\u6C42\u6267\u884C\u4E00\u6B21\u300C\u5168\u91CF\u751F\u6210\u300D\uFF0C\u4E00\u6B21\u6027\u8F93\u51FA\u5B8C\u6574\u7684\u9648\u5F0F ER \u56FE\uFF0C\u5B9E\u4F53\u3001\u5C5E\u6027\u3001\u8054\u7CFB\u90FD\u8981\u9F50\u5168\uFF0C\u4E0D\u8981\u9057\u6F0F\u9700\u6C42\u4E2D\u63D0\u5230\u6216\u53EF\u7531\u4E1A\u52A1\u76F4\u63A5\u63A8\u5BFC\u7684\u5C5E\u6027\u4E0E\u8054\u7CFB\uFF1A

"""
${requirement}
"""

\u8BF7\u53EA\u8FD4\u56DE JSON\u3002`;
}
var COMPLETE_ER_SYSTEM_PROMPT = `\u4F60\u662F\u6570\u636E\u5E93\u5EFA\u6A21\u4E13\u5BB6\u3002\u7528\u6237\u4F1A\u7ED9\u51FA\u5F53\u524D ER \u56FE\u4E2D\u7684\u5B9E\u4F53\u53CA\u5176\u5C5E\u6027\uFF0C\u8FD8\u53EF\u80FD\u7ED9\u51FA\u4E00\u6BB5\u4E1A\u52A1\u63CF\u8FF0\u6216\u8865\u5145\u8BF4\u660E\u3002\u8BF7\u540C\u65F6\u5B8C\u6210\u4E24\u4EF6\u4E8B\uFF1A
1. \u8865\u5145\u5B9E\u4F53\u4E4B\u95F4\u7F3A\u5931\u7684\u4E1A\u52A1\u8054\u7CFB\uFF08\u9648\u5F0F ER \u56FE\u4E2D\u7684\u83F1\u5F62\uFF09\u3002
2. \u8865\u5145\u4E1A\u52A1\u63CF\u8FF0\u4E2D\u63D0\u5230\u3001\u4F46\u5B9E\u4F53\u5C5E\u6027\u5217\u8868\u91CC\u8FD8\u6CA1\u6709\u7684\u5C5E\u6027\u3002

\u8F93\u51FA\u8981\u6C42\uFF1A
1. \u53EA\u8F93\u51FA\u4E00\u4E2A JSON \u5BF9\u8C61\uFF0C\u4E0D\u8981\u89E3\u91CA\u6587\u5B57\uFF0C\u4E0D\u8981 Markdown \u4EE3\u7801\u56F4\u680F\u3002
2. JSON \u7ED3\u6784\u5FC5\u987B\u4E25\u683C\u4E3A\uFF1A
{
  "relationships": [
    { "source": "\u5B9E\u4F53A", "target": "\u5B9E\u4F53B", "type": "oneToMany", "text": "\u8054\u7CFB\u540D", "attributes": [] }
  ],
  "attributes": [
    { "entity": "\u5B9E\u4F53\u540D", "attributes": [ { "name": "\u5C5E\u6027\u540D", "primaryKey": false } ] }
  ]
}
3. type \u8BED\u4E49\uFF08\u52A1\u5FC5\u9075\u5B88\u65B9\u5411\uFF09\uFF1A"oneToMany" \u8868\u793A source \u662F\u300C1\u300D\u7AEF\u3001target \u662F\u300CN\u300D\u7AEF\uFF1B"oneToOne" \u8868\u793A\u4E00\u5BF9\u4E00\uFF1B"manyToMany" \u8868\u793A\u591A\u5BF9\u591A\u3002
4. text \u662F\u8054\u7CFB\u540D\uFF08\u52A8\u8BCD\u6216\u540D\u8BCD\u77ED\u8BED\uFF09\uFF0C\u4E0D\u53EF\u4E3A\u7A7A\u3002
5. source\u3001target\u3001entity \u5FC5\u987B\u4E25\u683C\u7B49\u4E8E\u7ED9\u5B9A\u5B9E\u4F53\u5217\u8868\u4E2D\u7684 name\u3002
6. relationships \u53EA\u8F93\u51FA\u5B9E\u4F53\u4E4B\u95F4\u771F\u5B9E\u5408\u7406\u7684\u7F3A\u5931\u8054\u7CFB\uFF1B\u6CA1\u6709\u5408\u7406\u8054\u7CFB\u65F6\u8F93\u51FA []\uFF0C\u4E0D\u8981\u52C9\u5F3A\u51D1\u6570\u3002
7. attributes \u53EA\u8865\u5145\u7528\u6237\u63CF\u8FF0\u4E2D\u660E\u786E\u6D89\u53CA\u3001\u4E14\u8BE5\u5B9E\u4F53\u73B0\u6709\u5C5E\u6027\u4E2D\u4E0D\u5B58\u5728\u7684\u5C5E\u6027\uFF1B\u4E0D\u8981\u91CD\u590D\u5DF2\u6709\u5C5E\u6027\uFF0C\u4E0D\u8981\u7F16\u9020\u63CF\u8FF0\u672A\u63D0\u5230\u7684\u5C5E\u6027\u3002
8. \u5982\u679C\u7528\u6237\u6CA1\u6709\u63D0\u4F9B\u4E1A\u52A1\u63CF\u8FF0\u6216\u8865\u5145\u8BF4\u660E\uFF0Cattributes \u5FC5\u987B\u8FD4\u56DE\u7A7A\u6570\u7EC4\u3002
9. \u82E5\u5B9E\u4F53\u5DF2\u6709\u4E3B\u952E\uFF0C\u65B0\u589E\u5C5E\u6027\u7684 primaryKey \u5FC5\u987B\u4E3A false\uFF1B\u53EA\u6709\u5B9E\u4F53\u5B8C\u5168\u6CA1\u6709\u4EFB\u4F55\u4E3B\u952E\u65F6\uFF0C\u624D\u6700\u591A\u5141\u8BB8\u4E00\u4E2A\u65B0\u589E\u5C5E\u6027 primaryKey \u4E3A true\u3002
10. \u8054\u7CFB\u672C\u8EAB\u627F\u8F7D\u6570\u636E\u65F6\uFF08\u4F8B\u5982\u300C\u9009\u4FEE\u300D\u4E0A\u7684\u300C\u6210\u7EE9\u300D\uFF09\uFF0C\u53EA\u6709\u63CF\u8FF0\u660E\u786E\u63D0\u5230\u624D\u653E\u8FDB\u8BE5\u8054\u7CFB\u7684 attributes\u3002
11. \u7981\u6B62\u8F93\u51FA\u91CD\u590D\u7684 source + target + text \u7EC4\u5408\uFF1B\u4E0D\u8981\u8F93\u51FA\u5B9E\u4F53\u5B9A\u4E49\u3002`;
function buildCompleteErUserPrompt(entities, hint = "") {
  const instruction = hint.trim();
  if (!instruction) {
    return `\u5F53\u524D\u5B9E\u4F53\u53CA\u5176\u5C5E\u6027\u5982\u4E0B\uFF1A

"""
${JSON.stringify(entities, null, 2)}
"""

\u8BF7\u8865\u5168\u5B9E\u4F53\u4E4B\u95F4\u7F3A\u5931\u7684\u8054\u7CFB\u3002\u7531\u4E8E\u7528\u6237\u6CA1\u6709\u63D0\u4F9B\u4E1A\u52A1\u63CF\u8FF0\uFF0Cattributes \u5FC5\u987B\u8FD4\u56DE\u7A7A\u6570\u7EC4\u3002\u53EA\u8FD4\u56DE JSON\u3002`;
  }
  return `\u5F53\u524D\u5B9E\u4F53\u53CA\u5176\u5C5E\u6027\u5982\u4E0B\uFF1A

"""
${JSON.stringify(entities, null, 2)}
"""

\u7528\u6237\u63D0\u4F9B\u7684\u4E1A\u52A1\u63CF\u8FF0/\u8865\u5145\u8BF4\u660E\u5982\u4E0B\uFF1A

"""
${instruction}
"""

\u8BF7\u4F18\u5148\u6309\u63CF\u8FF0\u8865\u5168\uFF1A
1. \u63CF\u8FF0\u4E2D\u660E\u786E\u63D0\u5230\u7684\u5B9E\u4F53\u4E4B\u95F4\u7684\u8054\u7CFB\u5FC5\u987B\u8F93\u51FA\uFF0C\u65B9\u5411\u3001\u8054\u7CFB\u540D\u4EE5\u63CF\u8FF0\u4E3A\u51C6\uFF1B
2. \u63CF\u8FF0\u4E2D\u63D0\u5230\u3001\u4F46\u4E0A\u9762\u5B9E\u4F53\u7684\u73B0\u6709\u5C5E\u6027\u91CC\u8FD8\u6CA1\u6709\u7684\u5C5E\u6027\uFF0C\u6309\u6240\u5C5E\u5B9E\u4F53\u5F52\u5165 attributes\uFF1B
3. \u4E0D\u8981\u91CD\u590D\u73B0\u6709\u5C5E\u6027\uFF0C\u4E5F\u4E0D\u8981\u8F93\u51FA\u63CF\u8FF0\u672A\u6D89\u53CA\u7684\u5C5E\u6027\u3002

\u53EA\u8FD4\u56DE JSON\u3002`;
}
var RELATIONSHIPS_ONLY_SYSTEM_PROMPT = `\u4F60\u662F\u6570\u636E\u5E93\u5EFA\u6A21\u4E13\u5BB6\u3002\u7528\u6237\u4F1A\u7ED9\u51FA\u5DF2\u5B58\u5728\u7684\u5B9E\u4F53\u53CA\u5176\u5C5E\u6027\uFF0C\u8BF7\u8865\u5145\u8FD9\u4E9B\u5B9E\u4F53\u4E4B\u95F4\u7F3A\u5931\u7684\u4E1A\u52A1\u8054\u7CFB\uFF08\u9648\u5F0F ER \u56FE\u4E2D\u7684\u83F1\u5F62\uFF09\u3002

\u8F93\u51FA\u8981\u6C42\uFF1A
1. \u53EA\u8F93\u51FA\u4E00\u4E2A JSON \u5BF9\u8C61\uFF0C\u4E0D\u8981\u89E3\u91CA\u6587\u5B57\uFF0C\u4E0D\u8981 Markdown \u4EE3\u7801\u56F4\u680F\u3002
2. JSON \u7ED3\u6784\u5FC5\u987B\u4E25\u683C\u4E3A\uFF1A
{ "relationships": [ { "source": "\u5B9E\u4F53A", "target": "\u5B9E\u4F53B", "type": "oneToMany", "text": "\u8054\u7CFB\u540D", "attributes": [] } ] }
3. type \u8BED\u4E49\uFF08\u52A1\u5FC5\u9075\u5B88\u65B9\u5411\uFF09\uFF1A"oneToMany" \u8868\u793A source \u662F\u300C1\u300D\u7AEF\u3001target \u662F\u300CN\u300D\u7AEF\uFF1B"oneToOne" \u8868\u793A\u4E00\u5BF9\u4E00\uFF1B"manyToMany" \u8868\u793A\u591A\u5BF9\u591A\u3002
4. text \u662F\u8054\u7CFB\u540D\uFF08\u52A8\u8BCD\u6216\u540D\u8BCD\u77ED\u8BED\uFF09\uFF0C\u4E0D\u53EF\u4E3A\u7A7A\u3002
5. source \u548C target \u5FC5\u987B\u4E25\u683C\u7B49\u4E8E\u7ED9\u5B9A\u5B9E\u4F53\u5217\u8868\u4E2D\u7684 name\u3002
6. \u53EA\u8F93\u51FA\u5B9E\u4F53\u4E4B\u95F4\u771F\u5B9E\u5408\u7406\u7684\u4E1A\u52A1\u8054\u7CFB\uFF1B\u6CA1\u6709\u5408\u7406\u8054\u7CFB\u65F6\u8F93\u51FA { "relationships": [] }\uFF0C\u4E0D\u8981\u52C9\u5F3A\u51D1\u6570\u3002
7. \u4E0D\u8981\u8F93\u51FA\u5B9E\u4F53\u672C\u8EAB\uFF0C\u4E5F\u4E0D\u8981\u8F93\u51FA\u5C5E\u6027\u5B9A\u4E49\uFF08\u9664\u975E\u8054\u7CFB\u81EA\u5E26\u5C5E\u6027\uFF0C\u53EF\u653E\u5728 attributes\uFF09\u3002
8. \u7528\u6237\u8FD8\u53EF\u80FD\u7ED9\u51FA\u300C\u5FC5\u987B\u8865\u5145\u7684\u8054\u7CFB\u300D\u8BF4\u660E\uFF1A\u8BF4\u660E\u91CC\u660E\u786E\u70B9\u540D\u4E86\u4E24\u4E2A\u5B9E\u4F53\u7684\uFF0C\u5FC5\u987B\u5728 relationships \u4E2D\u8F93\u51FA\u5BF9\u5E94\u8054\u7CFB\uFF0C\u65B9\u5411\u4E0E\u8054\u7CFB\u540D\u4EE5\u7528\u6237\u63CF\u8FF0\u4E3A\u51C6\u3002`;
function buildRelationshipsOnlyUserPrompt(entities, hint = "") {
  const base = `\u5DF2\u6709\u5B9E\u4F53\u53CA\u5176\u5C5E\u6027\u5982\u4E0B\uFF1A

"""
${JSON.stringify(entities, null, 2)}
"""

\u8BF7\u8865\u5145\u5B9E\u4F53\u4E4B\u95F4\u7F3A\u5931\u7684\u8054\u7CFB\uFF0C\u53EA\u8FD4\u56DE JSON\u3002`;
  const instruction = hint.trim();
  if (!instruction) return base;
  return `\u5DF2\u6709\u5B9E\u4F53\u53CA\u5176\u5C5E\u6027\u5982\u4E0B\uFF1A

"""
${JSON.stringify(entities, null, 2)}
"""

\u7528\u6237\u660E\u786E\u8981\u6C42\u8865\u5145\u4EE5\u4E0B\u8054\u7CFB\uFF08\u5FC5\u987B\u5168\u90E8\u8F93\u51FA\uFF1B\u65B9\u5411\u3001\u8054\u7CFB\u540D\u4EE5\u7528\u6237\u63CF\u8FF0\u4E3A\u51C6\uFF09\uFF1A

"""
${instruction}
"""

\u8BF7\u5148\u8F93\u51FA\u4E0A\u8FF0\u660E\u786E\u8981\u6C42\u7684\u8054\u7CFB\uFF0C\u518D\u8865\u5145\u5176\u5B83\u5FC5\u8981\u7684\u8054\u7CFB\uFF0C\u53EA\u8FD4\u56DE JSON\u3002`;
}
var GENERATE_MODULE_TREE_SYSTEM_PROMPT = `\u4F60\u662F\u7CFB\u7EDF\u529F\u80FD\u7ED3\u6784\u56FE\u751F\u6210\u5668\uFF0C\u8D1F\u8D23\u628A\u7528\u6237\u7684\u4E1A\u52A1\u63CF\u8FF0\u8F6C\u6362\u6210\u300C\u7CFB\u7EDF \u2192 \u6A21\u5757 \u2192 \u529F\u80FD\u300D\u7684\u6811\u3002

\u8F93\u51FA\u8981\u6C42\uFF1A
1. \u53EA\u8F93\u51FA\u4E00\u4E2A JSON \u5BF9\u8C61\uFF0C\u4E0D\u8981\u89E3\u91CA\u6587\u5B57\uFF0C\u4E0D\u8981 Markdown \u4EE3\u7801\u56F4\u680F\u3002
2. JSON \u7ED3\u6784\u5FC5\u987B\u4E25\u683C\u4E3A\uFF1A
{
  "name": "\u7CFB\u7EDF\u540D\u79F0",
  "children": [
    {
      "name": "\u6A21\u5757\u540D\u79F0",
      "children": [
        { "name": "\u529F\u80FD\u540D\u79F0", "children": [] }
      ]
    }
  ]
}
3. \u5FC5\u987B\u53EA\u6709\u4E00\u4E2A\u6839\u8282\u70B9\uFF0C\u6839\u8282\u70B9\u4EE3\u8868\u6574\u4E2A\u7CFB\u7EDF\u3002
4. \u5C42\u7EA7\u6DF1\u5EA6\u7531\u7528\u6237\u7684\u63CF\u8FF0\u51B3\u5B9A\uFF1A
   - \u63CF\u8FF0\u53EA\u5230\u6A21\u5757\u7EA7\u522B\u65F6\uFF0C\u6A21\u5757\u7684 children \u8F93\u51FA\u7A7A\u6570\u7EC4\uFF1B
   - \u63CF\u8FF0\u4E2D\u660E\u786E\u62C6\u51FA\u4E86\u5B50\u529F\u80FD\uFF08\u4F8B\u5982\u300C\u5E93\u5B58\u76D8\u70B9\u300D\u4E0B\u9762\u8FD8\u6709\u300C\u751F\u6210\u76D8\u70B9\u4EFB\u52A1\u300D\u300C\u5DEE\u5F02\u590D\u6838\u300D\uFF09\u65F6\uFF0C\u7EE7\u7EED\u5D4C\u5957\uFF1B
   - \u4E0D\u8981\u4E3A\u4E86\u7EDF\u4E00\u5F62\u72B6\u5F3A\u884C\u628A\u6240\u6709\u6A21\u5757\u62C6\u6210\u4E09\u5C42\uFF0C\u4E5F\u4E0D\u8981\u65E0\u4F9D\u636E\u5730\u52A0\u6DF1\u5C42\u7EA7\u3002
5. \u6700\u591A 6 \u5C42\uFF0C\u8282\u70B9\u603B\u6570\u4E0D\u8D85\u8FC7 200\u3002
6. \u540D\u79F0\u4F7F\u7528\u4E2D\u6587\u4E1A\u52A1\u540D\u8BCD\u6216\u52A8\u5BBE\u77ED\u8BED\uFF0C2 \u5230 10 \u4E2A\u6C49\u5B57\uFF1B\u540C\u4E00\u7236\u8282\u70B9\u4E0B\u4E0D\u8981\u51FA\u73B0\u91CD\u540D\u3002
7. \u4E0D\u8981\u8F93\u51FA\u7F16\u53F7\u3001\u5C5E\u6027\u3001\u8BF4\u660E\u3001\u5750\u6807\u3001\u989C\u8272\u3001\u6837\u5F0F\u6216\u4EFB\u4F55\u4E0E\u6811\u7ED3\u6784\u65E0\u5173\u7684\u5B57\u6BB5\u3002
8. children \u5FC5\u987B\u662F\u6570\u7EC4\uFF1B\u53F6\u5B50\u8282\u70B9\u7684 children \u8F93\u51FA []\u3002`;
function buildGenerateModuleTreeUserPrompt(requirement) {
  return `\u7CFB\u7EDF\u63CF\u8FF0\u5982\u4E0B\uFF0C\u8BF7\u751F\u6210\u529F\u80FD\u7ED3\u6784\u6811\uFF1A

"""
${requirement}
"""

\u8BF7\u53EA\u8FD4\u56DE JSON\u3002`;
}

// server/services/ai.ts
async function generateErFromRequirement(requirement, options = {}) {
  const config = readLlmConfig(process.env, options.config);
  const full = options.mode === "full";
  const content = await chat(config, [
    {
      role: "system",
      content: full ? GENERATE_ER_FULL_SYSTEM_PROMPT : GENERATE_ER_SYSTEM_PROMPT
    },
    {
      role: "user",
      content: full ? buildGenerateErFullUserPrompt(requirement) : buildGenerateErUserPrompt(requirement)
    }
  ]);
  const warnings = [];
  const raw = extractJson(content);
  const data = normalizeAiResult(raw, warnings);
  return { data, warnings };
}
async function generateErCompletion(entities, hint = "", configOverride) {
  const config = readLlmConfig(process.env, configOverride);
  const content = await chat(config, [
    { role: "system", content: COMPLETE_ER_SYSTEM_PROMPT },
    { role: "user", content: buildCompleteErUserPrompt(entities, hint) }
  ]);
  const warnings = [];
  const raw = extractJson(content);
  const data = normalizeCompletion(raw, entities, warnings);
  return { data, warnings };
}
async function generateRelationships(entities, hint = "", configOverride) {
  const config = readLlmConfig(process.env, configOverride);
  const content = await chat(config, [
    { role: "system", content: RELATIONSHIPS_ONLY_SYSTEM_PROMPT },
    { role: "user", content: buildRelationshipsOnlyUserPrompt(entities, hint) }
  ]);
  const warnings = [];
  const raw = extractJson(content);
  const data = normalizeCompletion(raw, entities, warnings, false);
  return { data: data.relationships, warnings };
}
function normalizeAiResult(raw, warnings = []) {
  if (!isRecord(raw)) {
    throw new Error("\u5927\u6A21\u578B\u8FD4\u56DE\u7684\u4E0D\u662F JSON \u5BF9\u8C61");
  }
  const entitiesRaw = Array.isArray(raw.entities) ? raw.entities : [];
  const entities = [];
  const seenName = /* @__PURE__ */ new Set();
  for (const item of entitiesRaw) {
    if (!isRecord(item)) continue;
    const name = text(item.name);
    if (!name) continue;
    if (seenName.has(name)) {
      warnings.push(`\u5B9E\u4F53\u300C${name}\u300D\u91CD\u590D\u51FA\u73B0\uFF0C\u5DF2\u5408\u5E76\u53BB\u91CD`);
      continue;
    }
    seenName.add(name);
    entities.push({ name, attributes: normalizeAttributes(item.attributes) });
  }
  if (entities.length === 0) {
    throw new Error("\u5927\u6A21\u578B\u672A\u8FD4\u56DE\u4EFB\u4F55\u6709\u6548\u5B9E\u4F53\uFF0C\u8BF7\u8865\u5145\u66F4\u5177\u4F53\u7684\u4E1A\u52A1\u9700\u6C42\u63CF\u8FF0");
  }
  const relationshipsRaw = Array.isArray(raw.relationships) ? raw.relationships : [];
  const relationships = normalizeRelationships(relationshipsRaw, seenName, warnings);
  return { entities, relationships };
}
function normalizeCompletion(raw, entities, warnings = [], includeAttributes = true) {
  const container = isRecord(raw) ? raw : Array.isArray(raw) ? { relationships: raw } : null;
  if (!container) {
    throw new Error("\u5927\u6A21\u578B\u8FD4\u56DE\u7684\u4E0D\u662F JSON \u5BF9\u8C61");
  }
  const knownNames = new Set(entities.map((e) => e.name));
  const existingByEntity = /* @__PURE__ */ new Map();
  for (const entity of entities) {
    existingByEntity.set(
      entity.name,
      new Set((entity.attributes ?? []).map((attr) => attributeKey(attr.name)))
    );
  }
  const relationshipsRaw = Array.isArray(container.relationships) ? container.relationships : [];
  const relationships = normalizeRelationships(relationshipsRaw, knownNames, warnings);
  const attributes = [];
  if (includeAttributes) {
    const patchSource = [
      container.attributes,
      container.attributeSuggestions,
      container.entityAttributes,
      container.entities
    ].find((value) => Array.isArray(value));
    const patchesRaw = patchSource ?? [];
    const seenByEntity = /* @__PURE__ */ new Map();
    for (const item of patchesRaw) {
      if (!isRecord(item)) continue;
      const grouped = Array.isArray(item.attributes);
      const entityName = text(item.entity) || (grouped ? text(item.name) : "");
      if (!entityName) continue;
      if (!knownNames.has(entityName)) {
        warnings.push(`\u5C5E\u6027\u8865\u5168\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u5B9E\u4F53\u300C${entityName}\u300D\uFF0C\u5DF2\u5FFD\u7565`);
        continue;
      }
      const list = grouped ? normalizeAttributes(item.attributes) : text(item.name) ? [{ name: text(item.name), primaryKey: Boolean(item.primaryKey) }] : [];
      if (list.length === 0) continue;
      const existing = existingByEntity.get(entityName) ?? /* @__PURE__ */ new Set();
      const seen = seenByEntity.get(entityName) ?? /* @__PURE__ */ new Set();
      const kept = [];
      for (const attr of list) {
        const key = attributeKey(attr.name);
        if (existing.has(key)) {
          warnings.push(`\u5B9E\u4F53\u300C${entityName}\u300D\u5DF2\u6709\u5C5E\u6027\u300C${attr.name}\u300D\uFF0C\u5DF2\u8DF3\u8FC7`);
          continue;
        }
        if (seen.has(key)) continue;
        seen.add(key);
        kept.push(attr);
      }
      if (kept.length > 0) {
        seenByEntity.set(entityName, seen);
        attributes.push({ entity: entityName, attributes: kept });
      }
    }
  }
  return { relationships, attributes };
}
function normalizeRelationships(list, knownNames, warnings) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of list) {
    if (!isRecord(item)) continue;
    const source = text(item.source);
    const target = text(item.target);
    if (!source || !target) continue;
    if (!knownNames.has(source) || !knownNames.has(target)) {
      warnings.push(`\u8054\u7CFB ${source || "?"} \u2192 ${target || "?"} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u5B9E\u4F53\uFF0C\u5DF2\u5FFD\u7565`);
      continue;
    }
    const relationText = text(item.text) || "\u5173\u8054";
    const kind = normalizeRelationKind(item.type);
    const key = `${source}::${target}::${relationText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rel = { source, target, type: kind, text: relationText };
    const attrs = normalizeAttributes(item.attributes);
    if (attrs.length) rel.attributes = attrs;
    out.push(rel);
  }
  return out;
}
function normalizeAttributes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = text(item.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, primaryKey: Boolean(item.primaryKey) });
  }
  return out;
}
var RELATION_KIND_ALIASES = {
  onetoone: "oneToOne",
  one1: "oneToOne",
  "1to1": "oneToOne",
  "1:1": "oneToOne",
  "1-1": "oneToOne",
  onetomany: "oneToMany",
  "1:n": "oneToMany",
  "1:m": "oneToMany",
  "1-n": "oneToMany",
  "1-m": "oneToMany",
  manytoone: "oneToMany",
  "n:1": "oneToMany",
  "m:1": "oneToMany",
  manytomany: "manyToMany",
  "n:m": "manyToMany",
  "m:n": "manyToMany",
  "n-m": "manyToMany",
  "m-m": "manyToMany"
};
function normalizeRelationKind(raw) {
  const raw2 = text(raw).toLowerCase().replace(/\s+/g, "");
  if (RELATION_KIND_ALIASES[raw2]) return RELATION_KIND_ALIASES[raw2];
  const compact = raw2.replace(/[_\-]/g, "");
  if (compact === "onetoone" || compact === "11" || compact === "1:1") return "oneToOne";
  if (compact === "manytomany" || compact === "nm" || compact === "mn") return "manyToMany";
  return "oneToMany";
}
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function text(v) {
  return typeof v === "string" ? v.trim() : "";
}
function attributeKey(name) {
  return name.trim().toLowerCase();
}

// shared/module-tree.ts
var moduleIdSeq = 0;
function nextModuleNodeId() {
  moduleIdSeq += 1;
  return `fm-${moduleIdSeq}`;
}
function wrapRoots(roots, warnings) {
  if (roots.length === 0) throw new Error("\u6CA1\u6709\u8BC6\u522B\u5230\u4EFB\u4F55\u8282\u70B9");
  if (roots.length === 1) return { tree: { root: roots[0] }, warnings };
  warnings.push(`\u68C0\u6D4B\u5230 ${roots.length} \u4E2A\u9876\u5C42\u8282\u70B9\uFF0C\u5DF2\u81EA\u52A8\u5F52\u5165\u300C\u529F\u80FD\u7ED3\u6784\u300D\u6839\u8282\u70B9`);
  return {
    tree: {
      root: { id: nextModuleNodeId(), name: "\u529F\u80FD\u7ED3\u6784", children: roots }
    },
    warnings
  };
}
var MODULE_TREE_MAX_LEVELS = 6;
var MODULE_TREE_MAX_NODES = 200;
function normalizeModuleTree(raw, warnings = []) {
  const candidates = extractRootCandidates(raw);
  const budget = { count: 0 };
  const nodes = candidates.map((candidate) => normalizeModuleNode(candidate, warnings, 0, budget)).filter((node) => node !== null);
  if (nodes.length === 0) throw new Error("\u5927\u6A21\u578B\u672A\u8FD4\u56DE\u4EFB\u4F55\u6709\u6548\u529F\u80FD\u8282\u70B9\uFF0C\u8BF7\u8865\u5145\u66F4\u5177\u4F53\u7684\u7CFB\u7EDF\u63CF\u8FF0");
  return wrapRoots(nodes, warnings).tree;
}
function extractRootCandidates(raw) {
  if (Array.isArray(raw)) return raw;
  if (!isRecord2(raw)) throw new Error("\u5927\u6A21\u578B\u8FD4\u56DE\u7684\u4E0D\u662F JSON \u5BF9\u8C61\u6216\u6570\u7EC4");
  for (const key of ["root", "tree", "data"]) {
    if (raw[key] !== void 0) return [raw[key]];
  }
  if (typeof raw.name === "string" || Array.isArray(raw.children)) return [raw];
  if (Array.isArray(raw.nodes)) return raw.nodes;
  if (Array.isArray(raw.modules)) return raw.modules;
  throw new Error("\u5927\u6A21\u578B\u8FD4\u56DE\u7684 JSON \u4E2D\u6CA1\u6709\u53EF\u8BC6\u522B\u7684\u529F\u80FD\u6811");
}
function normalizeModuleNode(raw, warnings, depth, budget) {
  if (budget.count >= MODULE_TREE_MAX_NODES) {
    warnings.push(`\u8282\u70B9\u6570\u91CF\u8D85\u8FC7 ${MODULE_TREE_MAX_NODES}\uFF0C\u591A\u4F59\u90E8\u5206\u5DF2\u622A\u65AD`);
    return null;
  }
  if (typeof raw === "string") {
    const name2 = raw.trim();
    if (!name2) return null;
    budget.count += 1;
    return { id: nextModuleNodeId(), name: name2, children: [] };
  }
  if (!isRecord2(raw)) return null;
  const name = readNodeName(raw);
  if (!name) return null;
  budget.count += 1;
  const node = { id: nextModuleNodeId(), name, children: [] };
  const childrenRaw = readChildren(raw);
  if (childrenRaw.length > 0) {
    if (depth >= MODULE_TREE_MAX_LEVELS - 1) {
      warnings.push(`\u300C${name}\u300D\u8D85\u8FC7 ${MODULE_TREE_MAX_LEVELS} \u5C42\uFF0C\u5176\u5B50\u8282\u70B9\u5DF2\u5FFD\u7565`);
      return node;
    }
    for (const child of childrenRaw) {
      const normalized = normalizeModuleNode(child, warnings, depth + 1, budget);
      if (normalized) node.children.push(normalized);
    }
  }
  return node;
}
function readNodeName(raw) {
  for (const key of ["name", "title", "label", "text"]) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
function readChildren(raw) {
  for (const key of ["children", "nodes", "modules", "functions", "items", "subModules"]) {
    const value = raw[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// server/services/module-ai.ts
async function generateModuleTreeFromRequirement(requirement, configOverride) {
  const config = readLlmConfig(process.env, configOverride);
  const content = await chat(config, [
    { role: "system", content: GENERATE_MODULE_TREE_SYSTEM_PROMPT },
    { role: "user", content: buildGenerateModuleTreeUserPrompt(requirement) }
  ]);
  const warnings = [];
  const raw = extractJson(content);
  const tree = normalizeModuleTree(raw, warnings);
  return { data: { tree }, warnings };
}

// server/services/sql-parser.ts
import { init, parse } from "@guanmingchiu/sqlparser-ts";
var initPromise = null;
async function ensureInit() {
  if (!initPromise) {
    initPromise = init();
  }
  return initPromise;
}
async function parseSqlToTables(sql) {
  await ensureInit();
  const warnings = [];
  const statements = splitStatements(stripComments(sql));
  if (statements.length === 0) {
    throw new SqlParseError("\u6CA1\u6709\u68C0\u6D4B\u5230\u4EFB\u4F55 SQL \u8BED\u53E5");
  }
  const tables = [];
  const seenTables = /* @__PURE__ */ new Set();
  const pendingForeignKeys = [];
  for (const [index, raw] of statements.entries()) {
    const stmt = raw.trim();
    if (!stmt) continue;
    if (!/alter\s+table|create\s+table/i.test(stmt)) continue;
    const ast = tryParseStatement(stmt, index + 1, warnings);
    if (!ast) continue;
    for (const item of ast) {
      const created = item?.CreateTable;
      if (created) {
        const table = extractTable(created, warnings);
        if (!table) continue;
        if (seenTables.has(table.tableName)) {
          warnings.push(`\u8868 ${table.tableName} \u91CD\u590D\u5B9A\u4E49\uFF0C\u5DF2\u4FDD\u7559\u7B2C\u4E00\u6B21\u51FA\u73B0\u7684\u5B9A\u4E49`);
          continue;
        }
        seenTables.add(table.tableName);
        tables.push(table);
        continue;
      }
      const altered = item?.AlterTable;
      if (altered) {
        const tableName = lastIdentifier(altered.name);
        if (!tableName) continue;
        for (const op of altered.operations ?? []) {
          const added = op?.AddConstraint?.constraint;
          if (added?.ForeignKey) {
            const fk = extractForeignKey(added.ForeignKey);
            if (fk) pendingForeignKeys.push({ tableName, fk });
          }
        }
      }
    }
  }
  for (const { tableName, fk } of pendingForeignKeys) {
    const table = tables.find((t) => t.tableName === tableName);
    if (!table) {
      warnings.push(`ALTER TABLE ${tableName} \u6DFB\u52A0\u7684\u5916\u952E ${fk.name || fk.columns.join(",")} \u627E\u4E0D\u5230\u76EE\u6807\u8868\uFF0C\u5DF2\u8DF3\u8FC7`);
      continue;
    }
    const duplicated = table.foreignKeys.some(
      (existing) => existing.refTable === fk.refTable && existing.columns.join(",") === fk.columns.join(",")
    );
    if (!duplicated) table.foreignKeys.push(fk);
  }
  if (tables.length === 0) {
    throw new SqlParseError("\u6CA1\u6709\u89E3\u6790\u51FA\u4EFB\u4F55 CREATE TABLE \u8BED\u53E5\uFF0C\u8BF7\u786E\u8BA4\u8F93\u5165\u7684\u662F MySQL \u5EFA\u8868 SQL");
  }
  return { tables, warnings };
}
var SqlParseError = class extends Error {
};
function stripComments(sql) {
  let out = "";
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      out += ch;
      if (ch === "\\" && i + 1 < sql.length) {
        out += sql[i + 1];
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "#") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 1;
      out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}
function splitStatements(sql) {
  const out = [];
  let buf = "";
  let quote = null;
  let depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      buf += ch;
      if (ch === "\\" && i + 1 < sql.length) {
        buf += sql[i + 1];
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "(") {
      depth++;
      buf += ch;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      buf += ch;
      continue;
    }
    if (ch === ";" && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
function tryParseStatement(stmt, ordinal, warnings) {
  const attempts = [
    { label: "\u539F\u6837", sql: stmt },
    { label: "\u6E05\u6D17\u540E", sql: sanitizeMySql(stmt) }
  ];
  for (const attempt of attempts) {
    try {
      const ast = parse(attempt.sql, "mysql");
      if (Array.isArray(ast)) return ast;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`\u7B2C ${ordinal} \u6761\u8BED\u53E5\uFF08${attempt.label}\uFF09\u89E3\u6790\u5931\u8D25\uFF1A${message.split("\n")[0]}`);
    }
  }
  return null;
}
function sanitizeMySql(sql) {
  let out = sql;
  out = out.replace(
    /^[ \t]*(?:UNIQUE\s+|FULLTEXT\s+|SPATIAL\s+)?(?:INDEX|KEY)\s+[`"][^`"]+[`"]\s*\([^)]*\)[^,\n]*,\s*$/gim,
    ""
  );
  out = out.replace(/\)\s*USING\s+(?:BTREE|HASH)\s*\)?/gi, ")");
  out = out.replace(/\s+ON\s+UPDATE\s+[^,\n)]+/gi, "");
  out = out.replace(/\s+(?:CHARACTER\s+SET|CHARSET)\s*[= ]\s*[\w-]+/gi, "");
  out = out.replace(/\s+COLLATE\s*[= ]\s*[\w-]+/gi, "");
  out = out.replace(/\s+(?:ROW_FORMAT|STATS_PERSISTENT|STATS_AUTO_RECALC|STATS_SAMPLE_PAGES)\s*=\s*[^,\s]+/gi, "");
  out = out.replace(/,\s*\)/g, ")");
  out = out.replace(/,\s*,/g, ",");
  return out;
}
function extractTable(created, warnings) {
  const tableName = lastIdentifier(created.name);
  if (!tableName) {
    warnings.push("\u5B58\u5728\u4E00\u4E2A\u65E0\u6CD5\u8BC6\u522B\u8868\u540D\u7684 CREATE TABLE \u8BED\u53E5\uFF0C\u5DF2\u8DF3\u8FC7");
    return null;
  }
  const tableComment = extractTableComment(created.table_options);
  const columns = [];
  const rawColumns = Array.isArray(created.columns) ? created.columns : [];
  const pkSet = /* @__PURE__ */ new Set();
  const foreignKeys = [];
  for (const constraint of created.constraints ?? []) {
    if (constraint?.PrimaryKey) {
      for (const col of constraint.PrimaryKey.columns ?? []) {
        const name = identifierValue(col?.column?.expr);
        if (name) pkSet.add(name);
      }
    }
    if (constraint?.ForeignKey) {
      const fk = extractForeignKey(constraint.ForeignKey);
      if (fk) foreignKeys.push(fk);
    }
  }
  for (const col of rawColumns) {
    const name = col?.name?.value;
    if (!name) continue;
    const opts = extractColumnOptions(col.options);
    if (opts.primary) pkSet.add(name);
    columns.push({
      name,
      comment: opts.comment,
      primaryKey: pkSet.has(name),
      type: formatDataType(col.data_type)
    });
  }
  for (const col of columns) {
    if (pkSet.has(col.name)) col.primaryKey = true;
  }
  return {
    tableName,
    tableComment,
    columns,
    foreignKeys
  };
}
function extractForeignKey(fk) {
  const columns = (fk.columns ?? []).map((c) => typeof c === "string" ? c : c?.value).filter((v) => typeof v === "string" && v.length > 0);
  const refTable = lastIdentifier(fk.foreign_table);
  const refColumns = (fk.referred_columns ?? []).map((c) => typeof c === "string" ? c : c?.value).filter((v) => typeof v === "string" && v.length > 0);
  if (!refTable) return null;
  return {
    name: typeof fk.name === "string" ? fk.name : fk.name?.value ?? "",
    columns,
    refTable,
    refColumns
  };
}
function extractColumnOptions(options) {
  let comment = "";
  let primary = false;
  for (const entry of options ?? []) {
    const opt = entry?.option;
    if (!opt) continue;
    if (typeof opt === "string") {
      if (opt === "PrimaryKey") primary = true;
      continue;
    }
    if (typeof opt === "object") {
      if (opt.Comment !== void 0) {
        comment = typeof opt.Comment === "string" ? opt.Comment : "";
      }
      if (opt.Unique?.is_primary) primary = true;
      if (Array.isArray(opt.DialectSpecific)) {
        const text2 = opt.DialectSpecific.map((x) => x?.Word?.value ?? x?.value ?? "").join(" ");
        if (/PRIMARY\s+KEY/i.test(text2)) primary = true;
      }
    }
  }
  return { comment, primary };
}
function extractTableComment(tableOptions) {
  const plain = tableOptions?.Plain ?? [];
  for (const opt of plain) {
    if (opt?.Comment !== void 0) {
      const c = opt.Comment;
      if (typeof c === "string") return c;
      if (typeof c === "object") {
        if (typeof c.WithEq === "string") return c.WithEq;
        if (typeof c.WithoutEq === "string") return c.WithoutEq;
      }
    }
  }
  return "";
}
function lastIdentifier(nameNode) {
  if (!Array.isArray(nameNode) || nameNode.length === 0) return "";
  const parts = nameNode.map((part) => {
    if (part?.Identifier) return part.Identifier.value;
    if (part?.ObjectName) return lastIdentifier(part.ObjectName);
    return "";
  }).filter((v) => typeof v === "string");
  return parts[parts.length - 1] ?? "";
}
function identifierValue(exprNode) {
  if (!exprNode) return "";
  if (exprNode.Identifier) return exprNode.Identifier.value ?? "";
  if (exprNode.CompoundIdentifier) {
    const parts = exprNode.CompoundIdentifier.map((p) => p?.value ?? "");
    return parts[parts.length - 1] ?? "";
  }
  return "";
}
function formatDataType(dt) {
  if (!dt) return "";
  if (typeof dt === "string") return dt.toUpperCase();
  if (Array.isArray(dt)) {
    return dt.map(formatDataType).filter(Boolean).join(" ");
  }
  if (typeof dt === "object") {
    const key = Object.keys(dt)[0];
    if (!key) return "";
    const upper = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
    const lengths = [];
    const walk = (x) => {
      if (typeof x === "number") lengths.push(x);
      else if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") Object.values(x).forEach(walk);
    };
    walk(dt[key]);
    return lengths.length ? `${upper}(${lengths.join(",")})` : upper;
  }
  return "";
}

// server/routes/index.ts
function asyncHandler(fn) {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}
function readString(value) {
  return typeof value === "string" ? value : "";
}
function llmOverrideFromRequest(req) {
  return {
    baseUrl: (req.header("x-llm-base-url") ?? "").trim(),
    apiKey: (req.header("x-llm-api-key") ?? "").trim(),
    model: (req.header("x-llm-model") ?? "").trim()
  };
}
function sanitizeEntities(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e) => typeof e === "object" && e !== null).map((e) => ({
    name: readString(e.name).trim(),
    attributes: Array.isArray(e.attributes) ? e.attributes.filter((a) => typeof a === "object" && a !== null).map((a) => ({ name: readString(a.name).trim(), primaryKey: Boolean(a.primaryKey) })).filter((a) => a.name) : []
  })).filter((e) => e.name);
}
function createApiRouter() {
  const router = Router();
  const guard = createGuard({
    accessCode: (process.env.ACCESS_CODE || "").trim(),
    rateLimitPerMin: Number.parseInt(process.env.RATE_LIMIT_PER_MIN || "20", 10) || 0
  });
  router.get("/health", (_req, res) => {
    res.json(ok({ status: "ok", time: (/* @__PURE__ */ new Date()).toISOString() }));
  });
  router.post(
    "/parseSQL",
    guard,
    asyncHandler(async (req, res) => {
      let sql = readString(req.body?.sql);
      if (!sql && Array.isArray(req.body?.sqls)) {
        sql = req.body.sqls.filter((s) => typeof s === "string").join("\n;\n");
      }
      if (!sql.trim()) {
        throw new HttpError(400, "\u8BF7\u63D0\u4F9B SQL \u6587\u672C\uFF08\u5B57\u6BB5 sql \u6216 sqls\uFF09");
      }
      if (sql.length > 512 * 1024) {
        throw new HttpError(413, "SQL \u6587\u672C\u8FC7\u5927\uFF0C\u8BF7\u63A7\u5236\u5728 512KB \u4EE5\u5185");
      }
      const { tables, warnings } = await parseSqlToTables(sql);
      res.json(ok({ tables }, { warnings }));
    })
  );
  router.post(
    "/ai/generate-er",
    guard,
    asyncHandler(async (req, res) => {
      const prompt = readString(req.body?.prompt).trim();
      if (!prompt) throw new HttpError(400, "\u8BF7\u63D0\u4F9B\u9700\u6C42\u63CF\u8FF0\uFF08\u5B57\u6BB5 prompt\uFF09");
      if (prompt.length > 1e5) throw new HttpError(400, "\u9700\u6C42\u63CF\u8FF0\u8FC7\u957F\uFF0C\u8BF7\u63A7\u5236\u5728 10000 \u5B57\u4EE5\u5185");
      const mode = readString(req.body?.mode).trim() === "full" ? "full" : "core";
      const config = llmOverrideFromRequest(req);
      const { data, warnings } = await generateErFromRequirement(prompt, { mode, config });
      res.json(ok(data, { warnings }));
    })
  );
  router.post(
    "/ai/complete-er",
    guard,
    asyncHandler(async (req, res) => {
      const entitiesRaw = req.body?.entities;
      if (!Array.isArray(entitiesRaw) || entitiesRaw.length === 0) {
        throw new HttpError(400, "\u8BF7\u63D0\u4F9B\u5B9E\u4F53\u5217\u8868\uFF08\u5B57\u6BB5 entities\uFF09");
      }
      if (entitiesRaw.length > 40) {
        throw new HttpError(400, "\u5B9E\u4F53\u6570\u91CF\u8FC7\u591A\uFF0C\u8BF7\u63A7\u5236\u5728 40 \u4E2A\u4EE5\u5185");
      }
      const entities = sanitizeEntities(entitiesRaw);
      if (entities.length === 0) {
        throw new HttpError(400, "\u8BF7\u63D0\u4F9B\u81F3\u5C11 1 \u4E2A\u6709\u6548\u5B9E\u4F53\u624D\u80FD\u8865\u5168");
      }
      const hint = readString(req.body?.hint).trim();
      if (hint.length > 2e4) throw new HttpError(400, "\u8865\u5145\u8BF4\u660E\u8FC7\u957F\uFF0C\u8BF7\u63A7\u5236\u5728 20000 \u5B57\u4EE5\u5185");
      const config = llmOverrideFromRequest(req);
      const { data, warnings } = await generateErCompletion(entities, hint, config);
      res.json(ok(data, { warnings }));
    })
  );
  router.post(
    "/ai/generate-module-tree",
    guard,
    asyncHandler(async (req, res) => {
      const prompt = readString(req.body?.prompt).trim();
      if (!prompt) throw new HttpError(400, "\u8BF7\u63D0\u4F9B\u7CFB\u7EDF\u63CF\u8FF0\uFF08\u5B57\u6BB5 prompt\uFF09");
      if (prompt.length > 1e5) throw new HttpError(400, "\u7CFB\u7EDF\u63CF\u8FF0\u8FC7\u957F\uFF0C\u8BF7\u63A7\u5236\u5728 10000 \u5B57\u4EE5\u5185");
      const config = llmOverrideFromRequest(req);
      const { data, warnings } = await generateModuleTreeFromRequirement(prompt, config);
      res.json(ok(data, { warnings }));
    })
  );
  router.post(
    "/ai/generate-relationships",
    guard,
    asyncHandler(async (req, res) => {
      const entitiesRaw = req.body?.entities;
      if (!Array.isArray(entitiesRaw) || entitiesRaw.length === 0) {
        throw new HttpError(400, "\u8BF7\u63D0\u4F9B\u5B9E\u4F53\u5217\u8868\uFF08\u5B57\u6BB5 entities\uFF09");
      }
      if (entitiesRaw.length > 40) {
        throw new HttpError(400, "\u5B9E\u4F53\u6570\u91CF\u8FC7\u591A\uFF0C\u8BF7\u63A7\u5236\u5728 40 \u4E2A\u4EE5\u5185");
      }
      const sanitized = sanitizeEntities(entitiesRaw);
      if (sanitized.length < 2) {
        throw new HttpError(400, "\u81F3\u5C11\u9700\u8981 2 \u4E2A\u6709\u6548\u5B9E\u4F53\u624D\u80FD\u63A8\u65AD\u8054\u7CFB");
      }
      const hint = readString(req.body?.hint).trim();
      if (hint.length > 2e4) throw new HttpError(400, "\u8865\u5145\u8BF4\u660E\u8FC7\u957F\uFF0C\u8BF7\u63A7\u5236\u5728 2000 \u5B57\u4EE5\u5185");
      const config = llmOverrideFromRequest(req);
      const { data, warnings } = await generateRelationships(sanitized, hint, config);
      res.json(ok(data, { warnings }));
    })
  );
  router.use((_req, res) => {
    res.status(404).json(fail("\u63A5\u53E3\u4E0D\u5B58\u5728"));
  });
  return router;
}

// server/app.ts
function createApp() {
  const app2 = express();
  app2.set("trust proxy", true);
  app2.disable("x-powered-by");
  app2.use(cors({ origin: true, credentials: false }));
  app2.use(express.json({ limit: "2mb" }));
  app2.use("/api", createApiRouter());
  app2.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app2.use((_req, res) => {
    res.status(404).json(fail("Not Found"));
  });
  app2.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json(fail(err.message));
      return;
    }
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json(fail("\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON"));
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sql2er] \u672A\u5904\u7406\u5F02\u5E38:", err);
    res.status(500).json(fail(message || "\u670D\u52A1\u5668\u5185\u90E8\u9519\u8BEF"));
  });
  return app2;
}

// server/vercel.ts
var app = createApp();
function handler(req, res) {
  app(req, res);
}
export {
  handler as default
};
