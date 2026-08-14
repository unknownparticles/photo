import { canvasToBlob, createAssetFromBlob, loadImage } from './image';
import type { ImageAsset } from '../types';

const IMG = 512;
const LAT = 64;
const SCALING_FACTOR = 0.13025;
const NOISE_OFFSET = 0.0357;
const HALF_IDS = 10;
const CACHE_NAME = 'alun-moebius-onnx-v1';
const DEFAULT_MODEL_BASE = 'https://huggingface.co/simonw/Moebius-ONNX/resolve/main';

type Ort = typeof import('onnxruntime-web/webgpu');
type Session = Awaited<ReturnType<Ort['InferenceSession']['create']>>;

type Progress = (stage: string, loaded?: number, total?: number) => void;

export interface InpaintStrokePoint {
  x: number;
  y: number;
}

export interface InpaintStroke {
  size: number;
  points: InpaintStrokePoint[];
}

export interface MoebiusRunOptions {
  steps?: number;
  guidance?: number;
  seed?: number;
  onProgress?: Progress;
}

function modelBaseUrl() {
  return (import.meta.env.VITE_MOEBIUS_MODEL_BASE_URL?.trim() || DEFAULT_MODEL_BASE).replace(/\/$/, '');
}

async function persistentCache() {
  try {
    if (navigator.storage?.persist) void navigator.storage.persist();
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

async function loadModelBytes(url: string, onProgress?: (loaded: number, total: number, cached: boolean) => void) {
  const cache = await persistentCache();
  const cached = await cache?.match(url);
  if (cached) {
    const bytes = new Uint8Array(await cached.arrayBuffer());
    onProgress?.(bytes.byteLength, bytes.byteLength, true);
    return bytes;
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Moebius 模型下载失败：HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body?.getReader();
  let bytes: Uint8Array;

  if (reader && total > 0) {
    bytes = new Uint8Array(total);
    let loaded = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes.set(part.value, loaded);
      loaded += part.value.byteLength;
      onProgress?.(loaded, total, false);
    }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.(bytes.byteLength, bytes.byteLength, false);
  }

  if (cache) {
    try {
      await cache.put(url, new Response(bytes, {
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(bytes.byteLength),
        },
      }));
    } catch {
      // Storage quotas and private mode can reject ~1.2 GB model caching.
    }
  }
  return bytes;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randn(length: number, seed: number) {
  const rng = mulberry32(seed);
  const result = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    result[index] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  return result;
}

function makeDdim(numSteps: number, strength = 0.99) {
  const trainSteps = 1000;
  const betaStart = 0.00085;
  const betaEnd = 0.012;
  const betas = new Float64Array(trainSteps);
  const start = Math.sqrt(betaStart);
  const end = Math.sqrt(betaEnd);
  for (let index = 0; index < trainSteps; index += 1) {
    const value = start + (end - start) * (index / (trainSteps - 1));
    betas[index] = value * value;
  }
  const alphasCumprod = new Float64Array(trainSteps);
  let acc = 1;
  for (let index = 0; index < trainSteps; index += 1) {
    acc *= 1 - betas[index];
    alphasCumprod[index] = acc;
  }
  const ratio = Math.floor(trainSteps / numSteps);
  const all = Array.from({ length: numSteps }, (_, index) => Math.round(index * ratio)).reverse();
  const init = Math.min(Math.floor(numSteps * strength), numSteps);
  return { alphasCumprod, timesteps: all.slice(Math.max(numSteps - init, 0)) };
}

function ddimStep(eps: Float32Array, sample: Float32Array, timestep: number, previous: number, ddim: ReturnType<typeof makeDdim>) {
  const alpha = ddim.alphasCumprod[timestep];
  const alphaPrevious = previous >= 0 ? ddim.alphasCumprod[previous] : 1;
  const sqrtAlpha = Math.sqrt(alpha);
  const sqrtBeta = Math.sqrt(1 - alpha);
  const sqrtPrevious = Math.sqrt(alphaPrevious);
  const sqrtOneMinusPrevious = Math.sqrt(1 - alphaPrevious);
  const output = new Float32Array(sample.length);
  for (let index = 0; index < sample.length; index += 1) {
    const predX0 = (sample[index] - sqrtBeta * eps[index]) / sqrtAlpha;
    output[index] = sqrtPrevious * predX0 + sqrtOneMinusPrevious * eps[index];
  }
  return output;
}

function toSquareCanvas(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = IMG;
  canvas.height = IMG;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建局部重绘画布');
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#000';
  context.fillRect(0, 0, IMG, IMG);
  const scale = Math.min(IMG / width, IMG / height);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const x = Math.floor((IMG - w) / 2);
  const y = Math.floor((IMG - h) / 2);
  context.drawImage(source, x, y, w, h);
  return { canvas, rect: { x, y, w, h } };
}

function maskCanvas(strokes: InpaintStroke[], sourceWidth: number, sourceHeight: number, rect: { x: number; y: number; w: number; h: number }) {
  const canvas = document.createElement('canvas');
  canvas.width = IMG;
  canvas.height = IMG;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建局部重绘蒙版');
  context.strokeStyle = '#fff';
  context.fillStyle = '#fff';
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const scale = Math.min(rect.w / sourceWidth, rect.h / sourceHeight);

  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    context.lineWidth = Math.max(2, stroke.size * scale);
    const first = stroke.points[0];
    context.beginPath();
    context.moveTo(rect.x + first.x * rect.w, rect.y + first.y * rect.h);
    for (const point of stroke.points.slice(1)) context.lineTo(rect.x + point.x * rect.w, rect.y + point.y * rect.h);
    if (stroke.points.length === 1) {
      context.arc(rect.x + first.x * rect.w, rect.y + first.y * rect.h, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.stroke();
    }
  }
  return canvas;
}

function canvasToChw(canvas: HTMLCanvasElement) {
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, IMG, IMG).data;
  const plane = IMG * IMG;
  const output = new Float32Array(3 * plane);
  for (let index = 0; index < plane; index += 1) {
    output[index] = pixels[index * 4] / 127.5 - 1;
    output[plane + index] = pixels[index * 4 + 1] / 127.5 - 1;
    output[2 * plane + index] = pixels[index * 4 + 2] / 127.5 - 1;
  }
  return output;
}

function binaryMask(canvas: HTMLCanvasElement) {
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, IMG, IMG).data;
  const output = new Float32Array(IMG * IMG);
  for (let index = 0; index < output.length; index += 1) output[index] = pixels[index * 4 + 3] >= 128 ? 1 : 0;
  return output;
}

