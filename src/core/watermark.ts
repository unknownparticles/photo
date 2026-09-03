import type { ImageAsset } from '../types';
import { createAssetFromBlob, loadImage, inpaintMaskedImage, stripExtension } from './image';
import { Waldo, WaldoImageData } from 'waldo-lib';

export interface GrayPlane {
  width: number;
  height: number;
  data: Float32Array;
}

export interface TemplateMatch {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

export interface WatermarkTemplateOptions {
  threshold?: number;
  edgePadding?: number;
  maxOperations?: number;
  fillMode?: 'fast' | 'quality';
}

export interface ContentMaskOptions {
  brightnessThreshold?: number;
  darkToContent?: boolean;
}

export function rgbaToGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): GrayPlane {
  const data = new Float32Array(Math.max(0, width * height));
  for (let index = 0, pixel = 0; index < data.length; index += 1, pixel += 4) {
    data[index] = 0.299 * rgba[pixel] + 0.587 * rgba[pixel + 1] + 0.114 * rgba[pixel + 2];
  }
  return { width, height, data };
}

export function resizeGray(plane: GrayPlane, width: number, height: number): GrayPlane {
  const nextWidth = Math.max(1, Math.round(width));
  const nextHeight = Math.max(1, Math.round(height));
  const data = new Float32Array(nextWidth * nextHeight);
  for (let y = 0; y < nextHeight; y += 1) {
    const sourceY0 = Math.floor((y * plane.height) / nextHeight);
    const sourceY1 = Math.min(plane.height, Math.max(sourceY0 + 1, Math.ceil(((y + 1) * plane.height) / nextHeight)));
    for (let x = 0; x < nextWidth; x += 1) {
      const sourceX0 = Math.floor((x * plane.width) / nextWidth);
      const sourceX1 = Math.min(plane.width, Math.max(sourceX0 + 1, Math.ceil(((x + 1) * plane.width) / nextWidth)));
      let sum = 0;
      let count = 0;
      for (let sy = sourceY0; sy < sourceY1; sy += 1) {
        for (let sx = sourceX0; sx < sourceX1; sx += 1) {
          sum += plane.data[sy * plane.width + sx];
          count += 1;
        }
      }
      data[y * nextWidth + x] = count ? sum / count : 0;
    }
  }
  return { width: nextWidth, height: nextHeight, data };
}

export function extractTemplateAlpha(image: HTMLImageElement): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, image.naturalWidth);
  canvas.height = Math.max(1, image.naturalHeight);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return new Uint8Array(canvas.width * canvas.height);
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const alpha = new Uint8Array(canvas.width * canvas.height);
  for (let index = 0; index < alpha.length; index += 1) alpha[index] = data[index * 4 + 3];
  return alpha;
}

export function resizeAlpha(alpha: Uint8Array, fromWidth: number, fromHeight: number, toWidth: number, toHeight: number): Uint8Array {
  const outputWidth = Math.max(1, Math.round(toWidth));
  const outputHeight = Math.max(1, Math.round(toHeight));
  const output = new Uint8Array(outputWidth * outputHeight);
  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY0 = Math.floor((y * fromHeight) / outputHeight);
    const sourceY1 = Math.min(fromHeight, Math.max(sourceY0 + 1, Math.ceil(((y + 1) * fromHeight) / outputHeight)));
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX0 = Math.floor((x * fromWidth) / outputWidth);
      const sourceX1 = Math.min(fromWidth, Math.max(sourceX0 + 1, Math.ceil(((x + 1) * fromWidth) / outputWidth)));
      let sum = 0;
      let count = 0;
      for (let sy = sourceY0; sy < sourceY1; sy += 1) {
        for (let sx = sourceX0; sx < sourceX1; sx += 1) {
          sum += alpha[sy * fromWidth + sx];
          count += 1;
        }
      }
      output[y * outputWidth + x] = count ? Math.round(sum / count) : 0;
    }
  }
  return output;
}

export function rotateGray(plane: GrayPlane, angleDeg: number): GrayPlane {
  const angleRad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const cx = plane.width / 2;
  const cy = plane.height / 2;
  let sum = 0;
  for (let index = 0; index < plane.data.length; index += 1) sum += plane.data[index];
  const mean = sum / plane.data.length;
  const data = new Float32Array(plane.width * plane.height);
  data.fill(mean);
  for (let y = 0; y < plane.height; y += 1) {
    for (let x = 0; x < plane.width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const srcX = Math.round(dx * cos + dy * sin + cx);
      const srcY = Math.round(-dx * sin + dy * cos + cy);
      if (srcX >= 0 && srcX < plane.width && srcY >= 0 && srcY < plane.height) {
        data[y * plane.width + x] = plane.data[srcY * plane.width + srcX];
      }
    }
  }
  return { width: plane.width, height: plane.height, data };
}

