import { describe, expect, it } from 'vitest';
import { originLayerStyle } from './originLayout';

const identity = { scaleX: 1, scaleY: 1, x: 0, y: 0 };

describe('原图对比层几何', () => {
  it('未编辑时铺满显示框', () => {
    const style = originLayerStyle(1000, 800, 500, 400, 1000, 800, identity);
    expect(style.width).toBe(500);
    expect(style.height).toBe(400);
    expect(Math.abs(style.left)).toBeLessThan(1e-9);
    expect(Math.abs(style.top)).toBeLessThan(1e-9);
  });

  it('纯超分后整张原图按比例缩放到同一显示框（不再被裁剪）', () => {
    const map = { scaleX: 0.5, scaleY: 0.5, x: 0, y: 0 };
    const style = originLayerStyle(2000, 1600, 600, 480, 1000, 800, map);
    expect(style.width).toBeCloseTo(600);
    expect(style.height).toBeCloseTo(480);
    expect(style.left).toBeCloseTo(0);
  });

  it('裁剪后只露出对应区域且位置对齐', () => {
    const map = { scaleX: 1, scaleY: 1, x: 200, y: 100 };
    const style = originLayerStyle(400, 300, 400, 300, 1000, 800, map);
    expect(style.width).toBe(1000);
    expect(style.height).toBe(800);
    expect(style.left).toBe(-200);
    expect(style.top).toBe(-100);
  });

  it('裁剪加超分组合链保持逐点对应', () => {
    const map = { scaleX: 0.5, scaleY: 0.5, x: 200, y: 100 };
    const style = originLayerStyle(800, 600, 400, 300, 1000, 800, map);
    // 当前(0,0)应对应origin(200,100)：displayQ=0 处的图像坐标
    const originXAtZero = -style.left / style.width * 1000;
    const originYAtZero = -style.top / style.height * 800;
    expect(originXAtZero).toBeCloseTo(200);
    expect(originYAtZero).toBeCloseTo(100);
    // 当前右下角(800,600)应对应origin(600,400)
    const originXAtEnd = (400 / style.width) * 1000 + originXAtZero;
    const originYAtEnd = (300 / style.height) * 800 + originYAtZero;
    expect(originXAtEnd).toBeCloseTo(600);
    expect(originYAtEnd).toBeCloseTo(400);
  });
});
