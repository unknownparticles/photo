import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { CheckCircle2, Columns3, Combine, Paintbrush, Pipette, Plus, RotateCcw, X } from 'lucide-react';
import type { BackgroundBrushMode, BackgroundBrushPoint, BackgroundBrushStroke, BackgroundColorSample, IdPhotoMattingPreview, ImageAsset, SplitLine } from '../types';

type CropRect = { x: number; y: number; width: number; height: number };
type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type IdPhotoSize = { label: string; ratio: number };

function clampValue(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function pointerInFrame(event: ReactPointerEvent<HTMLElement>, frame: HTMLDivElement) {
  const rect = frame.getBoundingClientRect();
  return { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 };
}

type CropView = { zoom: number; offsetX: number; offsetY: number };
type TouchPoint = { x: number; y: number };
type PinchGesture = { distance: number; centerX: number; centerY: number; zoom: number; offsetX: number; offsetY: number };

export function DirectCropPanel({ asset, onApply }: { asset: ImageAsset; onApply: (values: CropRect) => Promise<void> }) {
  const [values, setValues] = useState<CropRect>({ x: 0, y: 0, width: asset.width, height: asset.height });
  const [ratio, setRatio] = useState<number | null>(null);
  const [locked, setLocked] = useState(true);
  const [view, setView] = useState<CropView>({ zoom: 1, offsetX: 0, offsetY: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: 'move' | 'resize'; handle: CropHandle; start: { x: number; y: number }; initial: CropRect } | null>(null);
  const viewRef = useRef<CropView>({ zoom: 1, offsetX: 0, offsetY: 0 });
  const touchPointsRef = useRef(new Map<number, TouchPoint>());
  const pinchRef = useRef<PinchGesture | null>(null);
  const presets = [{ label: '自由', ratio: null }, { label: '1 : 1', ratio: 1 }, { label: '4 : 3', ratio: 4 / 3 }, { label: '3 : 4', ratio: 3 / 4 }, { label: '16 : 9', ratio: 16 / 9 }];
  const handles: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  useEffect(() => {
    setValues({ x: 0, y: 0, width: asset.width, height: asset.height });
    setRatio(null);
    viewRef.current = { zoom: 1, offsetX: 0, offsetY: 0 };
    setView(viewRef.current);
  }, [asset.id, asset.width, asset.height]);

  function updateView(next: CropView) {
    viewRef.current = next;
    setView(next);
  }

  function constrainView(frame: HTMLDivElement, next: CropView): CropView {
    const rect = frame.getBoundingClientRect();
    const zoom = clampValue(next.zoom, 1, 4);
    const maxOffsetX = (rect.width * (zoom - 1)) / 2;
    const maxOffsetY = (rect.height * (zoom - 1)) / 2;
    return { zoom, offsetX: clampValue(next.offsetX, -maxOffsetX, maxOffsetX), offsetY: clampValue(next.offsetY, -maxOffsetY, maxOffsetY) };
  }

  function pointerInCropSpace(event: ReactPointerEvent<HTMLElement>, frame: HTMLDivElement) {
    const point = pointerInFrame(event, frame);
    const current = viewRef.current;
    return {
      x: 50 + ((point.x - 50) - (current.offsetX / frame.clientWidth) * 100) / current.zoom,
      y: 50 + ((point.y - 50) - (current.offsetY / frame.clientHeight) * 100) / current.zoom,
    };
  }

  function pinchCenter(frame: HTMLDivElement, first: TouchPoint, second: TouchPoint) {
    const rect = frame.getBoundingClientRect();
    return { x: (first.x + second.x) / 2 - rect.left - rect.width / 2, y: (first.y + second.y) / 2 - rect.top - rect.height / 2 };
  }

  function handlePointerDownCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch') return;
    const frame = frameRef.current;
    if (!frame) return;
    touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPointsRef.current.size < 2) return;
    const [first, second] = Array.from(touchPointsRef.current.values());
    const center = pinchCenter(frame, first, second);
    pinchRef.current = {
      distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      centerX: center.x,
      centerY: center.y,
      zoom: viewRef.current.zoom,
      offsetX: viewRef.current.offsetX,
      offsetY: viewRef.current.offsetY,
    };
    dragRef.current = null;
    frame.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMoveCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch' || !touchPointsRef.current.has(event.pointerId)) return;
    touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = pinchRef.current;
    const frame = frameRef.current;
    if (!gesture || !frame || touchPointsRef.current.size < 2) return;
    const [first, second] = Array.from(touchPointsRef.current.values());
    const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
    const center = pinchCenter(frame, first, second);
    const zoom = clampValue(gesture.zoom * (distance / gesture.distance), 1, 4);
    const scale = zoom / gesture.zoom;
    updateView(constrainView(frame, {
      zoom,
      offsetX: center.x - scale * (gesture.centerX - gesture.offsetX),
      offsetY: center.y - scale * (gesture.centerY - gesture.offsetY),
    }));
    event.preventDefault();
  }

  function handlePointerUpCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch') return;
    touchPointsRef.current.delete(event.pointerId);
    if (touchPointsRef.current.size < 2) pinchRef.current = null;
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>, mode: 'move' | 'resize', handle: CropHandle = 'se') {
    const frame = frameRef.current;
    if (!frame) return;
    if (pinchRef.current) return;
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

  function setPreviewZoom(value: number) {
    const frame = frameRef.current;
    if (!frame) return;
    updateView(constrainView(frame, { ...viewRef.current, zoom: value }));
  }

  return <>
    <div className="control-section">
      <div className="section-label">裁剪比例</div>
      <div className="segmented-grid">{presets.map((preset) => <button key={preset.label} className={preset.ratio && Math.abs(values.width / values.height - preset.ratio) < 0.02 ? 'is-selected' : !preset.ratio && !ratio ? 'is-selected' : ''} onClick={() => { setRatio(preset.ratio); if (!preset.ratio) { setValues({ x: 0, y: 0, width: asset.width, height: asset.height }); return; } const width = Math.min(asset.width, Math.round(asset.height * preset.ratio)); setValues({ x: Math.round((asset.width - width) / 2), y: Math.round((asset.height - width / preset.ratio) / 2), width, height: Math.round(width / preset.ratio) }); }}>{preset.label}</button>)}</div>
    </div>
    <div className="control-section direct-tool-section">
      <div className="crop-zoom-toolbar"><span>预览缩放 <strong>{Math.round(view.zoom * 100)}%</strong></span><input aria-label="裁剪预览缩放" type="range" min="1" max="4" step="0.05" value={view.zoom} onChange={(event) => setPreviewZoom(Number(event.target.value))} /><button className="icon-button" type="button" title="重置裁剪预览缩放" aria-label="重置裁剪预览缩放" onClick={() => setPreviewZoom(1)}><RotateCcw size={14} /></button></div>
      <div className="direct-image-frame crop-interaction" ref={frameRef} style={{ aspectRatio: `${asset.width} / ${asset.height}` }} onPointerDownCapture={handlePointerDownCapture} onPointerMoveCapture={handlePointerMoveCapture} onPointerUpCapture={handlePointerUpCapture} onPointerCancelCapture={handlePointerUpCapture} onPointerMove={moveCrop} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div className="crop-viewport" style={{ transform: `translate(${view.offsetX}px, ${view.offsetY}px) scale(${view.zoom})` }}>
          <img src={asset.url} alt="可直接拖动的裁剪预览" />
          <div className="crop-box" data-crop-box style={{ left: `${(values.x / asset.width) * 100}%`, top: `${(values.y / asset.height) * 100}%`, width: `${(values.width / asset.width) * 100}%`, height: `${(values.height / asset.height) * 100}%` }} onPointerDown={(event) => startDrag(event, 'move')}>
            <span className="crop-grid-line crop-grid-line-v one" /><span className="crop-grid-line crop-grid-line-v two" /><span className="crop-grid-line crop-grid-line-h one" /><span className="crop-grid-line crop-grid-line-h two" />
            {handles.map((handle) => <button type="button" aria-label={`调整裁剪框 ${handle}`} className={`crop-handle ${handle}`} key={handle} onPointerDown={(event) => startDrag(event, 'resize', handle)} />)}
          </div>
        </div>
      </div>
      <div className="direct-tool-caption"><span>拖动边框移动</span><span>双指缩放预览</span></div>
    </div>
    <div className="control-section">
      <div className="section-label">裁剪区域 <span className="muted">px</span></div>
      <div className="field-grid">{(['x', 'y', 'width', 'height'] as const).map((key) => <label className="field" key={key}><span>{key === 'x' ? '左' : key === 'y' ? '上' : key === 'width' ? '宽' : '高'}</span><div className="field-control"><input type="number" min="0" value={Math.round(values[key])} onChange={(event) => setValues((current) => ({ ...current, [key]: Number(event.target.value) }))} /></div></label>)}</div>
      <button className={`toggle-row ${locked ? 'is-on' : ''}`} onClick={() => setLocked((value) => !value)}><span className="toggle"><span /></span><span>输入时锁定比例</span></button>
    </div>
    <button className="apply-button" onClick={() => void onApply(values)}>应用裁剪</button>
  </>;
}

