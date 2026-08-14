const CACHE_NAME = 'alun-inpaint-models-v1';

export interface ModelCacheInfo {
  cached: boolean;
  bytes: number;
}

async function openCache() {
  try {
    if (navigator.storage?.persist) void navigator.storage.persist();
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

export async function modelCacheInfo(url: string): Promise<ModelCacheInfo> {
  const cache = await openCache();
  const cached = await cache?.match(url);
  if (!cached) return { cached: false, bytes: 0 };
  const headerBytes = Number(cached.headers.get('content-length'));
  if (Number.isFinite(headerBytes) && headerBytes > 0) return { cached: true, bytes: headerBytes };
  const buffer = await cached.arrayBuffer();
  return { cached: true, bytes: buffer.byteLength };
}

export async function clearCachedModel(url: string) {
  const cache = await openCache();
  await cache?.delete(url);
}

export async function loadCachedModel(url: string, onProgress?: (loaded: number, total: number, cached: boolean) => void) {
  const cache = await openCache();
  const cached = await cache?.match(url);
  if (cached) {
    const buffer = await cached.arrayBuffer();
    onProgress?.(buffer.byteLength, buffer.byteLength, true);
    return new Uint8Array(buffer);
  }

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`模型下载失败：HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body?.getReader();
  let bytes: Uint8Array;
  let loaded = 0;

  if (reader && total > 0) {
    bytes = new Uint8Array(total);
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes.set(part.value, loaded);
      loaded += part.value.byteLength;
      onProgress?.(loaded, total, false);
    }
    if (loaded !== total) bytes = bytes.slice(0, loaded);
  } else if (reader) {
    const chunks: Uint8Array[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      chunks.push(part.value);
      loaded += part.value.byteLength;
      onProgress?.(loaded, 0, false);
    }
    bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
    loaded = bytes.byteLength;
    onProgress?.(loaded, total || loaded, false);
  }

  if (cache) {
    try {
      await cache.put(url, new Response(bytes.buffer as ArrayBuffer, {
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(bytes.byteLength),
        },
      }));
    } catch {
      // Quota limits and private browsing may reject persistent model caching.
    }
  }

  return bytes;
}
