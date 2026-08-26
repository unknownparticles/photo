import { applyDenoiseToBuffer, applySharpenToBuffer } from './detail';

export type DetailWorkerRequest = { buffer: ArrayBuffer; width: number; height: number; denoise?: number; sharpen?: number };

self.onmessage = (event: MessageEvent<DetailWorkerRequest>) => {
  const { buffer, width, height, denoise, sharpen } = event.data;
  const data = new Uint8ClampedArray(buffer);
  applyDenoiseToBuffer(data, width, height, denoise ?? 0);
  applySharpenToBuffer(data, width, height, sharpen ?? 0);
  (self as unknown as Worker).postMessage({ buffer }, [buffer]);
};
