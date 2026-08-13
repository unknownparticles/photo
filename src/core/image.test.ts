import { describe, expect, it } from 'vitest';
import { alignedCropRect, extensionFor, readJpegOrientation, replaceExtension, stripExtension, updateImageMetadata } from './image';

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

  it('可以读取 JPEG 的 EXIF 方向标记', () => {
    const bytes = new Uint8Array(40);
    const view = new DataView(bytes.buffer);
    bytes.set([0xff, 0xd8, 0xff, 0xe1], 0);
    view.setUint16(4, 34, false);
    bytes.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6);
    bytes.set([0x49, 0x49], 12);
    view.setUint16(14, 0x002a, true);
    view.setUint32(16, 8, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 0x0112, true);
    view.setUint16(24, 3, true);
    view.setUint32(26, 1, true);
    view.setUint16(30, 8, true);
    bytes.set([0xff, 0xda], 38);
    expect(readJpegOrientation(bytes)).toBe(8);
  });

  it('可以将常见信息写入 JPEG EXIF 段', async () => {
    const source = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
    const result = await updateImageMetadata(source, { Make: 'Alun', GPSLatitude: '31.2', GPSLongitude: '121.4' });
    const bytes = new Uint8Array(await result.arrayBuffer());
    expect(Array.from(bytes.slice(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xe1]);
    expect(new TextDecoder().decode(bytes.slice(6, 10))).toBe('Exif');
  });
});

describe('批量对齐裁剪', () => {
  it('按右下角定位裁剪区域', () => {
    expect(alignedCropRect(1200, 800, 400, 300, 'bottom-right')).toEqual({ x: 800, y: 500, width: 400, height: 300 });
  });

  it('目标超过原图时限制到原图并保持居中', () => {
    expect(alignedCropRect(320, 240, 800, 100, 'center')).toEqual({ x: 0, y: 70, width: 320, height: 100 });
  });
});
