import { canvasToBlob, createAssetFromBlob, loadImage } from '../image';
import type { ImageAsset, ProcessedAsset } from '../../types';
import { clearCachedModel, loadCachedModel, modelCacheInfo } from './cache';
import { parseSemanticPrompt } from './semantic';
import type { InpaintAdapter, InpaintCapability, InpaintRunOptions, InpaintStroke } from './types';

const MIGAN_MODEL_BYTES = 28_079_181;
const MIGAN_MODEL_REVISION = '1538c135034b8cfe7a8472f34d09c8a5a45b17a7';
const DEFAULT_MIGAN_MODEL_URL = `https://huggingface.co/andraniksargsyan/migan/resolve/${MIGAN_MODEL_REVISION}/migan_pipeline_v2.onnx`;

type Ort = typeof import('onnxruntime-web/webgpu');
type Session = Awaited<ReturnType<Ort['InferenceSession']['create']>>;

function modelUrl() {
  return import.meta.env.VITE_MIGAN_MODEL_URL?.trim() || DEFAULT_MIGAN_MODEL_URL;
}

function ortWasmBaseUrl() {
  const override = import.meta.env.VITE_ORT_WASM_BASE_URL?.trim();
  if (override) return override.endsWith('/') ? override : `${override}/`;
  if (typeof window === 'undefined') return `${import.meta.env.BASE_URL}ort/`;
  return new URL(`${import.meta.env.BASE_URL}ort/`, window.location.origin).href;
}

function imageToChw(pixels: Uint8ClampedArray, width: number, height: number) {
  const plane = width * height;
  const output = new Uint8Array(plane * 3);
  for (let index = 0; index < plane; index += 1) {
    output[index] = pixels[index * 4];
    output[plane + index] = pixels[index * 4 + 1];
    output[plane * 2 + index] = pixels[index * 4 + 2];
  }
  return output;
}

function maskToChw(strokes: InpaintStroke[], width: number, height: number, maskGrowPx = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建 MI-GAN 蒙版画布');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#000';
  context.fillStyle = '#000';
  context.lineCap = 'round';
  context.lineJoin = 'round';

  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    context.lineWidth = Math.max(1, stroke.size + maskGrowPx * 2);
    const first = stroke.points[0];
    const x = first.x * width;
    const y = first.y * height;
    if (stroke.points.length === 1) {
      context.beginPath();
      context.arc(x, y, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
      continue;
    }
    context.beginPath();
    context.moveTo(x, y);
    for (const point of stroke.points.slice(1)) context.lineTo(point.x * width, point.y * height);
    context.stroke();
  }

  const pixels = context.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) mask[index] = pixels[index * 4] >= 128 ? 255 : 0;
  return mask;
}

