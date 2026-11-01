<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Delete, DocumentCopy, Edit, Plus, Rank } from '@element-plus/icons-vue';
import {
  MODULE_SAMPLES,
  parseModuleOutline,
  type ModuleDropMode,
  type ModuleNode,
  type ModuleNodeInput,
} from '@shared/module-tree';
import { generateModuleTree } from '@/http/api';
import { useModuleStore } from '@/stores/module';

const store = useModuleStore();

const tab = ref<'tree' | 'outline' | 'ai'>('tree');
const outlineText = ref('');
const aiText = ref('');
const aiLoading = ref(false);
const outlineLoading = ref(false);

const collapsedIds = ref<string[]>([]);

const dragId = ref<string | null>(null);
const dropTarget = ref<{ id: string; mode: ModuleDropMode } | null>(null);

interface TreeRow {
  node: ModuleNode;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
}

const rows = computed<TreeRow[]>(() => {
  if (!store.tree) return [];
  const out: TreeRow[] = [];
  const walk = (node: ModuleNode, depth: number, parentId: string | null): void => {
    out.push({
      node,
      depth,
      parentId,
      hasChildren: node.children.length > 0,
    });
    if (collapsedIds.value.includes(node.id)) return;
    for (const child of node.children) walk(child, depth + 1, node.id);
  };
  walk(store.tree.root, 0, null);
  return out;
});

const depthLabel = computed(() => {
  if (!store.tree) return '空';
  let max = 0;
  const walk = (node: ModuleNode, depth: number): void => {
    max = Math.max(max, depth);
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(store.tree.root, 0);
  return `${max + 1} 层`;
});

function toggleCollapse(id: string): void {
  collapsedIds.value = collapsedIds.value.includes(id)
    ? collapsedIds.value.filter((item) => item !== id)
    : [...collapsedIds.value, id];
}

function nextDefaultName(parentLevel: number): string {
  return parentLevel <= 0 ? '新模块' : '新功能';
}

function askName(title: string, value: string): Promise<string | null> {
  return ElMessageBox.prompt(title, title, {
    inputValue: value,
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    inputValidator: (input) => (input.trim() ? true : '名称不能为空'),
  })
    .then(({ value: input }) => input.trim())
    .catch(() => null);
}

async function addChild(row: TreeRow): Promise<void> {
  const name = await askName('添加子节点', nextDefaultName(row.depth));
  if (!name) return;
  const created = store.addChild(row.node.id, name);
  if (!created) ElMessage.warning('添加失败');
}

async function addSibling(row: TreeRow): Promise<void> {
  if (!row.parentId) return;
  const parentLevel = row.depth - 1;
  const name = await askName('添加同级节点', nextDefaultName(parentLevel));
  if (!name) return;
  const created = store.addSibling(row.node.id, name);
  if (!created) ElMessage.warning('添加失败');
}

async function rename(row: TreeRow): Promise<void> {
  const name = await askName('重命名', row.node.name);
  if (!name) return;
  store.renameNode(row.node.id, name);
}

async function remove(row: TreeRow): Promise<void> {
  if (!row.parentId) {
    ElMessage.warning('根节点不能删除');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `删除「${row.node.name}」及其全部子节点？`,
      '删除节点',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    );
  } catch {
    return;
  }
  if (!store.removeNode(row.node.id)) ElMessage.warning('删除失败');
}

/* ---------------- 拖拽调整层级 / 顺序 ---------------- */