export function buildContentMask(plane: GrayPlane, brightnessThreshold = 230, invert = false): Uint8Array {
  const mask = new Uint8Array(plane.width * plane.height);
  for (let index = 0; index < mask.length; index += 1) {
    const value = plane.data[index];
    mask[index] = invert ? (value > brightnessThreshold ? 1 : 0) : (value < brightnessThreshold ? 1 : 0);
  }
  return mask;
}

export interface WatermarkEnhancementOptions {
  contrast?: number;
  sharpen?: number;
  exposure?: number;
  saturation?: number;
  bgSuppress?: number;
}

export interface WatermarkMatchOptions {
  useWaldo?: boolean;
  waldoMinSimilarity?: number;
  threshold?: number;
  edgePadding?: number;
  maxOperations?: number;
  fillMode?: 'fast' | 'quality';
}

export function enhanceWatermarkImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: WatermarkEnhancementOptions = {}
): Uint8ClampedArray {
  const {
    contrast = 1.2,
    sharpen = 0.8,
    exposure = 1.0,
    saturation = 1.0,
    bgSuppress = 0.3,
  } = options;

  const out = new Uint8ClampedArray(data);
  const len = width * height;

  if (exposure !== 1.0) {
    for (let i = 0; i < len * 4; i++) {
      out[i] = Math.min(255, out[i] * exposure);
    }
  }

  if (saturation !== 1.0) {
    for (let i = 0; i < len; i++) {
      const idx = i * 4;
      if (out[idx + 3] < 10) continue;
      const r = out[idx];
      const g = out[idx + 1];
      const b = out[idx + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      out[idx] = Math.min(255, gray + (r - gray) * saturation);
      out[idx + 1] = Math.min(255, gray + (g - gray) * saturation);
      out[idx + 2] = Math.min(255, gray + (b - gray) * saturation);
    }
  }

  if (contrast !== 1.0) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < len; i++) {
      const idx = i * 4;
      if (out[idx + 3] > 10) {
        sum += 0.299 * out[idx] + 0.587 * out[idx + 1] + 0.114 * out[idx + 2];
        count++;
      }
    }
    const avg = count > 0 ? sum / count : 128;
    for (let i = 0; i < len; i++) {
      const idx = i * 4;
      if (out[idx + 3] < 10) continue;
      out[idx] = Math.min(255, Math.max(0, avg + (out[idx] - avg) * contrast));
      out[idx + 1] = Math.min(255, Math.max(0, avg + (out[idx + 1] - avg) * contrast));
      out[idx + 2] = Math.min(255, Math.max(0, avg + (out[idx + 2] - avg) * contrast));
    }
  }

  if (sharpen > 0) {
    const temp = new Uint8ClampedArray(out);
    const kernel = [0, -1, 0, -1, 4, -1, 0, -1, 0];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        if (temp[idx + 3] < 10) continue;
        for (let c = 0; c < 3; c++) {
          let lap = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const kidx = ((y + ky) * width + (x + kx)) * 4 + c;
              lap += temp[kidx] * kernel[(ky + 1) * 3 + (kx + 1)];
            }
          }
          const orig = temp[idx + c];
          out[idx + c] = Math.min(255, Math.max(0, orig + sharpen * lap * 0.3));
        }
      }
    }
  }

  if (bgSuppress > 0) {
    for (let i = 0; i < len; i++) {
      const idx = i * 4;
      const alpha = out[idx + 3];
      if (alpha < 30) {
        const factor = 1 - (alpha / 30) * bgSuppress * 0.8;
        out[idx] = out[idx] * factor;
        out[idx + 1] = out[idx + 1] * factor;
        out[idx + 2] = out[idx + 2] * factor;
      }
    }
  }

  return out;
}

export async function enhanceWatermark(asset: ImageAsset, options: WatermarkEnhancementOptions = {}): Promise<ImageAsset> {
  const image = await loadImage(asset.blob);
  const width = Math.max(1, image.naturalWidth);
  const height = Math.max(1, image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('当前浏览器无法创建画布');
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, width, height);
  const enhanced = enhanceWatermarkImageData(imageData.data, width, height, options);
  const newImageData = new ImageData(enhanced as ImageDataArray, width, height);
  context.putImageData(newImageData, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('图片编码失败'))), 'image/png')
  );
  return createAssetFromBlob(blob, `enhanced-${asset.name}`);
}

