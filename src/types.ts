export type ToolId =
  | 'resize'
  | 'crop'
  | 'split'
  | 'merge'
  | 'compress'
  | 'convert'
  | 'matting'
  | 'cleanup'
  | 'ai-upscale'
  | 'edit'
  | 'watermark'
  | 'metadata'
  | 'batch'
  | 'gif'
  | 'id-photo';

export type ExportFormat = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif' | 'image/gif';

export interface Layer {
  id: string;
  name: string;
  type: string;
  blob: Blob;
  url: string;
  width: number;
  height: number;
  visible: boolean;
  offsetX: number;
  offsetY: number;
}

export interface PhotoDocument {
  id: string;
  name: string;
  type: string;
  createdAt: number;
  canvasWidth: number;
  canvasHeight: number;
  layers: Layer[];
  activeLayerId: string | null;
  edited: boolean;
  origin?: { baselineId: string; url: string; width: number; height: number };
  originMap?: { scaleX: number; scaleY: number; x: number; y: number };
}

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
  backgroundSourceBlob?: Blob;
  origin?: { assetId: string; url: string; width: number; height: number };
  originMap?: { scaleX: number; scaleY: number; x: number; y: number };
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
  targetColors?: [number, number, number][];
  seedX: number;
  seedY: number;
  seeds?: BackgroundBrushPoint[];
  tolerance: number;
  feather: number;
}

export interface BackgroundColorSample extends BackgroundBrushPoint {
  color: [number, number, number];
}

export interface IdPhotoMattingPreview {
  subject: ImageAsset;
  source: ImageAsset;
  targetColor: [number, number, number] | null;
  targetColors: [number, number, number][];
  subjectOffset?: { x: number; y: number };
  subjectScale?: number;
}

export interface IdPhotoClothingLayer {
  id: string;
  name: string;
  asset: ImageAsset;
  x: number;
  y: number;
  width: number;
  visible: boolean;
  placement: 'behind' | 'front';
}

export type BackgroundBrushMode = 'erase' | 'restore';

export interface BackgroundBrushPoint {
  x: number;
  y: number;
}

export interface BackgroundBrushStroke {
  mode: BackgroundBrushMode;
  size: number;
  points: BackgroundBrushPoint[];
}

export interface CleanupBrushStroke {
  mode: 'standard' | 'ai';
  size: number;
  points: BackgroundBrushPoint[];
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

export type BatchCropAlignment =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

export type BatchOptions =
  | { kind: 'matting'; sampling: 'largest' | 'center' | 'corners'; tolerance: number; feather: number }
  | { kind: 'crop'; width: number; height: number; alignment: BatchCropAlignment }
  | { kind: 'upscale'; scale: 2 | 4 }
  | { kind: 'rename'; template: string; start: number; digits: number }
  | { kind: 'compress'; format: 'image/jpeg' | 'image/webp'; quality: number };

export interface BatchProgress {
  running: boolean;
  completed: number;
  failed: number;
  total: number;
  currentName?: string;
}

export interface AiCapability {
  webgpu: boolean;
  wasm: boolean;
  modelConfigured: boolean;
  runtime: 'webgpu' | 'wasm' | 'unavailable';
}

export type AiTask = 'remove-background' | 'upscale';
export type AiModelId = 'modnet' | 'espcn-2x' | 'espcn-4x';

export type AiOperationOptions = {
  modelId: AiModelId;
  scale?: number;
  denoise?: number;
  sharpen?: number;
};

export type AiRequest =
  | { mode: 'model'; task: AiTask; scale?: 2 | 4; denoise?: number; sharpen?: number }
  | { mode: 'local-fallback'; task: 'upscale'; scale?: 2 | 4; denoise?: number; sharpen?: number };

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
