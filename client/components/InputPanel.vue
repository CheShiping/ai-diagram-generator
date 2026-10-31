<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { generateEr, parseSql } from '@/http/api';
import { SAMPLE_SQL, useDiagramStore } from '@/stores/diagram';

const store = useDiagramStore();

const tab = ref<'sql' | 'ai'>('sql');
const sqlText = ref(SAMPLE_SQL);
const aiText = ref('');
const sqlLoading = ref(false);
const aiLoading = ref(false);

async function runSql(): Promise<void> {
  if (!sqlText.value.trim()) {
    ElMessage.warning('请先输入 MySQL 建表语句');
    return;
  }
  sqlLoading.value = true;
  try {
    const { tables, warnings } = await parseSql(sqlText.value);
    store.setFromTables(tables, warnings);
    ElMessage.success(`解析成功：${tables.length} 张表`);
    if (warnings.length > 0) {
      ElMessage.warning(`有 ${warnings.length} 条提示，详见下方`);
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '解析失败');
  } finally {
    sqlLoading.value = false;
  }
}

async function runAi(): Promise<void> {
  const prompt = aiText.value.trim();
  if (!prompt) {
    ElMessage.warning('请先描述业务需求');
    return;
  }
  aiLoading.value = true;
  try {
    const { result, warnings } = await generateEr(prompt);
    store.setFromAi(result, warnings);
    ElMessage.success(
      `生成成功：${result.entities.length} 个实体、${result.relationships.length} 条联系`,
    );
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '生成失败');
  } finally {
    aiLoading.value = false;
  }
}

function loadSample(): void {
  sqlText.value = SAMPLE_SQL;
  tab.value = 'sql';
}

function fillAiSample(): void {
  aiText.value =
    '一个在线教育系统：学生可以选修多门课程，每门课程有唯一编号、名称和学分；' +
    '学生属于某个班级，班级有班级编号和班级名称；' +
    '学生在选修课程时会产生成绩记录，成绩需要保存分数。';
}
</script>

<template>
  <div class="input-panel">
    <el-tabs v-model="tab" class="input-tabs">
      <el-tab-pane label="SQL 建表" name="sql">
        <div class="pane-body">
          <p class="hint">支持 MySQL <code>CREATE TABLE</code>，可含中文 <code>COMMENT</code> 与 <code>FOREIGN KEY</code>。</p>
          <el-input
            v-model="sqlText"
            type="textarea"
            class="code-area"
            :rows="20"
            resize="none"
            spellcheck="false"
            placeholder="粘贴 MySQL 建表语句…"
          />
          <div class="actions">
            <el-button text @click="loadSample">载入示例</el-button>
            <el-button type="primary" :loading="sqlLoading" @click="runSql">解析生成</el-button>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="自然语言" name="ai">
        <div class="pane-body">
          <p class="hint">用一段业务描述，由大模型推断实体、属性与联系。</p>
          <el-input
            v-model="aiText"
            type="textarea"
            class="code-area"
            :rows="12"
            resize="none"
            placeholder="例如：一个图书管理系统，读者可以借阅多本图书，每本书属于一个分类…"
          />
          <div class="actions">
            <el-button text @click="fillAiSample">填入示例</el-button>
            <el-button type="primary" :loading="aiLoading" @click="runAi">生成 ER 图</el-button>
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
.input-panel {
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

.hint code {
  background: #eef3fa;
  border-radius: 4px;
  padding: 1px 4px;
  font-size: 11px;
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
  max-height: 160px;
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