export async function extractWatermarkFromSelections(
  selections: ImageAsset[],
  enhancementOptions: WatermarkEnhancementOptions = {}
): Promise<ImageAsset> {
  const SZ = 120;
  const MIN_AREA = 8;
  const MIN_ALPHA = 20;
  if (selections.length < 3) throw new Error('请至少框选 3 个包含水印的区域');

  const samples = await Promise.all(selections.map(async (asset) => {
    const image = await loadImage(asset.blob);
    const canvas = document.createElement('canvas');
    canvas.width = SZ;
    canvas.height = SZ;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('当前浏览器无法创建画布');
    context.drawImage(image, 0, 0, SZ, SZ);
    return context.getImageData(0, 0, SZ, SZ);
  }));

  const totalPixels = SZ * SZ;
  const result = new Uint8ClampedArray(totalPixels * 4);
  const rVals = new Array<number>(samples.length);
  const gVals = new Array<number>(samples.length);
  const bVals = new Array<number>(samples.length);
  const aVals = new Array<number>(samples.length);

  for (let i = 0; i < totalPixels; i++) {
    for (let s = 0; s < samples.length; s++) {
      const idx = i * 4;
      const d = samples[s].data;
      rVals[s] = d[idx];
      gVals[s] = d[idx + 1];
      bVals[s] = d[idx + 2];
      aVals[s] = d[idx + 3];
    }
    rVals.sort((a, b) => a - b);
    gVals.sort((a, b) => a - b);
    bVals.sort((a, b) => a - b);
    aVals.sort((a, b) => a - b);
    const mid = Math.floor(samples.length / 2);
    const idx = i * 4;
    result[idx] = rVals[mid];
    result[idx + 1] = gVals[mid];
    result[idx + 2] = bVals[mid];
    result[idx + 3] = aVals[mid];
  }

  const sampleColors: number[] = [];
  for (let i = 0; i < totalPixels; i += 5) {
    const idx = i * 4;
    sampleColors.push(result[idx], result[idx + 1], result[idx + 2]);
  }
  sampleColors.sort((a, b) => a - b);
  const bgIdx = Math.floor(sampleColors.length / 2);
  const bgR = sampleColors[bgIdx];
  const bgG = sampleColors[bgIdx + 1];
  const bgB = sampleColors[bgIdx + 2];

  const finalData = new Uint8ClampedArray(totalPixels * 4);
  const dists = new Float32Array(totalPixels);
  let maxDist = 0;
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const dr = result[idx] - bgR;
    const dg = result[idx + 1] - bgG;
    const db = result[idx + 2] - bgB;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    dists[i] = dist;
    if (dist > maxDist) maxDist = dist;
  }
  const threshold = Math.max(8, maxDist * 0.12);
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const dist = dists[i];
    if (dist < threshold) {
      finalData[idx] = finalData[idx + 1] = finalData[idx + 2] = finalData[idx + 3] = 0;
    } else {
      let alpha = Math.min(1, (dist - threshold) / (maxDist - threshold + 1));
      alpha = Math.pow(alpha, 0.6);
      finalData[idx] = result[idx];
      finalData[idx + 1] = result[idx + 1];
      finalData[idx + 2] = result[idx + 2];
      finalData[idx + 3] = Math.min(255, alpha * 255);
    }
  }

  const denoised = removeIsolatedPixels(finalData, SZ, SZ, MIN_AREA, MIN_ALPHA);
  const cropped = cropTransparent(denoised, SZ, SZ);

  const canvas = document.createElement('canvas');
  canvas.width = cropped.width;
  canvas.height = cropped.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('当前浏览器无法创建画布');
  const imageData = new ImageData(cropped.data as ImageDataArray, cropped.width, cropped.height);
  context.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('图片编码失败'))), 'image/png'));
  const asset = await createAssetFromBlob(blob, `watermark-template-${Date.now()}.png`);

  if (enhancementOptions && Object.keys(enhancementOptions).length > 0) {
    return enhanceWatermark(asset, enhancementOptions);
  }
  return asset;
}

