import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownToLine, ArrowUpToLine, CheckCircle2, Columns3, Combine, Eye, EyeOff, Paintbrush, Pipette, Plus, RotateCcw, Shirt, Trash2, Upload, X } from 'lucide-react';
import type { BackgroundBrushMode, BackgroundBrushPoint, BackgroundBrushStroke, BackgroundColorSample, IdPhotoClothingLayer, IdPhotoMattingPreview, ImageAsset, SplitLine } from '../types';
import { useEditorOverlay } from './EditorOverlay';

type CropRect = { x: number; y: number; width: number; height: number };
type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type IdPhotoSize = { label: string; ratio: number };
type ClothingCategory = 'suit' | 'blazer' | 'shirt' | 'tie-shirt';

const clothingCategories: Array<{ id: ClothingCategory; label: string; count: number }> = [
  { id: 'suit', label: '西服', count: 10 },
  { id: 'blazer', label: '西装', count: 5 },
  { id: 'shirt', label: '衬衫', count: 7 },
  { id: 'tie-shirt', label: '领带衬衫', count: 5 },
];

function clothingUrl(category: ClothingCategory, index: number) {
  return `${import.meta.env.BASE_URL}id-photo-clothing/${category}-${String(index + 1).padStart(2, '0')}.png`;
}

function clampValue(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function pointerInFrame(event: ReactPointerEvent<HTMLElement>, frame: HTMLDivElement) {
  const rect = frame.getBoundingClientRect();
  return { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 };
}

export function DirectCropPanel({ asset, onApply }: { asset: ImageAsset; onApply: (values: CropRect) => Promise<void> }) {
  const overlayHost = useEditorOverlay();
  const [values, setValues] = useState<CropRect>({ x: 0, y: 0, width: asset.width, height: asset.height });
  const [ratio, setRatio] = useState<number | null>(null);
  const [locked, setLocked] = useState(true);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: 'move' | 'resize'; handle: CropHandle; start: { x: number; y: number }; initial: CropRect } | null>(null);
  const presets = [{ label: '自由', ratio: null }, { label: '1 : 1', ratio: 1 }, { label: '4 : 3', ratio: 4 / 3 }, { label: '3 : 4', ratio: 3 / 4 }, { label: '16 : 9', ratio: 16 / 9 }];
  const handles: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  useEffect(() => {
    setValues({ x: 0, y: 0, width: asset.width, height: asset.height });
    setRatio(null);
  }, [asset.id, asset.width, asset.height]);

  function pointerInCropSpace(event: ReactPointerEvent<HTMLElement>, frame: HTMLDivElement) {
    return pointerInFrame(event, frame);
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>, mode: 'move' | 'resize', handle: CropHandle = 'se') {
    const frame = frameRef.current;
    if (!frame) return;
    event.preventDefault();
    event.stopPropagation();
    frame.setPointerCapture(event.pointerId);
    dragRef.current = { mode, handle, start: pointerInCropSpace(event, frame), initial: values };
  }

  function moveCrop(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const frame = frameRef.current;
    if (!drag || !frame) return;
    const point = pointerInCropSpace(event, frame);
    const dx = ((point.x - drag.start.x) / 100) * asset.width;
    const dy = ((point.y - drag.start.y) / 100) * asset.height;
    const minimum = Math.min(24, Math.min(asset.width, asset.height));
    if (drag.mode === 'move') {
      setValues({ ...drag.initial, x: clampValue(drag.initial.x + dx, 0, asset.width - drag.initial.width), y: clampValue(drag.initial.y + dy, 0, asset.height - drag.initial.height) });
      return;
    }
    let left = drag.initial.x;
    let top = drag.initial.y;
    let right = drag.initial.x + drag.initial.width;
    let bottom = drag.initial.y + drag.initial.height;
    if (drag.handle.includes('w')) left += dx;
    if (drag.handle.includes('e')) right += dx;
    if (drag.handle.includes('n')) top += dy;
    if (drag.handle.includes('s')) bottom += dy;
    if (right - left < minimum) {
      if (drag.handle.includes('w')) left = right - minimum;
      else right = left + minimum;
    }
    if (bottom - top < minimum) {
      if (drag.handle.includes('n')) top = bottom - minimum;
      else bottom = top + minimum;
    }
    if (ratio) {
      const widthDriven = drag.handle.includes('e') || drag.handle.includes('w') || (!drag.handle.includes('n') && !drag.handle.includes('s'));
      if (widthDriven) {
        const height = (right - left) / ratio;
        if (drag.handle.includes('n')) top = bottom - height;
        else bottom = top + height;
      } else {
        const width = (bottom - top) * ratio;
        if (drag.handle.includes('w')) left = right - width;
        else right = left + width;
      }
    }
    if (left < 0) { right -= left; left = 0; }
    if (top < 0) { bottom -= top; top = 0; }
    if (right > asset.width) { left -= right - asset.width; right = asset.width; }
    if (bottom > asset.height) { top -= bottom - asset.height; bottom = asset.height; }
    const width = clampValue(right - left, minimum, asset.width);
    const height = clampValue(bottom - top, minimum, asset.height);
    setValues({ x: clampValue(left, 0, asset.width - width), y: clampValue(top, 0, asset.height - height), width, height });
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current && frameRef.current?.hasPointerCapture(event.pointerId)) frameRef.current.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  const overlay = <div className="editor-tool-overlay crop-interaction" ref={frameRef} onPointerDown={(event) => event.stopPropagation()} onPointerMove={moveCrop} onPointerUp={endDrag} onPointerCancel={endDrag}><div className="crop-box" data-crop-box style={{ left: `${(values.x / asset.width) * 100}%`, top: `${(values.y / asset.height) * 100}%`, width: `${(values.width / asset.width) * 100}%`, height: `${(values.height / asset.height) * 100}%` }} onPointerDown={(event) => startDrag(event, 'move')}><span className="crop-grid-line crop-grid-line-v one" /><span className="crop-grid-line crop-grid-line-v two" /><span className="crop-grid-line crop-grid-line-h one" /><span className="crop-grid-line crop-grid-line-h two" />{handles.map((handle) => <button type="button" aria-label={`调整裁剪框 ${handle}`} className={`crop-handle ${handle}`} key={handle} onPointerDown={(event) => startDrag(event, 'resize', handle)} />)}</div></div>;

  return <>
    {overlayHost && createPortal(overlay, overlayHost)}
    <div className="control-section">
      <div className="section-label">裁剪比例</div>
      <div className="segmented-grid">{presets.map((preset) => <button key={preset.label} className={preset.ratio && Math.abs(values.width / values.height - preset.ratio) < 0.02 ? 'is-selected' : !preset.ratio && !ratio ? 'is-selected' : ''} onClick={() => { setRatio(preset.ratio); if (!preset.ratio) { setValues({ x: 0, y: 0, width: asset.width, height: asset.height }); return; } const width = Math.min(asset.width, Math.round(asset.height * preset.ratio)); setValues({ x: Math.round((asset.width - width) / 2), y: Math.round((asset.height - width / preset.ratio) / 2), width, height: Math.round(width / preset.ratio) }); }}>{preset.label}</button>)}</div>
    </div>
    <div className="inline-info"><CheckCircle2 size={16} /><span>直接在中央图片上移动或缩放裁剪框，滚轮或双指可缩放画布。</span></div>
    <div className="control-section">
      <div className="section-label">裁剪区域 <span className="muted">px</span></div>
      <div className="field-grid">{(['x', 'y', 'width', 'height'] as const).map((key) => <label className="field" key={key}><span>{key === 'x' ? '左' : key === 'y' ? '上' : key === 'width' ? '宽' : '高'}</span><div className="field-control"><input type="number" min="0" value={Math.round(values[key])} onChange={(event) => setValues((current) => ({ ...current, [key]: Number(event.target.value) }))} /></div></label>)}</div>
      <button className={`toggle-row ${locked ? 'is-on' : ''}`} onClick={() => setLocked((value) => !value)}><span className="toggle"><span /></span><span>输入时锁定比例</span></button>
    </div>
    <button className="apply-button" onClick={() => void onApply(values)}>应用裁剪</button>
  </>;
}