function outputToCanvas(data: Uint8Array, width: number, height: number, original: Uint8ClampedArray) {
  const plane = width * height;
  if (data.length < plane * 3) throw new Error('MI-GAN 输出尺寸异常');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建 MI-GAN 输出画布');
  const image = context.createImageData(width, height);
  for (let index = 0; index < plane; index += 1) {
    image.data[index * 4] = data[index];
    image.data[index * 4 + 1] = data[plane + index];
    image.data[index * 4 + 2] = data[plane * 2 + index];
    image.data[index * 4 + 3] = original[index * 4 + 3];
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

class MiganAdapter implements InpaintAdapter {
  readonly id = 'migan' as const;
  readonly label = 'MI-GAN 512';
  readonly description = '约 28 MB 的浏览器端智能局部重绘模型';
  readonly installSizeBytes = MIGAN_MODEL_BYTES;
  private ort: Ort | null = null;
  private session: Session | null = null;
  private loading: Promise<void> | null = null;

  async capability(): Promise<InpaintCapability> {
    const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
    const wasm = typeof WebAssembly !== 'undefined';
    const cache = await modelCacheInfo(modelUrl());
    return {
      supported: webgpu || wasm,
      runtime: webgpu ? 'webgpu' : wasm ? 'wasm' : 'unavailable',
      installed: cache.cached,
      installSizeBytes: cache.bytes || MIGAN_MODEL_BYTES,
      reason: webgpu || wasm ? undefined : '当前浏览器不支持 WebGPU 或 WebAssembly',
    };
  }

  private async load(onProgress?: InpaintRunOptions['onProgress']) {
    if (this.session) return;
    if (this.loading) return this.loading;
    this.loading = this.loadInternal(onProgress).finally(() => { this.loading = null; });
    return this.loading;
  }

  private async loadInternal(onProgress?: InpaintRunOptions['onProgress']) {
    const capability = await this.capability();
    if (!capability.supported) throw new Error(capability.reason || '当前浏览器无法运行 MI-GAN');
    const ort = await import('onnxruntime-web/webgpu');
    this.ort = ort;

    // Keep the WASM helper module and binary on the same origin as the app. Cross-origin
    // dynamic module imports are commonly blocked by CSP, browser privacy settings or PWA
    // deployments and surface as "no available backend found".
    ort.env.wasm.wasmPaths = ortWasmBaseUrl();
    ort.env.wasm.numThreads = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
      ? Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 4))
      : 1;
    ort.env.wasm.proxy = false;

    const bytes = await loadCachedModel(modelUrl(), (loaded, total, cached) => {
      onProgress?.(cached ? 'MI-GAN 模型已缓存' : '下载 MI-GAN 模型', loaded, total || MIGAN_MODEL_BYTES);
    });
    onProgress?.('初始化 MI-GAN');
    const preferred = capability.runtime === 'webgpu' ? 'webgpu' : 'wasm';
    try {
      this.session = await ort.InferenceSession.create(bytes, { executionProviders: [preferred], graphOptimizationLevel: 'all' });
    } catch (error) {
      if (preferred !== 'webgpu' || typeof WebAssembly === 'undefined') {
        throw new Error(`MI-GAN ${preferred.toUpperCase()} 后端初始化失败：${error instanceof Error ? error.message : String(error)}`);
      }
      onProgress?.('WebGPU 初始化失败，切换 WASM');
      try {
        this.session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      } catch (wasmError) {
        throw new Error(`MI-GAN 本地运行时初始化失败：${wasmError instanceof Error ? wasmError.message : String(wasmError)}`);
      }
    }
  }

  async clearCache() {
    await clearCachedModel(modelUrl());
  }

  async run(asset: ImageAsset, strokes: InpaintStroke[], options: InpaintRunOptions = {}): Promise<ProcessedAsset> {
    if (!strokes.some((stroke) => stroke.points.length)) throw new Error('请先在图片上涂抹需要重绘的区域');
    await this.load(options.onProgress);
    const session = this.session;
    const ort = this.ort;
    if (!session || !ort) throw new Error('MI-GAN 尚未初始化');

    const semantic = parseSemanticPrompt(options.prompt);
    if (semantic.normalized) options.onProgress?.(`语义提示：${semantic.label}`);
    options.onProgress?.('准备 MI-GAN 输入');
    const source = await loadImage(asset.blob);
    const width = source.naturalWidth;
    const height = source.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建 MI-GAN 输入画布');
    context.drawImage(source, 0, 0, width, height);
    const original = context.getImageData(0, 0, width, height).data;
    const imageData = imageToChw(original, width, height);
    const maskData = maskToChw(strokes, width, height, semantic.maskGrowPx);

    const imageName = session.inputNames.find((name) => name.toLowerCase().includes('image')) ?? session.inputNames[0];
    const maskName = session.inputNames.find((name) => name.toLowerCase().includes('mask')) ?? session.inputNames[1];
    if (!imageName || !maskName) throw new Error('MI-GAN 输入节点无法识别');

    options.onProgress?.('MI-GAN 智能重绘');
    const results = await session.run({
      [imageName]: new ort.Tensor('uint8', imageData, [1, 3, height, width]),
      [maskName]: new ort.Tensor('uint8', maskData, [1, 1, height, width]),
    });
    const outputName = session.outputNames[0];
    const output = outputName ? results[outputName] : undefined;
    if (!output) throw new Error('MI-GAN 没有返回图像结果');
    const resultCanvas = outputToCanvas(output.data as Uint8Array, width, height, original);
    const blob = await canvasToBlob(resultCanvas, 'image/png', 0.95);
    const base = asset.name.replace(/\.[^/.]+$/, '');
    const next = await createAssetFromBlob(blob, `${base}-inpaint.png`);
    next.originalWidth = asset.originalWidth;
    next.originalHeight = asset.originalHeight;
    next.metadata = asset.metadata;
    options.onProgress?.('局部重绘完成', 1, 1);
    return { ...next, operationLabel: semantic.normalized ? `MI-GAN · ${semantic.label}` : 'MI-GAN 局部重绘' };
  }
}

export const miganAdapter = new MiganAdapter();
