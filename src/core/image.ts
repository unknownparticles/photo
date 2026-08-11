import type { ExportFormat, ExportOptions, ImageAsset, ImageOperation, LocalBackgroundRemovalOptions, ProcessedAsset, SplitLine, WatermarkOptions } from '../types';

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

export async function splitAsset(asset: ImageAsset, rows: number, columns: number, direction: 'horizontal' | 'vertical' | 'grid', customLines: SplitLine[] = []) {
  const image = await loadImage(asset.blob);
  const horizontalLines = customLines
    .filter((line) => line.orientation === 'horizontal')
    .map((line) => Math.round((Math.max(0, Math.min(100, line.position)) / 100) * image.naturalHeight))
    .filter((position, index, positions) => index === 0 || position !== positions[index - 1])
    .sort((a, b) => a - b);
  const verticalLines = customLines
    .filter((line) => line.orientation === 'vertical')
    .map((line) => Math.round((Math.max(0, Math.min(100, line.position)) / 100) * image.naturalWidth))
    .filter((position, index, positions) => index === 0 || position !== positions[index - 1])
    .sort((a, b) => a - b);
  const hasCustomLines = customLines.length > 0;
  const rowCuts = horizontalLines.length ? [0, ...horizontalLines, image.naturalHeight] : hasCustomLines ? [0, image.naturalHeight] : Array.from({ length: rows + 1 }, (_, index) => Math.round((index * image.naturalHeight) / rows));
  const columnCuts = verticalLines.length ? [0, ...verticalLines, image.naturalWidth] : hasCustomLines ? [0, image.naturalWidth] : Array.from({ length: columns + 1 }, (_, index) => Math.round((index * image.naturalWidth) / columns));
  const actualRows = hasCustomLines ? rowCuts.length - 1 : direction === 'vertical' ? 1 : rowCuts.length - 1;
  const actualColumns = hasCustomLines ? columnCuts.length - 1 : direction === 'horizontal' ? 1 : columnCuts.length - 1;
  const outputs: ImageAsset[] = [];
  for (let row = 0; row < actualRows; row += 1) {
    for (let column = 0; column < actualColumns; column += 1) {
      const left = columnCuts[column];
      const top = rowCuts[row];
      const right = columnCuts[column + 1];
      const bottom = rowCuts[row + 1];
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

function colorDistance(red: number, green: number, blue: number, target: [number, number, number]) {
  const redDelta = red - target[0];
  const greenDelta = green - target[1];
  const blueDelta = blue - target[2];
  return Math.sqrt(redDelta * redDelta + greenDelta * greenDelta + blueDelta * blueDelta) / 441.67295593;
}

function blurAlpha(data: Uint8ClampedArray, width: number, height: number, radius: number) {
  if (radius < 1) return;
  const horizontal = new Float32Array(width * height);
  const vertical = new Uint8ClampedArray(width * height);
  const rowPrefix = new Float32Array(width + 1);
  for (let y = 0; y < height; y += 1) {
    rowPrefix[0] = 0;
    for (let x = 0; x < width; x += 1) {
      rowPrefix[x + 1] = rowPrefix[x] + data[(y * width + x) * 4 + 3];
    }
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const count = right - left + 1;
      horizontal[y * width + x] = (rowPrefix[right + 1] - rowPrefix[left]) / count;
    }
  }
  const columnPrefix = new Float32Array(height + 1);
  for (let x = 0; x < width; x += 1) {
    columnPrefix[0] = 0;
    for (let y = 0; y < height; y += 1) {
      columnPrefix[y + 1] = columnPrefix[y] + horizontal[y * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height - 1, y + radius);
      const count = bottom - top + 1;
      vertical[y * width + x] = Math.round((columnPrefix[bottom + 1] - columnPrefix[top]) / count);
    }
  }
  for (let index = 0; index < vertical.length; index += 1) data[index * 4 + 3] = vertical[index];
}

export async function removeBackgroundAsset(asset: ImageAsset, options: LocalBackgroundRemovalOptions) {
  const canvas = await drawAsset(asset);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建画布');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const total = canvas.width * canvas.height;
  const removeMask = new Uint8Array(total);
  const threshold = Math.max(0, Math.min(1, options.tolerance / 100));
  const matches = (index: number) => colorDistance(pixels.data[index * 4], pixels.data[index * 4 + 1], pixels.data[index * 4 + 2], options.targetColor) <= threshold;

  if (options.method === 'solid') {
    for (let index = 0; index < total; index += 1) if (matches(index)) removeMask[index] = 1;
  } else {
    const startX = Math.max(0, Math.min(canvas.width - 1, Math.round((options.seedX / 100) * (canvas.width - 1))));
    const startY = Math.max(0, Math.min(canvas.height - 1, Math.round((options.seedY / 100) * (canvas.height - 1))));
    const start = startY * canvas.width + startX;
    const visited = new Uint8Array(total);
    const stack = new Int32Array(total);
    let stackSize = 0;
    stack[stackSize++] = start;
    visited[start] = 1;
    while (stackSize > 0) {
      const index = stack[--stackSize];
      if (!matches(index)) continue;
      removeMask[index] = 1;
      const x = index % canvas.width;
      const y = Math.floor(index / canvas.width);
      if (x > 0 && !visited[index - 1]) { visited[index - 1] = 1; if (matches(index - 1)) stack[stackSize++] = index - 1; }
      if (x < canvas.width - 1 && !visited[index + 1]) { visited[index + 1] = 1; if (matches(index + 1)) stack[stackSize++] = index + 1; }
      if (y > 0 && !visited[index - canvas.width]) { visited[index - canvas.width] = 1; if (matches(index - canvas.width)) stack[stackSize++] = index - canvas.width; }
      if (y < canvas.height - 1 && !visited[index + canvas.width]) { visited[index + canvas.width] = 1; if (matches(index + canvas.width)) stack[stackSize++] = index + canvas.width; }
    }
  }

  for (let index = 0; index < total; index += 1) if (removeMask[index]) pixels.data[index * 4 + 3] = 0;
  blurAlpha(pixels.data, canvas.width, canvas.height, Math.max(0, Math.min(40, Math.round(options.feather))));
  context.putImageData(pixels, 0, 0);
  const blob = await canvasToBlob(canvas, 'image/png');
  return createAssetFromBlob(blob, addSuffix(asset.name, '抠图'));
}

export async function applyWatermark(asset: ImageAsset, options: WatermarkOptions) {
  const canvas = await drawAsset(asset);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建画布');
  const padding = Math.max(18, Math.round(canvas.width * 0.035));
  const x = Math.max(0, Math.min(canvas.width, Math.round((options.x / 100) * canvas.width)));
  const y = Math.max(0, Math.min(canvas.height, Math.round((options.y / 100) * canvas.height)));
  const targetWidth = Math.max(1, Math.min(canvas.width, Math.round((options.width / 100) * canvas.width)));
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, options.opacity));
  if (options.kind === 'image' && options.image) {
    const watermark = await loadImage(options.image.blob);
    const watermarkHeight = Math.max(1, Math.round(targetWidth * (watermark.naturalHeight / watermark.naturalWidth)));
    context.drawImage(watermark, x, y, targetWidth, watermarkHeight);
  } else {
    const fontSize = Math.max(16, Math.round(options.fontSize ? (options.fontSize / 100) * canvas.width : canvas.width / 28));
    context.fillStyle = options.color ?? '#ffffff';
    context.shadowColor = 'rgba(0, 0, 0, .35)';
    context.shadowBlur = 8;
    context.font = `600 ${fontSize}px system-ui`;
    context.textBaseline = 'top';
    context.fillText(options.text, x || padding, y || padding);
  }
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
  const bytes = encoder.bytes();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: 'image/gif' });
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
      return applyWatermark(asset, operation.params as unknown as WatermarkOptions);
    case 'background-remove':
      return removeBackgroundAsset(asset, operation.params as unknown as LocalBackgroundRemovalOptions);
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
    return (await exifr.parse(file, { tiff: true, exif: true, gps: true })) as Record<string, unknown> | undefined;
  } catch {
    return undefined;
  }
}