function maskedChw(image: Float32Array, mask: Float32Array) {
  const plane = IMG * IMG;
  const output = new Float32Array(image.length);
  for (let channel = 0; channel < 3; channel += 1) for (let index = 0; index < plane; index += 1) output[channel * plane + index] = image[channel * plane + index] * (1 - mask[index]);
  return output;
}

function latentMask(mask: Float32Array) {
  const output = new Float32Array(LAT * LAT);
  const ratio = IMG / LAT;
  for (let y = 0; y < LAT; y += 1) for (let x = 0; x < LAT; x += 1) output[y * LAT + x] = mask[y * ratio * IMG + x * ratio];
  return output;
}

function chwToImageData(chw: Float32Array) {
  const plane = IMG * IMG;
  const output = new ImageData(IMG, IMG);
  for (let index = 0; index < plane; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = Math.max(0, Math.min(1, (chw[channel * plane + index] + 1) / 2));
      output.data[index * 4 + channel] = Math.round(value * 255);
    }
    output.data[index * 4 + 3] = 255;
  }
  return output;
}

function blendResult(result: ImageData, original: HTMLCanvasElement, mask: Float32Array) {
  const rawMask = document.createElement('canvas');
  rawMask.width = IMG;
  rawMask.height = IMG;
  const rawContext = rawMask.getContext('2d')!;
  const maskImage = new ImageData(IMG, IMG);
  for (let index = 0; index < mask.length; index += 1) {
    const value = mask[index] * 255;
    maskImage.data[index * 4] = value;
    maskImage.data[index * 4 + 1] = value;
    maskImage.data[index * 4 + 2] = value;
    maskImage.data[index * 4 + 3] = 255;
  }
  rawContext.putImageData(maskImage, 0, 0);
  const blurred = document.createElement('canvas');
  blurred.width = IMG;
  blurred.height = IMG;
  const blurContext = blurred.getContext('2d')!;
  blurContext.filter = 'blur(3px)';
  blurContext.drawImage(rawMask, 0, 0);
  const blurPixels = blurContext.getImageData(0, 0, IMG, IMG).data;
  const originalPixels = original.getContext('2d')!.getImageData(0, 0, IMG, IMG).data;
  const output = document.createElement('canvas');
  output.width = IMG;
  output.height = IMG;
  const blended = new ImageData(IMG, IMG);
  for (let index = 0; index < mask.length; index += 1) {
    const amount = blurPixels[index * 4] / 255;
    for (let channel = 0; channel < 3; channel += 1) blended.data[index * 4 + channel] = Math.round(result.data[index * 4 + channel] * amount + originalPixels[index * 4 + channel] * (1 - amount));
    blended.data[index * 4 + 3] = originalPixels[index * 4 + 3];
  }
  output.getContext('2d')!.putImageData(blended, 0, 0);
  return output;
}

