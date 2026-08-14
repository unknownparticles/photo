import type { ImageAsset, ProcessedAsset } from '../../types';

export type InpaintMode = 'fast' | 'smart' | 'hq';
export type InpaintEngineId = 'migan' | 'moebius';
export type InpaintRuntime = 'webgpu' | 'wasm' | 'unavailable';

export interface InpaintStrokePoint {
  x: number;
  y: number;
}

export interface InpaintStroke {
  size: number;
  points: InpaintStrokePoint[];
}

export interface InpaintProgress {
  stage: string;
  loaded?: number;
  total?: number;
}

export interface InpaintRunOptions {
  steps?: number;
  guidance?: number;
  seed?: number;
  prompt?: string;
  onProgress?: (stage: string, loaded?: number, total?: number) => void;
}

export interface InpaintCapability {
  supported: boolean;
  runtime: InpaintRuntime;
  installed: boolean;
  installSizeBytes: number;
  reason?: string;
}

export interface InpaintAdapter {
  id: InpaintEngineId;
  label: string;
  description: string;
  installSizeBytes: number;
  capability(): Promise<InpaintCapability>;
  run(asset: ImageAsset, strokes: InpaintStroke[], options?: InpaintRunOptions): Promise<ProcessedAsset>;
  clearCache?(): Promise<void>;
}
