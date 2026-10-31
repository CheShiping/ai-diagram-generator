/** SVG / PNG 导出。 */

import { computeBounds, type RenderNode } from '../geometry';
import { THEME } from '../theme';

const PADDING = 48;

export interface SvgExportResult {
  xml: string;
  width: number;
  height: number;
}

/** 把当前画布序列化成独立可用的 SVG 文本（去掉缩放变换、加白底与 viewBox）。 */
export function serializeSvg(svg: SVGSVGElement, nodes: RenderNode[]): SvgExportResult {
  const clone = svg.cloneNode(true) as SVGSVGElement;

  // 去掉 zoom / pan 变换，导出为完整视图
  const viewport = clone.querySelector('g.viewport');
  if (viewport) viewport.removeAttribute('transform');

  const bounds = nodes.length
    ? computeBounds(nodes)
    : { minX: 0, minY: 0, maxX: 400, maxY: 300 };

  const width = Math.max(bounds.maxX - bounds.minX + PADDING * 2, 320);
  const height = Math.max(bounds.maxY - bounds.minY + PADDING * 2, 200);
  const minX = bounds.minX - PADDING;
  const minY = bounds.minY - PADDING;

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
  clone.setAttribute('width', String(Math.round(width)));
  clone.setAttribute('height', String(Math.round(height)));
  clone.removeAttribute('class');
  clone.removeAttribute('style');

  // 插入纯白背景，避免 PNG 透明底
  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  background.setAttribute('x', String(minX));
  background.setAttribute('y', String(minY));
  background.setAttribute('width', String(width));
  background.setAttribute('height', String(height));
  background.setAttribute('fill', '#ffffff');
  clone.insertBefore(background, clone.firstChild);

  const xml = new XMLSerializer().serializeToString(clone);
  return { xml, width, height };
}

/** SVG 文本 → PNG Blob（按 scale 提高分辨率）。 */
export async function svgToPngBlob(svgXml: string, width: number, height: number, scale = 2): Promise<Blob> {
  const svgBlob = new Blob([svgXml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器无法创建 Canvas 上下文');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('PNG 生成失败'));
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('SVG 图片加载失败，无法生成 PNG'));
    image.src = url;
  });
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, mime = 'text/plain;charset=utf-8'): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

/** 供外部引用，避免魔法字符串散落 */
export const EXPORT_MIME = {
  svg: 'image/svg+xml;charset=utf-8',
  drawio: 'application/xml;charset=utf-8',
} as const;

export const DEFAULT_BACKGROUND = THEME.background;
