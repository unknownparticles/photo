import type { DetailWorkerRequest } from './detailWorker';

export type DetailValues = { denoise?: number; sharpen?: number };

let instance: Worker | null = null;
let broken = false;
let chain: Promise<unknown> = Promise.resolve();

function ensureWorker(): Worker | null {
  if (instance || broken) return instance;
  try {
    instance = new Worker(new URL('./detailWorker.ts', import.meta.url), { type: 'module' });
    instance.onerror = () => {
      broken = true;
      instance?.terminate();
      instance = null;
    };
  } catch {
    broken = true;
  }
  return instance;
}

function runOnWorker(worker: Worker, buffer: ArrayBuffer, width: number, height: number, denoise: number, sharpen: number): Promise<Uint8ClampedArray> {
  return new Promise<Uint8ClampedArray>((resolve, reject) => {
    const onMessage = (event: MessageEvent<{ buffer: ArrayBuffer }>) => {
      cleanup();
      resolve(new Uint8ClampedArray(event.data.buffer));
    };
    const onError = () => {
      cleanup();
      reject(new Error('细节处理线程失败'));
    };
    function cleanup() {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    }
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError, { once: true });
    const request: DetailWorkerRequest = { buffer, width, height, denoise, sharpen };
    worker.postMessage(request, [buffer]);
  });
}

export async function runDetailPass(input: Uint8ClampedArray, width: number, height: number, values: DetailValues): Promise<Uint8ClampedArray> {
  const denoise = values.denoise ?? 0;
  const sharpen = values.sharpen ?? 0;
  if ((!denoise || denoise <= 0) && (!sharpen || sharpen <= 0)) return input;
  const worker = ensureWorker();
  if (!worker) {
    const { applyDenoiseToBuffer, applySharpenToBuffer } = await import('./detail');
    const output = Uint8ClampedArray.from(input);
    applyDenoiseToBuffer(output, width, height, denoise);
    applySharpenToBuffer(output, width, height, sharpen);
    return output;
  }
  const task = chain.then(() => runOnWorker(worker, input.slice().buffer as ArrayBuffer, width, height, denoise, sharpen));
  chain = task.catch(() => undefined);
  return task;
}
