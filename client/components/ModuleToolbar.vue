<script setup lang="ts">
import { computed } from 'vue';
import { useModuleStore } from '@/stores/module';

const emit = defineEmits<{
  (e: 'export', kind: 'drawio' | 'png' | 'svg'): void;
  (e: 'fit'): void;
}>();

const store = useModuleStore();
const exportDisabled = computed(() => !store.hasTree || store.nodeCount === 0);

function onExport(kind: 'drawio' | 'png' | 'svg'): void {
  emit('export', kind);
}
</script>

<template>
  <div class="toolbar">
    <div class="group">
      <el-button size="small" :disabled="!store.hasTree" @click="emit('fit')">适配视图</el-button>
      <el-button
        size="small"
        :disabled="!store.hasTree"
        title="清除手动拖拽，恢复自动布局"
        @click="store.resetLayout()"
      >
        重新排版
      </el-button>
      <el-button size="small" :disabled="!store.canUndo()" @click="store.undo()">
        撤销
      </el-button>
    </div>

    <div class="spacer"></div>

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

    <div class="meta">{{ store.nodeCount }} 个节点</div>
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
  gap: 8px;
}

.spacer {
  flex: 1;
}

.caret {
  font-size: 10px;
  opacity: 0.75;
}

.meta {
  font-size: 12px;
  color: #92a1b6;
  white-space: nowrap;
}
</style>
