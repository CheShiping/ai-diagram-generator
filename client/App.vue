<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { FullScreen, ScaleToOriginal } from '@element-plus/icons-vue';
import {
  getStoredAccessCode,
  getStoredModelConfig,
  setStoredAccessCode,
  setStoredModelConfig,
} from '@/http/api';
import ErCanvas from '@/components/ErCanvas.vue';
import InputPanel from '@/components/InputPanel.vue';
import ModuleCanvas from '@/components/ModuleCanvas.vue';
import ModulePanel from '@/components/ModulePanel.vue';
import ModuleToolbar from '@/components/ModuleToolbar.vue';
import Toolbar from '@/components/Toolbar.vue';
import { buildDrawioXml } from '@/core/export/drawio';
import { buildModuleDrawioXml } from '@/core/export/module-drawio';
import {
  EXPORT_MIME,
  downloadBlob,
  downloadText,
  serializeSvg,
  svgToPngBlob,
} from '@/core/export/image';
import { useDiagramStore } from '@/stores/diagram';
import { useModuleStore } from '@/stores/module';

const store = useDiagramStore();
const moduleStore = useModuleStore();
const erCanvasRef = ref<InstanceType<typeof ErCanvas> | null>(null);
const moduleCanvasRef = ref<InstanceType<typeof ModuleCanvas> | null>(null);
const mode = ref<'er' | 'module'>('er');
const exporting = ref(false);
const settingsOpen = ref(false);
const settingsBaseUrl = ref('');
const settingsApiKey = ref('');
const settingsModel = ref('');
const settingsAccessCode = ref('');

/** 画布全屏：只隐藏左侧输入栏，标题栏与工具栏保留，整个窗口内放大画布 */
const immersive = ref(false);

function toggleFullscreen(): void {
  immersive.value = !immersive.value;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && immersive.value) immersive.value = false;
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

async function handleExport(kind: 'drawio' | 'png' | 'svg'): Promise<void> {
  const svg = erCanvasRef.value?.getSvg();
  const nodes = erCanvasRef.value?.getNodes() ?? [];
  const edges = erCanvasRef.value?.getEdges() ?? [];

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

async function handleModuleExport(kind: 'drawio' | 'png' | 'svg'): Promise<void> {
  const svg = moduleCanvasRef.value?.getSvg();
  const nodes = moduleCanvasRef.value?.getNodes() ?? [];
  const edges = moduleCanvasRef.value?.getEdges() ?? [];

  if (!svg || nodes.length === 0) {
    ElMessage.warning('当前没有可导出的功能结构图');
    return;
  }

  exporting.value = true;
  try {
    if (kind === 'drawio') {
      const xml = buildModuleDrawioXml(nodes, edges, { title: '功能结构图' });
      downloadText(xml, 'module-diagram.drawio', EXPORT_MIME.drawio);
      ElMessage.success('已导出 draw.io 文件');
      return;
    }

    const { xml, width, height } = serializeSvg(svg, nodes);

    if (kind === 'svg') {
      downloadText(xml, 'module-diagram.svg', EXPORT_MIME.svg);
      ElMessage.success('已导出 SVG');
      return;
    }

    const blob = await svgToPngBlob(xml, width, height, 2);
    downloadBlob(blob, 'module-diagram.png');
    ElMessage.success('已导出 PNG（2 倍分辨率）');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '导出失败');
  } finally {
    exporting.value = false;
  }
}

function fitView(): void {
  if (mode.value === 'module') moduleCanvasRef.value?.fitView();
  else erCanvasRef.value?.fitView();
}

function openSettings(): void {
  const modelConfig = getStoredModelConfig();
  settingsBaseUrl.value = modelConfig.baseUrl;
  settingsApiKey.value = modelConfig.apiKey;
  settingsModel.value = modelConfig.model;
  settingsAccessCode.value = getStoredAccessCode();
  settingsOpen.value = true;
}

function saveSettings(): void {
  const config = {
    baseUrl: settingsBaseUrl.value.trim().replace(/\/+$/, ''),
    apiKey: settingsApiKey.value.trim(),
    model: settingsModel.value.trim(),
  };
  setStoredModelConfig(config);
  setStoredAccessCode(settingsAccessCode.value.trim());
  settingsOpen.value = false;
  ElMessage.success('模型设置已保存到本地');
}

function clearDiagram(): void {
  if (mode.value === 'module') moduleStore.clear();
  else store.clear();
}
</script>

