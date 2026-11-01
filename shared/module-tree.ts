/**
 * 功能结构图（模块图）共享模型。
 *
 * 层级约定（复刻 huahub 的模块图）：
 *  - 第 0 层：系统（横排文字）
 *  - 第 1 层：模块（横排文字）
 *  - 第 2 层及更深：功能（竖排文字，逐字堆叠）
 *
 * 树结构同时用于左侧结构树编辑、大纲解析、AI 生成与布局渲染。
 */

export interface ModuleNode {
  id: string;
  name: string;
  children: ModuleNode[];
}

export interface ModuleTree {
  root: ModuleNode;
}

/** 创建节点 / 示例 / AI 结果时使用的纯数据形态（无 id） */
export interface ModuleNodeInput {
  name: string;
  children?: ModuleNodeInput[];
}

export interface ParseOutlineResult {
  tree: ModuleTree;
  warnings: string[];
}

let moduleIdSeq = 0;

/** 生成全局唯一节点 id（运行期单调递增，便于撤销快照复用） */
export function nextModuleNodeId(): string {
  moduleIdSeq += 1;
  return `fm-${moduleIdSeq}`;
}

/* ------------------------------------------------------------------ */
/* 示例数据                                                            */
/* ------------------------------------------------------------------ */

export const MODULE_SAMPLES: ModuleNodeInput[] = [
    {
      name: '外卖配送平台',
      children: [
        {
          name: '顾客端',
          children: [
            { name: '商家搜索' },
            { name: '菜品浏览' },
            { name: '购物车' },
            { name: '在线支付' },
            { name: '订单跟踪' },
          ],
        },
        {
          name: '商家端',
          children: [
            {
              name: '菜单管理',
              children: [{ name: '菜品上架' }, { name: '库存设置' }],
            },
            { name: '接单出餐' },
            { name: '营业统计' },
          ],
        },
        {
          name: '骑手端',
          children: [{ name: '订单抢单' }, { name: '路线导航' }, { name: '配送签收' }],
        },
        {
          name: '平台管理',
          children: [{ name: '商家审核' }, { name: '客服处理' }],
        },
      ],
    },
    {
      name: '智能仓储管理系统',
      children: [
        {
          name: '入库管理',
          children: [{ name: '到货预约' }, { name: '收货质检' }, { name: '上架分配' }],
        },
        {
          name: '库存管理',
          children: [
            { name: '库位查询' },
            {
              name: '库存盘点',
              children: [{ name: '生成盘点任务' }, { name: '差异复核' }],
            },
            { name: '安全库存预警' },
          ],
        },
        {
          name: '出库管理',
          children: [{ name: '订单拣货' }, { name: '复核打包' }, { name: '物流交接' }],
        },
        {
          name: '运营报表',
          children: [{ name: '周转率分析' }, { name: '异常记录' }],
        },
      ],
    },
    {
      name: '在线教育系统',
      children: [
        {
          name: '课程管理',
          children: [{ name: '课程创建' }, { name: '课程发布' }, { name: '课程下架' }],
        },
        {
          name: '学员管理',
          children: [{ name: '报名审核' }, { name: '学习进度' }, { name: '成绩查询' }],
        },
        {
          name: '教学管理',
          children: [{ name: '作业布置' }, { name: '作业批改' }, { name: '在线考试' }],
        },
        {
          name: '数据统计',
          children: [{ name: '课程销量' }, { name: '学习时长' }],
        },
      ],
    },
];

/** 按索引取一个全新的示例树（超出范围自动循环） */
export function createModuleSample(index = 0): ModuleTree {
  const safe = ((index % MODULE_SAMPLES.length) + MODULE_SAMPLES.length) % MODULE_SAMPLES.length;
  return { root: treeFromInput(MODULE_SAMPLES[safe]) };
}

function treeFromInput(input: ModuleNodeInput): ModuleNode {
  return {
    id: nextModuleNodeId(),
    name: input.name.trim(),
    children: (input.children ?? []).map(treeFromInput),
  };
}

