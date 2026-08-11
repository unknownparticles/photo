export type ToolId =
  | 'resize'
  | 'crop'
  | 'split'
  | 'merge'
  | 'compress'
  | 'convert'
  | 'ai'
  | 'edit'
  | 'watermark'
  | 'metadata'
  | 'batch'
  | 'gif'
  | 'id-photo';

export type ExportFormat = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif' | 'image/gif';

export interface ImageAsset {
  id: string;
  name: string;
  type: string;
  size: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  blob: Blob;
  url: string;
  sourceFile?: File;
  metadata?: Record<string, unknown>;
}

export interface ProcessedAsset extends ImageAsset {
  operationLabel?: string;
}

export interface ImageOperation {
  id: string;
  type: string;
  params: Record<string, unknown>;
  createdAt: number;
}

export interface SplitLine {
  id: string;
  orientation: 'horizontal' | 'vertical';
  position: number;
}

export interface WatermarkOptions {
  kind: 'text' | 'image';
  text: string;
  opacity: number;
  position: string;
  x: number;
  y: number;
  width: number;
  color?: string;
  fontSize?: number;
  image?: ImageAsset;
}

export interface LocalBackgroundRemovalOptions {
  method: 'solid' | 'connected';
  targetColor: [number, number, number];
  seedX: number;
  seedY: number;
  tolerance: number;
  feather: number;
}

export interface ExportOptions {
  format: ExportFormat;
  quality: number;
  background: string;
  preserveTransparency: boolean;
  preserveMetadata: boolean;
  filename?: string;
}

export interface BatchJob {
  id: string;
  assetIds: string[];
  operation: ImageOperation;
  status: 'idle' | 'running' | 'done' | 'cancelled' | 'error';
  completed: number;
  failed: number;
}

export interface AiCapability {
  webgpu: boolean;
  wasm: boolean;
  modelConfigured: boolean;
  runtime: 'webgpu' | 'wasm' | 'unavailable';
}

export type AiTask = 'remove-background' | 'upscale' | 'enhance' | 'denoise';
export type AiModelId = 'upscale-2x' | 'upscale-4x' | 'remove-background' | 'enhance' | 'denoise';

export type AiOperationOptions = {
  modelId: AiModelId;
  scale?: number;
};

export type AiRequest =
  | { mode: 'model'; task: AiTask; scale?: 2 | 4 }
  | { mode: 'local-fallback'; task: Exclude<AiTask, 'remove-background'>; scale?: 2 | 4 };

export interface LocalProcessor {
  process(asset: ImageAsset, operation: ImageOperation, signal?: AbortSignal): Promise<ProcessedAsset>;
}

export interface Encoder {
  supports(format: ExportFormat): boolean;
  encode(asset: ProcessedAsset, options: ExportOptions): Promise<Blob>;
}

export interface AiAdapter {
  capability(): Promise<AiCapability>;
  load(modelId: AiOperationOptions['modelId'], onProgress?: (value: number) => void): Promise<void>;
  run(input: ImageAsset, options: AiOperationOptions, signal?: AbortSignal): Promise<ProcessedAsset>;
}
