import type { AiAdapter, AiCapability, AiModelId, AiOperationOptions, AiTask, ImageAsset, ProcessedAsset } from '../types';
import { canvasToBlob, createAssetFromBlob, loadImage } from './image';

const modelBaseUrl = import.meta.env.VITE_MODEL_BASE_URL?.trim() || new URL('models/', document.baseURI).toString();
const MAX_MODEL_INPUT_EDGE = 1024;
const MAX_MODEL_OUTPUT_EDGE = 8192;

type OnnxRuntime = typeof import('onnxruntime-web');
type InferenceSession = Awaited<ReturnType<OnnxRuntime['InferenceSession']['create']>>;
type TensorOutput = { data: Float32Array | Uint8Array | Int32Array; dims: readonly number[] };

function modelUrl(modelId: AiModelId) {
  return new URL(`${modelId}.onnx`, modelBaseUrl.endsWith('/') ? modelBaseUrl : `${modelBaseUrl}/`).toString();
}

function taskForModel(modelId: AiModelId): AiTask {
  return modelId === 'modnet' ? 'remove-background' : 'upscale';
}

function clamp(value: number, min = 0, max = 255) {
  return Math.max(min, Math.min(max, value));
}

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('AI 处理已取消', 'AbortError');
}

function finiteDimension(value: number | string | undefined, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(MAX_MODEL_INPUT_EDGE, Math.round(parsed)) : fallback;
}

function outputValue(value: number, min: number, max: number) {
  if (min < -0.05 && max <= 1.1) return clamp((value + 1) * 127.5);
  if (max <= 1.5) return clamp(value * 255);
  return clamp(value);
}

function outputShape(dims: readonly number[]) {
  if (dims.length !== 4) throw new Error('AI 模型输出必须是四维图像张量');
  if (dims[1] === 1 || dims[1] === 2 || dims[1] === 3 || dims[1] === 4) return { layout: 'nchw' as const, channels: dims[1], height: dims[2], width: dims[3] };
  if (dims[3] === 1 || dims[3] === 2 || dims[3] === 3 || dims[3] === 4) return { layout: 'nhwc' as const, channels: dims[3], height: dims[1], width: dims[2] };
  throw new Error('AI 模型输出通道格式无法识别');
}

function valueAt(output: TensorOutput, shape: ReturnType<typeof outputShape>, x: number, y: number, channel: number) {
  if (shape.layout === 'nchw') return Number(output.data[channel * shape.width * shape.height + y * shape.width + x]);
  return Number(output.data[(y * shape.width + x) * shape.channels + channel]);
}

function outputRange(output: TensorOutput) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of output.data) {
    min = Math.min(min, Number(value));
    max = Math.max(max, Number(value));
  }
  return { min, max };
}

