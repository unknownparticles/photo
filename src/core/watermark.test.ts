import { describe, expect, it } from 'vitest';
import { matchTemplate, matchTemplateContent, resizeGray, rgbaToGray, extractTemplateAlpha, resizeAlpha, buildContentMask } from './watermark';
import type { GrayPlane } from './watermark';

function seededRandom(seed = 42) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makePlane(width: number, height: number, rand: () => number): GrayPlane {
  const data = new Float32Array(width * height);
  for (let index = 0; index < data.length; index += 1) data[index] = rand() * 255;
  return { width, height, data };
}

function copyRegion(source: GrayPlane, x: number, y: number, width: number, height: number): GrayPlane {
  const data = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) data[row * width + column] = source.data[(y + row) * source.width + (x + column)];
  }
  return { width, height, data };
}

describe('rgbaToGray', () => {
  it('computes luminance with standard weights', () => {
    const plane = rgbaToGray(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]), 2, 1);
    expect(plane.width).toBe(2);
    expect(plane.data[0]).toBeCloseTo(76.245, 2);
    expect(plane.data[1]).toBeCloseTo(149.685, 2);
  });
});

describe('resizeGray', () => {
  it('produces requested dimensions and preserves average brightness', () => {
    const rand = seededRandom(7);
    const plane = makePlane(40, 30, rand);
    const resized = resizeGray(plane, 20, 15);
    expect(resized.width).toBe(20);
    expect(resized.height).toBe(15);
    const before = plane.data.reduce((sum, value) => sum + value, 0) / plane.data.length;
    const after = resized.data.reduce((sum, value) => sum + value, 0) / resized.data.length;
    expect(Math.abs(before - after)).toBeLessThan(12);
  });

  it('clamps to at least one pixel', () => {
    const plane = makePlane(4, 4, seededRandom());
    expect(resizeGray(plane, 0, -5).width).toBe(1);
  });
});

describe('matchTemplate', () => {
  it('locates an exact template copy', () => {
    const search = makePlane(80, 60, seededRandom(3));
    const template = copyRegion(search, 23, 17, 14, 10);
    const matches = matchTemplate(search, template, 0.99);
    expect(matches.length).toBeGreaterThan(0);
    const top = matches[0];
    expect(Math.abs(top.x - 23)).toBeLessThanOrEqual(1);
    expect(Math.abs(top.y - 17)).toBeLessThanOrEqual(1);
    expect(top.score).toBeGreaterThan(0.98);
  });

  it('finds multiple repeated occurrences without duplicates', () => {
    const search = makePlane(120, 90, seededRandom(11));
    const template = copyRegion(search, 8, 8, 12, 9);
    for (let row = 0; row < 9; row += 1) {
      for (let column = 0; column < 12; column += 1) search.data[(50 + row) * search.width + (70 + column)] = template.data[row * 12 + column];
      for (let column = 0; column < 12; column += 1) search.data[(20 + row) * search.width + (95 + column)] = template.data[row * 12 + column];
    }
    const matches = matchTemplate(search, template, 0.97);
    expect(matches.length).toBeGreaterThanOrEqual(3);
    const centers = matches.map((match) => `${Math.round(match.x)},${Math.round(match.y)}`);
    expect(new Set(centers).size).toBe(matches.length);
    const hasNearby = (x: number, y: number) => matches.some((match) => Math.abs(match.x - x) <= 2 && Math.abs(match.y - y) <= 2);
    expect(hasNearby(8, 8)).toBe(true);
    expect(hasNearby(70, 50)).toBe(true);
    expect(hasNearby(95, 20)).toBe(true);
  });

  it('returns no matches when threshold is unreachable', () => {
    const search = makePlane(60, 50, seededRandom(5));
    const template = makePlane(10, 8, seededRandom(6));
    expect(matchTemplate(search, template, 0.999999)).toHaveLength(0);
  });

  it('refines coarse candidates to sub-stride accuracy', () => {
    const width = 200;
    const height = 160;
    const data = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) data[y * width + x] = 128 + 55 * Math.sin((x + y) / 6.5) * Math.cos(x / 9.5);
    }
    const search: GrayPlane = { width, height, data };
    const template = copyRegion(search, 101, 77, 16, 12);
    const [match] = matchTemplate(search, template, 0.99, 2e6);
    expect(match).toBeDefined();
    expect(Math.abs(match.x - 101)).toBeLessThanOrEqual(3);
    expect(Math.abs(match.y - 77)).toBeLessThanOrEqual(3);
  });
});