function removeIsolatedPixels(data: Uint8ClampedArray, w: number, h: number, minArea: number, minAlpha: number): Uint8ClampedArray {
  const binary = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) binary[i] = data[i * 4 + 3] > minAlpha ? 1 : 0;
  const visited = new Uint8Array(w * h);
  const regions: Array<{ pixels: Array<{ x: number; y: number }>; size: number }> = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = y * w + x;
      if (binary[idx] === 0 || visited[idx]) continue;
      const queue = [{ x, y }];
      visited[idx] = 1;
      const pixels: Array<{ x: number; y: number }> = [];
      let head = 0;
      while (head < queue.length) {
        const p = queue[head++];
        pixels.push(p);
        for (const [nx, ny] of [
            [p.x - 1, p.y],
            [p.x + 1, p.y],
            [p.x, p.y - 1],
            [p.x, p.y + 1],
          ] as [number, number][]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nidx = ny * w + nx;
          if (binary[nidx] && !visited[nidx]) { visited[nidx] = 1;
            queue.push({ x: nx, y: ny }); }
        }
      }
      if (pixels.length > 0) regions.push({ pixels, size: pixels.length });
    }
  }
  for (const region of regions) {
    if (region.size < minArea) {
      for (const p of region.pixels) {
        const idx = (p.y * w + p.x) * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = data[idx + 3] = 0;
      }
    }
  }
  const finalData = new Uint8ClampedArray(data);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const idx = (y * w + x) * 4;
      if (finalData[idx + 3] < 20) continue;
      let neighborCount = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          if (finalData[((y + dy) * w + (x + dx)) * 4 + 3] > 20) neighborCount++;
        }
      }
      if (neighborCount < 2) finalData[idx] = finalData[idx + 1] = finalData[idx + 2] = finalData[idx + 3] = 0;
    }
  }
  return finalData;
}

function cropTransparent(data: Uint8ClampedArray, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
  let top = h;
  let bottom = 0;
  let left = w;
  let right = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (top > bottom || left > right) return { data, width: w, height: h };
  const cw = right - left + 1;
  const ch = bottom - top + 1;
  const result = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      const si = ((top + y) * w + (left + x)) * 4;
      const di = (y * cw + x) * 4;
      result[di] = data[si];
      result[di + 1] = data[si + 1];
      result[di + 2] = data[si + 2];
      result[di + 3] = data[si + 3];
    }
  }
  return { data: result, width: cw, height: ch };
}

export function matchTemplateContent(search: GrayPlane, template: GrayPlane, contentMask: Uint8Array, threshold = 0.86, maxOperations = 6e7): TemplateMatch[] {
  const validWidth = search.width - template.width + 1;
  const validHeight = search.height - template.height + 1;
  if (validWidth < 1 || validHeight < 1 || template.width < 2 || template.height < 2) return [];

  const contentIndices: number[] = [];
  const templateValues: number[] = [];
  for (let index = 0; index < contentMask.length; index += 1) {
    if (contentMask[index]) {
      contentIndices.push(index);
      templateValues.push(template.data[index]);
    }
  }
  const contentCount = contentIndices.length;
  if (contentCount < 4) return [];

  let templateSum = 0;
  let templateSumSq = 0;
  for (let index = 0; index < templateValues.length; index += 1) {
    const value = templateValues[index];
    templateSum += value;
    templateSumSq += value * value;
  }
  const templateMean = templateSum / contentCount;
  const templateVariance = Math.max(1e-6, templateSumSq / contentCount - templateMean * templateMean);
  const templateStd = Math.sqrt(templateVariance);

  const totalPoints = validWidth * validHeight;
  const stride = Math.max(1, Math.min(3, Math.ceil(Math.sqrt((totalPoints * contentCount) / maxOperations))));
  const coarseThreshold = Math.min(threshold, Math.max(0.35, threshold - 0.15));
  const matches: TemplateMatch[] = [];

  for (let y = 0; y < validHeight; y += stride) {
    for (let x = 0; x < validWidth; x += stride) {
      let sum = 0;
      let sumSq = 0;
      let cross = 0;
      for (let c = 0; c < contentCount; c += 1) {
        const templateIndex = contentIndices[c];
        const ty = Math.floor(templateIndex / template.width);
        const tx = templateIndex % template.width;
        const searchIndex = (y + ty) * search.width + (x + tx);
        const value = search.data[searchIndex];
        sum += value;
        sumSq += value * value;
        cross += value * templateValues[c];
      }
      const mean = sum / contentCount;
      const variance = Math.max(1e-6, sumSq / contentCount - mean * mean);
      const denominator = Math.sqrt(variance) * templateStd * contentCount;
      if (denominator < 1e-6) continue;
      const score = (cross - contentCount * mean * templateMean) / denominator;
      if (score >= coarseThreshold) matches.push({ x, y, width: template.width, height: template.height, score });
    }
  }

  const refined = new Map<number, TemplateMatch>();
  const refineRadius = Math.max(1, Math.round(stride * 0.5));
  for (const match of matches) {
    const cx = match.x;
    const cy = match.y;
    const key = Math.floor(cy / refineRadius) * 100000 + Math.floor(cx / refineRadius);
    const existing = refined.get(key);
    if (!existing || match.score > existing.score) refined.set(key, match);
  }
  const candidates = Array.from(refined.values());
  const final: TemplateMatch[] = [];
  for (const candidate of candidates) {
    const cx = candidate.x + candidate.width / 2;
    const cy = candidate.y + candidate.height / 2;
    const minDistance = Math.max(candidate.width, candidate.height) * 0.35;
    const duplicated = final.some((kept) => Math.hypot(cx - (kept.x + kept.width / 2), cy - (kept.y + kept.height / 2)) < minDistance);
    if (!duplicated) final.push(candidate);
  }
  final.sort((a, b) => b.score - a.score);
  return final.filter((match) => match.score >= threshold);
}

