<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { diagramToAiEntities } from '@shared/er-model';
import { generateRelationships } from '@/http/api';
import { LAYOUT_OPTIONS, type LayoutKind } from '@/core/layout';
import { parseDrawioXml } from '@/core/import/drawio';
import { useDiagramStore } from '@/stores/diagram';

const emit = defineEmits<{
  (e: 'export', kind: 'drawio' | 'png' | 'svg'): void;
  (e: 'fit'): void;
}>();

const store = useDiagramStore();
const aiLoading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

/** AI 补关系弹窗：可留空（完全由 AI 推断），也可写明「谁连谁」 */
const relDialogOpen = ref(false);
const relHint = ref('');

const entityNames = computed(() =>
  store.diagram.nodes.filter((n) => n.type === 'entity').map((n) => n.name),
);

const canToggleComment = computed(() => store.sourceTables !== null);
const exportDisabled = computed(() => !store.hasDiagram);

/** 「导入原位置」只在从 draw.io 导入后出现 */
const layoutOptions = computed(() =>
  store.isImported
    ? LAYOUT_OPTIONS
    : LAYOUT_OPTIONS.filter((o) => o.value !== 'manual'),
);

const layoutLabel = computed(
  () => LAYOUT_OPTIONS.find((o) => o.value === store.layoutKind)?.label ?? '布局',
);

function onLayoutChange(value: LayoutKind): void {
  store.setLayout(value);
}

function openRelationships(): void {
  if (!store.hasDiagram) {
    ElMessage.warning('请先生成 ER 图');
    return;
  }
  if (store.entityCount < 2) {
    ElMessage.warning('至少需要 2 个实体才能推断联系');
    return;
  }
  relDialogOpen.value = true;
}

/** 点击实体名标签，追加到补充说明里，保证名字与图中一致 */
function insertEntityName(name: string): void {
  const current = relHint.value.trim();
  relHint.value = current ? `${current} ${name} ` : `${name} `;
}

async function submitRelationships(): Promise<void> {
  const entities = diagramToAiEntities(store.diagram);
  if (entities.length < 2) {
    ElMessage.warning('至少需要 2 个实体才能推断联系');
    return;
  }

  aiLoading.value = true;
  try {
    const { relationships, warnings } = await generateRelationships(entities, relHint.value);
    const added = store.appendRelationships(relationships);
    warnings.forEach((w) => store.pushWarning(w));

    relDialogOpen.value = false;
    relHint.value = '';

    if (added > 0) {
      ElMessage.success(`已补充 ${added} 条联系`);
    } else {
      ElMessage.info('没有发现可补充的新联系');
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'AI 补关系失败');
  } finally {
    aiLoading.value = false;
  }
}

function onExport(command: 'drawio' | 'png' | 'svg'): void {
  emit('export', command);
}

function pickFile(): void {
  fileInput.value?.click();
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  try {
    const xml = await file.text();
    const result = await parseDrawioXml(xml);
    store.setImported(result, result.warnings);
    ElMessage.success(`已导入 ${file.name}`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '导入失败');
  }
}
</script>

<template>
  <div class="toolbar">
    <div class="group">
      <el-radio-group
        :model-value="store.layoutKind"
        size="small"
        @update:model-value="onLayoutChange($event as LayoutKind)"
      >
        <el-radio-button v-for="option in layoutOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </el-radio-button>
      </el-radio-group>
    </div>

    <div class="group">
      <label class="switch">
        <span>中文注释</span>
        <el-switch
          :model-value="store.showComment"
          :disabled="!canToggleComment"
          @update:model-value="store.setShowComment(Boolean($event))"
        />
      </label>
      <label class="switch">
        <span>显示属性</span>
        <el-switch
          :model-value="store.showAttributes"
          @update:model-value="store.setShowAttributes(Boolean($event))"
        />
      </label>
    </div>

    <div class="spacer"></div>

    <div class="group">
      <input
        ref="fileInput"
        class="file-input"
        type="file"
        accept=".drawio,.xml,application/xml"
        @change="onFileChange"
      />
      <el-button size="small" @click="pickFile">导入 .drawio</el-button>
      <el-button size="small" :disabled="!store.hasDiagram" @click="openRelationships">
        AI 补关系
      </el-button>
      <el-button size="small" :disabled="!store.hasDiagram" @click="emit('fit')">适配视图</el-button>

      <el-dropdown trigger="click" @command="onExport">
        <el-button size="small" type="primary" :disabled="exportDisabled">
          导出 <span class="caret">▾</span>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="drawio">draw.io（.drawio）</el-dropdown-item>
            <el-dropdown-item command="png">PNG 图片</el-dropdown-item>
            <el-dropdown-item command="svg">SVG 矢量图</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div class="meta">{{ layoutLabel }} · {{ store.entityCount }} 个实体</div>

    <el-dialog
      v-model="relDialogOpen"
      title="AI 补关系"
      width="560px"
      append-to-body
      :close-on-click-modal="false"
    >
      <div class="rel-dialog">
        <p class="rel-tip">
          可选：写明需要补充的「谁连谁」，AI 会优先按你的描述添加；留空则完全由 AI 推断。
        </p>
        <p class="rel-example">
          例：订单明细 多对一 商品（按 商品ID 关联）<br />
          会话知识库 多对一 知识库；向量存储 对 知识库题目 多对一
        </p>
        <el-input
          v-model="relHint"
          type="textarea"
          :rows="5"
          resize="none"
          maxlength="2000"
          show-word-limit
          placeholder="例如：订单明细 多对一 商品；会话知识库 多对一 知识库。不写则仅让 AI 自动推断。"
        />
        <div v-if="entityNames.length > 0" class="rel-entities">
          <span class="rel-entities-label">图中实体（点击插入名称）：</span>
          <el-tag
            v-for="name in entityNames"
            :key="name"
            size="small"
            class="rel-tag"
            @click="insertEntityName(name)"
          >
            {{ name }}
          </el-tag>
        </div>
      </div>
      <template #footer>
        <el-button size="small" @click="relDialogOpen = false">取消</el-button>
        <el-button size="small" type="primary" :loading="aiLoading" @click="submitRelationships">
          开始补关系
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 10px 16px;
  border-bottom: 1px solid #e8eef7;
  background: #ffffff;
  flex-wrap: wrap;
}

.group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.spacer {
  flex: 1;
}

.switch {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #5b6b81;
  white-space: nowrap;
}

.caret {
  font-size: 10px;
  opacity: 0.75;
}

.file-input {
  display: none;
}

.meta {
  font-size: 12px;
  color: #92a1b6;
  white-space: nowrap;
}

.rel-dialog {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rel-tip {
  margin: 0;
  font-size: 12px;
  color: #5b6b81;
  line-height: 1.7;
}

.rel-example {
  margin: 0;
  padding: 8px 10px;
  font-size: 12px;
  color: #92a1b6;
  line-height: 1.8;
  background: #f6f9fd;
  border-radius: 6px;
}

.rel-entities {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.rel-entities-label {
  font-size: 12px;
  color: #92a1b6;
}

.rel-tag {
  cursor: pointer;
}

.rel-tag:hover {
  color: var(--el-color-primary);
  border-color: currentColor;
}
</style>