function inputSize(session: InferenceSession, image: HTMLImageElement) {
  const input = session.inputMetadata[0] as { dimensions?: Array<number | string> } | undefined;
  const dimensions = input?.dimensions ?? [];
  const fallbackScale = Math.min(1, MAX_MODEL_INPUT_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const fallbackWidth = Math.max(1, Math.round(image.naturalWidth * fallbackScale));
  const fallbackHeight = Math.max(1, Math.round(image.naturalHeight * fallbackScale));
  return {
    width: finiteDimension(dimensions[3], fallbackWidth),
    height: finiteDimension(dimensions[2], fallbackHeight),
  };
}

function inputChannels(session: InferenceSession) {
  const input = session.inputMetadata[0] as { dimensions?: Array<number | string> } | undefined;
  const channels = Number(input?.dimensions?.[1]);
  return channels === 1 ? 1 : 3;
}

function outputCanvas(output: TensorOutput, task: AiTask) {
  const shape = outputShape(output.dims);
  if (shape.width < 1 || shape.height < 1 || shape.width > MAX_MODEL_OUTPUT_EDGE || shape.height > MAX_MODEL_OUTPUT_EDGE) throw new Error('AI 模型输出尺寸不可用');
  const range = outputRange(output);
  const canvas = document.createElement('canvas');
  canvas.width = shape.width;
  canvas.height = shape.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建 AI 输出画布');
  const pixels = context.createImageData(shape.width, shape.height);
  if (task === 'remove-background' && shape.channels < 3) {
    for (let y = 0; y < shape.height; y += 1) for (let x = 0; x < shape.width; x += 1) {
      const alpha = outputValue(valueAt(output, shape, x, y, 0), range.min, range.max);
      const index = (y * shape.width + x) * 4;
      pixels.data[index] = 255;
      pixels.data[index + 1] = 255;
      pixels.data[index + 2] = 255;
      pixels.data[index + 3] = Math.round(alpha);
    }
  } else {
    if (shape.channels < 3) throw new Error('AI 模型没有可用的 RGB 输出');
    for (let y = 0; y < shape.height; y += 1) for (let x = 0; x < shape.width; x += 1) {
      const index = (y * shape.width + x) * 4;
      pixels.data[index] = Math.round(outputValue(valueAt(output, shape, x, y, 0), range.min, range.max));
      pixels.data[index + 1] = Math.round(outputValue(valueAt(output, shape, x, y, 1), range.min, range.max));
      pixels.data[index + 2] = Math.round(outputValue(valueAt(output, shape, x, y, 2), range.min, range.max));
      pixels.data[index + 3] = shape.channels > 3 ? Math.round(outputValue(valueAt(output, shape, x, y, 3), range.min, range.max)) : 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

export class LocalAiAdapter implements AiAdapter {
  private runtime: 'webgpu' | 'wasm' | 'unavailable' = 'unavailable';
  private ort: OnnxRuntime | null = null;
  private sessions = new Map<AiModelId, InferenceSession>();

  async capability(): Promise<AiCapability> {
    const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
    const wasm = typeof WebAssembly !== 'undefined';
    this.runtime = webgpu ? 'webgpu' : wasm ? 'wasm' : 'unavailable';
    return { webgpu, wasm, runtime: this.runtime, modelConfigured: Boolean(import.meta.env.VITE_MODEL_BASE_URL) };
  }

  private async session(modelId: AiModelId, onProgress?: (value: number) => void) {
    const cached = this.sessions.get(modelId);
    if (cached) return cached;
    const capability = await this.capability();
    if (capability.runtime === 'unavailable') throw new Error('当前设备不支持本地 AI 运行环境');
    onProgress?.(0.12);
    const runtime = await import('onnxruntime-web');
    this.ort = runtime;
    runtime.env.wasm.wasmPaths = `${modelBaseUrl}/wasm/`;
    const url = modelUrl(modelId);
    let response: Response;
    try {
      response = await fetch(url, { cache: 'force-cache' });
    } catch {
      throw new Error(`模型无法访问：${url}。请检查模型目录、网络或 VITE_MODEL_BASE_URL 配置`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (response.status === 404 || contentType.includes('text/html')) {
      throw new Error(`缺少模型文件：${modelId}.onnx。请将它放入 public/models/，或配置 VITE_MODEL_BASE_URL`);
    }
    if (!response.ok) throw new Error(`模型加载失败：HTTP ${response.status} · ${modelId}.onnx`);
    const modelData = await response.arrayBuffer();
    onProgress?.(0.3);
    const executionProviders = capability.runtime === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];
    const next = await runtime.InferenceSession.create(modelData, { executionProviders, graphOptimizationLevel: 'all' });
    this.sessions.set(modelId, next);
    onProgress?.(1);
    return next;
  }

  async load(modelId: AiOperationOptions['modelId'], onProgress?: (value: number) => void) {
    await this.session(modelId, onProgress);
  }

  async run(input: ImageAsset, options: AiOperationOptions, signal?: AbortSignal): Promise<ProcessedAsset> {
    abortIfNeeded(signal);
    const session = await this.session(options.modelId);
    const runtime = this.ort;
    if (!runtime) throw new Error('本地 AI 运行环境尚未初始化');
    const image = await loadImage(input.blob);
    const size = inputSize(session, image);
    const inputCanvas = document.createElement('canvas');
    inputCanvas.width = size.width;
    inputCanvas.height = size.height;
    const inputContext = inputCanvas.getContext('2d');
    if (!inputContext) throw new Error('当前浏览器无法创建 AI 输入画布');
    inputContext.drawImage(image, 0, 0, size.width, size.height);
    const pixels = inputContext.getImageData(0, 0, size.width, size.height).data;
    const plane = size.width * size.height;
    const channels = inputChannels(session);
    const data = new Float32Array(plane * channels);
    for (let index = 0; index < plane; index += 1) {
      const red = pixels[index * 4] / 255;
      const green = pixels[index * 4 + 1] / 255;
      const blue = pixels[index * 4 + 2] / 255;
      data[index] = channels === 1 ? (red + green + blue) / 3 : red;
      if (channels === 3) {
        data[plane + index] = green;
        data[plane * 2 + index] = blue;
      }
    }
    const tensor = new runtime.Tensor('float32', data, [1, channels, size.height, size.width]);
    abortIfNeeded(signal);
    const outputs = await session.run({ [session.inputNames[0]]: tensor });
    abortIfNeeded(signal);
    const output = outputs[session.outputNames[0]] as TensorOutput | undefined;
    if (!output) throw new Error('AI 模型没有返回图像结果');
    const task = taskForModel(options.modelId);
    const outputImage = outputCanvas(output, task);
    if (task === 'remove-background') {
      const original = document.createElement('canvas');
      original.width = outputImage.width;
      original.height = outputImage.height;
      const originalContext = original.getContext('2d');
      if (!originalContext) throw new Error('当前浏览器无法创建抠图画布');
      originalContext.drawImage(image, 0, 0, original.width, original.height);
      originalContext.globalCompositeOperation = 'destination-in';
      originalContext.drawImage(outputImage, 0, 0);
      const blob = await canvasToBlob(original, 'image/png');
      return createAssetFromBlob(blob, `${input.name.replace(/\.[^/.]+$/, '')}-MODNet抠图.png`);
    }
    const blob = await canvasToBlob(outputImage, 'image/png');
    const scale = options.modelId === 'espcn-4x' ? 4 : 2;
    return createAssetFromBlob(blob, `${input.name.replace(/\.[^/.]+$/, '')}-ESPCN${scale}x.png`);
  }
}

export const aiAdapter = new LocalAiAdapter();
