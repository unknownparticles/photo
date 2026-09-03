import type { ImageAsset, Layer, PhotoDocument } from '../types';
import { canvasToBlob } from './image';

export function layerFromAsset(asset: ImageAsset, name?: string): Layer {
  return {
    id: crypto.randomUUID(),
    name: name ?? asset.name,
    type: asset.type,
    blob: asset.blob,
    url: asset.url,
    width: asset.width,
    height: asset.height,
    visible: true,
    offsetX: 0,
    offsetY: 0,
  };
}

export function documentFromAsset(asset: ImageAsset): PhotoDocument {
  const layer = layerFromAsset(asset);
  return {
    id: crypto.randomUUID(),
    name: asset.name,
    type: asset.type,
    createdAt: Date.now(),
    canvasWidth: asset.width,
    canvasHeight: asset.height,
    layers: [layer],
    activeLayerId: layer.id,
    edited: false,
    origin: { baselineId: layer.id, url: asset.url, width: asset.width, height: asset.height },
    originMap: { scaleX: 1, scaleY: 1, x: 0, y: 0 },
  };
}

export function topmostVisibleLayer(document: PhotoDocument): Layer | null {
  for (let index = document.layers.length - 1; index >= 0; index -= 1) {
    if (document.layers[index].visible) return document.layers[index];
  }
  return null;
}

export async function flattenDocument(doc: PhotoDocument): Promise<ImageAsset> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, doc.canvasWidth);
  canvas.height = Math.max(1, doc.canvasHeight);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建画布');
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(`图层 ${layer.name} 解码失败`));
      element.src = layer.url;
    });
    context.save();
    context.globalAlpha = layer.opacity ?? 1;
    context.translate(layer.offsetX + layer.width / 2, layer.offsetY + layer.height / 2);
    context.rotate((layer.rotation ?? 0) * Math.PI / 180);
    context.scale(layer.scaleX ?? 1, layer.scaleY ?? 1);
    context.drawImage(image, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
    context.restore();
  }
  const blob = await canvasToBlob(canvas, 'image/png');
  const url = URL.createObjectURL(blob);
  return {
    id: doc.id,
    name: doc.name,
    type: 'image/png',
    size: blob.size,
    width: canvas.width,
    height: canvas.height,
    originalWidth: doc.origin?.width ?? canvas.width,
    originalHeight: doc.origin?.height ?? canvas.height,
    blob,
    url,
  };
}