/* ------------------------------------------------------------------ */
/* 大纲解析                                                            */
/* ------------------------------------------------------------------ */

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^[-*+•]\s+/;

/**
 * 把大纲文本解析成功能树。支持两种写法：
 *  1. Markdown 标题：# 系统、## 模块、### 功能（层级按 # 数量）
 *  2. 缩进层级：空格 / Tab 缩进表示父子关系
 * 同时容忍行首的 -、*、+、• 列表符号。
 */
export function parseModuleOutline(text: string): ParseOutlineResult {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\t/g, '    '))
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) throw new Error('大纲内容为空');

  const isMarkdown = lines.some((line) => HEADING_RE.test(line.trim()));
  return isMarkdown ? parseMarkdownOutline(lines) : parseIndentedOutline(lines);
}

function parseMarkdownOutline(lines: string[]): ParseOutlineResult {
  const warnings: string[] = [];
  const entries: Array<{ level: number; name: string }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(HEADING_RE);
    if (!match) {
      warnings.push(`已忽略非标题行：${trimmed.slice(0, 40)}`);
      continue;
    }
    const name = stripBullet(match[2]);
    if (!name) continue;
    entries.push({ level: match[1].length, name });
  }

  if (entries.length === 0) throw new Error('没有识别到任何标题，请使用 # 系统、## 模块 这样的写法');

  const minLevel = Math.min(...entries.map((entry) => entry.level));
  return buildTree(
    entries.map((entry) => ({ level: entry.level - minLevel, name: entry.name })),
    warnings,
  );
}

function parseIndentedOutline(lines: string[]): ParseOutlineResult {
  const warnings: string[] = [];
  const rawEntries = lines.map((line) => {
    const indent = line.length - line.trimStart().length;
    return { indent, name: stripBullet(line.trim()) };
  });

  const minIndent = Math.min(...rawEntries.map((entry) => entry.indent));
  const stack: Array<{ indent: number; node: ModuleNode }> = [];
  const roots: ModuleNode[] = [];

  for (const entry of rawEntries) {
    if (!entry.name) continue;
    const indent = entry.indent - minIndent;
    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) stack.pop();

    const node: ModuleNode = { id: nextModuleNodeId(), name: entry.name, children: [] };
    const parent = stack[stack.length - 1]?.node;
    if (parent) parent.children.push(node);
    else roots.push(node);

    stack.push({ indent, node });
  }

  return wrapRoots(roots, warnings);
}

function parseLevelEntries(
  entries: Array<{ level: number; name: string }>,
): ModuleNode[] {
  const stack: ModuleNode[] = [];
  const roots: ModuleNode[] = [];

  for (const entry of entries) {
    const node: ModuleNode = { id: nextModuleNodeId(), name: entry.name, children: [] };
    while (stack.length > entry.level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }

  return roots;
}

function buildTree(entries: Array<{ level: number; name: string }>, warnings: string[]): ParseOutlineResult {
  return wrapRoots(parseLevelEntries(entries), warnings);
}

function wrapRoots(roots: ModuleNode[], warnings: string[]): ParseOutlineResult {
  if (roots.length === 0) throw new Error('没有识别到任何节点');
  if (roots.length === 1) return { tree: { root: roots[0] }, warnings };

  warnings.push(`检测到 ${roots.length} 个顶层节点，已自动归入「功能结构」根节点`);
  return {
    tree: {
      root: { id: nextModuleNodeId(), name: '功能结构', children: roots },
    },
    warnings,
  };
}

function stripBullet(text: string): string {
  return text.replace(BULLET_RE, '').trim();
}

/* ------------------------------------------------------------------ */
/* AI 结果规整                                                         */
/* ------------------------------------------------------------------ */

export const MODULE_TREE_MAX_LEVELS = 6;
export const MODULE_TREE_MAX_NODES = 200;

/**
 * 把模型输出规整成功能树。
 * 兼容 { root: {...} }、{ name, children }、纯数组，以及 children / nodes / modules 等字段名。
 * 超过深度或节点总数的部分会被截断并给出警告。
 */
export function normalizeModuleTree(raw: unknown, warnings: string[] = []): ModuleTree {
  const candidates = extractRootCandidates(raw);
  const budget = { count: 0 };
  const nodes = candidates
    .map((candidate) => normalizeModuleNode(candidate, warnings, 0, budget))
    .filter((node): node is ModuleNode => node !== null);

  if (nodes.length === 0) throw new Error('大模型未返回任何有效功能节点，请补充更具体的系统描述');
  return wrapRoots(nodes, warnings).tree;
}

function extractRootCandidates(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!isRecord(raw)) throw new Error('大模型返回的不是 JSON 对象或数组');

  for (const key of ['root', 'tree', 'data']) {
    if (raw[key] !== undefined) return [raw[key]];
  }
  // 同时带 name 与 nodes / modules 的对象视为根节点，字段在 readChildren 中读取
  if (typeof raw.name === 'string' || Array.isArray(raw.children)) return [raw];
  if (Array.isArray(raw.nodes)) return raw.nodes;
  if (Array.isArray(raw.modules)) return raw.modules;
  throw new Error('大模型返回的 JSON 中没有可识别的功能树');
}