class MoebiusPipeline {
  private ort: Ort | null = null;
  private encoder: Session | null = null;
  private decoder: Session | null = null;
  private unet: Session | null = null;
  private loading: Promise<void> | null = null;

  async load(onProgress?: Progress) {
    if (this.encoder && this.decoder && this.unet) return;
    if (this.loading) return this.loading;
    if (!('gpu' in navigator)) throw new Error('Moebius 0.22B 局部重绘需要支持 WebGPU 的浏览器');
    this.loading = this.loadInternal(onProgress).finally(() => { this.loading = null; });
    return this.loading;
  }

  private async loadInternal(onProgress?: Progress) {
    const ort = await import('onnxruntime-web/webgpu');
    this.ort = ort;
    const base = modelBaseUrl();
    const get = (file: string, label: string) => loadModelBytes(`${base}/${file}`, (loaded, total, cached) => onProgress?.(cached ? `${label} · 已缓存` : `下载 ${label}`, loaded, total));
    this.encoder = await ort.InferenceSession.create(await get('vae_encoder.onnx', 'VAE Encoder'), { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
    this.decoder = await ort.InferenceSession.create(await get('vae_decoder.onnx', 'VAE Decoder'), { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
    this.unet = await ort.InferenceSession.create(await get('unet.onnx', 'Moebius UNet'), { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
  }

  private async encode(chw: Float32Array) {
    const ort = this.ort!;
    const output = await this.encoder!.run({ image: new ort.Tensor('float32', chw, [1, 3, IMG, IMG]) });
    const moments = output.moments.data as Float32Array;
    const latent = new Float32Array(4 * LAT * LAT);
    for (let index = 0; index < latent.length; index += 1) latent[index] = moments[index] * SCALING_FACTOR;
    return latent;
  }

  private async decode(latent: Float32Array) {
    const ort = this.ort!;
    const scaled = new Float32Array(latent.length);
    for (let index = 0; index < latent.length; index += 1) scaled[index] = latent[index] / SCALING_FACTOR;
    const output = await this.decoder!.run({ latent: new ort.Tensor('float32', scaled, [1, 4, LAT, LAT]) });
    return chwToImageData(output.image.data as Float32Array);
  }

  private async predict(latent: Float32Array, mask: Float32Array, maskedLatent: Float32Array, timestep: number, guidance: number) {
    const ort = this.ort!;
    const plane = LAT * LAT;
    const nine = new Float32Array(9 * plane);
    nine.set(latent, 0);
    nine.set(mask, 4 * plane);
    nine.set(maskedLatent, 5 * plane);
    const batch = new Float32Array(2 * nine.length);
    batch.set(nine, 0);
    batch.set(nine, nine.length);
    const ids = new BigInt64Array(2 * HALF_IDS);
    for (let index = 0; index < HALF_IDS; index += 1) {
      ids[index] = BigInt(HALF_IDS + index);
      ids[HALF_IDS + index] = BigInt(index);
    }
    const output = await this.unet!.run({
      latent: new ort.Tensor('float32', batch, [2, 9, LAT, LAT]),
      timesteps: new ort.Tensor('int64', new BigInt64Array([BigInt(timestep), BigInt(timestep)]), [2]),
      input_ids: new ort.Tensor('int64', ids, [2, HALF_IDS]),
    });
    const noise = output.noise.data as Float32Array;
    const size = 4 * plane;
    const result = new Float32Array(size);
    for (let index = 0; index < size; index += 1) result[index] = noise[index] + guidance * (noise[size + index] - noise[index]);
    return result;
  }

  async run(imageCanvas: HTMLCanvasElement, maskCanvas: HTMLCanvasElement, options: MoebiusRunOptions = {}) {
    await this.load(options.onProgress);
    const steps = Math.max(8, Math.min(30, Math.round(options.steps ?? 20)));
    const guidance = Math.max(1, Math.min(5, options.guidance ?? 2));
    const seed = Math.round(options.seed ?? Math.random() * 0x7fffffff);
    const ddim = makeDdim(steps);
    options.onProgress?.('编码图片');
    const image = canvasToChw(imageCanvas);
    const mask = binaryMask(maskCanvas);
    const mask64 = latentMask(mask);
    const maskedLatent = await this.encode(maskedChw(image, mask));
    const plane = LAT * LAT;
    let latent = randn(4 * plane, seed);
    const offset = randn(4, seed ^ 0x9e3779b9);
    for (let channel = 0; channel < 4; channel += 1) for (let index = 0; index < plane; index += 1) latent[channel * plane + index] += NOISE_OFFSET * offset[channel];
    for (let index = 0; index < ddim.timesteps.length; index += 1) {
      const timestep = ddim.timesteps[index];
      const previous = index + 1 < ddim.timesteps.length ? ddim.timesteps[index + 1] : -1;
      options.onProgress?.(`局部重绘 ${index + 1}/${ddim.timesteps.length}`, index + 1, ddim.timesteps.length);
      latent = ddimStep(await this.predict(latent, mask64, maskedLatent, timestep, guidance), latent, timestep, previous, ddim);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    options.onProgress?.('解码结果');
    return blendResult(await this.decode(latent), imageCanvas, mask);
  }
}

const pipeline = new MoebiusPipeline();

export async function runMoebiusInpaint(asset: ImageAsset, strokes: InpaintStroke[], options: MoebiusRunOptions = {}) {
  if (!strokes.some((stroke) => stroke.points.length)) throw new Error('请先在图片上涂抹需要重绘的区域');
  const image = await loadImage(asset.blob);
  const fitted = toSquareCanvas(image, image.naturalWidth, image.naturalHeight);
  const mask = maskCanvas(strokes, image.naturalWidth, image.naturalHeight, fitted.rect);
  const result = await pipeline.run(fitted.canvas, mask, options);
  const output = document.createElement('canvas');
  output.width = image.naturalWidth;
  output.height = image.naturalHeight;
  const context = output.getContext('2d');
  if (!context) throw new Error('无法创建局部重绘输出画布');
  context.imageSmoothingQuality = 'high';
  context.drawImage(result, fitted.rect.x, fitted.rect.y, fitted.rect.w, fitted.rect.h, 0, 0, output.width, output.height);
  const blob = await canvasToBlob(output, 'image/png', 0.95);
  const base = asset.name.replace(/\.[^/.]+$/, '');
  const next = await createAssetFromBlob(blob, `${base}-inpaint.png`);
  next.originalWidth = asset.originalWidth;
  next.originalHeight = asset.originalHeight;
  next.metadata = asset.metadata;
  return next;
}