function buildSumAreaTable(data: Float32Array, width: number, height: number): Float64Array {
  const stride = width + 1;
  const table = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += data[y * width + x];
      table[(y + 1) * stride + (x + 1)] = table[y * stride + (x + 1)] + rowSum;
    }
  }
  return table;
}

function tableArea(table: Float64Array, stride: number, x: number, y: number, width: number, height: number) {
  return table[(y + height) * stride + x + width] - table[y * stride + x + width] - table[(y + height) * stride + x] + table[y * stride + x];
}

function correlationAt(search: GrayPlane, template: GrayPlane, satSum: Float64Array, satSq: Float64Array, tMean: number, tStd: number, x: number, y: number) {
  const n = template.width * template.height;
  const sum = tableArea(satSum, search.width + 1, x, y, template.width, template.height);
  const sumSq = tableArea(satSq, search.width + 1, x, y, template.width, template.height);
  let cross = 0;
  for (let ty = 0; ty < template.height; ty += 1) {
    const searchRow = (y + ty) * search.width + x;
    const templateRow = ty * template.width;
    for (let tx = 0; tx < template.width; tx += 1) cross += search.data[searchRow + tx] * template.data[templateRow + tx];
  }
  const mean = sum / n;
  const variance = Math.max(1e-6, sumSq / n - mean * mean);
  const denominator = Math.sqrt(variance) * tStd * n;
  if (denominator < 1e-6) return 0;
  const score = (cross - n * mean * tMean) / denominator;
  return Math.max(-1, Math.min(1, score));
}

export function matchTemplate(search: GrayPlane, template: GrayPlane, threshold = 0.86, maxOperations = 6e7): TemplateMatch[] {
  const validWidth = search.width - template.width + 1;
  const validHeight = search.height - template.height + 1;
  if (validWidth < 1 || validHeight < 1 || template.width < 2 || template.height < 2) return [];

  const count = template.width * template.height;
  let templateSum = 0;
  let templateSumSq = 0;
  for (let index = 0; index < template.data.length; index += 1) {
    const value = template.data[index];
    templateSum += value;
    templateSumSq += value * value;
  }
  const templateMean = templateSum / count;
  const templateVariance = Math.max(1e-6, templateSumSq / count - templateMean * templateMean);
  const templateStd = Math.sqrt(templateVariance);

  const squared = new Float32Array(search.data.length);
  for (let index = 0; index < search.data.length; index += 1) squared[index] = search.data[index] * search.data[index];
  const satSum = buildSumAreaTable(search.data, search.width, search.height);
  const satSq = buildSumAreaTable(squared, search.width, search.height);

  const totalPoints = validWidth * validHeight;
  const stride = Math.max(1, Math.min(3, Math.ceil(Math.sqrt((totalPoints * count) / maxOperations))));
  const coarseThreshold = Math.min(threshold, Math.max(0.45, threshold - 0.1));
  const candidates: TemplateMatch[] = [];
  for (let y = 0; y < validHeight; y += stride) {
    for (let x = 0; x < validWidth; x += stride) {
      const score = correlationAt(search, template, satSum, satSq, templateMean, templateStd, x, y);
      if (score >= coarseThreshold) candidates.push({ x, y, width: template.width, height: template.height, score });
    }
  }

  const refined: TemplateMatch[] = [];
  for (const candidate of candidates) {
    let best = candidate;
    const minY = Math.max(0, candidate.y - stride);
    const maxY = Math.min(validHeight - 1, candidate.y + stride);
    const minX = Math.max(0, candidate.x - stride);
    const maxX = Math.min(validWidth - 1, candidate.x + stride);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const score = correlationAt(search, template, satSum, satSq, templateMean, templateStd, x, y);
        if (score > best.score) best = { x, y, width: template.width, height: template.height, score };
      }
    }
    if (best.score >= threshold) refined.push(best);
  }

  refined.sort((a, b) => b.score - a.score);
  const kept: TemplateMatch[] = [];
  const minDistance = Math.max(template.width, template.height) * 0.35;
  for (const match of refined) {
    const centerX = match.x + match.width / 2;
    const centerY = match.y + match.height / 2;
    const duplicated = kept.some((keptMatch) => Math.hypot(centerX - (keptMatch.x + match.width / 2), centerY - (keptMatch.y + match.height / 2)) < minDistance);
    if (!duplicated) kept.push(match);
  }
  return kept;
}

