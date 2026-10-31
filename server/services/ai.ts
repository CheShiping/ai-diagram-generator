/**
 * AI 能力封装：自然语言 → ER 结构、已有实体 → 补充联系与缺失属性。
 * 负责调用模型、解析 JSON，并做严格的结构规整（过滤脏数据）。
 */

import type {
  AiAttribute,
  AiAttributePatch,
  AiCompletionResult,
  AiEntity,
  AiRelationship,
  AiResult,
  RelationKind,
} from '../../shared/er-model';
import { chat, extractJson, readLlmConfig } from './ai-client';
import {
  COMPLETE_ER_SYSTEM_PROMPT,
  GENERATE_ER_SYSTEM_PROMPT,
  RELATIONSHIPS_ONLY_SYSTEM_PROMPT,
  buildCompleteErUserPrompt,
  buildGenerateErUserPrompt,
  buildRelationshipsOnlyUserPrompt,
} from './prompts';

export interface AiGenerateOutcome {
  data: AiResult;
  warnings: string[];
}

export interface AiCompletionOutcome {
  data: AiCompletionResult;
  warnings: string[];
}

/** 自然语言需求 → 实体与联系 */
export async function generateErFromRequirement(requirement: string): Promise<AiGenerateOutcome> {
  const config = readLlmConfig();

  const content = await chat(config, [
    { role: 'system', content: GENERATE_ER_SYSTEM_PROMPT },
    { role: 'user', content: buildGenerateErUserPrompt(requirement) },
  ]);

  const warnings: string[] = [];
  const raw = extractJson(content);
  const data = normalizeAiResult(raw, warnings);
  return { data, warnings };
}

/**
 * 已有实体 → 补充联系 + 缺失属性。
 * hint 是用户提供的业务描述或补充说明，也是新增属性的唯一依据。
 */
export async function generateErCompletion(
  entities: AiEntity[],
  hint = '',
): Promise<AiCompletionOutcome> {
  const config = readLlmConfig();

  const content = await chat(config, [
    { role: 'system', content: COMPLETE_ER_SYSTEM_PROMPT },
    { role: 'user', content: buildCompleteErUserPrompt(entities, hint) },
  ]);

  const warnings: string[] = [];
  const raw = extractJson(content);
  const data = normalizeCompletion(raw, entities, warnings);
  return { data, warnings };
}

/** 兼容旧接口：只返回补充的联系，不处理属性建议。 */
export async function generateRelationships(
  entities: AiEntity[],
  hint = '',
): Promise<{ data: AiRelationship[]; warnings: string[] }> {
  const config = readLlmConfig();

  const content = await chat(config, [
    { role: 'system', content: RELATIONSHIPS_ONLY_SYSTEM_PROMPT },
    { role: 'user', content: buildRelationshipsOnlyUserPrompt(entities, hint) },
  ]);

  const warnings: string[] = [];
  const raw = extractJson(content);
  const data = normalizeCompletion(raw, entities, warnings, false);
  return { data: data.relationships, warnings };
}

/* ------------------------------------------------------------------ */
/* 结构规整                                                            */
/* ------------------------------------------------------------------ */

export function normalizeAiResult(raw: unknown, warnings: string[] = []): AiResult {
  if (!isRecord(raw)) {
    throw new Error('大模型返回的不是 JSON 对象');
  }

  const entitiesRaw = Array.isArray(raw.entities) ? raw.entities : [];
  const entities: AiEntity[] = [];
  const seenName = new Set<string>();

  for (const item of entitiesRaw) {
    if (!isRecord(item)) continue;
    const name = text(item.name);
    if (!name) continue;
    if (seenName.has(name)) {
      warnings.push(`实体「${name}」重复出现，已合并去重`);
      continue;
    }
    seenName.add(name);
    entities.push({ name, attributes: normalizeAttributes(item.attributes) });
  }

  if (entities.length === 0) {
    throw new Error('大模型未返回任何有效实体，请补充更具体的业务需求描述');
  }

  const relationshipsRaw = Array.isArray(raw.relationships) ? raw.relationships : [];
  const relationships = normalizeRelationships(relationshipsRaw, seenName, warnings);

  return { entities, relationships };
}

/**
 * 规整 AI 补全结果：联系 + 属性补丁。
 * 属性补丁只保留图中已存在的实体，并过滤掉实体现有属性。
 */
