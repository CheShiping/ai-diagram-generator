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

async function addRelationships(): Promise<void> {
  if (!store.hasDiagram) {
    ElMessage.warning('请先生成 ER 图');
    return;
  }
  const entities = diagramToAiEntities(store.diagram);
  if (entities.length < 2) {
    ElMessage.warning('至少需要 2 个实体才能推断联系');
    return;
  }

  aiLoading.value = true;
  try {
    const { relationships, warnings } = await generateRelationships(entities);
    const added = store.appendRelationships(relationships);
    warnings.forEach((w) => store.pushWarning(w));

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
      <el-button size="small" :loading="aiLoading" :disabled="!store.hasDiagram" @click="addRelationships">
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
</style>