function normalizeModuleNode(
  raw: unknown,
  warnings: string[],
  depth: number,
  budget: { count: number },
): ModuleNode | null {
  if (budget.count >= MODULE_TREE_MAX_NODES) {
    warnings.push(`节点数量超过 ${MODULE_TREE_MAX_NODES}，多余部分已截断`);
    return null;
  }

  if (typeof raw === 'string') {
    const name = raw.trim();
    if (!name) return null;
    budget.count += 1;
    return { id: nextModuleNodeId(), name, children: [] };
  }

  if (!isRecord(raw)) return null;

  const name = readNodeName(raw);
  if (!name) return null;

  budget.count += 1;
  const node: ModuleNode = { id: nextModuleNodeId(), name, children: [] };

  const childrenRaw = readChildren(raw);
  if (childrenRaw.length > 0) {
    if (depth >= MODULE_TREE_MAX_LEVELS - 1) {
      warnings.push(`「${name}」超过 ${MODULE_TREE_MAX_LEVELS} 层，其子节点已忽略`);
      return node;
    }
    for (const child of childrenRaw) {
      const normalized = normalizeModuleNode(child, warnings, depth + 1, budget);
      if (normalized) node.children.push(normalized);
    }
  }

  return node;
}

function readNodeName(raw: Record<string, unknown>): string {
  for (const key of ['name', 'title', 'label', 'text']) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function readChildren(raw: Record<string, unknown>): unknown[] {
  for (const key of ['children', 'nodes', 'modules', 'functions', 'items', 'subModules']) {
    const value = raw[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------ */
/* 树操作（就地修改传入的树，调用方负责先克隆）                          */
/* ------------------------------------------------------------------ */

export function cloneModuleTree(tree: ModuleTree): ModuleTree {
  return { root: cloneNode(tree.root) };
}

function cloneNode(node: ModuleNode): ModuleNode {
  return { id: node.id, name: node.name, children: node.children.map(cloneNode) };
}

/**
 * 深拷贝并重新分配客户端 id。
 * AI 结果由服务端生成 id，与当前浏览器里的节点计数器可能重叠，
 * 替换整棵树前统一重新编号，避免后续新增节点的 id 冲突。
 */
export function reidModuleTree(tree: ModuleTree): ModuleTree {
  const rebuild = (node: ModuleNode): ModuleNode => ({
    id: nextModuleNodeId(),
    name: node.name,
    children: node.children.map(rebuild),
  });
  return { root: rebuild(tree.root) };
}

export function findModuleNode(root: ModuleNode, id: string): ModuleNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findModuleNode(child, id);
    if (found) return found;
  }
  return null;
}

export function findModuleParent(root: ModuleNode, id: string): ModuleNode | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = findModuleParent(child, id);
    if (found) return found;
  }
  return null;
}