export function IdPhotoPanel({ asset, onPreview, onBrushApply, onLoadClothing, onApply }: { asset: ImageAsset; onPreview: (values: CropRect, mattingMode: 'local' | 'ai', method: 'solid' | 'connected', samples: BackgroundColorSample[], targetColor: [number, number, number] | null, tolerance: number, feather: number) => Promise<IdPhotoMattingPreview | null>; onBrushApply: (preview: IdPhotoMattingPreview, stroke: BackgroundBrushStroke) => Promise<IdPhotoMattingPreview>; onLoadClothing: (source: File | string, removeBackground: boolean) => Promise<ImageAsset | null>; onApply: (preview: IdPhotoMattingPreview, background: string, values: CropRect, mattingMode: 'local' | 'ai', clothingLayers: IdPhotoClothingLayer[]) => Promise<void> }) {
  const sizes: IdPhotoSize[] = [
    { label: '一寸 · 25 × 35 mm', ratio: 25 / 35 },
    { label: '二寸 · 35 × 49 mm', ratio: 35 / 49 },
    { label: '小一寸 · 22 × 32 mm', ratio: 22 / 32 },
    { label: '护照 · 35 × 45 mm', ratio: 35 / 45 },
    { label: '身份证 · 26 × 32 mm', ratio: 26 / 32 },
  ];
  const [sizeLabel, setSizeLabel] = useState(sizes[0].label);
  const [background, setBackground] = useState('#4389d6');
  const [mattingMode, setMattingMode] = useState<'local' | 'ai'>('local');
  const [method, setMethod] = useState<'solid' | 'connected'>('solid');
  const [targetColor, setTargetColor] = useState<[number, number, number] | null>(null);
  const [interaction, setInteraction] = useState<'crop' | 'sample'>('crop');
  const [samples, setSamples] = useState<BackgroundColorSample[]>([]);
  const [tolerance, setTolerance] = useState(28);
  const [feather, setFeather] = useState(3);
  const [preview, setPreview] = useState<IdPhotoMattingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [clothingBusy, setClothingBusy] = useState(false);
  const [clothingCategory, setClothingCategory] = useState<ClothingCategory>('suit');
  const [uploadMatting, setUploadMatting] = useState(false);
  const [clothingLayers, setClothingLayers] = useState<IdPhotoClothingLayer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [brushMode, setBrushMode] = useState<BackgroundBrushMode>('erase');
  const [brushSize, setBrushSize] = useState(64);
  const [strokePoints, setStrokePoints] = useState<BackgroundBrushPoint[]>([]);
  const [values, setValues] = useState<CropRect>(() => initialIdPhotoCrop(asset.width, asset.height, sizes[0].ratio));
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const brushFrameRef = useRef<HTMLDivElement>(null);
  const brushRef = useRef(false);
  const brushPointsRef = useRef<BackgroundBrushPoint[]>([]);
  const dragRef = useRef<{ mode: 'move' | 'resize'; handle: CropHandle; start: { x: number; y: number }; initial: CropRect } | null>(null);
  const clothingDragRef = useRef<{ id: string; startX: number; startY: number; x: number; y: number } | null>(null);
  const clothingInputRef = useRef<HTMLInputElement>(null);
  const handles: CropHandle[] = ['nw', 'ne', 'se', 'sw'];
  const selectedSize = sizes.find((item) => item.label === sizeLabel) ?? sizes[0];

  useEffect(() => {
    setValues(initialIdPhotoCrop(asset.width, asset.height, selectedSize.ratio));
    setPreview(null);
    setTargetColor(null);
    setSamples([]);
    setClothingLayers([]);
    setActiveLayerId(null);
  }, [asset.id, asset.width, asset.height, selectedSize.ratio]);

  function chooseSize(label: string) {
    const next = sizes.find((item) => item.label === label) ?? sizes[0];
    setSizeLabel(label);
    setValues(initialIdPhotoCrop(asset.width, asset.height, next.ratio));
    setPreview(null);
    setSamples([]);
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>, mode: 'move' | 'resize', handle: CropHandle = 'se') {
    const frame = frameRef.current;
    if (!frame) return;
    event.preventDefault();
    event.stopPropagation();
    setPreview(null);
    setSamples([]);
    frame.setPointerCapture(event.pointerId);
    const point = pointerInFrame(event, frame);
    dragRef.current = { mode, handle, start: point, initial: values };
  }

  function moveCrop(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const frame = frameRef.current;
    if (!drag || !frame) return;
    const point = pointerInFrame(event, frame);
    const dx = ((point.x - drag.start.x) / 100) * asset.width;
    const dy = ((point.y - drag.start.y) / 100) * asset.height;
    if (drag.mode === 'move') {
      setValues({ ...drag.initial, x: clampValue(drag.initial.x + dx, 0, asset.width - drag.initial.width), y: clampValue(drag.initial.y + dy, 0, asset.height - drag.initial.height) });
      return;
    }
    const horizontal = drag.handle.includes('w') ? -1 : 1;
    const vertical = drag.handle.includes('n') ? -1 : 1;
    const widthDelta = Math.abs(dx) > Math.abs(dy * selectedSize.ratio) ? dx * horizontal : dy * selectedSize.ratio * vertical;
    const width = clampValue(drag.initial.width + widthDelta, Math.min(asset.width, 40), asset.width);
    const height = width / selectedSize.ratio;
    const x = drag.handle.includes('w') ? drag.initial.x + drag.initial.width - width : drag.initial.x;
    const y = drag.handle.includes('n') ? drag.initial.y + drag.initial.height - height : drag.initial.y;
    if (x < 0 || y < 0 || x + width > asset.width || y + height > asset.height) return;
    setValues({ x, y, width, height });
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current && frameRef.current?.hasPointerCapture(event.pointerId)) frameRef.current.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  async function generatePreview() {
    setBusy(true);
    const next = await onPreview(values, mattingMode, method, samples, targetColor, tolerance, feather);
    if (next) setTargetColor(next.targetColor);
    setPreview(next);
    setBusy(false);
  }

  function pickBackgroundColor(event: ReactPointerEvent<HTMLDivElement>) {
    if (interaction !== 'sample' || mattingMode !== 'local') return;
    const frame = frameRef.current;
    const image = imageRef.current;
    if (!frame || !image) return;
    const point = pointerInFrame(event, frame);
    const imageX = point.x / 100 * asset.width;
    const imageY = point.y / 100 * asset.height;
    if (imageX < values.x || imageX > values.x + values.width || imageY < values.y || imageY > values.y + values.height) return;
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(image, imageX, imageY, 1, 1, 0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    const sample = { color: [pixel[0], pixel[1], pixel[2]] as [number, number, number], x: (imageX - values.x) / values.width * 100, y: (imageY - values.y) / values.height * 100 };
    setSamples((current) => [...current, sample]);
    setTargetColor(sample.color);
    setPreview(null);
  }

  function brushPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const frame = brushFrameRef.current;
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)), y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)) };
  }

  function updateBrush(points: BackgroundBrushPoint[]) {
    brushPointsRef.current = points;
    setStrokePoints(points);
  }

  function startBrush(event: ReactPointerEvent<HTMLDivElement>) {
    const point = brushPoint(event);
    if (!point || !preview) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    brushRef.current = true;
    updateBrush([point]);
  }

  function moveBrush(event: ReactPointerEvent<HTMLDivElement>) {
    if (!brushRef.current) return;
    const point = brushPoint(event);
    if (!point) return;
    const previous = brushPointsRef.current.at(-1);
    if (previous && Math.abs(previous.x - point.x) < 0.15 && Math.abs(previous.y - point.y) < 0.15) return;
    updateBrush([...brushPointsRef.current, point]);
  }

  async function finishBrush(event: ReactPointerEvent<HTMLDivElement>) {
    if (!brushRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    brushRef.current = false;
    const points = brushPointsRef.current;
    updateBrush([]);
    if (!preview || !points.length) return;
    setBusy(true);
    setPreview(await onBrushApply(preview, { mode: brushMode, size: brushSize, points }));
    setBusy(false);
  }

  async function addClothing(source: File | string, name: string, removeBackground = false) {
    setClothingBusy(true);
    try {
      const clothingAsset = await onLoadClothing(source, removeBackground);
      if (!clothingAsset) return;
      const layer: IdPhotoClothingLayer = { id: crypto.randomUUID(), name, asset: clothingAsset, x: 5, y: 47, width: 90, visible: true, placement: 'front' };
      setClothingLayers((current) => [...current, layer]);
      setActiveLayerId(layer.id);
    } finally {
      setClothingBusy(false);
    }
  }

  function updateLayer(id: string, values: Partial<IdPhotoClothingLayer>) {
    setClothingLayers((current) => current.map((layer) => layer.id === id ? { ...layer, ...values } : layer));
  }

  function startClothingDrag(event: ReactPointerEvent<HTMLDivElement>, layer: IdPhotoClothingLayer) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    clothingDragRef.current = { id: layer.id, startX: event.clientX, startY: event.clientY, x: layer.x, y: layer.y };
    setActiveLayerId(layer.id);
  }

  function moveClothing(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = clothingDragRef.current;
    const frame = brushFrameRef.current;
    if (!drag || !frame) return;
    updateLayer(drag.id, {
      x: clampValue(drag.x + (event.clientX - drag.startX) / frame.clientWidth * 100, -50, 100),
      y: clampValue(drag.y + (event.clientY - drag.startY) / frame.clientHeight * 100, -50, 100),
    });
  }

  function endClothingDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    clothingDragRef.current = null;
  }

  const previewColor = targetColor ? rgbToHex(targetColor) : '#ffffff';
  const subjectWidth = preview?.subject.width ?? asset.width;
  const subjectHeight = preview?.subject.height ?? asset.height;
  const brushPath = strokePoints.map((point) => `${point.x * subjectWidth / 100},${point.y * subjectHeight / 100}`).join(' ');
  const maxBrushSize = Math.max(80, Math.min(800, Math.round(Math.max(subjectWidth, subjectHeight) * 0.4)));
  return <>
    <div className="panel-intro"><h3>证件照</h3><p>先预览并调整取景位置，再将人物背景替换为纯色。</p></div>
    <div className="control-section"><label className="field"><span>照片规格</span><div className="field-control"><select className="select-input" value={sizeLabel} onChange={(event) => chooseSize(event.target.value)}>{sizes.map((item) => <option key={item.label}>{item.label}</option>)}</select></div></label><div className="color-field"><span>背景颜色</span><label><input type="color" value={background} onChange={(event) => setBackground(event.target.value)} /><b>{background.toUpperCase()}</b></label></div></div>
    <div className="control-section"><div className="section-label">抠图方式</div><div className="segmented-grid two"><button className={mattingMode === 'local' ? 'is-selected' : ''} onClick={() => { setMattingMode('local'); setPreview(null); }}>本地抠图</button><button className={mattingMode === 'ai' ? 'is-selected' : ''} onClick={() => { setMattingMode('ai'); setInteraction('crop'); setPreview(null); }}>AI 抠图</button></div><div className="direct-tool-caption"><span>{mattingMode === 'local' ? '复用抠图模块' : '复用 AI / MODNet 模块'}</span><span>先预览再确认</span></div></div>
    {mattingMode === 'local' && <div className="control-section"><div className="segmented-grid two"><button className={method === 'connected' ? 'is-selected' : ''} onClick={() => { setMethod('connected'); setPreview(null); }}>联通色块</button><button className={method === 'solid' ? 'is-selected' : ''} onClick={() => { setMethod('solid'); setPreview(null); }}>全图颜色</button></div><div className="color-field"><span>默认目标颜色</span><label><input type="color" value={previewColor} onChange={(event) => { setTargetColor(hexToRgb(event.target.value)); setPreview(null); }} /><b>{previewColor.toUpperCase()}</b></label></div><div className="range-heading"><span>色彩匹配度</span><strong>{tolerance}%</strong></div><input className="range-input" type="range" min="1" max="100" value={tolerance} onChange={(event) => { setTolerance(Number(event.target.value)); setPreview(null); }} /><div className="range-heading"><span>羽化半径</span><strong>{feather} px</strong></div><input className="range-input" type="range" min="0" max="40" value={feather} onChange={(event) => { setFeather(Number(event.target.value)); setPreview(null); }} /><div className="direct-tool-caption"><span>首次预览自动选择占比最大的颜色</span><span>参数可调整</span></div></div>}
    <div className="control-section direct-tool-section"><div className="section-label">裁剪前预览 <span className="muted">{interaction === 'sample' ? `已取 ${samples.length} 个颜色样本` : '拖动框调整位置'}</span></div>{mattingMode === 'local' && <div className="segmented-grid two id-photo-interaction-tabs"><button className={interaction === 'crop' ? 'is-selected' : ''} onClick={() => setInteraction('crop')}>调整裁剪</button><button className={interaction === 'sample' ? 'is-selected' : ''} onClick={() => setInteraction('sample')}><Pipette size={13} /> 批量取色</button></div>}<div className={`direct-image-frame crop-interaction id-photo-crop-frame ${interaction === 'sample' ? 'is-sampling' : ''}`} ref={frameRef} style={{ aspectRatio: `${asset.width} / ${asset.height}` }} onPointerDown={pickBackgroundColor} onPointerMove={moveCrop} onPointerUp={endDrag} onPointerCancel={endDrag}><img ref={imageRef} src={asset.url} alt={interaction === 'sample' ? '点击证件照背景批量取色' : '证件照裁剪前预览'} /><div className="crop-box id-photo-crop-box" style={{ left: `${(values.x / asset.width) * 100}%`, top: `${(values.y / asset.height) * 100}%`, width: `${(values.width / asset.width) * 100}%`, height: `${(values.height / asset.height) * 100}%` }} onPointerDown={(event) => startDrag(event, 'move')}><span className="crop-grid-line crop-grid-line-v one" /><span className="crop-grid-line crop-grid-line-v two" /><span className="crop-grid-line crop-grid-line-h one" /><span className="crop-grid-line crop-grid-line-h two" />{handles.map((handle) => <button type="button" aria-label={`调整证件照裁剪框 ${handle}`} className={`crop-handle ${handle}`} key={handle} onPointerDown={(event) => startDrag(event, 'resize', handle)} />)}</div>{samples.map((sample, index) => <span className="background-pick-marker id-photo-pick-marker" key={`${sample.x}-${sample.y}-${index}`} style={{ left: `${((values.x + sample.x / 100 * values.width) / asset.width) * 100}%`, top: `${((values.y + sample.y / 100 * values.height) / asset.height) * 100}%`, backgroundColor: rgbToHex(sample.color) }}>{index + 1}</span>)}</div><div className="direct-tool-caption"><span>{Math.round(values.width)} × {Math.round(values.height)} px</span><span>{interaction === 'sample' ? '在裁剪框内连续点击背景' : '拖动角点调整比例'}</span></div>{samples.length > 0 && <><div className="id-photo-sample-list">{samples.map((sample, index) => <button type="button" key={`${rgbToHex(sample.color)}-${index}`} onClick={() => { setSamples((current) => current.filter((_, sampleIndex) => sampleIndex !== index)); setPreview(null); }} title={`移除样本 ${index + 1}`}><span style={{ backgroundColor: rgbToHex(sample.color) }} />{index + 1}<X size={11} /></button>)}</div><button type="button" className="id-photo-clear-samples" onClick={() => { setSamples([]); setTargetColor(null); setPreview(null); }}><RotateCcw size={13} /> 清空 {samples.length} 个取色样本</button></>}</div>
    <button className="apply-button" type="button" onClick={() => void generatePreview()} disabled={busy}>{busy ? '正在生成抠图预览…' : preview ? '重新生成抠图预览' : '生成抠图预览'}</button>
    {preview && <><div className="id-photo-matting-preview"><div className="section-label">图层预览 <span className="muted">拖动服装调整位置</span></div><div className="id-photo-subject-frame clothing-composer" ref={brushFrameRef} style={{ backgroundColor: background, aspectRatio: `${selectedSize.ratio}` }} onPointerDown={startBrush} onPointerMove={moveBrush} onPointerUp={(event) => void finishBrush(event)} onPointerCancel={(event) => void finishBrush(event)}>{clothingLayers.filter((layer) => layer.placement === 'behind' && layer.visible).map((layer) => <div className={`clothing-canvas-layer ${activeLayerId === layer.id ? 'is-active' : ''}`} key={layer.id} style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, zIndex: 1 }} onPointerDown={(event) => startClothingDrag(event, layer)} onPointerMove={moveClothing} onPointerUp={endClothingDrag} onPointerCancel={endClothingDrag}><img src={layer.asset.url} alt={layer.name} /></div>)}<img className="id-photo-subject-layer" src={preview.subject.url} alt="证件照透明抠图预览" />{clothingLayers.filter((layer) => layer.placement === 'front' && layer.visible).map((layer) => <div className={`clothing-canvas-layer ${activeLayerId === layer.id ? 'is-active' : ''}`} key={layer.id} style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, zIndex: 3 }} onPointerDown={(event) => startClothingDrag(event, layer)} onPointerMove={moveClothing} onPointerUp={endClothingDrag} onPointerCancel={endClothingDrag}><img src={layer.asset.url} alt={layer.name} /></div>)}{strokePoints.length > 0 && <svg className="brush-mask-preview" viewBox={`0 0 ${subjectWidth} ${subjectHeight}`} preserveAspectRatio="none" aria-hidden="true">{strokePoints.length === 1 ? <circle cx={strokePoints[0].x * subjectWidth / 100} cy={strokePoints[0].y * subjectHeight / 100} r={brushSize / 2} fill={brushMode === 'erase' ? '#e78f49' : '#6f9fda'} opacity=".65" /> : <polyline points={brushPath} fill="none" stroke={brushMode === 'erase' ? '#e78f49' : '#6f9fda'} strokeWidth={brushSize} strokeLinecap="round" strokeLinejoin="round" opacity=".65" />}</svg>}</div><div className="direct-tool-caption"><span>{clothingLayers.filter((layer) => layer.visible).length ? `${clothingLayers.filter((layer) => layer.visible).length + 1} 个可见图层` : '人物图层'}</span><span>{busy ? '处理中…' : '透明主体预览'}</span></div></div><div className="control-section brush-control-section"><div className="segmented-grid two"><button className={brushMode === 'erase' ? 'is-selected' : ''} onClick={() => setBrushMode('erase')}><Paintbrush size={13} /> 擦除背景</button><button className={brushMode === 'restore' ? 'is-selected' : ''} onClick={() => setBrushMode('restore')}>还原区域</button></div><div className="range-heading"><span>画笔大小</span><strong>{brushSize} px</strong></div><input className="range-input" type="range" min="4" max={maxBrushSize} value={Math.min(brushSize, maxBrushSize)} onChange={(event) => setBrushSize(Number(event.target.value))} /></div>
    <div className="control-section clothing-section"><div className="section-label">服装素材 <span className="muted">内置 {clothingCategories.reduce((sum, item) => sum + item.count, 0)} 款</span></div><div className="clothing-category-tabs">{clothingCategories.map((category) => <button type="button" key={category.id} className={clothingCategory === category.id ? 'is-selected' : ''} onClick={() => setClothingCategory(category.id)}>{category.label}</button>)}</div><div className="clothing-library">{Array.from({ length: clothingCategories.find((item) => item.id === clothingCategory)?.count ?? 0 }, (_, index) => <button type="button" key={index} disabled={clothingBusy} onClick={() => void addClothing(clothingUrl(clothingCategory, index), `${clothingCategories.find((item) => item.id === clothingCategory)?.label} ${index + 1}`)} title={`添加${clothingCategories.find((item) => item.id === clothingCategory)?.label} ${index + 1}`}><img src={clothingUrl(clothingCategory, index)} alt={`${clothingCategory} ${index + 1}`} /><span><Plus size={12} /></span></button>)}</div><input ref={clothingInputRef} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void addClothing(file, file.name, uploadMatting); event.currentTarget.value = ''; }} /><div className="clothing-upload-row"><button type="button" className="clothing-upload-button" onClick={() => clothingInputRef.current?.click()} disabled={clothingBusy}><Upload size={14} />{clothingBusy ? '正在处理…' : '上传服装'}</button><button type="button" className={`toggle-row compact ${uploadMatting ? 'is-on' : ''}`} onClick={() => setUploadMatting((value) => !value)}><span className="toggle"><span /></span><span>上传后抠图</span></button></div></div>
    <div className="control-section"><div className="section-label">图层 <span className="muted">上方优先显示</span></div><div className="id-photo-layer-list">{[...clothingLayers].reverse().map((layer) => <div className={activeLayerId === layer.id ? 'is-active' : ''} key={layer.id} onClick={() => setActiveLayerId(layer.id)}><img src={layer.asset.url} alt="" /><span><strong>{layer.name}</strong><small>{layer.placement === 'front' ? '人物前方' : '人物后方'} · 宽度 {Math.round(layer.width)}%</small></span><button type="button" title={layer.visible ? '隐藏图层' : '显示图层'} onClick={(event) => { event.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}>{layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button><button type="button" title={layer.placement === 'front' ? '移到人物后方' : '移到人物前方'} onClick={(event) => { event.stopPropagation(); updateLayer(layer.id, { placement: layer.placement === 'front' ? 'behind' : 'front' }); }}>{layer.placement === 'front' ? <ArrowDownToLine size={14} /> : <ArrowUpToLine size={14} />}</button><button type="button" title="删除图层" onClick={(event) => { event.stopPropagation(); setClothingLayers((current) => current.filter((item) => item.id !== layer.id)); }}><Trash2 size={14} /></button></div>)}<div className="id-photo-base-layer"><Shirt size={16} /><span><strong>人物</strong><small>基础图层</small></span><Eye size={14} /></div></div>{activeLayerId && clothingLayers.some((layer) => layer.id === activeLayerId) && <><div className="range-heading"><span>服装大小</span><strong>{Math.round(clothingLayers.find((layer) => layer.id === activeLayerId)?.width ?? 0)}%</strong></div><input className="range-input" type="range" min="20" max="180" value={clothingLayers.find((layer) => layer.id === activeLayerId)?.width ?? 90} onChange={(event) => updateLayer(activeLayerId, { width: Number(event.target.value) })} /></>}</div>
    <button className="apply-button id-photo-confirm-button" type="button" onClick={() => void onApply(preview, background, values, mattingMode, clothingLayers)} disabled={busy || clothingBusy}><CheckCircle2 size={17} /> 生成证件照</button></>}
  </>;
}

