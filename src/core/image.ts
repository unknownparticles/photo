import type { ExportFormat, ExportOptions, ImageAsset, ImageOperation, ProcessedAsset } from '../types';

const DEFAULT_MAX_EDGE = 8192;

function makeId(prefix = 'asset') {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function loadImage(source: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = typeof source === 'string' ? source : URL.createObjectURL(source);
    image.onload = () => {
      if (typeof source !== 'string') URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      if (typeof source !== 'string') URL.revokeObjectURL(url);
      reject(new Error('图片无法读取'));
    };
    image.src = url;
  });
}

export async function createAssetFromBlob(blob: Blob, name: string, sourceFile?: File): Promise<ImageAsset> {
  const image = await loadImage(blob);
  return {
    id: makeId(),
    name,
    type: blob.type || sourceFile?.type || 'image/png',
    size: blob.size,
    width: image.naturalWidth,
    height: image.naturalHeight,
    originalWidth: image.naturalWidth,
    originalHeight: image.naturalHeight,
    blob,
    url: URL.createObjectURL(blob),
    sourceFile,
  };
}

function canvasSize(width: number, height: number) {
  const scale = Math.min(1, DEFAULT_MAX_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

async function drawAsset(asset: ImageAsset, options: { width?: number; height?: number; background?: string } = {}) {
  const image = await loadImage(asset.blob);
  const size = canvasSize(options.width ?? image.naturalWidth, options.height ?? image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建画布');
  if (options.background) {
    context.fillStyle = options.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: ExportFormat = 'image/png', quality = 0.88): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('导出图片失败'))), type, quality);
  });
}

export async function encodeAsset(asset: ProcessedAsset, options: ExportOptions): Promise<Blob> {
  const needsBackground = options.format === 'image/jpeg' && !options.preserveTransparency;
  const canvas = await drawAsset(asset, { background: needsBackground ? options.background : undefined });
  return canvasToBlob(canvas, options.format, options.quality);
}

export async function resizeAsset(asset: ImageAsset, width: number, height: number, label = '调整尺寸') {
  const canvas = await drawAsset(asset, { width, height });
  const blob = await canvasToBlob(canvas, asset.type.startsWith('image/') ? (asset.type as ExportFormat) : 'image/png');
  return createAssetFromBlob(blob, addSuffix(asset.name, label));
}

