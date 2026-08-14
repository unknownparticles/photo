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
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  if (reader) {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      chunks.push(part.value);
      loaded += part.value.byteLength;
      onProgress?.(loaded, total, false);
    }
  } else {
    const chunk = new Uint8Array(await response.arrayBuffer());
    chunks.push(chunk);
    loaded = chunk.byteLength;
    onProgress?.(loaded, total || loaded, false);
  }

  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  if (cache) {
    try {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      await cache.put(url, new Response(copy.buffer, {
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(copy.byteLength),
        },
      }));
    } catch {
      // Quota limits and private browsing may reject persistent model caching.
    }
  }

  return bytes;
}
