/**
 * 功能结构图 AI 生成：自然语言 → 系统 / 模块 / 功能树。
 * 只负责调用模型、抽取 JSON 并规整结构，布局与渲染完全在前端完成。
 */

import { normalizeModuleTree, type ModuleTree } from '../../shared/module-tree';
import { chat, extractJson, readLlmConfig, type LlmConfigOverride } from './ai-client';
import {
  GENERATE_MODULE_TREE_SYSTEM_PROMPT,
  buildGenerateModuleTreeUserPrompt,
} from './prompts';

export interface ModuleTreeOutcome {
  data: { tree: ModuleTree };
  warnings: string[];
}

export async function generateModuleTreeFromRequirement(
  requirement: string,
  configOverride?: LlmConfigOverride,
): Promise<ModuleTreeOutcome> {
  const config = readLlmConfig(process.env, configOverride);

  const content = await chat(config, [
    { role: 'system', content: GENERATE_MODULE_TREE_SYSTEM_PROMPT },
    { role: 'user', content: buildGenerateModuleTreeUserPrompt(requirement) },
  ]);

  const warnings: string[] = [];
  const raw = extractJson(content);
  const tree = normalizeModuleTree(raw, warnings);
  return { data: { tree }, warnings };
}
