import { toDataURL } from 'qrcode';
import { createAssetFromBlob, loadImage } from './image';
import type { ImageAsset } from '../types';

export interface QrCodeOptions {
  text: string;
  width: number;
  fgColor: string;
  bgColor: string;
  logo?: { dataUrl: string; size: number };
}

export async function generateQrCodeDataURL(options: QrCodeOptions): Promise<string> {
  const { text, width, fgColor, bgColor } = options;
  if (!text.trim()) throw new Error('二维码内容不能为空');
  const qrDataUrl = await toDataURL(text, {
    width,
    margin: 2,
    color: { dark: fgColor, light: bgColor },
    errorCorrectionLevel: 'M',
  });
  const qrImage = await loadImage(qrDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = width;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建画布');
  context.fillStyle = bgColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(qrImage, 0, 0, canvas.width, canvas.height);

  if (options.logo?.dataUrl) {
    const logoSize = Math.max(1, Math.round(width * Math.min(0.3, Math.max(0, options.logo.size))));
    const logoImage = await loadImage(options.logo.dataUrl);
    const logoHeight = Math.max(1, Math.round(logoSize * (logoImage.naturalHeight / Math.max(1, logoImage.naturalWidth))));
    const x = Math.round((canvas.width - logoSize) / 2);
    const y = Math.round((canvas.height - logoHeight) / 2);
    context.drawImage(logoImage, x, y, logoSize, logoHeight);
  }

  return canvas.toDataURL('image/png');
}

export async function generateQrCodeBlob(options: QrCodeOptions): Promise<Blob> {
  const dataUrl = await generateQrCodeDataURL(options);
  const response = await fetch(dataUrl);
  return response.blob();
}

export async function generateQrCodeAsset(options: QrCodeOptions): Promise<ImageAsset> {
  const blob = await generateQrCodeBlob(options);
  const name = options.text.trim().slice(0, 20).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, '-') || 'qrcode';
  return createAssetFromBlob(blob, `${name}.png`);
}
