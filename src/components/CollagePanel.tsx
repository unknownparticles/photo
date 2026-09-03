import { useEffect, useRef, useState } from 'react';
import type { ImageAsset } from '../types';
import { createAssetFromBlob, downloadBlob } from '../core/image';
import { composeCollage } from '../core/collage';
import type { CollageLayer } from '../core/collage';
import { Combine, Download, Eye, EyeOff, ImagePlus, Layers3, Trash2 } from 'lucide-react';

type Sticker = CollageLayer & { id: string };

export function CollagePanel({ asset, onExport, setNotice }: { asset: ImageAsset | null; onExport: (asset: ImageAsset) => Promise<void>; setNotice: (notice: { type: 'success' | 'warning' | 'error'; text: string } | null) => void }) {
  const baseAsset = asset;
  const [canvasWidth, setCanvasWidth] = useState(asset?.width ?? 1024);
  const [canvasHeight, setCanvasHeight] = useState(asset?.height ?? 1024);
  const [background, setBackground] = useState('#ffffff');
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const stickerInput = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; initialX: number; initialY: number } | null>(null);
  const rotateRef = useRef<{ id: string; centerX: number; centerY: number; startAngle: number; initialRotation: number } | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const selectedSticker = stickers.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (baseAsset) {
      setCanvasWidth(baseAsset.width);
      setCanvasHeight(baseAsset.height);
    }
  }, [baseAsset]);

  function pointerInPreview(event: React.PointerEvent<HTMLDivElement>) {
    const frame = previewRef.current;
    if (!frame) return { x: 0, y: 0 };
    const rect = frame.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * canvasWidth, y: ((event.clientY - rect.top) / rect.height) * canvasHeight };
  }

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target as Element | null;
    const stickerEl = target?.closest('[data-sticker-id]') as Element | null;
    const rotateEl = target?.closest('[data-rotate-id]') as Element | null;
    if (rotateEl && stickerEl) {
      const id = stickerEl.getAttribute('data-sticker-id') ?? '';
      const rect = previewRef.current?.getBoundingClientRect();
      if (!rect) return;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const startAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI;
      const sticker = stickers.find((item) => item.id === id);
      rotateRef.current = { id, centerX, centerY, startAngle, initialRotation: sticker?.rotation ?? 0 };
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!stickerEl) {
      setSelectedId(null);
      return;
    }
    const id = stickerEl.getAttribute('data-sticker-id') ?? '';
    const sticker = stickers.find((item) => item.id === id);
    if (!sticker) return;
    const point = pointerInPreview(event);
    dragRef.current = { id, startX: point.x, startY: point.y, initialX: sticker.offsetX, initialY: sticker.offsetY };
    setSelectedId(id);
    event.preventDefault();
    event.stopPropagation();
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current) {
      const point = pointerInPreview(event);
      setStickers((current) => current.map((item) => item.id === dragRef.current!.id ? { ...item, offsetX: dragRef.current!.initialX + (point.x - dragRef.current!.startX), offsetY: dragRef.current!.initialY + (point.y - dragRef.current!.startY) } : item));
      return;
    }
    if (rotateRef.current) {
      const rect = previewRef.current?.getBoundingClientRect();
      if (!rect) return;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const currentAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI;
      const delta = currentAngle - rotateRef.current.startAngle;
      setStickers((current) => current.map((item) => item.id === rotateRef.current!.id ? { ...item, rotation: rotateRef.current!.initialRotation + delta } : item));
      return;
    }
  }

  function endDrag() {
    dragRef.current = null;
    rotateRef.current = null;
  }

  async function addSticker(file: File | undefined) {
    if (!file?.type.startsWith('image/')) return;
    const asset = await createAssetFromBlob(file, file.name, file);
    const id = crypto.randomUUID();
    const sticker: Sticker = {
      id,
      asset,
      offsetX: canvasWidth / 2 - asset.width / 2,
      offsetY: canvasHeight / 2 - asset.height / 2,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
    };
    setStickers((current) => [...current, sticker]);
    setSelectedId(id);
  }

  function updateSticker(id: string, patch: Partial<Sticker>) {
    setStickers((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  async function handleExport() {
    if (!baseAsset) return;
    setExporting(true);
    try {
      const layers: CollageLayer[] = [
        { asset: baseAsset, offsetX: 0, offsetY: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
        ...stickers.map(({ asset, offsetX, offsetY, rotation, scaleX, scaleY, opacity }) => ({ asset, offsetX, offsetY, rotation, scaleX, scaleY, opacity })),
      ];
      const blob = await composeCollage({ canvasWidth, canvasHeight, background, layers });
      const exported = await createAssetFromBlob(blob, `拼贴-${Date.now()}.png`);
      await onExport(exported);
    } finally {
      setExporting(false);
    }
  }

  async function handleDownload() {
    if (!baseAsset) return;
    setExporting(true);
    try {
      const layers: CollageLayer[] = [
        { asset: baseAsset, offsetX: 0, offsetY: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
        ...stickers.map(({ asset, offsetX, offsetY, rotation, scaleX, scaleY, opacity }) => ({ asset, offsetX, offsetY, rotation, scaleX, scaleY, opacity })),
      ];
      const blob = await composeCollage({ canvasWidth, canvasHeight, background, layers });
      downloadBlob(blob, `拼贴-${Date.now()}.png`);
      setNotice({ type: 'success', text: '拼贴已下载' });
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="panel-intro"><h3>自由拼贴</h3><p>当前图片作为底图，导入贴纸后可拖拽、缩放、旋转。</p></div>
      <div className="control-section">
        <div className="field-grid">
          <label className="field"><span>画布宽度</span><div className="field-control"><input type="number" min="64" max="4096" value={canvasWidth} onChange={(event) => setCanvasWidth(Number(event.target.value))} /></div></label>
          <label className="field"><span>画布高度</span><div className="field-control"><input type="number" min="64" max="4096" value={canvasHeight} onChange={(event) => setCanvasHeight(Number(event.target.value))} /></div></label>
          <label className="field"><span>背景颜色</span><div className="field-control"><input type="color" value={background} onChange={(event) => setBackground(event.target.value)} /><b>{background.toUpperCase()}</b></div></label>
        </div>
        <button className="watermark-file-button" onClick={() => stickerInput.current?.click()}><ImagePlus size={16} /><span>添加贴纸</span></button>
        <input ref={stickerInput} type="file" accept="image/*" className="visually-hidden" onChange={(event) => { void addSticker(event.target.files?.[0]); event.currentTarget.value = ''; }} />
      </div>

      <div className="control-section">
        <div className="section-label">画布</div>
        <div className="collage-preview" ref={previewRef} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <img src={baseAsset?.url ?? ''} alt="底图" className="collage-base-image" />
          {stickers.map((sticker) => (
            <div
              key={sticker.id}
              data-sticker-id={sticker.id}
              className={`collage-sticker ${selectedId === sticker.id ? 'is-selected' : ''}`}
              style={{
                left: `${(sticker.offsetX / canvasWidth) * 100}%`,
                top: `${(sticker.offsetY / canvasHeight) * 100}%`,
                width: `${(sticker.asset.width / canvasWidth) * 100}%`,
                height: `${(sticker.asset.height / canvasHeight) * 100}%`,
                transform: `rotate(${sticker.rotation ?? 0}deg) scale(${sticker.scaleX ?? 1}, ${sticker.scaleY ?? 1})`,
              }}
            >
              <img src={sticker.asset.url} alt={sticker.asset.name} draggable={false} />
              {selectedId === sticker.id && (
                <button type="button" data-rotate-id={sticker.id} className="collage-handle collage-rotate-handle" title="旋转">R</button>
              )}
            </div>
          ))}
        </div>
      </div>

      {stickers.length > 0 && (
        <div className="control-section">
          <div className="section-label">贴纸</div>
          <div className="collage-sticker-list">
            {stickers.map((sticker, index) => (
              <div key={sticker.id} className={`collage-sticker-row ${selectedId === sticker.id ? 'is-active' : ''}`}>
                <button type="button" className="layer-thumb" onClick={() => setSelectedId(sticker.id)}><img src={sticker.asset.url} alt={sticker.asset.name} draggable={false} /></button>
                <button type="button" className="layer-name" onClick={() => setSelectedId(sticker.id)}><strong>{sticker.asset.name}</strong></button>
                <button type="button" className="layer-action" title="上移" onClick={() => { if (index < stickers.length - 1) { const next = [...stickers]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; setStickers(next); } }}><Layers3 size={14} /></button>
                <button type="button" className="layer-action" title="下移" onClick={() => { if (index > 0) { const next = [...stickers]; [next[index], next[index - 1]] = [next[index - 1], next[index]]; setStickers(next); } }}><Layers3 size={14} /></button>
                <button type="button" className="layer-action" title={sticker.visible !== false ? '隐藏' : '显示'} onClick={() => updateSticker(sticker.id, { visible: !(sticker.visible !== false) })}>{sticker.visible !== false ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                <button type="button" className="layer-action danger" title="删除" onClick={() => { setStickers((current) => current.filter((item) => item.id !== sticker.id)); if (selectedId === sticker.id) setSelectedId(null); }}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedSticker && (
        <div className="control-section">
          <div className="section-label">选中贴纸</div>
          <div className="field-grid">
            <label className="field"><span>缩放</span><div className="field-control"><input type="number" min="0.1" max="5" step="0.1" value={selectedSticker.scaleX ?? 1} onChange={(event) => updateSticker(selectedSticker.id, { scaleX: Number(event.target.value), scaleY: Number(event.target.value) })} /></div></label>
            <label className="field"><span>旋转</span><div className="field-control"><input type="number" min="0" max="360" step="1" value={Math.round(selectedSticker.rotation ?? 0)} onChange={(event) => updateSticker(selectedSticker.id, { rotation: Number(event.target.value) })} /></div></label>
          </div>
        </div>
      )}

      <div className="control-section">
        <button className="secondary-button full" onClick={handleDownload} disabled={exporting || !baseAsset}><Download size={16} /> 下载拼贴</button>
        <button className="apply-button" onClick={handleExport} disabled={exporting || !baseAsset}><Combine size={16} /> 嵌入当前文档</button>
      </div>
    </>
  );
}
