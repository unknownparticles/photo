import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightLeft, ArrowDownToLine, Info, ArrowUpToLine, CheckCircle2, Columns3, Combine, Eye, EyeOff, Paintbrush, Pipette, Plus, RotateCcw, Shirt, Trash2, Upload } from 'lucide-react';
import type { BackgroundBrushMode, BackgroundBrushPoint, BackgroundBrushStroke, BackgroundColorSample, IdPhotoClothingLayer, IdPhotoMattingPreview, ImageAsset, SplitLine } from '../types';
import type { Notice } from '../App';
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

export function IdPhotoPanel({ asset, onPreview, onBrushApply, onLoadClothing, onApply, onStage, onStageUpdate, setNotice }: { asset: ImageAsset; onPreview: (values: CropRect, mattingMode: 'local' | 'ai' | 'none', method: 'solid' | 'connected', samples: BackgroundColorSample[], targetColor: [number, number, number] | null, tolerance: number, feather: number) => Promise<IdPhotoMattingPreview | null>; onBrushApply: (preview: IdPhotoMattingPreview, stroke: BackgroundBrushStroke) => Promise<IdPhotoMattingPreview>; onLoadClothing: (source: File | string, removeBackground: boolean) => Promise<ImageAsset | null>; onApply: (preview: IdPhotoMattingPreview, background: string, values: CropRect, mattingMode: 'local' | 'ai' | 'none', clothingLayers: IdPhotoClothingLayer[], backgroundImage?: ImageAsset) => Promise<void>; onStage: (subject: ImageAsset, opts?: { reset?: boolean }) => void; onStageUpdate: (asset: ImageAsset) => Promise<void> | void; setNotice: (notice: Notice) => void }) {
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
  const [progressLabel, setProgressLabel] = useState('');
  const [clothingBusy, setClothingBusy] = useState(false);
  const [clothingCategory, setClothingCategory] = useState<ClothingCategory>('suit');
  const [uploadMatting, setUploadMatting] = useState(false);
  const [clothingLayers, setClothingLayers] = useState<IdPhotoClothingLayer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [brushMode, setBrushMode] = useState<BackgroundBrushMode>('erase');
  const [brushEnabled, setBrushEnabled] = useState(false);
  const [brushSize, setBrushSize] = useState(64);
  const [strokePoints, setStrokePoints] = useState<BackgroundBrushPoint[]>([]);
  const brushRef = useRef(false);
  const brushPointsRef = useRef<BackgroundBrushPoint[]>([]);
  const [step, setStep] = useState(0);
  const [needMatting, setNeedMatting] = useState(true);
  const [needBackground, setNeedBackground] = useState(true);
  const [needClothing, setNeedClothing] = useState(false);
  const [framing, setFraming] = useState(true);
  const [subjectOffset, setSubjectOffset] = useState({ x: 0, y: 0 });
  const [subjectScale, setSubjectScale] = useState(100);
  const [backgroundImage, setBackgroundImage] = useState<ImageAsset | null>(null);
  const subjectDragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const subjectResizeRef = useRef<{ startX: number; startScale: number } | null>(null);
  const [values, setValues] = useState<CropRect>(() => initialIdPhotoCrop(asset.width, asset.height, sizes[0].ratio));
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ mode: 'move' | 'resize'; handle: CropHandle; start: { x: number; y: number }; initial: CropRect } | null>(null);
  const clothingDragRef = useRef<{ id: string; startX: number; startY: number; x: number; y: number } | null>(null);
  const clothingResizeRef = useRef<{ id: string; startX: number; startWidth: number } | null>(null);
  const clothingInputRef = useRef<HTMLInputElement>(null);
  const bgFileRef = useRef<HTMLInputElement>(null);
  const composeRafRef = useRef<number | null>(null);
  const overlayHost = useEditorOverlay();
  const handles: CropHandle[] = ['nw', 'ne', 'se', 'sw'];
  const selectedSize = sizes.find((item) => item.label === sizeLabel) ?? sizes[0];

  useEffect(() => {
    setValues(initialIdPhotoCrop(asset.width, asset.height, selectedSize.ratio));
    setPreview(null);
    setTargetColor(null);
    setSamples([]);
    setClothingLayers([]);
    setActiveLayerId(null);
    setStep(0);
    setFraming(true);
    setSubjectOffset({ x: 0, y: 0 });
    setSubjectScale(100);
  }, [asset.id, selectedSize.ratio]);

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

  async function generatePreview(choice: 'local' | 'ai' | 'none' = needMatting ? mattingMode : 'none') {
    if (busy) return;
    setBusy(true);
    setProgressLabel(choice === 'none' ? '正在生成取景结果…' : mattingMode === 'ai' ? '正在加载 MODNet 并抠图…' : '正在进行本地抠图…');
    try {
      const next = await onPreview(values, choice, method, samples, targetColor, tolerance, feather);
      if (!next) {
        setNotice({ type: 'error', text: '抠图失败，请检查图片或参数后重试' });
        return;
      }
      if (next.targetColor) setTargetColor(next.targetColor);
      setPreview(next);
      setFraming(false);
      onStage(next.subject);
      setNotice({ type: 'success', text: choice === 'none' ? '取景完成，已更新到中央预览' : '抠图完成，中央预览已更新' });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? `抠图出错：${error.message}` : '抠图出错，请重试' });
    } finally {
      setBusy(false);
      setProgressLabel('');
    }
  }

  function chooseNeedMatting(value: boolean) {
    setNeedMatting(value);
    setPreview(null);
    if (!value) void generatePreview('none');
  }

  function goToStep(next: number) {
    setStep(Math.max(0, Math.min(2, next)));
  }

  async function refineBrush(stroke: BackgroundBrushStroke) {
    if (!preview) return;
    setBusy(true);
    try {
      const next = await onBrushApply(preview, stroke);
      setPreview(next);
      onStage(next.subject);
      setNotice({ type: 'success', text: '边缘精修完成，已同步到中央预览' });
    } finally {
      setBusy(false);
    }
  }

  // ---- 换背景 / 换衣服的实时合成：任何变化都重画并推到中央预览顶层 ----
  const scheduleComposite = useCallback(() => {
    if (!preview) return;
    if (composeRafRef.current) cancelAnimationFrame(composeRafRef.current);
    composeRafRef.current = requestAnimationFrame(() => {
      composeRafRef.current = null;
      void (async () => {
        if (!preview) return;
        const width = preview.subject.width;
        const height = Math.round(width / selectedSize.ratio);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) return;
        if (backgroundImage) {
          const img = await new Promise<HTMLImageElement>((resolve) => { const el = new Image(); el.onload = () => resolve(el); el.src = backgroundImage.url; });
          const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
          const dw = img.naturalWidth * scale;
          const dh = img.naturalHeight * scale;
          context.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);
        } else if (needBackground) {
          context.fillStyle = background;
          context.fillRect(0, 0, width, height);
        }
        const subject = await new Promise<HTMLImageElement>((resolve) => { const el = new Image(); el.onload = () => resolve(el); el.src = preview.subject.url; });
        {
          const sw = width * subjectScale / 100;
          const sh = sw * (subject.naturalHeight / Math.max(1, subject.naturalWidth));
          context.drawImage(subject, subjectOffset.x / 100 * width, subjectOffset.y / 100 * height, sw, sh);
        }
        for (const placement of ['behind', 'front'] as const) {
          for (const layer of clothingLayers) {
            if (layer.placement !== placement || !layer.visible) continue;
            const img = await new Promise<HTMLImageElement>((resolve) => { const el = new Image(); el.onload = () => resolve(el); el.src = layer.asset.url; });
            const drawW = layer.width / 100 * width;
            const drawH = drawW * (img.naturalHeight / Math.max(1, img.naturalWidth));
            context.drawImage(img, layer.x / 100 * width, layer.y / 100 * height, drawW, drawH);
          }
          if (placement === 'behind') { const sw2 = width * subjectScale / 100; const sh2 = sw2 * (subject.naturalHeight / Math.max(1, subject.naturalWidth)); context.drawImage(subject, subjectOffset.x / 100 * width, subjectOffset.y / 100 * height, sw2, sh2); }
        }
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((result) => resolve(result ?? new Blob()), 'image/png'));
        await onStageUpdate({ id: crypto.randomUUID(), name: '证件照合成', type: 'image/png', size: blob.size, width, height, originalWidth: width, originalHeight: height, blob, url: URL.createObjectURL(blob) });
      })();
    });
  }, [preview, background, backgroundImage, needBackground, clothingLayers, selectedSize.ratio, subjectOffset, subjectScale, onStageUpdate]);

  useEffect(() => {
    if (step >= 1 && preview) scheduleComposite();
  }, [step, preview, scheduleComposite]);

  useEffect(() => {
    if (!preview || step < 1) return;
    const frame = document.getElementById('id-photo-stage-frame');
    if (!frame) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const dir = event.deltaY < 0 ? 1 : -1;
      const clothEl = (event.target as Element).closest('.clothing-canvas-layer') as HTMLElement | null;
      const id = clothEl?.getAttribute('data-layer-id');
      if (id) {
        setClothingLayers((current) => current.map((layer) => (layer.id === id ? { ...layer, width: clampValue(layer.width + dir * 5, 10, 220) } : layer)));
        setActiveLayerId(id);
      } else {
        setSubjectScale((current) => clampValue(current + dir * 5, 20, 300));
      }
      scheduleComposite();
    };
    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.removeEventListener('wheel', onWheel);
  }, [preview, step, scheduleComposite]);

  function pickBackgroundColor(event: ReactPointerEvent<HTMLDivElement>) {
    if (interaction !== 'sample' || mattingMode !== 'local') return;
    event.stopPropagation();
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
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)), y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)) };
  }

  function updateBrush(points: BackgroundBrushPoint[]) {
    brushPointsRef.current = points;
    setStrokePoints(points);
  }

  function startSubjectDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (step !== 1 && step !== 2 || brushEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    subjectDragRef.current = { startX: event.clientX, startY: event.clientY, baseX: subjectOffset.x, baseY: subjectOffset.y };
  }

  function startSubjectResize(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    subjectResizeRef.current = { startX: event.clientX, startScale: subjectScale };
  }

  function moveSubjectResize(event: ReactPointerEvent<HTMLElement>) {
    const resize = subjectResizeRef.current;
    const frame = document.getElementById('id-photo-stage-frame');
    if (!resize || !frame) return;
    setSubjectScale(clampValue(resize.startScale + (event.clientX - resize.startX) / frame.clientWidth * 100, 20, 300));
    scheduleComposite();
  }

  function endSubjectResize(event: ReactPointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    subjectResizeRef.current = null;
  }

  function moveSubjectDrag(event: ReactPointerEvent<HTMLImageElement>) {
    const drag = subjectDragRef.current;
    const frame = document.getElementById('id-photo-stage-frame');
    if (!drag || !frame) return;
    setSubjectOffset({
      x: clampValue(drag.baseX + (event.clientX - drag.startX) / frame.clientWidth * 100, -40, 40),
      y: clampValue(drag.baseY + (event.clientY - drag.startY) / frame.clientHeight * 100, -40, 40),
    });
    scheduleComposite();
  }

  function endSubjectDrag(event: ReactPointerEvent<HTMLImageElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    subjectDragRef.current = null;
  }

  function startBrush(event: ReactPointerEvent<HTMLDivElement>) {
    const point = brushPoint(event);
    if (!point || !preview || !brushEnabled) return;
    event.preventDefault();
    event.stopPropagation();
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
    await refineBrush({ mode: brushMode, size: brushSize, points });
  }

  async function addClothing(source: File | string, name: string, removeBg = false) {
    setClothingBusy(true);
    try {
      const clothingAsset = await onLoadClothing(source, removeBg);
      if (!clothingAsset) return;
      const widthPct = 80;
      const heightFraction = (widthPct / 100) * (clothingAsset.height / Math.max(1, clothingAsset.width)) * selectedSize.ratio;
      const yPct = clampValue(100 - heightFraction * 100, -30, 96);
      const layer: IdPhotoClothingLayer = { id: crypto.randomUUID(), name, asset: clothingAsset, x: 10, y: yPct, width: widthPct, visible: true, placement: 'front' };
      setClothingLayers((current) => [...current, layer]);
      setActiveLayerId(layer.id);
      setNeedClothing(true);
    } finally {
      setClothingBusy(false);
    }
  }

  function updateLayer(id: string, patch: Partial<IdPhotoClothingLayer>) {
    setClothingLayers((current) => current.map((layer) => layer.id === id ? { ...layer, ...patch } : layer));
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
    const frame = document.getElementById('id-photo-stage-frame');
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

  function startClothingResize(event: ReactPointerEvent<HTMLElement>, layer: IdPhotoClothingLayer) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    clothingResizeRef.current = { id: layer.id, startX: event.clientX, startWidth: layer.width };
    setActiveLayerId(layer.id);
  }

  function moveClothingResize(event: ReactPointerEvent<HTMLElement>) {
    const resize = clothingResizeRef.current;
    const frame = document.getElementById('id-photo-stage-frame');
    if (!resize || !frame) return;
    updateLayer(resize.id, { width: clampValue(resize.startWidth + (event.clientX - resize.startX) / frame.clientWidth * 100, 10, 220) });
  }

  function endClothingResize(event: ReactPointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    clothingResizeRef.current = null;
  }

  const previewColor = targetColor ? rgbToHex(targetColor) : '#ffffff';
  const subjectWidth = preview?.subject.width ?? asset.width;
  const subjectHeight = preview?.subject.height ?? asset.height;
  const brushPath = strokePoints.map((point) => `${point.x * subjectWidth / 100},${point.y * subjectHeight / 100}`).join(' ');
  const maxBrushSize = Math.max(80, Math.min(800, Math.round(Math.max(subjectWidth, subjectHeight) * 0.4)));
  const cropMode = step === 0 && (framing || !preview);
  const stageFrameProps = cropMode
    ? {
        id: 'id-photo-stage-frame',
        ref: frameRef,
        className: `direct-image-frame crop-interaction id-photo-stage-crop ${interaction === 'sample' ? 'is-sampling' : ''}`,
        style: { aspectRatio: `${asset.width} / ${asset.height}` },
      }
    : {
        id: 'id-photo-stage-frame',
        className: `id-photo-subject-frame clothing-composer id-photo-stage-compose ${brushEnabled ? 'brush-active' : ''}`,
        style: { backgroundColor: needBackground ? background : 'transparent', width: '100%', height: '100%' },
      };

  return <>
    <div className="panel-intro"><h3>证件照</h3><p>按向导三步完成：抠图 → 换背景 → 换衣服，结果实时显示在左侧预览。</p></div>
    <div className="control-section"><div className="id-photo-steps">{['抠图', '换背景', '换衣服'].map((label, index) => <button type="button" key={label} className={`id-photo-step ${step === index ? 'is-current' : ''} ${index < step ? 'is-done' : ''}`} onClick={() => { if (index === 0 || preview) setStep(index); }}><span>{index + 1}</span>{label}</button>)}</div></div>
    <div className="control-section"><label className="field"><span>照片规格</span><div className="field-control"><select className="select-input" value={sizeLabel} onChange={(event) => chooseSize(event.target.value)}>{sizes.map((item) => <option key={item.label}>{item.label}</option>)}</select></div></label></div>

    {busy && <div className="control-section"><div className="ai-progress is-active" aria-live="polite"><div><span>{progressLabel || '处理中…'}</span><strong>请稍候</strong></div><div className="ai-progress-track"><span className="is-indeterminate" /></div></div></div>}

    {step === 0 && <>
      <div className="control-section"><div className="section-label">第 1 步 · 是否需要抠图？</div><div className="segmented-grid two"><button type="button" className={needMatting ? 'is-selected' : ''} onClick={() => chooseNeedMatting(true)}>需要抠图</button><button type="button" className={!needMatting ? 'is-selected' : ''} onClick={() => chooseNeedMatting(false)}>跳过（保留原背景）</button></div></div>
      {needMatting && <>
        <div className="control-section"><div className="section-label">抠图方式</div><div className="segmented-grid two"><button className={mattingMode === 'local' ? 'is-selected' : ''} onClick={() => { setMattingMode('local'); setPreview(null); }}>本地抠图</button><button className={mattingMode === 'ai' ? 'is-selected' : ''} onClick={() => { setMattingMode('ai'); setInteraction('crop'); setPreview(null); }}>AI 抠图</button></div></div>
        {mattingMode === 'local' && <div className="control-section"><div className="segmented-grid two"><button className={method === 'connected' ? 'is-selected' : ''} onClick={() => { setMethod('connected'); setPreview(null); }}>联通色块</button><button className={method === 'solid' ? 'is-selected' : ''} onClick={() => { setMethod('solid'); setPreview(null); }}>全图颜色</button></div><div className="color-field"><span>默认目标颜色</span><label><input type="color" value={previewColor} onChange={(event) => { setTargetColor(hexToRgb(event.target.value)); setPreview(null); }} /><b>{previewColor.toUpperCase()}</b></label></div><div className="range-heading"><span>色彩匹配度</span><strong>{tolerance}%</strong></div><input className="range-input" type="range" min="1" max="100" value={tolerance} onChange={(event) => { setTolerance(Number(event.target.value)); setPreview(null); }} /><div className="range-heading"><span>羽化半径</span><strong>{feather} px</strong></div><input className="range-input" type="range" min="0" max="40" value={feather} onChange={(event) => { setFeather(Number(event.target.value)); setPreview(null); }} /></div>}
        {framing || !preview ? (
          <>
            {mattingMode === 'local' && <div className="segmented-grid two id-photo-interaction-tabs"><button className={interaction === 'crop' ? 'is-selected' : ''} onClick={() => setInteraction('crop')}>调整裁剪</button><button className={interaction === 'sample' ? 'is-selected' : ''} onClick={() => setInteraction('sample')}><Pipette size={13} /> 批量取色</button></div>}
            <div className="direct-tool-caption"><span>在左侧预览图上{interaction === 'sample' ? '连续点击背景取色' : '拖动裁剪框'}</span><span>{Math.round(values.width)} × {Math.round(values.height)} px</span></div>
          </>
        ) : (
          <>
            <div className="inline-info"><CheckCircle2 size={15} /><span>抠图结果已在左侧预览实时显示。</span></div>
            <button type="button" className="text-button" onClick={() => { setPreview(null); setFraming(true); }}><RotateCcw size={13} /> 重新取景</button>
          </>
        )}
        <button className="apply-button" type="button" onClick={() => void generatePreview()} disabled={busy}>{busy ? '正在生成抠图预览…' : preview ? '重新生成抠图预览' : '生成抠图并预览'}</button>
        {preview && <div className="control-section brush-control-section"><div className="section-label">边缘精修 <span className="muted">在左侧大图上涂抹</span></div><div className="segmented-grid two"><button className={brushEnabled && brushMode === 'erase' ? 'is-selected' : ''} onClick={() => { setBrushMode('erase'); setBrushEnabled(!(brushEnabled && brushMode === 'erase')); }}><Paintbrush size={13} /> 擦除背景</button><button className={brushEnabled && brushMode === 'restore' ? 'is-selected' : ''} onClick={() => { setBrushMode('restore'); setBrushEnabled(!(brushEnabled && brushMode === 'restore')); }}>还原区域</button></div>{!brushEnabled && <div className="direct-tool-caption"><span>画笔未启用：选择“擦除/还原”后可在左侧大图涂抹</span><span>默认不影响拖动人物</span></div>}<div className="range-heading"><span>画笔大小</span><strong>{brushSize} px</strong></div><input className="range-input" type="range" min="4" max={maxBrushSize} value={Math.min(brushSize, maxBrushSize)} onChange={(event) => setBrushSize(Number(event.target.value))} /></div>}
      </>}
      <div className="control-section wizard-nav"><button type="button" className="secondary-button" disabled={busy} onClick={() => { goToStep(1); if (!preview) void generatePreview(needMatting ? mattingMode : 'none'); }}>{busy ? '处理中…' : preview ? '下一步：换背景' : '生成并进入换背景'}<ArrowRightLeft size={14} /></button></div>
    </>}

    {step === 1 && <>
      <div className="control-section"><div className="section-label">第 2 步 · 是否需要换背景？</div><div className="segmented-grid two"><button type="button" className={needBackground ? 'is-selected' : ''} onClick={() => setNeedBackground(true)}>需要换背景</button><button type="button" className={!needBackground ? 'is-selected' : ''} onClick={() => setNeedBackground(false)}>跳过</button></div>{!needMatting && <div className="inline-info merge-warning"><Info size={15} /><span>当前保留了原始背景，底色切换不会生效；如需纯色底请回到第一步开启抠图。</span></div>}</div>
      {needBackground && <div className="control-section">
        <div className="segmented-grid two"><button type="button" className={!backgroundImage ? 'is-selected' : ''} onClick={() => setBackgroundImage(null)}>纯色</button><button type="button" className={backgroundImage ? 'is-selected' : ''} onClick={() => backgroundImage || bgFileRef.current?.click()}>自定义图片</button></div>
        {backgroundImage && <div className="inline-info"><CheckCircle2 size={15} /><span>已使用上传图片作为背景（自动居中裁切铺满）。</span><button type="button" className="text-button" onClick={() => setBackgroundImage(null)}>移除</button></div>}
        {!backgroundImage && <div className="color-field"><span>背景颜色（左侧实时预览）</span><label><input type="color" value={background} onChange={(event) => setBackground(event.target.value)} /><b>{background.toUpperCase()}</b></label></div>}
        <input ref={bgFileRef} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) { const url = URL.createObjectURL(file); const img = new Image(); img.onload = () => { setBackgroundImage({ id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, width: img.naturalWidth, height: img.naturalHeight, originalWidth: img.naturalWidth, originalHeight: img.naturalHeight, blob: file, url }); scheduleComposite(); }; img.src = url; } event.currentTarget.value = ''; }} />
      </div>}
      <div className="control-section wizard-nav"><button type="button" className="secondary-button" onClick={() => goToStep(0)}>上一步</button><button type="button" className="secondary-button" onClick={() => goToStep(2)}>下一步：换衣服<ArrowRightLeft size={14} /></button></div>
    </>}

    {step === 2 && <>
      <div className="control-section"><div className="section-label">第 3 步 · 是否需要换衣服？</div><div className="segmented-grid two"><button type="button" className={needClothing ? 'is-selected' : ''} onClick={() => setNeedClothing(true)}>需要换衣服</button><button type="button" className={!needClothing ? 'is-selected' : ''} onClick={() => setNeedClothing(false)}>跳过</button></div>{needClothing && <div className="direct-tool-caption"><span>在左侧大图上拖动调整位置</span><span>角点/滑杆调大小 · 拖动人物调位置</span></div>}</div>
      {needClothing && <>
        <div className="control-section clothing-section"><div className="section-label">服装素材 <span className="muted">内置 {clothingCategories.reduce((sum, item) => sum + item.count, 0)} 款</span></div><div className="clothing-category-tabs">{clothingCategories.map((category) => <button type="button" key={category.id} className={clothingCategory === category.id ? 'is-selected' : ''} onClick={() => setClothingCategory(category.id)}>{category.label}</button>)}</div><div className="clothing-library">{Array.from({ length: clothingCategories.find((item) => item.id === clothingCategory)?.count ?? 0 }, (_, index) => <button type="button" key={index} disabled={clothingBusy} onClick={() => void addClothing(clothingUrl(clothingCategory, index), `${clothingCategories.find((item) => item.id === clothingCategory)?.label} ${index + 1}`)} title={`添加${clothingCategories.find((item) => item.id === clothingCategory)?.label} ${index + 1}`}><img src={clothingUrl(clothingCategory, index)} alt={`${clothingCategory} ${index + 1}`} /><span><Plus size={12} /></span></button>)}</div><input ref={clothingInputRef} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void addClothing(file, file.name, uploadMatting); event.currentTarget.value = ''; }} /><div className="clothing-upload-row"><button type="button" className="clothing-upload-button" onClick={() => clothingInputRef.current?.click()} disabled={clothingBusy}><Upload size={14} />{clothingBusy ? '正在处理…' : '上传服装'}</button><button type="button" className={`toggle-row compact ${uploadMatting ? 'is-on' : ''}`} onClick={() => setUploadMatting((value) => !value)}><span className="toggle"><span /></span><span>上传后抠图</span></button></div></div>
        <div className="control-section"><div className="range-heading"><span>人物大小</span><strong>{Math.round(subjectScale)}%</strong></div><input className="range-input" type="range" min="20" max="300" value={Math.round(subjectScale)} onChange={(event) => { setSubjectScale(Number(event.target.value)); scheduleComposite(); }} /></div>
        {activeLayerId && clothingLayers.some((layer) => layer.id === activeLayerId) && <div className="control-section"><div className="range-heading"><span>选中服装大小</span><strong>{Math.round(clothingLayers.find((layer) => layer.id === activeLayerId)?.width ?? 0)}%</strong></div><input className="range-input" type="range" min="10" max="220" value={clothingLayers.find((layer) => layer.id === activeLayerId)?.width ?? 90} onChange={(event) => updateLayer(activeLayerId, { width: Number(event.target.value) })} /></div>}
        <div className="control-section"><div className="section-label">服装图层 <span className="muted">上方优先显示</span></div><div className="id-photo-layer-list">{[...clothingLayers].reverse().map((layer) => <div className={activeLayerId === layer.id ? 'is-active' : ''} key={layer.id} onClick={() => setActiveLayerId(layer.id)}><img src={layer.asset.url} alt="" /><span><strong>{layer.name}</strong><small>{layer.placement === 'front' ? '人物前方' : '人物后方'} · 宽度 {Math.round(layer.width)}%</small></span><button type="button" title={layer.visible ? '隐藏图层' : '显示图层'} onClick={(event) => { event.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}>{layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button><button type="button" title={layer.placement === 'front' ? '移到人物后方' : '移到人物前方'} onClick={(event) => { event.stopPropagation(); updateLayer(layer.id, { placement: layer.placement === 'front' ? 'behind' : 'front' }); }}>{layer.placement === 'front' ? <ArrowDownToLine size={14} /> : <ArrowUpToLine size={14} />}</button><button type="button" title="删除图层" onClick={(event) => { event.stopPropagation(); setClothingLayers((current) => current.filter((item) => item.id !== layer.id)); }}><Trash2 size={14} /></button></div>)}<div className="id-photo-base-layer"><Shirt size={16} /><span><strong>人物</strong><small>基础图层</small></span><Eye size={14} /></div></div></div>
      </>}
      <div className="control-section wizard-nav"><button type="button" className="secondary-button" onClick={() => goToStep(1)}>上一步</button><button className="apply-button id-photo-confirm-button" type="button" onClick={() => preview && void onApply({ ...preview, subjectOffset, subjectScale }, needBackground ? background : '#ffffff', values, needMatting ? mattingMode : 'none', clothingLayers, backgroundImage ?? undefined)} disabled={busy || clothingBusy || !preview}><CheckCircle2 size={17} /> 导出证件照</button></div>
    </>}

    {overlayHost && createPortal(
      cropMode ? (
        <div id="id-photo-stage-frame" ref={frameRef} className={`direct-image-frame crop-interaction id-photo-stage-crop ${interaction === 'sample' ? 'is-sampling' : ''}`} style={{ width: '100%', height: '100%', aspectRatio: `${asset.width} / ${asset.height}` }} onPointerDown={pickBackgroundColor} onPointerMove={moveCrop} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <img ref={imageRef} src={asset.url} alt="取景原图" draggable={false} />
          <div className="crop-box id-photo-crop-box" style={{ left: `${(values.x / asset.width) * 100}%`, top: `${(values.y / asset.height) * 100}%`, width: `${(values.width / asset.width) * 100}%`, height: `${(values.height / asset.height) * 100}%` }} onPointerDown={(event) => startDrag(event, 'move')}>
            <span className="crop-grid-line crop-grid-line-v one" /><span className="crop-grid-line crop-grid-line-v two" /><span className="crop-grid-line crop-grid-line-h one" /><span className="crop-grid-line crop-grid-line-h two" />
            {handles.map((handle) => <button type="button" aria-label={`调整证件照裁剪框 ${handle}`} className={`crop-handle ${handle}`} key={handle} onPointerDown={(event) => startDrag(event, 'resize', handle)} />)}
          </div>
          {samples.map((sample, index) => <span className="background-pick-marker id-photo-pick-marker" key={`${sample.x}-${sample.y}-${index}`} style={{ left: `${((values.x + sample.x / 100 * values.width) / asset.width) * 100}%`, top: `${((values.y + sample.y / 100 * values.height) / asset.height) * 100}%`, backgroundColor: rgbToHex(sample.color) }}>{index + 1}</span>)}
          <span className="id-photo-stage-tag">取景模式 · 拖动调整</span>
        </div>
      ) : preview ? (
        <div {...stageFrameProps} onPointerDown={startBrush} onPointerMove={moveBrush} onPointerUp={(event) => void finishBrush(event)} onPointerCancel={(event) => void finishBrush(event)}>
          {clothingLayers.filter((layer) => layer.placement === 'behind' && layer.visible).map((layer) => (
            <div className={`clothing-canvas-layer ${activeLayerId === layer.id ? 'is-active' : ''}`} key={layer.id} data-layer-id={layer.id} style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, zIndex: 1 }} onPointerDown={(event) => startClothingDrag(event, layer)} onPointerMove={moveClothing} onPointerUp={endClothingDrag} onPointerCancel={endClothingDrag}>
              <img src={layer.asset.url} alt={layer.name} />
              <span className="clothing-resize-handle" onPointerDown={(event) => startClothingResize(event, layer)} onPointerMove={moveClothingResize} onPointerUp={endClothingResize} onPointerCancel={endClothingResize} />
            </div>
          ))}
          <div
            className="id-photo-subject-wrap"
            style={{ left: `${subjectOffset.x}%`, top: `${subjectOffset.y}%`, width: `${subjectScale}%`, zIndex: 2 }}
            onPointerDown={(event) => startSubjectDrag(event)}
            onPointerMove={moveSubjectDrag}
            onPointerUp={endSubjectDrag}
            onPointerCancel={endSubjectDrag}
          >
            <img className="id-photo-subject-layer" src={preview.subject.url} alt="证件照主体" draggable={false} />
            <span className="clothing-resize-handle" title="拖动调整人物大小" onPointerDown={(event) => startSubjectResize(event)} onPointerMove={moveSubjectResize} onPointerUp={endSubjectResize} onPointerCancel={endSubjectResize} />
          </div>
          {clothingLayers.filter((layer) => layer.placement === 'front' && layer.visible).map((layer) => (
            <div className={`clothing-canvas-layer ${activeLayerId === layer.id ? 'is-active' : ''}`} key={layer.id} data-layer-id={layer.id} style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, zIndex: 3 }} onPointerDown={(event) => startClothingDrag(event, layer)} onPointerMove={moveClothing} onPointerUp={endClothingDrag} onPointerCancel={endClothingDrag}>
              <img src={layer.asset.url} alt={layer.name} />
              <span className="clothing-resize-handle" onPointerDown={(event) => startClothingResize(event, layer)} onPointerMove={moveClothingResize} onPointerUp={endClothingResize} onPointerCancel={endClothingResize} />
            </div>
          ))}
          {strokePoints.length > 0 && <svg className="brush-mask-preview" viewBox={`0 0 ${subjectWidth} ${subjectHeight}`} preserveAspectRatio="none" aria-hidden="true">{strokePoints.length === 1 ? <circle cx={strokePoints[0].x * subjectWidth / 100} cy={strokePoints[0].y * subjectHeight / 100} r={brushSize / 2} fill={brushMode === 'erase' ? '#e78f49' : '#6f9fda'} opacity=".65" /> : <polyline points={brushPath} fill="none" stroke={brushMode === 'erase' ? '#e78f49' : '#6f9fda'} strokeWidth={brushSize} strokeLinecap="round" strokeLinejoin="round" opacity=".65" />}</svg>}
          <span className="id-photo-stage-tag">实时编辑层</span>
        </div>
      ) : null,
      overlayHost,
    )}
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
