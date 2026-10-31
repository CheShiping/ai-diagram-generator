<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getStoredAccessCode, setStoredAccessCode } from '@/http/api';
import ErCanvas from '@/components/ErCanvas.vue';
import InputPanel from '@/components/InputPanel.vue';
import Toolbar from '@/components/Toolbar.vue';
import { buildDrawioXml } from '@/core/export/drawio';
import {
  EXPORT_MIME,
  downloadBlob,
  downloadText,
  serializeSvg,
  svgToPngBlob,
} from '@/core/export/image';
import { useDiagramStore } from '@/stores/diagram';

const store = useDiagramStore();
const canvasRef = ref<InstanceType<typeof ErCanvas> | null>(null);
const exporting = ref(false);

async function handleExport(kind: 'drawio' | 'png' | 'svg'): Promise<void> {
  const svg = canvasRef.value?.getSvg();
  const nodes = canvasRef.value?.getNodes() ?? [];
  const edges = canvasRef.value?.getEdges() ?? [];

  if (!svg || nodes.length === 0) {
    ElMessage.warning('当前没有可导出的图');
    return;
  }

  exporting.value = true;
  try {
    if (kind === 'drawio') {
      const xml = buildDrawioXml(nodes, edges, { title: '陈式 ER 图' });
      downloadText(xml, 'er-diagram.drawio', EXPORT_MIME.drawio);
      ElMessage.success('已导出 draw.io 文件');
      return;
    }

    const { xml, width, height } = serializeSvg(svg, nodes);

    if (kind === 'svg') {
      downloadText(xml, 'er-diagram.svg', EXPORT_MIME.svg);
      ElMessage.success('已导出 SVG');
      return;
    }

    const blob = await svgToPngBlob(xml, width, height, 2);
    downloadBlob(blob, 'er-diagram.png');
    ElMessage.success('已导出 PNG（2 倍分辨率）');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '导出失败');
  } finally {
    exporting.value = false;
  }
}

function fitView(): void {
  canvasRef.value?.fitView();
}

async function openSettings(): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(
      '如果服务端配置了 ACCESS_CODE，请在此填写访问码；留空表示不使用。',
      '访问码设置',
      {
        confirmButtonText: '保存',
        cancelButtonText: '取消',
        inputValue: getStoredAccessCode(),
        inputPlaceholder: '访问码（可留空）',
      },
    );
    setStoredAccessCode((value ?? '').trim());
    ElMessage.success('访问码已保存到本地');
  } catch {
    /* 用户取消 */
  }
}

function clearDiagram(): void {
  store.clear();
}
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="brand">
        <span class="logo">ER</span>
        <div class="titles">
          <h1>SQL / 自然语言 → 陈式 ER 图</h1>
          <p>实体＝矩形，属性＝椭圆，联系＝菱形，主键以下划线标注</p>
        </div>
      </div>
      <div class="header-actions">
        <el-button text size="small" @click="openSettings">访问码</el-button>
        <el-button text size="small" :disabled="!store.hasDiagram" @click="clearDiagram">清空</el-button>
      </div>
    </header>

    <main class="app-main">
      <aside class="side">
        <InputPanel />
      </aside>

      <section class="stage">
        <Toolbar @export="handleExport" @fit="fitView" />
        <div class="canvas-wrap">
          <ErCanvas
            ref="canvasRef"
            :diagram="store.diagram"
            :layout-kind="store.layoutKind"
            :show-attributes="store.showAttributes"
          />
          <div v-if="exporting" class="exporting-mask">正在导出…</div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: #ffffff;
  border-bottom: 1px solid #e8eef7;
  flex: none;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: linear-gradient(135deg, #3d7eff, #64b0ff);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.5px;
}

.titles h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1f2d3d;
}

.titles p {
  margin: 2px 0 0;
  font-size: 12px;
  color: #8b9bb0;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.app-main {
  flex: 1;
  min-height: 0;
  display: flex;
}

.side {
  width: 400px;
  flex: none;
  border-right: 1px solid #e8eef7;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.stage {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.canvas-wrap {
  flex: 1;
  min-height: 0;
  position: relative;
}

.exporting-mask {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #4a5a70;
  z-index: 10;
}

@media (max-width: 1100px) {
  .app-main {
    flex-direction: column;
  }

  .side {
    width: 100%;
    height: 46vh;
    border-right: none;
    border-bottom: 1px solid #e8eef7;
  }
}
</style>
