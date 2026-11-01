/**
 * 功能结构图状态：树、手动拖拽偏移、撤销历史、示例切换。
 *
 * 布局本身是纯函数（见 core/module-layout.ts），这里只保存可编辑数据，
 * 画布拿到树和偏移后自行计算坐标。
 */

import { acceptHMRUpdate, defineStore } from 'pinia';
import {
  addModuleChild,
  addModuleSibling,
  cloneModuleTree,
  createModuleSample,
  findModuleNode,
  MODULE_SAMPLES,
  moduleNodeCount,
  moveModuleNode,
  reidModuleTree,
  removeModuleNode,
  renameModuleNode,
  type ModuleDropMode,
  type ModuleTree,
} from '@shared/module-tree';

export interface ModuleOffset {
  dx: number;
  dy: number;
}

export type ModuleOffsets = Record<string, ModuleOffset>;

interface ModuleSnapshot {
  tree: ModuleTree | null;
  offsets: ModuleOffsets;
  sampleIndex: number;
}

interface ModuleState {
  tree: ModuleTree | null;
  offsets: ModuleOffsets;
  warnings: string[];
  sampleIndex: number;
  history: ModuleSnapshot[];
}

const HISTORY_LIMIT = 60;

export const useModuleStore = defineStore('module', {
  state: (): ModuleState => ({
    tree: createModuleSample(0),
    offsets: {},
    warnings: [],
    sampleIndex: 0,
    history: [],
  }),

  getters: {
    hasTree: (state) => state.tree !== null,
    nodeCount: (state) => (state.tree ? moduleNodeCount(state.tree.root) : 0),
  },

  actions: {
    /** 记录当前状态，供 Ctrl+Z 回退（树编辑、拖拽、改名、AI 生成前调用） */
    pushHistory(): void {
      this.history.push({
        tree: this.tree ? cloneModuleTree(this.tree) : null,
        offsets: { ...this.offsets },
        sampleIndex: this.sampleIndex,
      });
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
    },

    undo(): boolean {
      const snapshot = this.history.pop();
      if (!snapshot) return false;
      this.tree = snapshot.tree;
      this.offsets = snapshot.offsets;
      this.sampleIndex = snapshot.sampleIndex;
      return true;
    },

    canUndo(): boolean {
      return this.history.length > 0;
    },

    /** 换一换：循环加载内置示例 */
    loadSample(index?: number): void {
      this.pushHistory();
      const length = MODULE_SAMPLES.length;
      const target = index ?? this.sampleIndex + 1;
      this.sampleIndex = ((target % length) + length) % length;
      this.tree = createModuleSample(this.sampleIndex);
      this.offsets = {};
      this.warnings = [];
    },

    /** 恢复当前示例 */
    restoreSample(): void {
      this.loadSample(this.sampleIndex);
    },

    /** 大纲解析 / AI 生成成功后替换整棵树 */
    replaceTree(tree: ModuleTree, warnings: string[] = []): void {
      this.pushHistory();
      // 外部树的 id 可能与本浏览器计数器重叠，替换前统一重新编号
      this.tree = reidModuleTree(tree);
      this.offsets = {};
      this.warnings = warnings;
    },

    clear(): void {
      this.pushHistory();
      this.tree = null;
      this.offsets = {};
      this.warnings = [];
    },

    addChild(parentId: string, name: string): string | null {
      if (!this.tree) return null;
      const draft = cloneModuleTree(this.tree);
      const node = addModuleChild(draft.root, parentId, name.trim());
      if (!node) return null;
      this.pushHistory();
      this.tree = draft;
      this.offsets = {};
      return node.id;
    },

    addSibling(siblingId: string, name: string): string | null {
      if (!this.tree) return null;
      const draft = cloneModuleTree(this.tree);
      const node = addModuleSibling(draft.root, siblingId, name.trim());
      if (!node) return null;
      this.pushHistory();
      this.tree = draft;
      this.offsets = {};
      return node.id;
    },

    removeNode(id: string): boolean {
      if (!this.tree) return false;
      const draft = cloneModuleTree(this.tree);
      if (!removeModuleNode(draft.root, id)) return false;
      this.pushHistory();
      this.tree = draft;
      this.offsets = {};
      return true;
    },

    renameNode(id: string, name: string): boolean {
      if (!this.tree) return false;
      const draft = cloneModuleTree(this.tree);
      if (!renameModuleNode(draft.root, id, name.trim())) return false;
      this.pushHistory();
      this.tree = draft;
      this.offsets = {};
      return true;
    },

    moveNode(dragId: string, targetId: string, mode: ModuleDropMode): boolean {
      if (!this.tree) return false;
      const draft = cloneModuleTree(this.tree);
      if (!moveModuleNode(draft.root, dragId, targetId, mode)) return false;
      this.pushHistory();
      this.tree = draft;
      this.offsets = {};
      return true;
    },

    nodeName(id: string): string {
      if (!this.tree) return '';
      return findModuleNode(this.tree.root, id)?.name ?? '';
    },

    /** 拖动过程中实时写入偏移，不记录历史（历史由拖拽开始时记录一次） */
    setOffset(id: string, dx: number, dy: number): void {
      this.offsets = { ...this.offsets, [id]: { dx, dy } };
    },

    setOffsets(offsets: ModuleOffsets): void {
      this.offsets = offsets;
    },

    resetLayout(): void {
      this.pushHistory();
      this.offsets = {};
    },

    setWarnings(warnings: string[]): void {
      this.warnings = warnings;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useModuleStore, import.meta.hot));
}
