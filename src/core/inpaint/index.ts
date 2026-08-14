import { runMoebiusInpaint } from '../moebius';
import type { ImageAsset, ProcessedAsset } from '../../types';
import { miganAdapter } from './migan';
import type { InpaintEngineId, InpaintRunOptions, InpaintStroke } from './types';

export type { InpaintEngineId, InpaintMode, InpaintRunOptions, InpaintStroke } from './types';
export { miganAdapter } from './migan';

export const INPAINT_ENGINES = {
  migan: {
    id: 'migan' as const,
    label: 'MI-GAN 512',
    description: '默认智能重绘 · 约 28 MB',
  },
  moebius: {
    id: 'moebius' as const,
    label: 'Moebius 0.22B',
    description: '高质量重绘 · 约 1.24 GB',
  },
};

export async function runInpaint(engine: InpaintEngineId, asset: ImageAsset, strokes: InpaintStroke[], options: InpaintRunOptions = {}): Promise<ProcessedAsset> {
  if (engine === 'migan') return miganAdapter.run(asset, strokes, options);
  return runMoebiusInpaint(asset, strokes, options);
}
