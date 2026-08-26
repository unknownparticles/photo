import { describe, expect, it } from 'vitest';
import { adaptiveRadius, applyDenoiseToBuffer, applySharpenToBuffer, blendDenoise, blendSharpen, denoiseRadius, smoothReference } from './detail';

function rgba(pixels: Array<[number, number, number, number]>) {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([red, green, blue, alpha], index) => {
    data[index * 4] = red;
    data[index * 4 + 1] = green;
    data[index * 4 + 2] = blue;
    data[index * 4 + 3] = alpha;
  });
  return data;
}

function pixel(data: Uint8ClampedArray, index: number) {
  return [data[index * 4], data[index * 4 + 1], data[index * 4 + 2], data[index * 4 + 3]] as const;
}

const W = 160;
const H = 120;

function psnr(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let mse = 0;
  for (let index = 0; index < a.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) mse += (a[index + channel] - b[index + channel]) ** 2;
  }
  return 10 * Math.log10(255 ** 2 / (mse / (a.length / 4 * 3)));
}

function sharpness(data: Uint8ClampedArray, width: number, height: number) {
  let total = 0;
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    const offset = (y * width + x) * 4;
    total += Math.abs(data[offset + 4] - data[offset - 4]) + Math.abs(data[offset + width * 4] - data[offset - width * 4]);
  }
  return total / ((width - 2) * (height - 2));
}

function fractalFixture() {
  let seed = 11;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const octave = (scale: number) => {
    const sw = Math.max(2, Math.floor(W / scale));
    const sh = Math.max(2, Math.floor(H / scale));
    const grid: number[] = [];
    for (let index = 0; index < sw * sh; index += 1) grid.push(random());
    const plane = new Float64Array(W * H);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      const fx = x / W * (sw - 1);
      const fy = y / H * (sh - 1);
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const a = grid[y0 * sw + x0];
      const b = grid[y0 * sw + Math.min(sw - 1, x0 + 1)];
      const c = grid[Math.min(sh - 1, y0 + 1) * sw + x0];
      const d = grid[Math.min(sh - 1, y0 + 1) * sw + Math.min(sw - 1, x0 + 1)];
      plane[y * W + x] = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
    }
    return plane;
  };
  const o1 = octave(8);
  const o2 = octave(4);
  const o3 = octave(2);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let index = 0; index < W * H; index += 1) {
    const lumaValue = 128 + (o1[index] - 0.5) * 90 + (o2[index] - 0.5) * 50 + (o3[index] - 0.5) * 28;
    data[index * 4] = lumaValue + (o2[index] - 0.5) * 30;
    data[index * 4 + 1] = lumaValue;
    data[index * 4 + 2] = lumaValue - (o2[index] - 0.5) * 30;
    data[index * 4 + 3] = 255;
  }
  return data;
}

describe('自适应半径', () => {
  it('小图保持基础半径，大图按比例放大并封顶', () => {
    expect(adaptiveRadius(2, 1200, 900)).toBe(2);
    expect(adaptiveRadius(2, 3000, 2000)).toBe(4);
    expect(adaptiveRadius(1, 6000, 4500)).toBe(4);
    expect(adaptiveRadius(4, 9000, 6000)).toBe(20);
    expect(adaptiveRadius(0, 800, 600)).toBe(1);
  });
});

describe('端到端质量（客观指标）', () => {
  it('降噪显著提升信噪比并保留大部分细节', () => {
    const clean = fractalFixture();
    const noisy = Uint8ClampedArray.from(clean);
    let seed = 99;
    const gauss = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff - 0.5) * 2;
    };
    for (let index = 0; index < noisy.length; index += 4) {
      const noise = gauss() * 9;
      noisy[index] += noise;
      noisy[index + 1] += noise * 0.9;
      noisy[index + 2] += noise * 1.1;
    }
    const baseline = psnr(clean, noisy);
    expect(baseline).toBeGreaterThan(28);
    const denoised = Uint8ClampedArray.from(noisy);
    applyDenoiseToBuffer(denoised, W, H, 40);
    expect(psnr(clean, denoised) - baseline).toBeGreaterThanOrEqual(1);
    expect(sharpness(denoised, W, H)).toBeGreaterThan(sharpness(noisy, W, H) * 0.82);
  });

  it('锐化恢复轻度模糊损失的清晰度且不产生光晕', () => {
    const clean = fractalFixture();
    const soft = Uint8ClampedArray.from(clean);
    soft.set(smoothReference(soft, W, H, 1, 2));
    soft.set(smoothReference(soft, W, H, 1, 1));
    const cleanSharpness = sharpness(clean, W, H);
    const softSharpness = sharpness(soft, W, H);
    expect(softSharpness).toBeLessThan(cleanSharpness * 0.85);
    const sharpened = Uint8ClampedArray.from(soft);
    applySharpenToBuffer(sharpened, W, H, 70);
    const recovered = sharpness(sharpened, W, H);
    expect((recovered - softSharpness) / (cleanSharpness - softSharpness)).toBeGreaterThanOrEqual(0.35);
    expect(psnr(clean, sharpened)).toBeGreaterThan(psnr(clean, soft));
  });
});

