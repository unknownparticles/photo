import { describe, expect, it } from 'vitest';
import { extensionFor, replaceExtension, stripExtension } from './image';

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
});