describe('extractTemplateAlpha', () => {
  it.skip('extracts alpha channel from image pixels (needs DOM canvas)', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(255,0,0,128)';
    ctx.fillRect(0, 0, 2, 4);
    ctx.fillStyle = 'rgba(0,255,0,255)';
    ctx.fillRect(2, 0, 2, 4);
    const image = new Image();
    image.src = canvas.toDataURL();
    await image.decode();
    const alpha = extractTemplateAlpha(image);
    expect(alpha.length).toBe(16);
    for (let x = 0; x < 2; x += 1) for (let y = 0; y < 4; y += 1) expect(alpha[y * 4 + x]).toBe(128);
    for (let x = 2; x < 4; x += 1) for (let y = 0; y < 4; y += 1) expect(alpha[y * 4 + x]).toBe(255);
  });
});

describe('resizeAlpha', () => {
  it('resizes alpha mask with nearest-area averaging', () => {
    const alpha = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
    const resized = resizeAlpha(alpha, 4, 3, 2, 2);
    expect(resized).toEqual(new Uint8Array([35, 55, 75, 95]));
  });

  it('clamps dimensions to at least 1x1', () => {
    const alpha = new Uint8Array([0, 1, 2, 3]);
    expect(resizeAlpha(alpha, 2, 2, 0, 0).length).toBe(1);
  });
});

describe('buildContentMask', () => {
  it('marks dark pixels as content when background is bright', () => {
    const plane: GrayPlane = { width: 3, height: 3, data: new Float32Array([250, 240, 255, 200, 50, 30, 255, 255, 255]) };
    const mask = buildContentMask(plane, 230);
    expect(Array.from(mask)).toEqual([0, 0, 0, 1, 1, 1, 0, 0, 0]);
  });

  it('inverts to keep bright pixels as content', () => {
    const plane: GrayPlane = { width: 2, height: 2, data: new Float32Array([255, 10, 20, 255]) };
    const mask = buildContentMask(plane, 200, true);
    expect(Array.from(mask)).toEqual([1, 0, 0, 1]);
  });
});

describe('matchTemplateContent', () => {
  it('matches using only content pixels and ignores bright background', () => {
    const search: GrayPlane = { width: 40, height: 30, data: new Float32Array(40 * 30) };
    const rand = seededRandom(99);
    for (let index = 0; index < search.data.length; index += 1) search.data[index] = 200 + rand() * 55;
    const contentData = new Float32Array([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    const template: GrayPlane = { width: 3, height: 3, data: contentData };
    const startY = 17;
    const startX = 23;
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 3; x += 1) search.data[(startY + y) * search.width + (startX + x)] = contentData[y * 3 + x];
    }
    const mask = new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const matches = matchTemplateContent(search, template, mask, 0.99);
    expect(matches.length).toBeGreaterThan(0);
    const top = matches[0];
    expect(Math.abs(top.x - startX)).toBeLessThanOrEqual(1);
    expect(Math.abs(top.y - startY)).toBeLessThanOrEqual(1);
    expect(top.score).toBeGreaterThan(0.95);
  });

  it('ignores bright background pixels and still finds the pattern', () => {
    const search: GrayPlane = { width: 50, height: 40, data: new Float32Array(50 * 40) };
    for (let index = 0; index < search.data.length; index += 1) search.data[index] = 240;
    const contentData = new Float32Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
    const template: GrayPlane = { width: 3, height: 4, data: contentData };
    const startY = 20;
    const startX = 25;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 3; x += 1) search.data[(startY + y) * search.width + (startX + x)] = contentData[y * 3 + x];
    }
    const mask = new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const matches = matchTemplateContent(search, template, mask, 0.99);
    expect(matches.length).toBeGreaterThan(0);
    const top = matches[0];
    expect(Math.abs(top.x - startX)).toBeLessThanOrEqual(1);
    expect(Math.abs(top.y - startY)).toBeLessThanOrEqual(1);
    expect(top.score).toBeGreaterThan(0.999);
  });
});
