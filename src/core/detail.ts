export type DetailValues = { denoise?: number; sharpen?: number };

function clampByte(value: number) {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function luma(red: number, green: number, blue: number) {
  return 0.299 * red + 0.587 * green + 0.114 * blue;
}

function boxBlurPass(source: Uint8ClampedArray, target: Uint8ClampedArray, width: number, height: number, radius: number, horizontal: boolean) {
  const lineLength = horizontal ? width : height;
  const lines = horizontal ? height : width;
  const stepWithinLine = horizontal ? 4 : width * 4;
  const stepToNextLine = horizontal ? width * 4 : 4;
  const windowSize = radius * 2 + 1;
  for (let line = 0; line < lines; line += 1) {
    const lineStart = line * stepToNextLine;
    let sumRed = 0;
    let sumGreen = 0;
    let sumBlue = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const index = lineStart + Math.max(0, Math.min(lineLength - 1, offset)) * stepWithinLine;
      sumRed += source[index];
      sumGreen += source[index + 1];
      sumBlue += source[index + 2];
    }
    for (let position = 0; position < lineLength; position += 1) {
      const targetIndex = lineStart + position * stepWithinLine;
      target[targetIndex] = sumRed / windowSize;
      target[targetIndex + 1] = sumGreen / windowSize;
      target[targetIndex + 2] = sumBlue / windowSize;
      target[targetIndex + 3] = source[targetIndex + 3];
      const addIndex = lineStart + Math.min(lineLength - 1, position + radius + 1) * stepWithinLine;
      const removeIndex = lineStart + Math.max(0, position - radius) * stepWithinLine;
      sumRed += source[addIndex] - source[removeIndex];
      sumGreen += source[addIndex + 1] - source[removeIndex + 1];
      sumBlue += source[addIndex + 2] - source[removeIndex + 2];
    }
  }
}

export function smoothReference(data: Uint8ClampedArray, width: number, height: number, radius: number, rounds = 2) {
  const safeRadius = Math.max(1, Math.round(radius));
  const result = Uint8ClampedArray.from(data);
  const scratch = new Uint8ClampedArray(result.length);
  for (let round = 0; round < rounds; round += 1) {
    boxBlurPass(result, scratch, width, height, safeRadius, true);
    boxBlurPass(scratch, result, width, height, safeRadius, false);
  }
  return result;
}

export function denoiseRadius(strength: number) {
  return Math.max(1, Math.min(4, Math.round(strength / 25)));
}

const REFERENCE_EDGE = 1500;
const MAX_ADAPTIVE_RADIUS = 20;

export function adaptiveRadius(baseRadius: number, width: number, height: number) {
  const longest = Math.max(width, height);
  if (longest <= REFERENCE_EDGE) return Math.max(1, baseRadius);
  return Math.max(1, Math.min(MAX_ADAPTIVE_RADIUS, Math.round(baseRadius * longest / REFERENCE_EDGE)));
}

export function blendDenoise(orig: Uint8ClampedArray, blurred: Uint8ClampedArray, strength: number) {
  const amount = Math.max(0, Math.min(100, strength)) / 100;
  if (amount <= 0) return;
  const maxBlend = amount * 0.92;
  const threshold = 30;
  for (let index = 0; index < orig.length; index += 4) {
    const difference = Math.abs(luma(orig[index], orig[index + 1], orig[index + 2]) - luma(blurred[index], blurred[index + 1], blurred[index + 2]));
    const weight = maxBlend * (1 - difference / threshold);
    if (weight <= 0) continue;
    orig[index] = clampByte(orig[index] + (blurred[index] - orig[index]) * weight);
    orig[index + 1] = clampByte(orig[index + 1] + (blurred[index + 1] - orig[index + 1]) * weight);
    orig[index + 2] = clampByte(orig[index + 2] + (blurred[index + 2] - orig[index + 2]) * weight);
  }
}

export function blendSharpen(orig: Uint8ClampedArray, blurred: Uint8ClampedArray, strength: number) {
  const amount = (Math.max(0, Math.min(100, strength)) / 100) * 2.8;
  if (amount <= 0) return;
  for (let index = 0; index < orig.length; index += 4) {
    const difference = luma(orig[index], orig[index + 1], orig[index + 2]) - luma(blurred[index], blurred[index + 1], blurred[index + 2]);
    const gate = Math.min(1, Math.abs(difference) / 1.5);
    if (gate <= 0) continue;
    const weight = amount * gate;
    orig[index] = clampByte(orig[index] + (orig[index] - blurred[index]) * weight);
    orig[index + 1] = clampByte(orig[index + 1] + (orig[index + 1] - blurred[index + 1]) * weight);
    orig[index + 2] = clampByte(orig[index + 2] + (orig[index + 2] - blurred[index + 2]) * weight);
  }
}

export function applyDenoiseToBuffer(data: Uint8ClampedArray, width: number, height: number, strength: number) {
  if (!strength || strength <= 0 || !width || !height) return;
  const radius = adaptiveRadius(denoiseRadius(strength), width, height);
  blendDenoise(data, smoothReference(data, width, height, radius, 1), strength);
}

export function applySharpenToBuffer(data: Uint8ClampedArray, width: number, height: number, strength: number) {
  if (!strength || strength <= 0 || !width || !height) return;
  blendSharpen(data, smoothReference(data, width, height, adaptiveRadius(1, width, height), 2), strength);
}