async function grayFromAsset(asset: ImageAsset): Promise<{ plane: GrayPlane; image: HTMLImageElement }> {
  const image = await loadImage(asset.blob);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, image.naturalWidth);
  canvas.height = Math.max(1, image.naturalHeight);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('当前浏览器无法创建画布');
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return { plane: rgbaToGray(imageData.data, canvas.width, canvas.height), image };
}

async function collectMatches(search: GrayPlane, templateFull: GrayPlane, threshold: number, maxOperations: number, invertContent: boolean): Promise<TemplateMatch[]> {
  if (templateFull.width < 24 || templateFull.height < 16) return [];
  const rotationAngles = templateFull.width < 120 && templateFull.height < 120 ? [0, -15, 15, -30, 30] : [0];
  const scales = [0.4, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 1.75];
  const collected: TemplateMatch[] = [];
  for (const scale of scales) {
    const templateWidth = Math.round(templateFull.width * scale);
    const templateHeight = Math.round(templateFull.height * scale);
    if (templateWidth < 8 || templateHeight < 6) continue;
    if (templateWidth > search.width * 0.92 || templateHeight > search.height * 0.92) continue;
    const scaledTemplate = resizeGray(templateFull, templateWidth, templateHeight);
    for (const angle of rotationAngles) {
      const rotatedTemplate = angle === 0 ? scaledTemplate : rotateGray(scaledTemplate, angle);
      const scaledMask = buildContentMask(rotatedTemplate, 230, invertContent);
      collected.push(...matchTemplateContent(search, rotatedTemplate, scaledMask, threshold, maxOperations));
    }
  }
  const inverse = search.width / templateFull.width;
  const mapped = collected
    .map((match) => ({ x: match.x * inverse, y: match.y * inverse, width: match.width * inverse, height: match.height * inverse, score: match.score }))
    .sort((a, b) => b.score - a.score);
  const matches: typeof mapped = [];
  for (const match of mapped) {
    const centerX = match.x + match.width / 2;
    const centerY = match.y + match.height / 2;
  const minDistance = Math.max(match.width, match.height) * 0.35;
  const duplicated = matches.some((kept) => Math.hypot(centerX - (kept.x + kept.width / 2), centerY - (kept.y + kept.height / 2)) < minDistance);
  if (!duplicated) matches.push(match);
  }
  return matches;
}

async function buildMaskForMatches(width: number, height: number, matches: TemplateMatch[], templateFull: GrayPlane, edgePadding: number, invertContent: boolean): Promise<{ mask: Uint8Array; maxDimension: number }> {
  const templateContentMask = buildContentMask(templateFull, 230, invertContent);
  const templateMaskResized = templateFull.width > 0 && templateFull.height > 0 ? resizeAlpha(templateContentMask, templateFull.width, templateFull.height, templateFull.width, templateFull.height) : templateContentMask;
  const mask = new Uint8Array(width * height);
  let maxDimension = 0;
  for (const match of matches) {
    maxDimension = Math.max(maxDimension, match.width, match.height);
    const x0 = Math.max(0, Math.round(match.x));
    const y0 = Math.max(0, Math.round(match.y));
    const mw = Math.min(width - x0, Math.round(match.width));
    const mh = Math.min(height - y0, Math.round(match.height));
    if (mw > 0 && mh > 0) {
      const scaledMask = resizeAlpha(templateMaskResized, templateFull.width, templateFull.height, mw, mh);
      for (let dy = 0; dy < mh; dy += 1) {
        const maskRow = (y0 + dy) * width + x0;
        const maskCol = dy * mw;
        for (let dx = 0; dx < mw; dx += 1) {
          if (scaledMask[maskCol + dx] > 16) mask[maskRow + dx] = 1;
        }
      }
    }
    if (edgePadding > 0) {
      const ex = Math.round(edgePadding);
      const left = Math.max(0, x0 - ex);
      const top = Math.max(0, y0 - ex);
      const right = Math.min(width, x0 + mw + ex);
      const bottom = Math.min(height, y0 + mh + ex);
      for (let y = top; y < bottom; y += 1) mask.fill(1, y * width + left, y * width + right);
    }
  }
  return { mask, maxDimension };
}

