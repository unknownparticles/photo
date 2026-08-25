export const UPSCALE_TILE_EDGE = 512;
export const UPSCALE_TILE_OVERLAP = 24;

export type RgbaImage = { data: Uint8ClampedArray; width: number; height: number };
export type SingleChannelInfer = (plane: Float32Array, height: number, width: number) => Promise<Float32Array>;

function clamp(value: number, min = 0, max = 255) {
  return Math.max(min, Math.min(max, value));
}

export function hasMeaningfulAlpha(pixels: Uint8ClampedArray) {
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 250) return true;
  }
  return false;
}

export function bleedTransparentPixels(pixels: Uint8ClampedArray, width: number, height: number) {
  const total = width * height;
  const filled = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const neighboursOf = (index: number) => {
    const x = index % width;
    const y = (index / width) | 0;
    return [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1];
  };
  for (let index = 0; index < total; index += 1) {
    if (pixels[index * 4 + 3] !== 0 || filled[index]) continue;
    for (const neighbour of neighboursOf(index)) {
      if (neighbour >= 0 && !filled[neighbour] && pixels[neighbour * 4 + 3] > 0) {
        pixels[index * 4] = pixels[neighbour * 4];
        pixels[index * 4 + 1] = pixels[neighbour * 4 + 1];
        pixels[index * 4 + 2] = pixels[neighbour * 4 + 2];
        filled[index] = 1;
        queue[tail++] = index;
        break;
      }
    }
  }
  while (head < tail) {
    const index = queue[head++];
    for (const neighbour of neighboursOf(index)) {
      if (neighbour >= 0 && !filled[neighbour] && pixels[neighbour * 4 + 3] === 0) {
        pixels[neighbour * 4] = pixels[index * 4];
        pixels[neighbour * 4 + 1] = pixels[index * 4 + 1];
        pixels[neighbour * 4 + 2] = pixels[index * 4 + 2];
        filled[neighbour] = 1;
        queue[tail++] = neighbour;
      }
    }
  }
}

export function chromaPlanes(pixels: Uint8ClampedArray, total: number) {
  const cbPlane = new Uint8Array(total);
  const crPlane = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    const red = pixels[index * 4];
    const green = pixels[index * 4 + 1];
    const blue = pixels[index * 4 + 2];
    cbPlane[index] = Math.round(-0.168736 * red - 0.331264 * green + 0.5 * blue + 128);
    crPlane[index] = Math.round(0.5 * red - 0.418688 * green - 0.081312 * blue + 128);
  }
  return { cbPlane, crPlane };
}