describe('降噪内核', () => {
  it('半径随强度递增且封顶', () => {
    expect(denoiseRadius(0)).toBe(1);
    expect(denoiseRadius(30)).toBe(1);
    expect(denoiseRadius(40)).toBe(2);
    expect(denoiseRadius(70)).toBe(3);
    expect(denoiseRadius(100)).toBe(4);
  });

  it('平坦噪声区被平滑', () => {
    const orig = rgba([[200, 60, 40, 255], [208, 66, 46, 255]]);
    const blurred = rgba([[204, 63, 43, 255], [204, 63, 43, 255]]);
    const gapBefore = Math.abs(orig[0] - orig[4]);
    blendDenoise(orig, blurred, 80);
    const gapAfter = Math.abs(orig[0] - orig[4]);
    expect(gapAfter).toBeLessThan(gapBefore);
    expect(orig[7]).toBe(255);
  });

  it('强边缘被保留不被抹平', () => {
    const edge = 180;
    const orig = rgba([[30, 30, 30, 255], [30 + edge, 30 + edge, 30 + edge, 255]]);
    const blurred = rgba([[90, 90, 90, 255], [150, 150, 150, 255]]);
    blendDenoise(orig, blurred, 100);
    const [dark, bright] = [pixel(orig, 0), pixel(orig, 1)];
    expect(bright[0] - dark[0]).toBeGreaterThan(edge * 0.9);
  });

  it('强度为 0 时不修改像素', () => {
    const orig = rgba([[10, 20, 30, 255]]);
    const snapshot = Uint8ClampedArray.from(orig);
    blendDenoise(orig, rgba([[250, 250, 250, 255]]), 0);
    expect(Array.from(orig)).toEqual(Array.from(snapshot));
  });

  it('alpha 通道不受影响', () => {
    const orig = rgba([[100, 100, 100, 128]]);
    const blurred = rgba([[200, 200, 200, 7]]);
    blendDenoise(orig, blurred, 100);
    expect(pixel(orig, 0)[3]).toBe(128);
  });
});

describe('锐化内核', () => {
  it('模糊边缘对比度被增强', () => {
    const soft = rgba([[120, 120, 122, 255], [130, 130, 132, 255]]);
    const blurred = rgba([[125, 125, 127, 255], [125, 125, 127, 255]]);
    blendSharpen(soft, blurred, 80);
    const [left, right] = [pixel(soft, 0), pixel(soft, 1)];
    expect(right[0] - left[0]).toBeGreaterThan(10);
  });

  it('均匀区域基本不变', () => {
    const flat = rgba([[140, 140, 140, 255], [141, 141, 141, 255]]);
    const blurred = rgba([[140, 140, 140, 255], [140, 140, 140, 255]]);
    blendSharpen(flat, blurred, 100);
    for (let index = 0; index < flat.length; index += 4) {
      for (const value of Array.from(flat.slice(index, index + 3))) {
        expect(Math.abs(value - 140)).toBeLessThanOrEqual(4);
      }
      expect(flat[index + 3]).toBe(255);
    }
  });

  it('alpha 通道不受影响', () => {
    const orig = rgba([[50, 50, 50, 200]]);
    const blurred = rgba([[150, 150, 150, 0]]);
    blendSharpen(orig, blurred, 100);
    expect(pixel(orig, 0)[3]).toBe(200);
  });

  it('强度为 0 时不修改像素', () => {
    const orig = rgba([[1, 2, 3, 255]]);
    const snapshot = Uint8ClampedArray.from(orig);
    blendSharpen(orig, rgba([[253, 252, 251, 255]]), 0);
    expect(Array.from(orig)).toEqual(Array.from(snapshot));
  });
});
