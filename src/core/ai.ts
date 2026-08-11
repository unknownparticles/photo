import type { AiAdapter, AiCapability, AiOperationOptions, ImageAsset, ProcessedAsset } from '../types';

const modelBaseUrl = import.meta.env.VITE_MODEL_BASE_URL ?? '/photo/models';

export class LocalAiAdapter implements AiAdapter {
  private runtime: 'webgpu' | 'wasm' | 'unavailable' = 'unavailable';

  async capability(): Promise<AiCapability> {
    const webgpu = 'gpu' in navigator;
    const wasm = typeof WebAssembly !== 'undefined';
    this.runtime = webgpu ? 'webgpu' : wasm ? 'wasm' : 'unavailable';
    return { webgpu, wasm, runtime: this.runtime, modelConfigured: Boolean(import.meta.env.VITE_MODEL_BASE_URL) };
  }

  async load(modelId: AiOperationOptions['modelId'], onProgress?: (value: number) => void) {
    const capability = await this.capability();
    if (capability.runtime === 'unavailable') throw new Error('当前设备不支持本地 AI 运行环境');
    onProgress?.(0.15);
    const runtime = await import('onnxruntime-web');
    runtime.env.wasm.wasmPaths = `${modelBaseUrl}/wasm/`;
    const response = await fetch(`${modelBaseUrl}/${modelId}.onnx`, { method: 'HEAD' });
    if (!response.ok) throw new Error(`模型文件未配置：${modelId}.onnx`);
    onProgress?.(1);
  }

  async run(_input: ImageAsset, options: AiOperationOptions): Promise<ProcessedAsset> {
    await this.load(options.modelId);
    throw new Error('模型适配器已就绪，但当前模型尚未绑定推理图输入输出');
  }
}

export const aiAdapter = new LocalAiAdapter();
