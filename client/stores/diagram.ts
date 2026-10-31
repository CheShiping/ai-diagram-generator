/** 全局状态：当前图模型、布局方式、显示偏好、数据来源。 */

import { acceptHMRUpdate, defineStore } from 'pinia';
import {
  aiToDiagram,
  appendAttributesToDiagram,
  cardinalityOf,
  existingEntityPairs,
  tablesToDiagram,
  type AiAttributePatch,
  type AiRelationship,
  type ErDiagram,
  type ParsedTable,
} from '@shared/er-model';
import type { LayoutKind } from '@/core/layout';

interface DiagramState {
  diagram: ErDiagram;
  /** 上一次 SQL 解析出的原始表结构，用于切换中英文显示时重建 */
  sourceTables: ParsedTable[] | null;
  layoutKind: LayoutKind;
  showComment: boolean;
  showAttributes: boolean;
  warnings: string[];
  /** 当前图是否来自 draw.io 导入（决定是否提供「导入原位置」布局） */
  isImported: boolean;
}

export const SAMPLE_SQL = `-- 班级表
CREATE TABLE \`t_class_info\` (
  \`class_id\`   int(11) NOT NULL AUTO_INCREMENT COMMENT '班级ID',
  \`class_name\` varchar(50) NOT NULL DEFAULT '' COMMENT '班级名称',
  \`create_time\` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (\`class_id\`) USING BTREE
) ENGINE = InnoDB COMMENT = '班级';

-- 学生表
CREATE TABLE \`t_student\` (
  \`student_id\`   int(11) NOT NULL AUTO_INCREMENT COMMENT '学生ID',
  \`student_name\` varchar(50) NOT NULL COMMENT '学生姓名',
  \`birthdate\`    date DEFAULT NULL COMMENT '出生日期',
  \`class_id\`     int(11) DEFAULT NULL COMMENT '所属班级',
  PRIMARY KEY (\`student_id\`) USING BTREE,
  CONSTRAINT \`fk_student_class\` FOREIGN KEY (\`class_id\`) REFERENCES \`t_class_info\` (\`class_id\`)
) ENGINE = InnoDB COMMENT = '学生';

-- 课程表
CREATE TABLE \`t_course\` (
  \`course_id\`   int(11) NOT NULL AUTO_INCREMENT COMMENT '课程ID',
  \`course_name\` varchar(50) NOT NULL COMMENT '课程名称',
  \`teacher_id\`  int(11) DEFAULT NULL COMMENT '任课教师',
  PRIMARY KEY (\`course_id\`)
) ENGINE = InnoDB COMMENT = '课程';

-- 成绩表（多对多联系被拆解为实体）
CREATE TABLE \`t_score\` (
  \`score_id\`   int(11) NOT NULL AUTO_INCREMENT COMMENT '成绩ID',
  \`student_id\` int(11) NOT NULL COMMENT '学生ID',
  \`course_id\`  int(11) NOT NULL COMMENT '课程ID',
  \`score\`      decimal(5,2) DEFAULT NULL COMMENT '分数',
  PRIMARY KEY (\`score_id\`),
  CONSTRAINT \`fk_score_student\` FOREIGN KEY (\`student_id\`) REFERENCES \`t_student\` (\`student_id\`),
  CONSTRAINT \`fk_score_course\` FOREIGN KEY (\`course_id\`) REFERENCES \`t_course\` (\`course_id\`)
) ENGINE = InnoDB COMMENT = '成绩';`;