function onDragStart(event: DragEvent, row: TreeRow): void {
  dragId.value = row.node.id;
  event.dataTransfer?.setData('text/plain', row.node.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

function onDragOver(event: DragEvent, row: TreeRow): void {
  if (!dragId.value || dragId.value === row.node.id) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
  let mode: ModuleDropMode = 'child';
  if (row.depth > 0 && ratio < 0.25) mode = 'before';
  else if (row.depth > 0 && ratio > 0.75) mode = 'after';

  dropTarget.value = { id: row.node.id, mode };
}

function onDragLeave(row: TreeRow): void {
  if (dropTarget.value?.id === row.node.id) dropTarget.value = null;
}

function onDrop(event: DragEvent, row: TreeRow): void {
  event.preventDefault();
  const source = dragId.value;
  const mode = dropTarget.value?.id === row.node.id ? dropTarget.value.mode : 'child';
  dragId.value = null;
  dropTarget.value = null;
  if (!source) return;

  if (!store.moveNode(source, row.node.id, mode)) {
    ElMessage.warning('不能移动到这个位置');
  }
}

function onDragEnd(): void {
  dragId.value = null;
  dropTarget.value = null;
}

/* ---------------- 示例 / 大纲 / AI ---------------- */

function inputToOutline(input: ModuleNodeInput, depth = 0): string {
  const head = `${'  '.repeat(depth)}${input.name}\n`;
  return head + (input.children ?? []).map((child) => inputToOutline(child, depth + 1)).join('');
}

function fillOutlineSample(): void {
  const input = MODULE_SAMPLES[store.sampleIndex] ?? MODULE_SAMPLES[0];
  outlineText.value = inputToOutline(input);
}

async function parseOutline(): Promise<void> {
  if (!outlineText.value.trim()) {
    ElMessage.warning('请先粘贴大纲文本');
    return;
  }
  outlineLoading.value = true;
  try {
    const { tree, warnings } = parseModuleOutline(outlineText.value);
    store.replaceTree(tree, warnings);
    tab.value = 'tree';
    ElMessage.success(`已解析 ${store.nodeCount} 个节点`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '大纲解析失败');
  } finally {
    outlineLoading.value = false;
  }
}

async function runAi(): Promise<void> {
  const prompt = aiText.value.trim();
  if (!prompt) {
    ElMessage.warning('请先描述系统功能');
    return;
  }
  aiLoading.value = true;
  try {
    const { tree, warnings } = await generateModuleTree(prompt);
    store.replaceTree(tree, warnings);
    tab.value = 'tree';
    ElMessage.success(`已生成 ${store.nodeCount} 个功能节点`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '生成失败');
  } finally {
    aiLoading.value = false;
  }
}

function fillAiSample(): void {
  aiText.value =
    '一个面向中小型仓库的智能仓储管理系统：包含入库管理（到货预约、收货质检、上架分配）、' +
    '库存管理（库位查询、库存盘点、安全库存预警）、出库管理（订单拣货、复核打包、物流交接）' +
    '和运营报表（周转率分析、异常记录）；库存盘点下需要生成盘点任务并支持差异复核。';
}

function changeSample(): void {
  store.loadSample();
  collapsedIds.value = [];
}

function restoreSample(): void {
  store.restoreSample();
  collapsedIds.value = [];
}

function clearTree(): void {
  store.clear();
  collapsedIds.value = [];
}
</script>

<template>
  <div class="module-panel">
    <el-tabs v-model="tab" class="input-tabs">
      <el-tab-pane label="结构树" name="tree">
        <div class="pane-body">
          <div class="tree-summary">
            <span>{{ store.nodeCount }} 个节点 · {{ depthLabel }}</span>
            <div class="summary-actions">
              <el-button text size="small" @click="changeSample">换一换</el-button>
              <el-button text size="small" @click="restoreSample">恢复示例</el-button>
              <el-button text size="small" @click="clearTree">清空</el-button>
            </div>
          </div>

          <div class="tree-scroll">
            <div
              v-for="row in rows"
              :key="row.node.id"
              :class="[
                'tree-row',
                {
                  'drop-before': dropTarget?.id === row.node.id && dropTarget.mode === 'before',
                  'drop-after': dropTarget?.id === row.node.id && dropTarget.mode === 'after',
                  'drop-child': dropTarget?.id === row.node.id && dropTarget.mode === 'child',
                },
              ]"
              :style="{ paddingLeft: `${row.depth * 16 + 2}px` }"
              @dragover="onDragOver($event, row)"
              @dragleave="onDragLeave(row)"
              @drop="onDrop($event, row)"
            >
              <span
                class="drag-handle"
                draggable="true"
                title="拖拽调整层级或顺序"
                @dragstart="onDragStart($event, row)"
                @dragend="onDragEnd"
              >
                <el-icon><Rank /></el-icon>
              </span>

              <button
                v-if="row.hasChildren"
                type="button"
                class="collapse-btn"
                :title="collapsedIds.includes(row.node.id) ? '展开' : '收起'"
                @click="toggleCollapse(row.node.id)"
              >
                {{ collapsedIds.includes(row.node.id) ? '▸' : '▾' }}
              </button>
              <span v-else class="collapse-placeholder"></span>

              <span class="node-name" :title="row.node.name" @dblclick="rename(row)">
                {{ row.node.name }}
              </span>

              <span class="row-actions">
                <el-button text size="small" title="添加子节点" @click="addChild(row)">
                  <el-icon><Plus /></el-icon>
                </el-button>
                <el-button
                  text
                  size="small"
                  title="添加同级节点"
                  :disabled="!row.parentId"
                  @click="addSibling(row)"
                >
                  <el-icon><DocumentCopy /></el-icon>
                </el-button>
                <el-button text size="small" title="重命名" @click="rename(row)">
                  <el-icon><Edit /></el-icon>
                </el-button>
                <el-button
                  text
                  size="small"
                  title="删除节点"
                  :disabled="!row.parentId"
                  @click="remove(row)"
                >
                  <el-icon><Delete /></el-icon>
                </el-button>
              </span>
            </div>

            <div v-if="rows.length === 0" class="tree-empty">
              还没有功能结构。粘贴大纲、AI 生成，或点「恢复示例」。
            </div>
          </div>

          <p class="hint">
            拖到行的上/下边缘调整同级顺序，拖到行中间成为子节点；根节点不能删除。
          </p>
        </div>
      </el-tab-pane>

      <el-tab-pane label="大纲文本" name="outline">
        <div class="pane-body">
          <p class="hint">
            支持缩进层级或 Markdown 标题（# 系统 / ## 模块 / ### 功能），行首的 -、*、• 会被忽略。
          </p>
          <el-input
            v-model="outlineText"
            type="textarea"
            class="code-area"
            :rows="18"
            resize="none"
            spellcheck="false"
            placeholder="智能仓储管理系统&#10;  入库管理&#10;    到货预约&#10;    收货质检"
          />
          <div class="actions">
            <el-button text @click="fillOutlineSample">填入示例</el-button>
            <el-button type="primary" :loading="outlineLoading" @click="parseOutline">
              解析生成
            </el-button>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="AI 生成" name="ai">
        <div class="pane-body">
          <p class="hint">
            描述系统包含哪些模块和功能，层级深度由描述决定；生成会替换当前结构树，可用 Ctrl+Z 撤销。
          </p>
          <el-input
            v-model="aiText"
            type="textarea"
            class="code-area"
            :rows="14"
            resize="none"
            placeholder="例如：一个智能仓储管理系统，包含入库、库存、出库和运营报表…"
          />
          <div class="actions">
            <el-button text @click="fillAiSample">填入示例</el-button>
            <el-button type="primary" :loading="aiLoading" @click="runAi">生成功能结构</el-button>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <div v-if="store.warnings.length > 0" class="warnings">
      <div class="warnings-title">提示（{{ store.warnings.length }}）</div>
      <ul>
        <li v-for="(item, index) in store.warnings" :key="index">{{ item }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.module-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.input-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.input-tabs :deep(.el-tabs__header) {
  margin: 0;
  padding: 0 12px;
}

.input-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.input-tabs :deep(.el-tab-pane) {
  height: 100%;
}

.pane-body {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px;
  gap: 10px;
  min-height: 0;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: #7d8da3;
  line-height: 1.6;
}

.tree-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #5b6b81;
}

.summary-actions {
  display: flex;
  gap: 2px;
}

.tree-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid #e8eef7;
  border-radius: 8px;
  background: #fbfcfe;
  padding: 6px 4px;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 30px;
  border-radius: 5px;
  border-top: 2px solid transparent;
  border-bottom: 2px solid transparent;
  padding-right: 4px;
}

