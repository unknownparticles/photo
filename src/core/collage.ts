import type { ImageAsset } from '../types';
import { canvasToBlob, loadImage } from './image';

export interface CollageLayer {
  asset: ImageAsset;
  offsetX: number;
  offsetY: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
}

export interface CollageParams {
  canvasWidth: number;
  canvasHeight: number;
  background: string;
  layers: CollageLayer[];
}

export async function composeCollage(params: CollageParams): Promise<Blob> {
  const { canvasWidth, canvasHeight, background, layers } = params;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, canvasWidth);
  canvas.height = Math.max(1, canvasHeight);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建画布');

  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (const layer of layers) {
    const image = await loadImage(layer.asset.blob);
    context.save();
    context.globalAlpha = layer.opacity ?? 1;
    context.translate(layer.offsetX + layer.width / 2, layer.offsetY + layer.height / 2);
    context.rotate((layer.rotation ?? 0) * Math.PI / 180);
    context.scale(layer.scaleX ?? 1, layer.scaleY ?? 1);
    context.drawImage(image, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
    context.restore();
  }

  return canvasToBlob(canvas, 'image/png');
}
