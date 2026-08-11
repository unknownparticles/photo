import { describe, expect, it } from 'vitest';
import { extensionFor, replaceExtension, stripExtension, updateImageMetadata } from './image';

describe('图片文件名工具', () => {
  it('可以移除原始扩展名', () => {
    expect(stripExtension('旅行照片.final.jpg')).toBe('旅行照片.final');
  });

  it('可以替换输出扩展名', () => {
    expect(replaceExtension('poster.png', 'webp')).toBe('poster.webp');
  });

  it('可以映射导出格式扩展名', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/avif')).toBe('avif');
  });

  it('可以将常见信息写入 JPEG EXIF 段', async () => {
    const source = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
    const result = await updateImageMetadata(source, { Make: 'Alun', GPSLatitude: '31.2', GPSLongitude: '121.4' });
    const bytes = new Uint8Array(await result.arrayBuffer());
    expect(Array.from(bytes.slice(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xe1]);
    expect(new TextDecoder().decode(bytes.slice(6, 10))).toBe('Exif');
  });
});