type MetadataValue = unknown;

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return value === undefined || value === null ? '' : String(value);
}

function asciiBytes(value: string, maxLength = 240) {
  const normalized = value.slice(0, maxLength).replace(/[^\x20-\x7E]/g, '?');
  const bytes = new TextEncoder().encode(`${normalized}\0`);
  return bytes;
}

function rational(value: number) {
  const denominator = 1000000;
  return [Math.round(value * denominator), denominator] as const;
}

function gpsParts(value: MetadataValue, positiveRef: string, negativeRef: string) {
  if (value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const absolute = Math.abs(numeric);
  return {
    ref: numeric < 0 ? negativeRef : positiveRef,
    values: [Math.floor(absolute), (absolute % 1) * 60, ((absolute * 60) % 1) * 60],
  };
}

function writeExif(metadata: Record<string, unknown>) {
  const entries: Array<{ tag: number; type: number; count: number; value: Uint8Array | number }> = [];
  const addAscii = (tag: number, key: string) => {
    const value = metadataString(metadata, key);
    if (value) entries.push({ tag, type: 2, count: asciiBytes(value).length, value: asciiBytes(value) });
  };
  addAscii(0x010e, 'ImageDescription');
  addAscii(0x010f, 'Make');
  addAscii(0x0110, 'Model');
  addAscii(0x0131, 'Software');
  addAscii(0x013b, 'Artist');
  addAscii(0x8298, 'Copyright');
  addAscii(0x9003, 'DateTimeOriginal');

  const latitude = gpsParts(metadata.GPSLatitude, 'N', 'S');
  const longitude = gpsParts(metadata.GPSLongitude, 'E', 'W');
  const hasGps = Boolean(latitude && longitude);
  if (hasGps) entries.push({ tag: 0x8825, type: 4, count: 1, value: 0 });
  entries.sort((a, b) => a.tag - b.tag);

  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  let dataOffset = ifdOffset + ifdSize;
  const dataParts: Uint8Array[] = [];
  const offsets = new Map<number, number>();
  for (const entry of entries) {
    if (typeof entry.value !== 'number') {
      offsets.set(entry.tag, dataOffset);
      dataParts.push(entry.value);
      dataOffset += entry.value.length;
    }
  }

  let gpsOffset = 0;
  let gpsBytes = new Uint8Array();
  if (hasGps && latitude && longitude) {
    gpsOffset = dataOffset;
    const gpsEntries = [
      { tag: 0x0001, type: 2, count: 2, value: asciiBytes(latitude.ref, 1) },
      { tag: 0x0002, type: 5, count: 3, value: latitude.values },
      { tag: 0x0003, type: 2, count: 2, value: asciiBytes(longitude.ref, 1) },
      { tag: 0x0004, type: 5, count: 3, value: longitude.values },
    ];
    const gpsIfdSize = 2 + gpsEntries.length * 12 + 4;
    let gpsDataOffset = gpsOffset + gpsIfdSize;
    const gpsDataParts: Uint8Array[] = [];
    const gpsDataOffsets: number[] = [];
    for (const entry of gpsEntries) {
      if (Array.isArray(entry.value)) {
        gpsDataOffsets.push(gpsDataOffset);
        const bytes = new Uint8Array(entry.value.length * 8);
        const view = new DataView(bytes.buffer);
        entry.value.forEach((part, index) => {
          const [numerator, denominator] = rational(part);
          view.setUint32(index * 8, numerator, true);
          view.setUint32(index * 8 + 4, denominator, true);
        });
        gpsDataParts.push(bytes);
        gpsDataOffset += bytes.length;
      } else gpsDataOffsets.push(0);
    }
    gpsBytes = new Uint8Array(gpsDataOffset - gpsOffset);
    const gpsView = new DataView(gpsBytes.buffer);
    gpsView.setUint16(0, gpsEntries.length, true);
    gpsEntries.forEach((entry, index) => {
      const offset = 2 + index * 12;
      gpsView.setUint16(offset, entry.tag, true);
      gpsView.setUint16(offset + 2, entry.type, true);
      gpsView.setUint32(offset + 4, entry.count, true);
      if (Array.isArray(entry.value)) gpsView.setUint32(offset + 8, gpsDataOffsets[index], true);
      else gpsBytes.set(entry.value, offset + 8);
    });
    let cursor = gpsIfdSize;
    for (const part of gpsDataParts) {
      gpsBytes.set(part, cursor);
      cursor += part.length;
    }
    dataParts.push(gpsBytes);
    dataOffset += gpsBytes.length;
  }

  const tiff = new Uint8Array(dataOffset);
  const view = new DataView(tiff.buffer);
  tiff.set(new Uint8Array([0x49, 0x49, 0x2a, 0x00]), 0);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, entries.length, true);
  entries.forEach((entry, index) => {
    const offset = ifdOffset + 2 + index * 12;
    view.setUint16(offset, entry.tag, true);
    view.setUint16(offset + 2, entry.type, true);
    view.setUint32(offset + 4, entry.count, true);
    if (entry.tag === 0x8825) view.setUint32(offset + 8, gpsOffset, true);
    else if (typeof entry.value === 'number') view.setUint32(offset + 8, entry.value, true);
    else if (entry.value.length <= 4) tiff.set(entry.value, offset + 8);
    else view.setUint32(offset + 8, offsets.get(entry.tag) ?? 0, true);
  });
  let cursor = ifdOffset + ifdSize;
  for (const part of dataParts) {
    tiff.set(part, cursor);
    cursor += part.length;
  }
  return tiff;
}