export async function removeWatermarkByTemplate(asset: ImageAsset, template: ImageAsset, options: WatermarkTemplateOptions = {}): Promise<ImageAsset> {
  const threshold = options.threshold ?? 0.86;
  const edgePadding = options.edgePadding ?? 6;
  const maxOperations = options.maxOperations ?? 6e7;

  const [{ plane: searchFull, image: sourceImage }, { plane: templateFull }] = await Promise.all([grayFromAsset(asset), grayFromAsset(template)]);
  const width = searchFull.width;
  const height = searchFull.height;
  const downscale = Math.min(1, 720 / Math.max(width, height));
  const search = downscale < 1 ? resizeGray(searchFull, width * downscale, height * downscale) : searchFull;
  const templateGray = resizeGray(templateFull, templateFull.width, templateFull.height);

  const brightPixels = templateGray.data.filter((v) => v >= 230).length;
  const totalPixels = templateGray.width * templateGray.height;
  const backgroundRatio = brightPixels / totalPixels;
  const contentRatio = 1 - backgroundRatio;
  const invertContent = contentRatio > 0.01 && contentRatio < 0.95 && templateGray.data.reduce((a, b) => a + b, 0) / totalPixels < 200;

  const matches = await collectMatches(search, templateFull, threshold, maxOperations, invertContent);
  if (!matches.length) throw new Error('未在图片中识别到该水印模板，可尝试降低匹配灵敏度、增加边缘扩展，或更换包含更少背景的模板');

  const { mask, maxDimension } = await buildMaskForMatches(width, height, matches, templateFull, edgePadding, invertContent);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('当前浏览器无法创建画布');
  context.drawImage(sourceImage, 0, 0);

  const radius = Math.max(4, Math.min(240, Math.round(maxDimension * 0.28)));
  const searchRadius = Math.min(420, Math.round(radius * 2.8) + 20);
  const imageData = context.getImageData(0, 0, width, height);
  const fillMode = options.fillMode ?? 'quality';
  if (fillMode === 'fast') {
    inpaintMaskedImage(imageData, mask, width, height, Math.max(2, Math.round(radius * 0.5)), 8, Math.min(120, searchRadius));
  } else {
    inpaintMaskedImage(imageData, mask, width, height, radius, 32, searchRadius);
  }
  context.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('图片编码失败'))), 'image/png'));
  return createAssetFromBlob(blob, `${stripExtension(asset.name)}-去水印.png`);
}