export const useDiagramStore = defineStore('diagram', {
  state: (): DiagramState => ({
    diagram: { nodes: [], links: [] },
    sourceTables: null,
    layoutKind: 'smart',
    showComment: true,
    showAttributes: true,
    warnings: [],
    isImported: false,
  }),

  getters: {
    hasDiagram: (state) => state.diagram.nodes.length > 0,
    entityCount: (state) => state.diagram.nodes.filter((n) => n.type === 'entity').length,
  },

  actions: {
    /** 用 SQL 表结构构建图 */
    setFromTables(tables: ParsedTable[], warnings: string[] = []): void {
      this.sourceTables = tables;
      this.isImported = false;
      this.resetManualLayout();
      const { diagram, warnings: convertWarnings } = tablesToDiagram(tables, {
        showComment: this.showComment,
      });
      this.diagram = diagram;
      this.warnings = [...warnings, ...convertWarnings];
    },

    /** 用 AI 结果构建图 */
    setFromAi(result: Parameters<typeof aiToDiagram>[0], warnings: string[] = []): void {
      this.sourceTables = null;
      this.isImported = false;
      this.resetManualLayout();
      const { diagram, warnings: convertWarnings } = aiToDiagram(result);
      this.diagram = diagram;
      this.warnings = [...warnings, ...convertWarnings];
    },

    /** 用导入的 draw.io 图构建（保留原坐标，切到「导入原位置」布局） */
    setImported(result: ErDiagram, warnings: string[] = []): void {
      this.diagram = { nodes: result.nodes, links: result.links };
      this.sourceTables = null;
      this.isImported = true;
      this.layoutKind = 'manual';
      this.warnings = warnings;
    },

    /** 切换中英文显示（仅 SQL 来源可切换） */
    rebuildFromTables(): void {
      if (!this.sourceTables) return;
      const { diagram, warnings } = tablesToDiagram(this.sourceTables, { showComment: this.showComment });
      this.diagram = diagram;
      this.warnings = warnings;
    },

    /**
     * 把 AI 补充的联系并入当前图。返回实际新增的联系数量。
     * 已存在的实体对会被跳过，避免重复连线。
     */
    appendRelationships(relationships: AiRelationship[]): number {
      const entityIdByName = new Map(
        this.diagram.nodes.filter((n) => n.type === 'entity').map((n) => [n.name, n.id]),
      );
      const existingPairs = existingEntityPairs(this.diagram);

      const nodes = [...this.diagram.nodes];
      const links = [...this.diagram.links];
      let added = 0;

      relationships.forEach((rel, index) => {
        const sourceId = entityIdByName.get(rel.source);
        const targetId = entityIdByName.get(rel.target);
        if (!sourceId || !targetId) return;

        const pairKey = [rel.source, rel.target].sort().join('::');
        if (existingPairs.has(pairKey)) return;
        existingPairs.add(pairKey);

        const relId = `ai-rel-${index}`;
        nodes.push({ id: relId, name: rel.text?.trim() || '关联', type: 'relationship' });

        const card = cardinalityOf(rel.type);
        links.push({ source: sourceId, target: relId, type: 'relationship', text: card.left });
        links.push({ source: relId, target: targetId, type: 'relationship', text: card.right });

        (rel.attributes ?? []).forEach((attr, attrIndex) => {
          const name = attr.name?.trim();
          if (!name) return;
          const attrId = `${relId}#${attrIndex}`;
          nodes.push({
            id: attrId,
            name,
            type: 'attribute',
            parent: relId,
            isPrimaryKey: Boolean(attr.primaryKey),
          });
          links.push({ source: relId, target: attrId, type: 'attribute' });
        });

        added += 1;
      });

      this.diagram = { nodes, links };
      return added;
    },

    /**
     * 把 AI 建议的缺失属性并入当前图。返回实际新增的属性数量。
     * 已存在的属性名会被跳过；实体已有主键时不会新增第二个主键。
     */
    appendAttributes(patches: AiAttributePatch[]): number {
      const result = appendAttributesToDiagram(this.diagram, patches);
      if (result.added > 0) this.diagram = result.diagram;
      if (result.warnings.length > 0) {
        this.warnings = [...this.warnings, ...result.warnings];
      }
      return result.added;
    },

    /** 批量重命名节点（只改显示名，不改 id / 连线关系） */
    renameNodes(names: Record<string, string>): void {
      const ids = new Set(Object.keys(names));
      if (!ids.size) return;

      let changed = false;
      const nodes = this.diagram.nodes.map((node) => {
        if (!ids.has(node.id)) return node;
        const name = (names[node.id] ?? '').trim();
        if (!name || name === node.name) return node;
        changed = true;
        return { ...node, name };
      });

      if (changed) this.diagram = { nodes, links: this.diagram.links };
    },

    setLayout(kind: LayoutKind): void {
      this.layoutKind = kind;
    },

    setShowComment(value: boolean): void {
      this.showComment = value;
      this.rebuildFromTables();
    },

    setShowAttributes(value: boolean): void {
      this.showAttributes = value;
    },

    clear(): void {
      this.diagram = { nodes: [], links: [] };
      this.sourceTables = null;
      this.isImported = false;
      this.layoutKind = 'smart';
      this.warnings = [];
    },

    pushWarning(message: string): void {
      this.warnings = [...this.warnings, message];
    },

    /** 「导入原位置」只对导入图有效，重建其他来源的图时回落到默认布局 */
    resetManualLayout(): void {
      if (this.layoutKind === 'manual') this.layoutKind = 'smart';
    },
  },
});

// 开发期热更新 store 定义：否则新增 action 后旧实例仍会报 "xxx is not a function"
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useDiagramStore, import.meta.hot));
}