function sampleChroma(plane: Uint8Array, width: number, height: number, x: number, y: number) {
  const clampedX = Math.max(0, Math.min(width - 1, x));
  const clampedY = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = clampedX - x0;
  const fy = clampedY - y0;
  const top = plane[y0 * width + x0] * (1 - fx) + plane[y0 * width + x1] * fx;
  const bottom = plane[y1 * width + x0] * (1 - fx) + plane[y1 * width + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

function writeYcbcrPixel(target: Uint8ClampedArray, offset: number, luma: number, cb: number, cr: number, alpha: number) {
  const brightness = luma * 255;
  const cbOffset = cb - 128;
  const crOffset = cr - 128;
  target[offset] = clamp(brightness + 1.402 * crOffset);
  target[offset + 1] = clamp(brightness - 0.344136 * cbOffset - 0.714136 * crOffset);
  target[offset + 2] = clamp(brightness + 1.772 * cbOffset);
  target[offset + 3] = alpha;
}

export function lumaTile(pixels: Uint8ClampedArray, width: number, height: number, x0: number, y0: number, tileWidth: number, tileHeight: number) {
  const plane = new Float32Array(tileWidth * tileHeight);
  for (let y = 0; y < tileHeight; y += 1) {
    const sourceRow = ((y0 + y) * width + x0) * 4;
    for (let x = 0; x < tileWidth; x += 1) {
      const offset = sourceRow + x * 4;
      plane[y * tileWidth + x] = (0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2]) / 255;
    }
  }
  return plane;
}

export function alphaTile(pixels: Uint8ClampedArray, width: number, height: number, x0: number, y0: number, tileWidth: number, tileHeight: number) {
  const plane = new Float32Array(tileWidth * tileHeight);
  for (let y = 0; y < tileHeight; y += 1) {
    const sourceRow = ((y0 + y) * width + x0) * 4;
    for (let x = 0; x < tileWidth; x += 1) {
      plane[y * tileWidth + x] = pixels[sourceRow + x * 4 + 3] / 255;
    }
  }
  return plane;
}

export function planUpscaleTiles(width: number, height: number) {
  const step = UPSCALE_TILE_EDGE - UPSCALE_TILE_OVERLAP * 2;
  const tiles: Array<{ x0: number; y0: number; left: number; top: number; right: number; bottom: number }> = [];
  for (let sy = 0; sy < height; sy += step) {
    for (let sx = 0; sx < width; sx += step) {
      tiles.push({
        x0: sx,
        y0: sy,
        left: Math.max(0, sx - UPSCALE_TILE_OVERLAP),
        top: Math.max(0, sy - UPSCALE_TILE_OVERLAP),
        right: Math.min(width, sx + step + UPSCALE_TILE_OVERLAP),
        bottom: Math.min(height, sy + step + UPSCALE_TILE_OVERLAP),
      });
    }
  }
  return tiles;
}

export async function assembleUpscaled(
  source: RgbaImage,
  factor: number,
  infer: SingleChannelInfer,
  options: { alphaUsed?: boolean } = {},
): Promise<RgbaImage> {
  const { width, height } = source;
  const pixels = source.data;
  const alphaUsed = options.alphaUsed ?? hasMeaningfulAlpha(pixels);
  if (alphaUsed) bleedTransparentPixels(pixels, width, height);
  const { cbPlane, crPlane } = chromaPlanes(pixels, width * height);
  const outWidth = width * factor;
  const outHeight = height * factor;
  const target = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (const tile of planUpscaleTiles(width, height)) {
    const tileWidth = tile.right - tile.left;
    const tileHeight = tile.bottom - tile.top;
    const lumaOutput = await infer(lumaTile(pixels, width, height, tile.left, tile.top, tileWidth, tileHeight), tileHeight, tileWidth);
    if (lumaOutput.length !== tileWidth * factor * tileHeight * factor) throw new Error('AI 超分模型输出尺寸与输入不匹配');
    const alphaOutput = alphaUsed ? await infer(alphaTile(pixels, width, height, tile.left, tile.top, tileWidth, tileHeight), tileHeight, tileWidth) : null;
    for (let coreY = tile.y0; coreY < Math.min(tile.bottom, tile.y0 + UPSCALE_TILE_EDGE - UPSCALE_TILE_OVERLAP * 2); coreY += 1) {
      for (let coreX = tile.x0; coreX < Math.min(tile.right, tile.x0 + UPSCALE_TILE_EDGE - UPSCALE_TILE_OVERLAP * 2); coreX += 1) {
        for (let dy = 0; dy < factor; dy += 1) {
          const lumaRow = (coreY - tile.top) * factor + dy;
          const destY = coreY * factor + dy;
          for (let dx = 0; dx < factor; dx += 1) {
            const lumaIndex = lumaRow * tileWidth * factor + (coreX - tile.left) * factor + dx;
            const sampleX = (coreX * factor + dx + 0.5) / factor - 0.5;
            const sampleY = (coreY * factor + dy + 0.5) / factor - 0.5;
            const cb = sampleChroma(cbPlane, width, height, sampleX, sampleY);
            const cr = sampleChroma(crPlane, width, height, sampleX, sampleY);
            const alpha = alphaOutput ? Math.round(clamp(alphaOutput[lumaIndex] * 255)) : 255;
            writeYcbcrPixel(target, (destY * outWidth + coreX * factor + dx) * 4, lumaOutput[lumaIndex], cb, cr, alpha);
          }
        }
      }
    }
  }
  return { data: target, width: outWidth, height: outHeight };
}
