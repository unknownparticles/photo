import { useEffect, useRef, useState } from 'react';
import type { ImageAsset, Layer } from '../types';
import { createAssetFromBlob, downloadBlob } from '../core/image';
import { Download, Eye, EyeOff, ImagePlus, Layers3, Trash2 } from 'lucide-react';

type Sticker = Layer & { visible?: boolean };

export function CollagePanel({ asset, onAddSticker, onUpdateSticker, onRemoveSticker, stickers, selectedId, setSelectedId, setNotice }: {
  asset: ImageAsset | null;
  onAddSticker: (sticker: Sticker) => void;
  onUpdateSticker: (id: string, patch: Partial<Sticker>) => void;
  onRemoveSticker: (id: string) => void;
  stickers: Sticker[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  setNotice: (notice: { type: 'success' | 'warning' | 'error'; text: string } | null) => void;
}) {
  const baseAsset = asset;
  const [canvasWidth, setCanvasWidth] = useState(asset?.width ?? 1024);
  const [canvasHeight, setCanvasHeight] = useState(asset?.height ?? 1024);
  const stickerInput = useRef<HTMLInputElement>(null);

  const selectedSticker = stickers.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (baseAsset) {
      setCanvasWidth(baseAsset.width);
      setCanvasHeight(baseAsset.height);
    }
  }, [baseAsset]);

  async function addSticker(file: File | undefined) {
    if (!file?.type.startsWith('image/')) return;
    const asset = await createAssetFromBlob(file, file.name, file);
    const id = crypto.randomUUID();
    const sticker: Sticker = {
      id,
      name: asset.name,
      type: asset.type,
      blob: asset.blob,
      url: asset.url,
      width: asset.width,
      height: asset.height,
      visible: true,
      offsetX: canvasWidth / 2 - asset.width / 2,
      offsetY: canvasHeight / 2 - asset.height / 2,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
    };
    onAddSticker(sticker);
    setSelectedId(id);
  }

  function updateSticker(id: string, patch: Partial<Sticker>) {
    onUpdateSticker(id, patch);
  }

  async function handleDownload() {
    setNotice({ type: 'success', text: '请在左侧预览中查看当前文档的拼贴结果' });
  }

  return (
    <>
      <div className="panel-intro"><h3>自由拼贴</h3><p>当前图片作为底图，导入贴纸后在左侧实时预览中拖拽、缩放、旋转。</p></div>
      <div className="control-section">
        <div className="field-grid">
          <label className="field"><span>画布宽度</span><div className="field-control"><input type="number" min="64" max="4096" value={canvasWidth} onChange={(event) => setCanvasWidth(Number(event.target.value))} /></div></label>
          <label className="field"><span>画布高度</span><div className="field-control"><input type="number" min="64" max="4096" value={canvasHeight} onChange={(event) => setCanvasHeight(Number(event.target.value))} /></div></label>
        </div>
        <button className="watermark-file-button" onClick={() => stickerInput.current?.click()}><ImagePlus size={16} /><span>添加贴纸</span></button>
        <input ref={stickerInput} type="file" accept="image/*" className="visually-hidden" onChange={(event) => { void addSticker(event.target.files?.[0]); event.currentTarget.value = ''; }} />
      </div>

      {stickers.length > 0 && (
        <div className="control-section">
          <div className="section-label">贴纸</div>
          <div className="collage-sticker-list">
            {stickers.map((sticker, index) => (
              <div key={sticker.id} className={`collage-sticker-row ${selectedId === sticker.id ? 'is-active' : ''}`}>
                <button type="button" className="layer-thumb" onClick={() => setSelectedId(sticker.id)}><img src={sticker.url} alt={sticker.name} draggable={false} /></button>
                <button type="button" className="layer-name" onClick={() => setSelectedId(sticker.id)}><strong>{sticker.name}</strong></button>
                <button type="button" className="layer-action" title="上移" onClick={() => { if (index < stickers.length - 1) { const next = [...stickers]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; onUpdateSticker(sticker.id, {}); } }}><Layers3 size={14} /></button>
                <button type="button" className="layer-action" title="下移" onClick={() => { if (index > 0) { const next = [...stickers]; [next[index], next[index - 1]] = [next[index - 1], next[index]]; onUpdateSticker(sticker.id, {}); } }}><Layers3 size={14} /></button>
                <button type="button" className="layer-action" title={sticker.visible !== false ? '隐藏' : '显示'} onClick={() => updateSticker(sticker.id, { visible: !(sticker.visible !== false) })}>{sticker.visible !== false ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                <button type="button" className="layer-action danger" title="删除" onClick={() => { onRemoveSticker(sticker.id); if (selectedId === sticker.id) setSelectedId(null); }}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedSticker && (
        <div className="control-section">
          <div className="section-label">选中贴纸</div>
          <div className="field-grid">
            <label className="field"><span>X</span><div className="field-control"><input type="number" value={Math.round(selectedSticker.offsetX)} onChange={(event) => updateSticker(selectedSticker.id, { offsetX: Number(event.target.value) })} /></div></label>
            <label className="field"><span>Y</span><div className="field-control"><input type="number" value={Math.round(selectedSticker.offsetY)} onChange={(event) => updateSticker(selectedSticker.id, { offsetY: Number(event.target.value) })} /></div></label>
            <label className="field"><span>缩放</span><div className="field-control"><input type="number" min="0.1" max="5" step="0.1" value={selectedSticker.scaleX ?? 1} onChange={(event) => updateSticker(selectedSticker.id, { scaleX: Number(event.target.value), scaleY: Number(event.target.value) })} /></div></label>
            <label className="field"><span>旋转</span><div className="field-control"><input type="number" min="0" max="360" step="1" value={Math.round(selectedSticker.rotation ?? 0)} onChange={(event) => updateSticker(selectedSticker.id, { rotation: Number(event.target.value) })} /></div></label>
          </div>
        </div>
      )}

      <div className="control-section">
        <button className="secondary-button full" onClick={handleDownload} disabled={!baseAsset}><Download size={16} /> 下载拼贴</button>
      </div>
    </>
  );
}