export function IdPhotoPanel({ asset, onPreview, onBrushApply, onApply }: { asset: ImageAsset; onPreview: (values: CropRect, mattingMode: 'local' | 'ai', method: 'solid' | 'connected', samples: BackgroundColorSample[], targetColor: [number, number, number] | null, tolerance: number, feather: number) => Promise<IdPhotoMattingPreview | null>; onBrushApply: (preview: IdPhotoMattingPreview, stroke: BackgroundBrushStroke) => Promise<IdPhotoMattingPreview>; onApply: (preview: IdPhotoMattingPreview, background: string, values: CropRect, mattingMode: 'local' | 'ai') => Promise<void> }) {
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
  const handles: CropHandle[] = ['nw', 'ne', 'se', 'sw'];
  const selectedSize = sizes.find((item) => item.label === sizeLabel) ?? sizes[0];

  useEffect(() => {
    setValues(initialIdPhotoCrop(asset.width, asset.height, selectedSize.ratio));
    setPreview(null);
    setTargetColor(null);
    setSamples([]);
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
    {preview && <><div className="id-photo-matting-preview"><div className="section-label">抠图预览 <span className="muted">请确认边缘</span></div><div className="id-photo-subject-frame" ref={brushFrameRef} style={{ backgroundColor: background, aspectRatio: `${selectedSize.ratio}` }} onPointerDown={startBrush} onPointerMove={moveBrush} onPointerUp={(event) => void finishBrush(event)} onPointerCancel={(event) => void finishBrush(event)}><img src={preview.subject.url} alt="证件照透明抠图预览" />{strokePoints.length > 0 && <svg className="brush-mask-preview" viewBox={`0 0 ${subjectWidth} ${subjectHeight}`} preserveAspectRatio="none" aria-hidden="true">{strokePoints.length === 1 ? <circle cx={strokePoints[0].x * subjectWidth / 100} cy={strokePoints[0].y * subjectHeight / 100} r={brushSize / 2} fill={brushMode === 'erase' ? '#e78f49' : '#6f9fda'} opacity=".65" /> : <polyline points={brushPath} fill="none" stroke={brushMode === 'erase' ? '#e78f49' : '#6f9fda'} strokeWidth={brushSize} strokeLinecap="round" strokeLinejoin="round" opacity=".65" />}</svg>}</div><div className="direct-tool-caption"><span>拖动涂抹优化边缘</span><span>{busy ? '处理中…' : '透明主体预览'}</span></div></div><div className="control-section brush-control-section"><div className="segmented-grid two"><button className={brushMode === 'erase' ? 'is-selected' : ''} onClick={() => setBrushMode('erase')}><Paintbrush size={13} /> 擦除背景</button><button className={brushMode === 'restore' ? 'is-selected' : ''} onClick={() => setBrushMode('restore')}>还原区域</button></div><div className="range-heading"><span>画笔大小</span><strong>{brushSize} px</strong></div><input className="range-input" type="range" min="4" max={maxBrushSize} value={Math.min(brushSize, maxBrushSize)} onChange={(event) => setBrushSize(Number(event.target.value))} /></div><button className="apply-button id-photo-confirm-button" type="button" onClick={() => void onApply(preview, background, values, mattingMode)} disabled={busy}><CheckCircle2 size={17} /> 确认抠图并生成证件照</button></>}
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

  return <><div className="control-section"><div className="section-label">分割方式</div><div className="mode-cards">{[['horizontal', '横向', '一列多行'], ['vertical', '纵向', '一行多列'], ['grid', '网格', '行 × 列']].map(([value, label, detail]) => <button key={value} className={`mode-card ${direction === value ? 'is-selected' : ''}`} onClick={() => setDirection(value as typeof direction)}><span className="mode-symbol">{value === 'horizontal' ? <Columns3 size={17} /> : value === 'vertical' ? <Columns3 className="rotate-90" size={17} /> : <Combine size={17} />}</span><strong>{label}</strong><small>{detail}</small></button>)}</div></div><div className="control-section direct-tool-section"><div className="split-add-toolbar"><span>点击图片添加</span><button className={addOrientation === 'horizontal' ? 'is-selected' : ''} onClick={() => setAddOrientation('horizontal')}><Plus size={13} /> 横线</button><button className={addOrientation === 'vertical' ? 'is-selected' : ''} onClick={() => setAddOrientation('vertical')}><Plus size={13} /> 竖线</button></div><div className="direct-image-frame split-interaction" ref={frameRef} style={{ aspectRatio: `${asset.width} / ${asset.height}` }} onPointerDown={addLine} onPointerMove={moveLine} onPointerUp={endLineDrag} onPointerCancel={endLineDrag}>{lines.map((line) => <button type="button" aria-label={`${line.orientation === 'horizontal' ? '横向' : '纵向'}分割线`} data-split-line className={`split-line ${line.orientation}`} key={line.id} style={line.orientation === 'horizontal' ? { top: `${line.position}%` } : { left: `${line.position}%` }} onPointerDown={(event) => startLineDrag(event, line)} onDoubleClick={() => removeLine(line.id)} onContextMenu={(event) => { event.preventDefault(); removeLine(line.id); }} onKeyDown={(event) => (event.key === 'Delete' || event.key === 'Backspace') && removeLine(line.id)} />)}</div><div className="direct-tool-caption"><span>{lines.length ? `${lines.length} 条自定义分割线` : '点击图片添加分割线'}</span><span>双击或右键删除</span></div></div><div className="control-section"><div className="field-row"><label className="field"><span>{direction === 'vertical' ? '数量' : '行数'}</span><div className="field-control"><input type="number" min="1" max="12" value={rows} onChange={(event) => setRows(Number(event.target.value))} /></div></label>{direction === 'grid' && <><span className="multiply">×</span><label className="field"><span>列数</span><div className="field-control"><input type="number" min="1" max="12" value={columns} onChange={(event) => setColumns(Number(event.target.value))} /></div></label></>}</div><div className="split-visual"><span /> <span /> <span /> <span /></div></div><button className="apply-button" onClick={() => void onApply(direction, rows, columns, lines)}>生成切图</button></>;
}