function hexToRgb(value: string): [number, number, number] {
  const normalized = value.replace('#', '').padEnd(6, '0').slice(0, 6);
  return [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16)) as [number, number, number];
}

function rgbToHex(color: [number, number, number]) {
  return `#${color.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;
}

function initialIdPhotoCrop(width: number, height: number, ratio: number): CropRect {
  let cropWidth = width;
  let cropHeight = cropWidth / ratio;
  if (cropHeight > height) {
    cropHeight = height;
    cropWidth = cropHeight * ratio;
  }
  return { x: (width - cropWidth) / 2, y: (height - cropHeight) / 2, width: cropWidth, height: cropHeight };
}

export function DirectSplitPanel({ asset, onApply }: { asset: ImageAsset; onApply: (direction: 'horizontal' | 'vertical' | 'grid', rows: number, columns: number, lines?: SplitLine[]) => Promise<void> }) {
  const overlayHost = useEditorOverlay();
  const [direction, setDirection] = useState<'horizontal' | 'vertical' | 'grid'>('grid');
  const [rows, setRows] = useState(2);
  const [columns, setColumns] = useState(2);
  const [addOrientation, setAddOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
  const [lines, setLines] = useState<SplitLine[]>([]);
  const frameRef = useRef<HTMLDivElement>(null);
  const lineDragRef = useRef<{ id: string; start: number; initial: number } | null>(null);

  useEffect(() => setLines([]), [asset.id]);

  function addLine(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest('[data-split-line]')) return;
    const frame = frameRef.current;
    if (!frame) return;
    const point = pointerInFrame(event, frame);
    setLines((current) => [...current, { id: crypto.randomUUID(), orientation: addOrientation, position: clampValue(addOrientation === 'horizontal' ? point.y : point.x, 3, 97) }]);
  }

  function startLineDrag(event: ReactPointerEvent<HTMLButtonElement>, line: SplitLine) {
    const frame = frameRef.current;
    if (!frame) return;
    event.preventDefault();
    event.stopPropagation();
    frame.setPointerCapture(event.pointerId);
    const point = pointerInFrame(event as unknown as ReactPointerEvent<HTMLDivElement>, frame);
    lineDragRef.current = { id: line.id, start: line.orientation === 'horizontal' ? point.y : point.x, initial: line.position };
  }

  function moveLine(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = lineDragRef.current;
    const frame = frameRef.current;
    if (!drag || !frame) return;
    const line = lines.find((item) => item.id === drag.id);
    if (!line) return;
    const point = pointerInFrame(event, frame);
    const current = line.orientation === 'horizontal' ? point.y : point.x;
    setLines((items) => items.map((item) => item.id === drag.id ? { ...item, position: clampValue(drag.initial + current - drag.start, 3, 97) } : item));
  }

  function endLineDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (lineDragRef.current && frameRef.current?.hasPointerCapture(event.pointerId)) frameRef.current.releasePointerCapture(event.pointerId);
    lineDragRef.current = null;
  }

  function removeLine(id: string) {
    setLines((current) => current.filter((line) => line.id !== id));
  }

  const rowCount = Math.max(1, Math.min(12, Math.round(rows)));
  const columnCount = Math.max(1, Math.min(12, Math.round(columns)));
  const automaticLines: SplitLine[] = lines.length ? [] : [
    ...(direction !== 'vertical' ? Array.from({ length: rowCount - 1 }, (_, index) => ({ id: `auto-h-${index}`, orientation: 'horizontal' as const, position: ((index + 1) / rowCount) * 100 })) : []),
    ...(direction !== 'horizontal' ? Array.from({ length: columnCount - 1 }, (_, index) => ({ id: `auto-v-${index}`, orientation: 'vertical' as const, position: ((index + 1) / columnCount) * 100 })) : []),
  ];
  const overlay = <div className="editor-tool-overlay split-interaction" ref={frameRef} onPointerDown={(event) => { event.stopPropagation(); addLine(event); }} onPointerMove={moveLine} onPointerUp={endLineDrag} onPointerCancel={endLineDrag}>{automaticLines.map((line) => <span aria-hidden="true" className={`split-guide ${line.orientation}`} key={line.id} style={line.orientation === 'horizontal' ? { top: `${line.position}%` } : { left: `${line.position}%` }} />)}{lines.map((line) => <button type="button" aria-label={`${line.orientation === 'horizontal' ? '横向' : '纵向'}分割线`} data-split-line className={`split-line ${line.orientation}`} key={line.id} style={line.orientation === 'horizontal' ? { top: `${line.position}%` } : { left: `${line.position}%` }} onPointerDown={(event) => startLineDrag(event, line)} onDoubleClick={() => removeLine(line.id)} onContextMenu={(event) => { event.preventDefault(); removeLine(line.id); }} onKeyDown={(event) => (event.key === 'Delete' || event.key === 'Backspace') && removeLine(line.id)} />)}</div>;
  const automaticSummary = direction === 'horizontal' ? `${rowCount} 行` : direction === 'vertical' ? `${columnCount} 列` : `${rowCount} 行 × ${columnCount} 列`;
  return <>{overlayHost && createPortal(overlay, overlayHost)}<div className="control-section"><div className="section-label">分割方式</div><div className="mode-cards">{[['horizontal', '横向', '一列多行'], ['vertical', '纵向', '一行多列'], ['grid', '网格', '行 × 列']].map(([value, label, detail]) => <button key={value} className={`mode-card ${direction === value ? 'is-selected' : ''}`} onClick={() => setDirection(value as typeof direction)}><span className="mode-symbol">{value === 'horizontal' ? <Columns3 size={17} /> : value === 'vertical' ? <Columns3 className="rotate-90" size={17} /> : <Combine size={17} />}</span><strong>{label}</strong><small>{detail}</small></button>)}</div></div><div className="control-section direct-tool-section"><div className="split-add-toolbar"><span>点击中央图片添加</span><button className={addOrientation === 'horizontal' ? 'is-selected' : ''} onClick={() => setAddOrientation('horizontal')}><Plus size={13} /> 横线</button><button className={addOrientation === 'vertical' ? 'is-selected' : ''} onClick={() => setAddOrientation('vertical')}><Plus size={13} /> 竖线</button></div><div className="direct-tool-caption"><span>{lines.length ? `${lines.length} 条自定义分割线` : `${automaticSummary}实时预览`}</span><span>{lines.length ? '双击或右键删除' : '点击图片切换为自定义'}</span></div></div><div className="control-section"><div className="field-row"><label className="field"><span>{direction === 'vertical' ? '列数' : '行数'}</span><div className="field-control"><input type="number" min="1" max="12" value={direction === 'vertical' ? columns : rows} onChange={(event) => direction === 'vertical' ? setColumns(Number(event.target.value)) : setRows(Number(event.target.value))} /></div></label>{direction === 'grid' && <><span className="multiply">×</span><label className="field"><span>列数</span><div className="field-control"><input type="number" min="1" max="12" value={columns} onChange={(event) => setColumns(Number(event.target.value))} /></div></label></>}</div></div><button className="apply-button" onClick={() => void onApply(direction, rowCount, columnCount, lines)}>生成切图</button></>;
}