export async function cropAsset(asset: ImageAsset, x: number, y: number, width: number, height: number, label = '裁剪') {
  const image = await loadImage(asset.blob);
  const safeX = Math.max(0, Math.min(Math.round(x), image.naturalWidth - 1));
  const safeY = Math.max(0, Math.min(Math.round(y), image.naturalHeight - 1));
  const safeWidth = Math.max(1, Math.min(Math.round(width), image.naturalWidth - safeX));
  const safeHeight = Math.max(1, Math.min(Math.round(height), image.naturalHeight - safeY));
  const size = canvasSize(safeWidth, safeHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建画布');
  context.drawImage(image, safeX, safeY, safeWidth, safeHeight, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas, asset.type === 'image/jpeg' ? 'image/jpeg' : 'image/png');
  return createAssetFromBlob(blob, addSuffix(asset.name, label));
}

export async function splitAsset(asset: ImageAsset, rows: number, columns: number, direction: 'horizontal' | 'vertical' | 'grid') {
  const actualRows = direction === 'vertical' ? 1 : direction === 'horizontal' ? rows : rows;
  const actualColumns = direction === 'horizontal' ? 1 : direction === 'vertical' ? columns : columns;
  const image = await loadImage(asset.blob);
  const outputs: ImageAsset[] = [];
  for (let row = 0; row < actualRows; row += 1) {
    for (let column = 0; column < actualColumns; column += 1) {
      const left = Math.round((column * image.naturalWidth) / actualColumns);
      const top = Math.round((row * image.naturalHeight) / actualRows);
      const right = Math.round(((column + 1) * image.naturalWidth) / actualColumns);
      const bottom = Math.round(((row + 1) * image.naturalHeight) / actualRows);
      const child = await cropAsset(asset, left, top, right - left, bottom - top, `${row * actualColumns + column + 1}`);
      outputs.push({ ...child, name: `${stripExtension(asset.name)}-${String(outputs.length + 1).padStart(2, '0')}.png` });
    }
  }
  return outputs;
}

export async function createCollage(assets: ImageAsset[], layout: 'horizontal' | 'vertical' | 'grid', gap: number, background: string) {
  if (!assets.length) throw new Error('至少需要一张图片');
  const images = await Promise.all(assets.map((asset) => loadImage(asset.blob)));
  const columns = layout === 'horizontal' ? assets.length : layout === 'vertical' ? 1 : Math.ceil(Math.sqrt(assets.length));
  const rows = layout === 'vertical' ? assets.length : layout === 'horizontal' ? 1 : Math.ceil(assets.length / columns);
  const cellWidth = Math.max(...images.map((image) => image.naturalWidth));
  const cellHeight = Math.max(...images.map((image) => image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = cellWidth * columns + gap * (columns - 1);
  canvas.height = cellHeight * rows + gap * (rows - 1);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建画布');
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  images.forEach((image, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * (cellWidth + gap) + (cellWidth - image.naturalWidth) / 2;
    const y = row * (cellHeight + gap) + (cellHeight - image.naturalHeight) / 2;
    context.drawImage(image, x, y);
  });
  const blob = await canvasToBlob(canvas, 'image/png');
  return createAssetFromBlob(blob, `拼图-${new Date().toISOString().slice(0, 10)}.png`);
}

export async function applyAdjustments(asset: ImageAsset, values: { brightness: number; contrast: number; saturation: number; blur: number }) {
  const canvas = await drawAsset(asset);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建画布');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const brightness = values.brightness / 100;
  const contrast = (values.contrast + 100) / 100;
  const saturation = (values.saturation + 100) / 100;
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  for (let index = 0; index < pixels.data.length; index += 4) {
    let red = pixels.data[index];
    let green = pixels.data[index + 1];
    let blue = pixels.data[index + 2];
    red = factor * (red - 128) + 128 + brightness * 255;
    green = factor * (green - 128) + 128 + brightness * 255;
    blue = factor * (blue - 128) + 128 + brightness * 255;
    const grey = 0.299 * red + 0.587 * green + 0.114 * blue;
    red = grey + (red - grey) * saturation;
    green = grey + (green - grey) * saturation;
    blue = grey + (blue - grey) * saturation;
    pixels.data[index] = clamp(red);
    pixels.data[index + 1] = clamp(green);
    pixels.data[index + 2] = clamp(blue);
  }
  context.putImageData(pixels, 0, 0);
  if (values.blur > 0) {
    const filtered = document.createElement('canvas');
    filtered.width = canvas.width;
    filtered.height = canvas.height;
    const filteredContext = filtered.getContext('2d');
    if (!filteredContext) throw new Error('当前浏览器无法创建画布');
    filteredContext.filter = `blur(${values.blur}px)`;
    filteredContext.drawImage(canvas, 0, 0);
    const blob = await canvasToBlob(filtered, 'image/png');
    return createAssetFromBlob(blob, addSuffix(asset.name, '编辑'));
  }
  const blob = await canvasToBlob(canvas, 'image/png');
  return createAssetFromBlob(blob, addSuffix(asset.name, '编辑'));
}

export async function applyWatermark(asset: ImageAsset, text: string, opacity: number, position: string) {
  const canvas = await drawAsset(asset);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建画布');
  const padding = Math.max(18, Math.round(canvas.width * 0.035));
  context.save();
  context.globalAlpha = opacity;
  context.fillStyle = '#ffffff';
  context.shadowColor = 'rgba(0, 0, 0, .35)';
  context.shadowBlur = 8;
  context.font = `600 ${Math.max(16, Math.round(canvas.width / 28))}px system-ui`;
  const metrics = context.measureText(text);
  const x = position.includes('left') ? padding : position.includes('right') ? canvas.width - metrics.width - padding : (canvas.width - metrics.width) / 2;
  const y = position.includes('top') ? padding + 28 : position.includes('bottom') ? canvas.height - padding : canvas.height / 2;
  context.fillText(text, x, y);
  context.restore();
  const blob = await canvasToBlob(canvas, 'image/png');
  return createAssetFromBlob(blob, addSuffix(asset.name, '水印'));
}

export async function encodeGifFrames(assets: ImageAsset[], fps = 8) {
  const { GIFEncoder, applyPalette, quantize } = await import('gifenc');
  const encoder = GIFEncoder();
  const images = await Promise.all(assets.map((asset) => loadImage(asset.blob)));
  const width = Math.max(...images.map((image) => image.naturalWidth));
  const height = Math.max(...images.map((image) => image.naturalHeight));
  for (const image of images) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法创建画布');
    context.drawImage(image, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    encoder.writeFrame(index, width, height, { palette, delay: Math.round(1000 / fps) });
  }
  encoder.finish();
  return new Blob([encoder.bytes()], { type: 'image/gif' });
}

export async function exportImage(asset: ProcessedAsset, options: ExportOptions) {
  const blob = await encodeAsset(asset, options);
  const filename = options.filename ?? replaceExtension(asset.name, extensionFor(options.format));
  downloadBlob(blob, filename);
  return blob;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function extensionFor(format: ExportFormat) {
  return format.split('/')[1].replace('jpeg', 'jpg');
}

export function stripExtension(name: string) {
  return name.replace(/\.[^/.]+$/, '');
}

export function replaceExtension(name: string, extension: string) {
  return `${stripExtension(name)}.${extension}`;
}

function addSuffix(name: string, suffix: string) {
  return `${stripExtension(name)}-${suffix}.png`;
}

function clamp(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export async function processLocalOperation(asset: ImageAsset, operation: ImageOperation) {
  switch (operation.type) {
    case 'resize':
      return resizeAsset(asset, Number(operation.params.width), Number(operation.params.height));
    case 'crop':
      return cropAsset(asset, Number(operation.params.x), Number(operation.params.y), Number(operation.params.width), Number(operation.params.height));
    case 'edit':
      return applyAdjustments(asset, operation.params as never);
    case 'watermark':
      return applyWatermark(asset, String(operation.params.text), Number(operation.params.opacity), String(operation.params.position));
    default:
      return asset;
  }
}

export function asProcessedAsset(asset: ImageAsset): ProcessedAsset {
  return asset;
}

export async function readImageMetadata(file: File) {
  try {
    const exifr = await import('exifr');
    return (await exifr.parse(file, { tiff: true, ifd0: true, exif: true, gps: true })) as Record<string, unknown> | undefined;
  } catch {
    return undefined;
  }
}