export function addModuleChild(root: ModuleNode, parentId: string, name: string): ModuleNode | null {
  const parent = findModuleNode(root, parentId);
  const value = name.trim();
  if (!parent || !value) return null;
  const node: ModuleNode = { id: nextModuleNodeId(), name: value, children: [] };
  parent.children.push(node);
  return node;
}

export function addModuleSibling(root: ModuleNode, siblingId: string, name: string): ModuleNode | null {
  const value = name.trim();
  if (!value || root.id === siblingId) return null;
  const parent = findModuleParent(root, siblingId);
  if (!parent) return null;

  const index = parent.children.findIndex((child) => child.id === siblingId);
  if (index < 0) return null;

  const node: ModuleNode = { id: nextModuleNodeId(), name: value, children: [] };
  parent.children.splice(index + 1, 0, node);
  return node;
}

export function removeModuleNode(root: ModuleNode, id: string): boolean {
  if (root.id === id) return false;
  const parent = findModuleParent(root, id);
  if (!parent) return false;
  const index = parent.children.findIndex((child) => child.id === id);
  if (index < 0) return false;
  parent.children.splice(index, 1);
  return true;
}

export function renameModuleNode(root: ModuleNode, id: string, name: string): boolean {
  const node = findModuleNode(root, id);
  const value = name.trim();
  if (!node || !value || node.name === value) return false;
  node.name = value;
  return true;
}

export type ModuleDropMode = 'before' | 'after' | 'child';

/**
 * 移动节点：把 dragId 放到 targetId 的前面 / 后面 / 内部。
 * 根节点不可移动，也不能把节点拖进自己的子树。
 */
export function moveModuleNode(
  root: ModuleNode,
  dragId: string,
  targetId: string,
  mode: ModuleDropMode,
): boolean {
  if (dragId === targetId || root.id === dragId) return false;

  const dragNode = findModuleNode(root, dragId);
  const dragParent = findModuleParent(root, dragId);
  const targetNode = findModuleNode(root, targetId);
  if (!dragNode || !dragParent || !targetNode) return false;
  if (isDescendant(dragNode, targetId)) return false;

  let insertParent: ModuleNode;
  let insertIndex: number;

  if (mode === 'child') {
    insertParent = targetNode;
    insertIndex = targetNode.children.length;
  } else {
    if (targetNode.id === root.id) return false;
    const targetParent = findModuleParent(root, targetId);
    if (!targetParent) return false;
    insertParent = targetParent;
    insertIndex = targetParent.children.findIndex((child) => child.id === targetId);
    if (insertIndex < 0) return false;
    if (mode === 'after') insertIndex += 1;
  }

  // 先摘除，再按摘除后的下标插入，避免同一父节点内移动时下标偏移
  const removeIndex = dragParent.children.findIndex((child) => child.id === dragId);
  if (removeIndex < 0) return false;
  dragParent.children.splice(removeIndex, 1);

  if (insertParent.id === dragParent.id && removeIndex < insertIndex) insertIndex -= 1;
  insertIndex = Math.max(0, Math.min(insertIndex, insertParent.children.length));
  insertParent.children.splice(insertIndex, 0, dragNode);
  return true;
}

function isDescendant(node: ModuleNode, id: string): boolean {
  return node.children.some((child) => child.id === id || isDescendant(child, id));
}

export function moduleNodeCount(root: ModuleNode): number {
  return 1 + root.children.reduce((total, child) => total + moduleNodeCount(child), 0);
}

/** 树的层数：只有根节点时为 1 */
export function moduleTreeDepth(root: ModuleNode): number {
  if (root.children.length === 0) return 1;
  return 1 + Math.max(...root.children.map(moduleTreeDepth));
}