export async function removeWatermarkByTemplates(asset: ImageAsset, templates: ImageAsset[], options: WatermarkTemplateOptions = {}): Promise<ImageAsset> {
  const threshold = options.threshold ?? 0.86;
  const edgePadding = options.edgePadding ?? 6;
  const maxOperations = options.maxOperations ?? 6e7;

  const [{ plane: searchFull, image: sourceImage }] = await Promise.all([grayFromAsset(asset)]);
  const width = searchFull.width;
  const height = searchFull.height;
  const downscale = Math.min(1, 720 / Math.max(width, height));
  const search = downscale < 1 ? resizeGray(searchFull, width * downscale, height * downscale) : searchFull;

  const allMatches: TemplateMatch[] = [];
  const templateData = await Promise.all(templates.map((tpl) => grayFromAsset(tpl)));
  let invertContent = false;
  for (let i = 0; i < templateData.length; i += 1) {
    const { plane: templateFull } = templateData[i];
    const templateGray = resizeGray(templateFull, templateFull.width, templateFull.height);
    const brightPixels = templateGray.data.filter((v) => v >= 230).length;
    const totalPixels = templateGray.width * templateFull.height;
    const contentRatio = 1 - brightPixels / totalPixels;
    if (i === 0) invertContent = contentRatio > 0.01 && contentRatio < 0.95 && templateGray.data.reduce((a, b) => a + b, 0) / totalPixels < 200;
    const matches = await collectMatches(search, templateFull, threshold, maxOperations, invertContent);
    allMatches.push(...matches);
  }

  allMatches.sort((a, b) => b.score - a.score);
  const merged: TemplateMatch[] = [];
  for (const match of allMatches) {
    const centerX = match.x + match.width / 2;
    const centerY = match.y + match.height / 2;
    const minDistance = Math.max(match.width, match.height) * 0.35;
    const duplicated = merged.some((kept) => Math.hypot(centerX - (kept.x + kept.width / 2), centerY - (kept.y + kept.height / 2)) < minDistance);
    if (!duplicated) merged.push(match);
  }

  const bestTemplate = templateData[0]?.plane;
  if (!merged.length) throw new Error('未在图片中识别到该水印模板，可尝试降低匹配灵敏度、增加边缘扩展，或更换包含更少背景的模板');

  const { mask, maxDimension } = await buildMaskForMatches(width, height, merged, bestTemplate, edgePadding, invertContent);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('当前浏览器无法创建画布');
  context.drawImage(sourceImage, 0, 0);

  const radius = Math.max(4, Math.min(240, Math.round(maxDimension * 0.28)));
  const searchRadius = Math.min(420, Math.round(radius * 2.8) + 20);
  const imageData = context.getImageData(0, 0, width, height);
  const fillMode = options.fillMode ?? 'quality';
  if (fillMode === 'fast') {
    inpaintMaskedImage(imageData, mask, width, height, Math.max(2, Math.round(radius * 0.5)), 8, Math.min(120, searchRadius));
  } else {
    inpaintMaskedImage(imageData, mask, width, height, radius, 32, searchRadius);
  }
  context.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('图片编码失败'))), 'image/png'));
  return createAssetFromBlob(blob, `${stripExtension(asset.name)}-去水印.png`);
}

let waldoInstance: { instance: Waldo; canvas: HTMLCanvasElement } | null = null;

async function getWaldoInstance(): Promise<{ instance: Waldo; canvas: HTMLCanvasElement }> {
  if (waldoInstance) return waldoInstance;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: false }) || canvas.getContext('experimental-webgl', { preserveDrawingBuffer: false });
  if (!gl) throw new Error('当前浏览器不支持 WebGL，无法使用 waldo 匹配引擎');
  waldoInstance = { instance: new Waldo(gl as WebGLRenderingContext), canvas };
  return waldoInstance;
}

export async function matchWatermarkWithWaldo(
  searchAsset: ImageAsset,
  templateAsset: ImageAsset,
  minSimilarity: number = 0.5
): Promise<TemplateMatch[]> {
  const [searchImg, templateImg] = await Promise.all([loadImage(searchAsset.blob), loadImage(templateAsset.blob)]);

  const searchCanvas = document.createElement('canvas');
  searchCanvas.width = searchImg.naturalWidth;
  searchCanvas.height = searchImg.naturalHeight;
  const searchCtx = searchCanvas.getContext('2d', { willReadFrequently: true });
  if (!searchCtx) throw new Error('当前浏览器无法创建画布');
  searchCtx.drawImage(searchImg, 0, 0);
  const searchImageData = searchCtx.getImageData(0, 0, searchCanvas.width, searchCanvas.height);

  const templateCanvas = document.createElement('canvas');
  templateCanvas.width = templateImg.naturalWidth;
  templateCanvas.height = templateImg.naturalHeight;
  const templateCtx = templateCanvas.getContext('2d', { willReadFrequently: true });
  if (!templateCtx) throw new Error('当前浏览器无法创建画布');
  templateCtx.drawImage(templateImg, 0, 0);
  const templateImageData = templateCtx.getImageData(0, 0, templateCanvas.width, templateCanvas.height);

  const { instance: waldo } = await getWaldoInstance();
  const matches = await waldo.filteredSimilarities(
    { data: searchImageData.data, width: searchCanvas.width, height: searchCanvas.height } as WaldoImageData,
    { data: templateImageData.data, width: templateCanvas.width, height: templateCanvas.height } as WaldoImageData,
    minSimilarity
  );

  return matches
    .map((m) => ({
      x: m.location.x,
      y: m.location.y,
      width: templateCanvas.width,
      height: templateCanvas.height,
      score: m.similarity,
    }))
    .sort((a, b) => b.score - a.score);
}