<template>
  <div :class="['app-shell', { immersive }]">
    <header class="app-header">
      <div class="brand">
        <span class="logo">{{ mode === 'module' ? 'FM' : 'ER' }}</span>
        <div class="titles">
          <h1>
            {{ mode === 'module' ? '系统功能结构图' : 'SQL / 自然语言 → 陈式 ER 图' }}
            <span class="version">v2.0</span>
          </h1>
          <p v-if="mode === 'module'">第 1–2 层横排，第 3 层起竖排；同层统一尺寸，内容水平垂直居中</p>
          <p v-else>实体＝矩形，属性＝椭圆，联系＝菱形，主键以下划线标注</p>
        </div>
      </div>
      <div class="header-actions">
        <el-radio-group v-model="mode" size="small" class="mode-switch">
          <el-radio-button value="er">ER 图</el-radio-button>
          <el-radio-button value="module">功能结构图</el-radio-button>
        </el-radio-group>
        <el-button text size="small" @click="openSettings">模型设置</el-button>
        <el-button
          text
          size="small"
          :disabled="mode === 'er' ? !store.hasDiagram : !moduleStore.hasTree"
          @click="clearDiagram"
        >
          清空
        </el-button>
      </div>
    </header>

    <main class="app-main">
      <aside class="side">
        <InputPanel v-if="mode === 'er'" />
        <ModulePanel v-else />
      </aside>

      <section class="stage">
        <Toolbar v-if="mode === 'er'" @export="handleExport" @fit="fitView" />
        <ModuleToolbar v-else @export="handleModuleExport" @fit="fitView" />
        <div class="canvas-wrap">
          <ErCanvas
            v-if="mode === 'er'"
            ref="erCanvasRef"
            :diagram="store.diagram"
            :layout-kind="store.layoutKind"
            :show-attributes="store.showAttributes"
          />
          <ModuleCanvas
            v-else
            ref="moduleCanvasRef"
            :tree="moduleStore.tree"
            :offsets="moduleStore.offsets"
          />
          <button
            type="button"
            class="fullscreen-btn"
            :title="immersive ? '退出全屏（Esc）' : '全屏编辑'"
            :aria-label="immersive ? '退出全屏' : '全屏编辑'"
            @click="toggleFullscreen"
          >
            <el-icon>
              <ScaleToOriginal v-if="immersive" />
              <FullScreen v-else />
            </el-icon>
            <span>{{ immersive ? '退出全屏' : '全屏' }}</span>
          </button>
          <div v-if="exporting" class="exporting-mask">正在导出…</div>
        </div>
      </section>
    </main>

    <el-dialog
      v-model="settingsOpen"
      title="自定义模型设置"
      width="520px"
      append-to-body
      :close-on-click-modal="false"
    >
      <div class="model-settings">
        <p class="model-settings-tip">
          留空则沿用服务端 .env 配置；这里保存的接口地址、Key 与模型名只作用于当前浏览器。
        </p>
        <label class="settings-label">接口地址</label>
        <el-input
          v-model="settingsBaseUrl"
          placeholder="https://api.deepseek.com/v1"
          spellcheck="false"
        />
        <label class="settings-label">API Key</label>
        <el-input
          v-model="settingsApiKey"
          type="password"
          show-password
          autocomplete="off"
          placeholder="留空沿用服务端配置"
        />
        <label class="settings-label">模型名称</label>
        <el-input v-model="settingsModel" placeholder="deepseek-chat" spellcheck="false" />
        <label class="settings-label">访问码（可选）</label>
        <el-input
          v-model="settingsAccessCode"
          placeholder="服务端开启 ACCESS_CODE 时填写"
          autocomplete="off"
        />
      </div>
      <template #footer>
        <el-button size="small" @click="settingsOpen = false">取消</el-button>
        <el-button size="small" type="primary" @click="saveSettings">保存</el-button>
      </template>
    </el-dialog>
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
  display: flex;
  align-items: center;
  gap: 8px;
}

.version {
  padding: 1px 6px;
  border: 1px solid #1f2d3d;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: #1f2d3d;
  background: #ffffff;
}

.titles p {
  margin: 2px 0 0;
  font-size: 12px;
  color: #8b9bb0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mode-switch {
  margin-right: 4px;
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

/* 全屏模式：隐藏左侧输入栏，画布铺满窗口剩余空间（标题栏与工具栏保留） */
.app-shell.immersive .side {
  display: none;
}

.fullscreen-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  background: #ffffff;
  border: 1px solid #dce6f2;
  border-radius: 6px;
  color: #4a5a70;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(31, 45, 61, 0.08);
}

.fullscreen-btn:hover {
  border-color: #3d7eff;
  color: #3d7eff;
}

.fullscreen-btn .el-icon {
  font-size: 14px;
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

.model-settings {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.model-settings-tip {
  margin: 0 0 4px;
  font-size: 12px;
  color: #92a1b6;
  line-height: 1.7;
}

.settings-label {
  margin-top: 3px;
  font-size: 12px;
  color: #5b6b81;
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
