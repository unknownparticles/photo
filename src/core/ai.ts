import type { AiAdapter, AiCapability, AiModelId, AiOperationOptions, AiTask, ImageAsset, ProcessedAsset } from '../types';
import { canvasToBlob, createAssetFromBlob, loadImage } from './image';
import { assembleUpscaled, type SingleChannelInfer } from './aiUpscale';

const AI_RESOURCE_REVISION = '28e9cf4f2034c8cde9a332d1c6e21faf60b0b218';
const ORT_WASM_VERSION = '1.27.0';
const DEFAULT_AI_RESOURCE_BASE_URL = `https://raw.githubusercontent.com/unknownparticles/photo/${AI_RESOURCE_REVISION}/resources/ai/`;
const DEFAULT_ORT_WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_WASM_VERSION}/dist/`;

function resourceBaseUrl(value: string | undefined, fallback: string) {
  const url = new URL(value?.trim() || fallback, document.baseURI).toString();
  return url.endsWith('/') ? url : `${url}/`;
}

const modelBaseUrl = resourceBaseUrl(import.meta.env.VITE_MODEL_BASE_URL, new URL('models/', DEFAULT_AI_RESOURCE_BASE_URL).toString());
const ortWasmBaseUrl = resourceBaseUrl(import.meta.env.VITE_ORT_WASM_BASE_URL, DEFAULT_ORT_WASM_BASE_URL);
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

async function readResponse(response: Response, onProgress?: (value: number) => void) {
  if (!response.body) {
    const data = await response.arrayBuffer();
    onProgress?.(0.48);
    return data;
  }
  const reader = response.body.getReader();
  const contentLength = Number(response.headers.get('content-length'));
  const chunks: Uint8Array[] = [];
  const data = Number.isFinite(contentLength) && contentLength > 0 ? new Uint8Array(contentLength) : null;
  let received = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    if (data) data.set(part.value, received);
    else chunks.push(part.value);
    received += part.value.byteLength;
    if (Number.isFinite(contentLength) && contentLength > 0) onProgress?.(0.12 + Math.min(1, received / contentLength) * 0.36);
  }
  if (data) {
    onProgress?.(0.48);
    return data.buffer;
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress?.(0.48);
  return merged.buffer;
}

function modnetInputSize(image: HTMLImageElement) {
  const reference = 512;
  let width: number;
  let height: number;
  if (Math.max(image.naturalWidth, image.naturalHeight) < reference || Math.min(image.naturalWidth, image.naturalHeight) > reference) {
    if (image.naturalWidth >= image.naturalHeight) {
      height = reference;
      width = Math.round((image.naturalWidth / image.naturalHeight) * reference);
    } else {
      width = reference;
      height = Math.round((image.naturalHeight / image.naturalWidth) * reference);
    }
  } else {
    width = image.naturalWidth;
    height = image.naturalHeight;
  }
  return { width: Math.max(32, width - (width % 32)), height: Math.max(32, height - (height % 32)) };
}

function inputChannels(session: InferenceSession) {
  const input = session.inputMetadata[0] as { dimensions?: Array<number | string>; shape?: Array<number | string> } | undefined;
  const channels = Number((input?.shape ?? input?.dimensions)?.[1]);
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
    if (shape.channels < 1) throw new Error('AI 模型没有可用的图像输出');
    for (let y = 0; y < shape.height; y += 1) for (let x = 0; x < shape.width; x += 1) {
      const index = (y * shape.width + x) * 4;
      const red = Math.round(outputValue(valueAt(output, shape, x, y, 0), range.min, range.max));
      pixels.data[index] = red;
      pixels.data[index + 1] = shape.channels > 1 ? Math.round(outputValue(valueAt(output, shape, x, y, 1), range.min, range.max)) : red;
      pixels.data[index + 2] = shape.channels > 2 ? Math.round(outputValue(valueAt(output, shape, x, y, 2), range.min, range.max)) : red;
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
  private forcedWasm = false;

  async capability(): Promise<AiCapability> {
    const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
    const wasm = typeof WebAssembly !== 'undefined';
    this.runtime = this.forcedWasm || !webgpu ? wasm ? 'wasm' : 'unavailable' : 'webgpu';
    return { webgpu, wasm, runtime: this.runtime, modelConfigured: Boolean(import.meta.env.VITE_MODEL_BASE_URL) };
  }

  private async session(modelId: AiModelId, onProgress?: (value: number) => void, runtimeOverride?: 'webgpu' | 'wasm') {
    const cached = this.sessions.get(modelId);
    if (cached) return cached;
    const capability = await this.capability();
    if (capability.runtime === 'unavailable') throw new Error('当前设备不支持本地 AI 运行环境');
    onProgress?.(0.12);
    const runtime = await import('onnxruntime-web');
    this.ort = runtime;
    runtime.env.wasm.wasmPaths = ortWasmBaseUrl;
    const url = modelUrl(modelId);
    let response: Response;
    try {
      response = await fetch(url, { cache: 'force-cache' });
    } catch {
      throw new Error(`模型无法访问：${url}。请检查模型目录、网络或 VITE_MODEL_BASE_URL 配置`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (response.status === 404 || contentType.includes('text/html')) {
      throw new Error(`缺少模型文件：${modelId}.onnx。请配置 VITE_MODEL_BASE_URL，或自托管 resources/ai/models/`);
    }
    if (!response.ok) throw new Error(`模型加载失败：HTTP ${response.status} · ${modelId}.onnx`);
    const modelData = await readResponse(response, onProgress);
    onProgress?.(0.52);
    const executionProviders = (runtimeOverride ?? capability.runtime) === 'webgpu' ? ['webgpu'] : ['wasm'];
    const next = await runtime.InferenceSession.create(modelData, { executionProviders, graphOptimizationLevel: 'all' });
    this.sessions.set(modelId, next);
    onProgress?.(1);
    return next;
  }

  private async switchToWasm(modelId: AiModelId, onProgress?: (value: number) => void) {
    const previous = this.sessions.get(modelId);
    this.sessions.delete(modelId);
    await previous?.release().catch(() => undefined);
    this.forcedWasm = true;
    return this.session(modelId, onProgress, 'wasm');
  }

  async load(modelId: AiOperationOptions['modelId'], onProgress?: (value: number) => void) {
    await this.session(modelId, onProgress);
  }

  private async inferSingleChannel(session: InferenceSession, plane: Float32Array, height: number, width: number): Promise<TensorOutput> {
    const runtime = this.ort;
    if (!runtime) throw new Error('本地 AI 运行环境尚未初始化');
    const tensor = new runtime.Tensor('float32', plane, [1, 1, height, width]);
    const outputs = await session.run({ [session.inputNames[0]]: tensor }) as Record<string, TensorOutput>;
    const output = outputs[session.outputNames[0]] as TensorOutput | undefined;
    if (!output) throw new Error('AI 模型没有返回图像结果');
    return output;
  }

  private async runUpscale(modelId: AiModelId, image: HTMLImageElement, signal?: AbortSignal): Promise<HTMLCanvasElement> {
    const session = await this.session(modelId);
    if (inputChannels(session) !== 1) throw new Error('当前超分模型不是单通道亮度模型，无法执行彩色超分');
    abortIfNeeded(signal);
    const factor = modelId === 'espcn-4x' ? 4 : 2;
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    const keepRatio = Math.max(Math.min(1, MAX_MODEL_OUTPUT_EDGE / (longest * factor)), 1 / factor);
    const sourceWidth = Math.max(1, Math.round(image.naturalWidth * keepRatio));
    const sourceHeight = Math.max(1, Math.round(image.naturalHeight * keepRatio));
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = sourceWidth;
    sourceCanvas.height = sourceHeight;
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceContext) throw new Error('当前浏览器无法创建 AI 输入画布');
    sourceContext.imageSmoothingEnabled = true;
    sourceContext.imageSmoothingQuality = 'high';
    sourceContext.drawImage(image, 0, 0, sourceWidth, sourceHeight);
    const pixels = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight).data;
    const infer: SingleChannelInfer = async (plane, tileHeight, tileWidth) => {
      abortIfNeeded(signal);
      const output = await this.inferSingleChannel(session, plane, tileHeight, tileWidth);
      return output.data as Float32Array;
    };
    const assembled = await assembleUpscaled({ data: pixels, width: sourceWidth, height: sourceHeight }, factor, infer);
    abortIfNeeded(signal);
    const resultCanvas = document.createElement('canvas');
    resultCanvas.width = assembled.width;
    resultCanvas.height = assembled.height;
    const resultContext = resultCanvas.getContext('2d');
    if (!resultContext) throw new Error('当前浏览器无法创建 AI 输出画布');
    const target = resultContext.createImageData(assembled.width, assembled.height);
    target.data.set(assembled.data);
    resultContext.putImageData(target, 0, 0);
    return resultCanvas;
  }

  async run(input: ImageAsset, options: AiOperationOptions, signal?: AbortSignal): Promise<ProcessedAsset> {
    abortIfNeeded(signal);
    let session = await this.session(options.modelId);
    const runtime = this.ort;
    if (!runtime) throw new Error('本地 AI 运行环境尚未初始化');
    const image = await loadImage(input.blob);
    const task = taskForModel(options.modelId);
    if (task === 'upscale') {
      let upscaled: HTMLCanvasElement;
      try {
        upscaled = await this.runUpscale(options.modelId, image, signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        if (this.runtime !== 'webgpu' || this.forcedWasm || typeof WebAssembly === 'undefined') throw error;
        await this.switchToWasm(options.modelId);
        upscaled = await this.runUpscale(options.modelId, image, signal);
      }
      abortIfNeeded(signal);
      const blob = await canvasToBlob(upscaled, 'image/png');
      return createAssetFromBlob(blob, `${input.name.replace(/\.[^/.]+$/, '')}-ESPCN${options.modelId === 'espcn-4x' ? 4 : 2}x.png`);
    }
    const size = modnetInputSize(image);
    const inputCanvas = document.createElement('canvas');
    inputCanvas.width = size.width;
    inputCanvas.height = size.height;
    const inputContext = inputCanvas.getContext('2d', { willReadFrequently: true });
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
      data[index] = channels === 1 ? (red + green + blue) / 3 * 2 - 1 : red * 2 - 1;
      if (channels === 3) {
        data[plane + index] = green * 2 - 1;
        data[plane * 2 + index] = blue * 2 - 1;
      }
    }
    const tensor = new runtime.Tensor('float32', data, [1, channels, size.height, size.width]);
    abortIfNeeded(signal);
    let outputs: Record<string, TensorOutput>;
    try {
      outputs = await session.run({ [session.inputNames[0]]: tensor }) as Record<string, TensorOutput>;
    } catch (error) {
      if (this.runtime !== 'webgpu' || this.forcedWasm || typeof WebAssembly === 'undefined') throw error;
      session = await this.switchToWasm(options.modelId);
      const wasmSize = modnetInputSize(image);
      const wasmCanvas = document.createElement('canvas');
      wasmCanvas.width = wasmSize.width;
      wasmCanvas.height = wasmSize.height;
      const wasmContext = wasmCanvas.getContext('2d', { willReadFrequently: true });
      if (!wasmContext) throw new Error('当前浏览器无法创建 AI 输入画布');
      wasmContext.drawImage(image, 0, 0, wasmSize.width, wasmSize.height);
      const wasmPixels = wasmContext.getImageData(0, 0, wasmSize.width, wasmSize.height).data;
      const wasmPlane = wasmSize.width * wasmSize.height;
      const wasmChannels = inputChannels(session);
      const wasmData = new Float32Array(wasmPlane * wasmChannels);
      for (let index = 0; index < wasmPlane; index += 1) {
        const red = wasmPixels[index * 4] / 255;
        const green = wasmPixels[index * 4 + 1] / 255;
        const blue = wasmPixels[index * 4 + 2] / 255;
        wasmData[index] = wasmChannels === 1 ? (red + green + blue) / 3 * 2 - 1 : red * 2 - 1;
        if (wasmChannels === 3) {
          wasmData[wasmPlane + index] = green * 2 - 1;
          wasmData[wasmPlane * 2 + index] = blue * 2 - 1;
        }
      }
      const wasmTensor = new runtime.Tensor('float32', wasmData, [1, wasmChannels, wasmSize.height, wasmSize.width]);
      outputs = await session.run({ [session.inputNames[0]]: wasmTensor }) as Record<string, TensorOutput>;
    }
    abortIfNeeded(signal);
    const output = outputs[session.outputNames[0]] as TensorOutput | undefined;
    if (!output) throw new Error('AI 模型没有返回图像结果');
    const outputImage = outputCanvas(output, task);
    const original = document.createElement('canvas');
    original.width = image.naturalWidth;
    original.height = image.naturalHeight;
    const originalContext = original.getContext('2d');
    if (!originalContext) throw new Error('当前浏览器无法创建抠图画布');
    originalContext.drawImage(image, 0, 0, original.width, original.height);
    originalContext.globalCompositeOperation = 'destination-in';
    originalContext.drawImage(outputImage, 0, 0, original.width, original.height);
    const blob = await canvasToBlob(original, 'image/png');
    return createAssetFromBlob(blob, `${input.name.replace(/\.[^/.]+$/, '')}-MODNet抠图.png`);
  }
}

export const aiAdapter = new LocalAiAdapter();
