import { describe, expect, it } from 'vitest';
import { assembleUpscaled, bleedTransparentPixels, hasMeaningfulAlpha, planUpscaleTiles, UPSCALE_TILE_EDGE, UPSCALE_TILE_OVERLAP, type RgbaImage } from './aiUpscale';

function solidImage(width: number, height: number, red: number, green: number, blue: number, alpha = 255): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = red;
    data[index * 4 + 1] = green;
    data[index * 4 + 2] = blue;
    data[index * 4 + 3] = alpha;
  }
  return { data, width, height };
}

function pixelAt(image: RgbaImage, x: number, y: number) {
  const offset = (y * image.width + x) * 4;
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2], image.data[offset + 3]] as const;
}

async function replicateInfer(plane: Float32Array, tileHeight: number, tileWidth: number, factor: number) {
  const outHeight = tileHeight * factor;
  const outWidth = tileWidth * factor;
  const output = new Float32Array(outHeight * outWidth);
  for (let y = 0; y < outHeight; y += 1) for (let x = 0; x < outWidth; x += 1) {
    output[y * outWidth + x] = plane[((y / factor) | 0) * tileWidth + ((x / factor) | 0)];
  }
  return output;
}

function makeInfer(factor: number) {
  return (plane: Float32Array, tileHeight: number, tileWidth: number) => replicateInfer(plane, tileHeight, tileWidth, factor);
}

describe('超分透明通道处理', () => {
  it('识别含透明像素的图片', () => {
    const opaque = solidImage(2, 2, 10, 20, 30).data;
    expect(hasMeaningfulAlpha(opaque)).toBe(false);
    const transparent = solidImage(2, 2, 10, 20, 30).data;
    transparent[3] = 0;
    expect(hasMeaningfulAlpha(transparent)).toBe(true);
  });

  it('透明区域渗入相邻颜色，避免黑边', () => {
    const image = solidImage(3, 3, 200, 40, 40);
    for (let y = 0; y < 3; y += 1) {
      const offset = (y * 3 + 2) * 4;
      image.data[offset] = 0;
      image.data[offset + 1] = 0;
      image.data[offset + 2] = 0;
      image.data[offset + 3] = 0;
    }
    bleedTransparentPixels(image.data, 3, 3);
    const [red, green, blue, alpha] = pixelAt(image, 2, 1);
    expect([red, green, blue]).toEqual([200, 40, 40]);
    expect(alpha).toBe(0);
  });

  it('超分后保留 alpha 而不是全部变不透明', async () => {
    const source = solidImage(8, 8, 220, 60, 30);
    for (let y = 0; y < 2; y += 1) for (let x = 5; x < 8; x += 1) {
      const offset = (y * 8 + x) * 4;
      source.data[offset] = 99;
      source.data[offset + 1] = 77;
      source.data[offset + 2] = 55;
      source.data[offset + 3] = 0;
    }
    const result = await assembleUpscaled(source, 2, makeInfer(2));
    const [holeRed, holeGreen, holeBlue, holeAlpha] = pixelAt(result, 12, 1);
    expect(holeAlpha).toBe(0);
    expect(Math.abs(holeRed - 220)).toBeLessThanOrEqual(2);
    expect(holeGreen).toBe(60);
    expect(holeBlue).toBe(30);
    const [bodyRed, bodyGreen, bodyBlue, bodyAlpha] = pixelAt(result, 2, 2);
    expect(Math.abs(bodyRed - 220)).toBeLessThanOrEqual(2);
    expect([bodyGreen, bodyBlue]).toEqual([60, 30]);
    expect(bodyAlpha).toBe(255);
  });
});

describe('超分色彩与尺寸', () => {
  it('输出尺寸等于输入乘以倍率', async () => {
    const result = await assembleUpscaled(solidImage(6, 4, 1, 2, 3), 4, makeInfer(4));
    expect(result.width).toBe(24);
    expect(result.height).toBe(16);
    expect(result.data.length).toBe(24 * 16 * 4);
  });

  it('彩色图片不再变成黑白', async () => {
    const width = 16;
    const height = 8;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const isRed = x < width / 2;
      data[offset] = isRed ? 230 : 25;
      data[offset + 1] = isRed ? 45 : 90;
      data[offset + 2] = isRed ? 35 : 240;
      data[offset + 3] = 255;
    }
    const result = await assembleUpscaled({ data, width, height }, 2, makeInfer(2));
    expect(result.width).toBe(32);
    const [leftRed, leftGreen, leftBlue] = pixelAt(result, 4, 4);
    expect(leftRed - leftGreen).toBeGreaterThan(120);
    expect(leftRed - leftBlue).toBeGreaterThan(120);
    const [rightRed, rightGreen, rightBlue] = pixelAt(result, 24, 4);
    expect(rightBlue - rightRed).toBeGreaterThan(120);
    expect(rightBlue - rightGreen).toBeGreaterThan(80);
  });

  it('中性灰经过 YCbCr 往返保持不变', async () => {
    const result = await assembleUpscaled(solidImage(4, 4, 128, 128, 128), 2, makeInfer(2));
    for (const [x, y] of [[1, 1], [5, 3], [7, 7]] as const) {
      const [red, green, blue] = pixelAt(result, x, y);
      expect(Math.abs(red - 128)).toBeLessThanOrEqual(2);
      expect(Math.abs(green - 128)).toBeLessThanOrEqual(2);
      expect(Math.abs(blue - 128)).toBeLessThanOrEqual(2);
    }
  });

  it('纯色区域在分块拼接后保持一致', async () => {
    const size = UPSCALE_TILE_EDGE + 100;
    const result = await assembleUpscaled(solidImage(size, size, 180, 60, 130), 2, makeInfer(2));
    const samples: Array<readonly [number, number]> = [[1, 1], [(size * 2) / 2, (size * 2) / 2], [size * 2 - 2, size * 2 - 2], [size + 50, 30]];
    for (const [x, y] of samples) {
      const [red, green, blue] = pixelAt(result, Math.floor(x), Math.floor(y));
      expect(Math.abs(red - 180)).toBeLessThanOrEqual(3);
      expect(Math.abs(green - 60)).toBeLessThanOrEqual(3);
      expect(Math.abs(blue - 130)).toBeLessThanOrEqual(3);
    }
  });
});

describe('超分分块规划', () => {
  it('核心区域无缝覆盖整张图且带重叠上下文', () => {
    const step = UPSCALE_TILE_EDGE - UPSCALE_TILE_OVERLAP * 2;
    const width = step * 2 + 37;
    const tiles = planUpscaleTiles(width, width);
    const coreOwner = new Int32Array(width * width).fill(-1);
    tiles.forEach((tile, tileIndex) => {
      const coreRight = Math.min(tile.right, tile.x0 + step);
      const coreBottom = Math.min(tile.bottom, tile.y0 + step);
      expect(tile.left).toBe(Math.max(0, tile.x0 - UPSCALE_TILE_OVERLAP));
      expect(coreRight - tile.x0).toBeGreaterThan(0);
      for (let y = tile.y0; y < coreBottom; y += 1) for (let x = tile.x0; x < coreRight; x += 1) {
        expect(coreOwner[y * width + x]).toBe(-1);
        coreOwner[y * width + x] = tileIndex;
      }
    });
    expect(coreOwner.every((owner) => owner >= 0)).toBe(true);
    if (tiles.length > 1) {
      const first = tiles[0];
      expect(first.right - first.left).toBeGreaterThan(step);
    }
  });
});