export async function updateImageMetadata(blob: Blob, metadata: Record<string, unknown>) {
  const tiff = writeExif(metadata);
  const source = new Uint8Array(await blob.arrayBuffer());
  if (blob.type === 'image/png') {
    if (source.length < 33 || source[0] !== 0x89 || source[1] !== 0x50 || source[2] !== 0x4e || source[3] !== 0x47) return blob;
    const chunk = pngChunk('eXIf', tiff);
    const firstChunkLength = (source[8] << 24) | (source[9] << 16) | (source[10] << 8) | source[11];
    const insertAt = 8 + 12 + firstChunkLength;
    const result = new Uint8Array(source.length + chunk.length);
    result.set(source.subarray(0, insertAt), 0);
    result.set(chunk, insertAt);
    result.set(source.subarray(insertAt), insertAt + chunk.length);
    return new Blob([result], { type: 'image/png' });
  }
  if (blob.type !== 'image/jpeg') return blob;
  const payload = new Uint8Array(6 + tiff.length);
  payload.set(new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]));
  payload.set(tiff, 6);
  if (payload.length + 2 > 0xffff) throw new Error('元数据过大，无法写入 JPEG');
  const segment = new Uint8Array(payload.length + 4);
  segment.set(new Uint8Array([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]));
  segment.set(payload, 4);
  const result = new Uint8Array(source.length + segment.length);
  result.set(source.subarray(0, 2), 0);
  result.set(segment, 2);
  result.set(source.subarray(2), segment.length + 2);
  return new Blob([result], { type: 'image/jpeg' });
}

function pngChunk(type: string, data: Uint8Array) {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)), false);
  return chunk;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