export function normalizeCompletion(
  raw: unknown,
  entities: AiEntity[],
  warnings: string[] = [],
  includeAttributes = true,
): AiCompletionResult {
  const container = isRecord(raw)
    ? raw
    : Array.isArray(raw)
      ? { relationships: raw }
      : null;
  if (!container) {
    throw new Error('大模型返回的不是 JSON 对象');
  }

  const knownNames = new Set(entities.map((e) => e.name));
  const existingByEntity = new Map<string, Set<string>>();
  for (const entity of entities) {
    existingByEntity.set(
      entity.name,
      new Set((entity.attributes ?? []).map((attr) => attributeKey(attr.name))),
    );
  }

  const relationshipsRaw = Array.isArray(container.relationships) ? container.relationships : [];
  const relationships = normalizeRelationships(relationshipsRaw, knownNames, warnings);

  const attributes: AiAttributePatch[] = [];
  if (includeAttributes) {
    const patchSource = [
      container.attributes,
      container.attributeSuggestions,
      container.entityAttributes,
      container.entities,
    ].find((value): value is unknown[] => Array.isArray(value));
    const patchesRaw = patchSource ?? [];
    const seenByEntity = new Map<string, Set<string>>();

    for (const item of patchesRaw) {
      if (!isRecord(item)) continue;
      const grouped = Array.isArray(item.attributes);
      const entityName = text(item.entity) || (grouped ? text(item.name) : '');
      if (!entityName) continue;
      if (!knownNames.has(entityName)) {
        warnings.push(`属性补全引用了不存在的实体「${entityName}」，已忽略`);
        continue;
      }

      // 兼容两种模型输出：{ entity, attributes: [...] } 或平铺的 { entity, name }
      const list = grouped
        ? normalizeAttributes(item.attributes)
        : text(item.name)
          ? [{ name: text(item.name), primaryKey: Boolean(item.primaryKey) }]
          : [];
      if (list.length === 0) continue;

      const existing = existingByEntity.get(entityName) ?? new Set<string>();
      const seen = seenByEntity.get(entityName) ?? new Set<string>();
      const kept: AiAttribute[] = [];

      for (const attr of list) {
        const key = attributeKey(attr.name);
        if (existing.has(key)) {
          warnings.push(`实体「${entityName}」已有属性「${attr.name}」，已跳过`);
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

function normalizeRelationships(list: unknown[], knownNames: Set<string>, warnings: string[]): AiRelationship[] {
  const out: AiRelationship[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    if (!isRecord(item)) continue;
    const source = text(item.source);
    const target = text(item.target);
    if (!source || !target) continue;
    if (!knownNames.has(source) || !knownNames.has(target)) {
      warnings.push(`联系 ${source || '?'} → ${target || '?'} 引用了不存在的实体，已忽略`);
      continue;
    }
    const relationText = text(item.text) || '关联';
    const kind = normalizeRelationKind(item.type);
    const key = `${source}::${target}::${relationText}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const rel: AiRelationship = { source, target, type: kind, text: relationText };
    const attrs = normalizeAttributes(item.attributes);
    if (attrs.length) rel.attributes = attrs;
    out.push(rel);
  }

  return out;
}

function normalizeAttributes(raw: unknown): AiAttribute[] {
  if (!Array.isArray(raw)) return [];
  const out: AiAttribute[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = text(item.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, primaryKey: Boolean(item.primaryKey) });
  }
  return out;
}

const RELATION_KIND_ALIASES: Record<string, RelationKind> = {
  onetoone: 'oneToOne',
  one1: 'oneToOne',
  '1to1': 'oneToOne',
  '1:1': 'oneToOne',
  '1-1': 'oneToOne',
  onetomany: 'oneToMany',
  '1:n': 'oneToMany',
  '1:m': 'oneToMany',
  '1-n': 'oneToMany',
  '1-m': 'oneToMany',
  manytoone: 'oneToMany',
  'n:1': 'oneToMany',
  'm:1': 'oneToMany',
  manytomany: 'manyToMany',
  'n:m': 'manyToMany',
  'm:n': 'manyToMany',
  'n-m': 'manyToMany',
  'm-m': 'manyToMany',
};

export function normalizeRelationKind(raw: unknown): RelationKind {
  const raw2 = text(raw).toLowerCase().replace(/\s+/g, '');
  if (RELATION_KIND_ALIASES[raw2]) return RELATION_KIND_ALIASES[raw2];

  // 兜底：去掉常见分隔符后再查一次
  const compact = raw2.replace(/[_\-]/g, '');
  if (compact === 'onetoone' || compact === '11' || compact === '1:1') return 'oneToOne';
  if (compact === 'manytomany' || compact === 'nm' || compact === 'mn') return 'manyToMany';
  return 'oneToMany';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function attributeKey(name: string): string {
  return name.trim().toLowerCase();
}