.tree-row:hover {
  background: #f2f6fc;
}

.tree-row.drop-before {
  border-top-color: #3d7eff;
}

.tree-row.drop-after {
  border-bottom-color: #3d7eff;
}

.tree-row.drop-child {
  background: #e8f1ff;
  box-shadow: inset 0 0 0 1px #3d7eff;
}

.drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  color: #b4c0d0;
  cursor: grab;
  flex: none;
}

.drag-handle:active {
  cursor: grabbing;
}

.collapse-btn {
  width: 16px;
  height: 18px;
  border: none;
  background: transparent;
  color: #7d8da3;
  font-size: 10px;
  cursor: pointer;
  padding: 0;
  flex: none;
}

.collapse-placeholder {
  width: 16px;
  flex: none;
}

.node-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: #26374d;
  cursor: default;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 0;
  opacity: 0.45;
  flex: none;
}

.tree-row:hover .row-actions {
  opacity: 1;
}

.row-actions :deep(.el-button) {
  padding: 2px 4px;
  height: 22px;
}

.tree-empty {
  padding: 24px 12px;
  text-align: center;
  font-size: 12px;
  color: #92a1b6;
  line-height: 1.8;
}

.code-area {
  flex: 1;
  min-height: 0;
}

.code-area :deep(textarea) {
  height: 100%;
  font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
  font-size: 13px;
  line-height: 1.65;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.warnings {
  border-top: 1px solid #edf1f7;
  max-height: 140px;
  overflow: auto;
  padding: 10px 14px;
  background: #fffaf0;
}

.warnings-title {
  font-size: 12px;
  font-weight: 600;
  color: #b07d1e;
  margin-bottom: 6px;
}

.warnings ul {
  margin: 0;
  padding-left: 18px;
}

.warnings li {
  font-size: 12px;
  color: #8a6d3b;
  line-height: 1.7;
}
</style>
