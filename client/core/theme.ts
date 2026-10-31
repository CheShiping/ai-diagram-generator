/**
 * 陈式 ER 图的视觉常量（黑白线稿风格，集中管理，导出时复用同一套参数）。
 */

export const THEME = {
  background: '#ffffff',
  entityFill: '#ffffff',
  entityStroke: '#000000',
  attributeFill: '#ffffff',
  attributeStroke: '#000000',
  relationshipFill: '#ffffff',
  relationshipStroke: '#000000',
  linkColor: '#000000',
  textColor: '#000000',
  fontSize: 13,
  fontFamily: '"PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif',
  /** 属性 / 联系 / 连线的线宽 */
  strokeWidth: 1.3,
  /** 实体边框更粗，强调主体 */
  entityStrokeWidth: 2.2,
  /** 直角矩形（示例图为直角） */
  cornerRadius: 0,
  entityMinWidth: 108,
  entityHeight: 42,
  attributeMinWidth: 88,
  attributeHeight: 33,
  relationshipMinWidth: 72,
  relationshipHeight: 48,
  padding: 26,
  linkLabelFontSize: 12,
} as const;

export type Theme = typeof THEME;
