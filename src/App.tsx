import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
  BadgeCheck,
  Check,
  CheckCircle2,
  CircleHelp,
  ClipboardPaste,
  Combine,
  Crop,
  Download,
  Droplets,
  Eraser,
  FileDown,
  FileImage,
  Film,
  FolderOpen,
  Gauge,
  ImagePlus,
  Info,
  Layers3,
  LockKeyhole,
  Maximize2,
  Menu,
  Moon,
  PackageOpen,
  PanelLeft,
  Paintbrush,
  Pipette,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Split,
  Sun,
  Trash2,
  Undo2,
  UploadCloud,
  WandSparkles,
  X,
  Redo2,
} from 'lucide-react';
import { aiAdapter } from './core/ai';
import {
  applyAdjustments,
  applyBackgroundBrush,
  applyCleanupBrush,
  applyWatermark,
  asProcessedAsset,
  createAssetFromBlob,
  createCollage,
  alignedCropRect,
  cropAsset,
  composeIdPhotoAsset,
  downloadBlob,
  encodeAsset,
  encodeGifFrames,
  estimateDominantColor,
  estimateBackgroundSamples,
  exportImage,
  normalizeImageOrientation,
  readImageMetadata,
  removeBackgroundAsset,
  applyLocalAiFallback,
  resizeAsset,
  splitAsset,
  updateImageMetadata,
} from './core/image';
import { useAppStore } from './store';
import type { AiCapability, AiModelId, AiRequest, AiTask, BackgroundBrushStroke, BackgroundColorSample, BatchCropAlignment, BatchOptions, BatchProgress, CleanupBrushStroke, ExportFormat, IdPhotoClothingLayer, IdPhotoMattingPreview, ImageAsset, ImageOperation, LocalBackgroundRemovalOptions, SplitLine, ToolId, WatermarkOptions } from './types';
import { DirectCropPanel, DirectSplitPanel, IdPhotoPanel } from './components/DirectImageControls';
import { EditorOverlayContext, useEditorOverlay } from './components/EditorOverlay';
import { getStoredLanguagePreference, observeDocumentLocale, resolveLocale, setStoredLanguagePreference } from './i18n';
import type { LanguagePreference } from './i18n';

type Notice = { type: 'success' | 'warning' | 'error'; text: string } | null;

type EditValues = { brightness: number; contrast: number; saturation: number; blur: number };

const defaultEditValues: EditValues = { brightness: 0, contrast: 0, saturation: 0, blur: 0 };

function editPreviewFilter(values: EditValues) {
  return `brightness(${100 + values.brightness}%) contrast(${100 + values.contrast}%) saturate(${100 + values.saturation}%) blur(${values.blur}px)`;
}

type ToolDefinition = {
  id: ToolId;
  label: string;
  description: string;
  icon: LucideIcon;
  category: '基础处理' | '智能工具' | '工作流';
  accent: string;
};

const tools: ToolDefinition[] = [
  { id: 'resize', label: '尺寸', description: '精准调整宽高', icon: Maximize2, category: '基础处理', accent: 'lime' },
  { id: 'crop', label: '裁剪', description: '比例与画布裁切', icon: Crop, category: '基础处理', accent: 'blue' },
  { id: 'split', label: '分割', description: '横纵网格切图', icon: Split, category: '基础处理', accent: 'orange' },
  { id: 'merge', label: '拼图', description: '多图自由合并', icon: Combine, category: '基础处理', accent: 'pink' },
  { id: 'compress', label: '压缩', description: '更小体积交付', icon: Gauge, category: '基础处理', accent: 'teal' },
  { id: 'convert', label: '格式', description: 'JPG / PNG / WebP', icon: ArrowRightLeft, category: '基础处理', accent: 'violet' },
  { id: 'matting', label: '抠图', description: '本地与 AI 智能抠图', icon: Eraser, category: '智能工具', accent: 'orange' },
  { id: 'cleanup', label: '消除笔', description: 'AI 去水印与普通消除', icon: Paintbrush, category: '智能工具', accent: 'pink' },
  { id: 'ai-upscale', label: 'AI 超分', description: '智能放大恢复细节', icon: Sparkles, category: '智能工具', accent: 'yellow' },
  { id: 'edit', label: '编辑', description: '色彩与滤镜', icon: SlidersHorizontal, category: '基础处理', accent: 'blue' },
  { id: 'watermark', label: '水印', description: '文字与图片标记', icon: Droplets, category: '工作流', accent: 'cyan' },
  { id: 'metadata', label: '信息', description: 'EXIF 与隐私', icon: ShieldCheck, category: '工作流', accent: 'green' },
  { id: 'batch', label: '批处理', description: '一套规则多张图', icon: Layers3, category: '工作流', accent: 'orange' },
  { id: 'gif', label: 'GIF', description: '动图帧与导出', icon: Film, category: '工作流', accent: 'purple' },
  { id: 'id-photo', label: '证件照', description: '规格快速出片', icon: BadgeCheck, category: '工作流', accent: 'red' },
];

const presets = [
  { label: '横屏 16:9', width: 1920, height: 1080 },
  { label: '头像 1:1', width: 1080, height: 1080 },
  { label: '小红书', width: 1080, height: 1350 },
  { label: '手机壁纸', width: 1080, height: 1920 },
];

const formatOptions: Array<{ label: string; value: ExportFormat }> = [
  { label: 'JPG', value: 'image/jpeg' },
  { label: 'PNG', value: 'image/png' },
  { label: 'WebP', value: 'image/webp' },
  { label: 'AVIF', value: 'image/avif' },
];

const metadataFields = [['Make', '制造商'], ['Model', '相机型号'], ['ImageDescription', '图片描述'], ['Artist', '作者'], ['Copyright', '版权'], ['DateTimeOriginal', '拍摄时间'], ['GPSLatitude', '纬度'], ['GPSLongitude', '经度']] as const;

const aiTasks: Array<{ id: AiTask; label: string; description: string; icon: LucideIcon; model: string }> = [
  { id: 'remove-background', label: 'MODNet 抠图', description: '人物主体自动分离', icon: WandSparkles, model: 'modnet' },
  { id: 'upscale', label: 'ESPCN 超分', description: '细节放大与恢复', icon: Maximize2, model: 'espcn' },
];

const aiModelDownloadSizes: Record<AiModelId, string> = {
  modnet: '约 26 MB',
  'espcn-2x': '约 87 KB',
  'espcn-4x': '约 101 KB',
};

const aiTaskLabels = Object.fromEntries(aiTasks.map((task) => [task.id, task.label])) as Record<AiTask, string>;

function aiModelId(task: AiTask, scale = 2): AiModelId {
  if (task === 'upscale') return scale === 4 ? 'espcn-4x' : 'espcn-2x';
  return 'modnet';
}

function operation(type: string, params: Record<string, unknown>): ImageOperation {
  return { id: crypto.randomUUID(), type, params, createdAt: Date.now() };
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function fileNameWithoutExtension(name: string) {
  return name.replace(/\.[^/.]+$/, '');
}

type ViewportSize = { width: number; height: number };

type PreviewPoint = { x: number; y: number };

type PreviewInteraction =
  | { type: 'pan'; start: PreviewPoint; offset: PreviewPoint }
  | { type: 'pinch'; distance: number; midpoint: PreviewPoint; zoom: number; offset: PreviewPoint }
  | null;

const MIN_PREVIEW_ZOOM = 1;
const MAX_PREVIEW_ZOOM = 4;

function distanceBetween(first: PreviewPoint, second: PreviewPoint) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function midpointBetween(first: PreviewPoint, second: PreviewPoint): PreviewPoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function clampPreviewOffset(offset: PreviewPoint, zoom: number, image: { width: number; height: number }, stage: { width: number; height: number }) {
  const maxX = Math.max(0, (image.width * zoom - stage.width) / 2);
  const maxY = Math.max(0, (image.height * zoom - stage.height) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, offset.x)),
    y: Math.max(-maxY, Math.min(maxY, offset.y)),
  };
}

function PreviewImage({ asset, editValues, onOverlayHost }: { asset: ImageAsset; editValues?: EditValues; onOverlayHost: (host: HTMLDivElement | null) => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const pointersRef = useRef(new Map<number, PreviewPoint>());
  const interactionRef = useRef<PreviewInteraction>(null);
  const [zoom, setZoom] = useState(MIN_PREVIEW_ZOOM);
  const [offset, setOffset] = useState<PreviewPoint>({ x: 0, y: 0 });
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });

  const measure = useCallback(() => {
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!stage || !image) return null;
    return {
      stage: { width: stage.clientWidth, height: stage.clientHeight },
      image: displaySize,
    };
  }, [displaySize]);

  const fitImage = useCallback(() => {
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!stage || !image?.naturalWidth || !image.naturalHeight) return;
    const scale = Math.min((stage.clientWidth - 32) / image.naturalWidth, (stage.clientHeight - 32) / image.naturalHeight, 1);
    setDisplaySize({ width: Math.max(1, image.naturalWidth * scale), height: Math.max(1, image.naturalHeight * scale) });
  }, []);

  const updateTransform = useCallback((nextZoom: number, nextOffset: PreviewPoint) => {
    const measured = measure();
    const safeZoom = Math.max(MIN_PREVIEW_ZOOM, Math.min(MAX_PREVIEW_ZOOM, nextZoom));
    const safeOffset = measured ? clampPreviewOffset(nextOffset, safeZoom, measured.image, measured.stage) : nextOffset;
    setZoom(safeZoom);
    setOffset(safeOffset);
  }, [measure]);

  function handleImageLoad() {
    fitImage();
  }

  useLayoutEffect(() => {
    const handleResize = () => fitImage();
    const observer = new ResizeObserver(handleResize);
    if (stageRef.current) observer.observe(stageRef.current);
    window.addEventListener('resize', handleResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [fitImage]);

  useLayoutEffect(() => {
    const measured = measure();
    if (!measured) return;
    setOffset((current) => clampPreviewOffset(current, zoom, measured.image, measured.stage));
  }, [displaySize.height, displaySize.width, measure, zoom]);

  useEffect(() => {
    setZoom(MIN_PREVIEW_ZOOM);
    setOffset({ x: 0, y: 0 });
    pointersRef.current.clear();
    interactionRef.current = null;
  }, [asset.id]);

  function localPoint(event: React.PointerEvent<HTMLDivElement>): PreviewPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function setZoomAtPoint(nextZoom: number, point: PreviewPoint) {
    const measured = measure();
    if (!measured) return;
    const imagePoint = {
      x: (point.x - measured.stage.width / 2 - offset.x) / zoom,
      y: (point.y - measured.stage.height / 2 - offset.y) / zoom,
    };
    const nextOffset = {
      x: point.x - measured.stage.width / 2 - imagePoint.x * nextZoom,
      y: point.y - measured.stage.height / 2 - imagePoint.y * nextZoom,
    };
    updateTransform(nextZoom, nextOffset);
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const factor = Math.exp(-event.deltaY * 0.002);
    setZoomAtPoint(zoom * factor, point);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = localPoint(event);
    pointersRef.current.set(event.pointerId, point);
    if (pointersRef.current.size >= 2) {
      const [first, second] = Array.from(pointersRef.current.values());
      interactionRef.current = { type: 'pinch', distance: distanceBetween(first, second), midpoint: midpointBetween(first, second), zoom, offset };
    } else {
      interactionRef.current = { type: 'pan', start: point, offset };
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    const point = localPoint(event);
    pointersRef.current.set(event.pointerId, point);
    const interaction = interactionRef.current;
    if (!interaction) return;
    if (interaction.type === 'pan') {
      if (pointersRef.current.size !== 1 || zoom <= MIN_PREVIEW_ZOOM) return;
      updateTransform(zoom, { x: interaction.offset.x + point.x - interaction.start.x, y: interaction.offset.y + point.y - interaction.start.y });
      return;
    }
    if (pointersRef.current.size < 2) return;
    const [first, second] = Array.from(pointersRef.current.values());
    const midpoint = midpointBetween(first, second);
    const nextZoom = interaction.zoom * (distanceBetween(first, second) / Math.max(1, interaction.distance));
    const measured = measure();
    if (!measured) return;
    const imagePoint = {
      x: (interaction.midpoint.x - measured.stage.width / 2 - interaction.offset.x) / interaction.zoom,
      y: (interaction.midpoint.y - measured.stage.height / 2 - interaction.offset.y) / interaction.zoom,
    };
    updateTransform(nextZoom, {
      x: midpoint.x - measured.stage.width / 2 - imagePoint.x * nextZoom,
      y: midpoint.y - measured.stage.height / 2 - imagePoint.y * nextZoom,
    });
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 1) {
      const [point] = Array.from(pointersRef.current.values());
      interactionRef.current = { type: 'pan', start: point, offset };
    } else if (!pointersRef.current.size) {
      interactionRef.current = null;
    }
  }

  return (
    <div
      ref={stageRef}
      className={`preview-image-viewport ${zoom > MIN_PREVIEW_ZOOM ? 'is-zoomed' : ''}`}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <div className="preview-image-canvas" style={{ width: displaySize.width, height: displaySize.height, transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})` }}>
        <img ref={imageRef} className="main-preview" src={asset.url} alt={asset.name} onLoad={handleImageLoad} style={editValues ? { filter: editPreviewFilter(editValues) } : undefined} />
        <div ref={onOverlayHost} className="editor-overlay-host" />
      </div>
    </div>
  );
}

function readViewportSize(): ViewportSize {
  if (typeof window === 'undefined') return { width: 0, height: 0 };
  return {
    width: Math.round(window.visualViewport?.width ?? window.innerWidth),
    height: Math.round(window.visualViewport?.height ?? window.innerHeight),
  };
}

function useViewportSize() {
  const [viewport, setViewport] = useState<ViewportSize>(readViewportSize);

  useEffect(() => {
    const update = () => {
      const next = readViewportSize();
      setViewport((current) => current.width === next.width && current.height === next.height ? current : next);
    };
    const visualViewport = window.visualViewport;
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    visualViewport?.addEventListener('resize', update);
    update();
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  return viewport;
}

function workspaceMetrics(viewport: ViewportSize) {
  const isMobile = viewport.width > 0 && viewport.width <= 820;
  const paddingX = Math.round(Math.min(isMobile ? 20 : 48, Math.max(isMobile ? 12 : 24, viewport.width * (isMobile ? 0.04 : 0.03))));
  const paddingY = Math.round(Math.min(isMobile ? 18 : 28, Math.max(12, viewport.height * 0.025)));
  const pageMaxWidth = 1540;
  const areaWidth = Math.max(0, Math.min(viewport.width - paddingX * 2, pageMaxWidth - paddingX * 2));
  const topbarHeight = 48;
  const fixedRowsHeight = 48 + 58 + 10;
  const areaHeight = Math.max(0, viewport.height - topbarHeight - paddingY * 2 - fixedRowsHeight);
  return { paddingX, paddingY, areaWidth, areaHeight };
}

async function fileToAsset(file: File) {
  if (!file.type.startsWith('image/')) return null;
  const [normalizedBlob, metadata] = await Promise.all([normalizeImageOrientation(file), readImageMetadata(file)]);
  const asset = await createAssetFromBlob(normalizedBlob, file.name, file);
  return metadata ? { ...asset, metadata } : asset;
}

function App() {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const viewport = useViewportSize();
  const [notice, setNotice] = useState<Notice>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>(() => getStoredLanguagePreference());
  const [batchProgress, setBatchProgress] = useState<BatchProgress>({ running: false, completed: 0, failed: 0, total: 0 });
  const {
    assets,
    activeAssetId,
    activeTool,
    history,
    addAssets,
    replaceAssets,
    setActiveAsset,
    setActiveTool,
    addOperation,
    addHistory,
    clearHistory,
    checkpoint,
    undo,
    redo,
    undoStack,
    redoStack,
  } = useAppStore();
  const activeAsset = assets.find((asset) => asset.id === activeAssetId) ?? assets[0] ?? null;
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;
  const metrics = workspaceMetrics(viewport);
  const workspaceStyle = {
    '--workspace-padding-x': `${metrics.paddingX}px`,
    '--workspace-padding-y': `${metrics.paddingY}px`,
    '--workspace-area-width': `${metrics.areaWidth}px`,
    '--workspace-area-height': `${metrics.areaHeight}px`,
  } as CSSProperties;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const locale = resolveLocale(languagePreference);

  useEffect(() => observeDocumentLocale(locale), [locale]);

  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length) await handleFiles(files, '剪贴板');
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  });

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'z') return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)) return;
      if (event.shiftKey) {
        if (!canRedo) return;
        event.preventDefault();
        redo();
        setNotice({ type: 'success', text: '已重做上一步操作' });
      } else {
        if (!canUndo) return;
        event.preventDefault();
        undo();
        setNotice({ type: 'success', text: '已撤销上一步操作' });
      }
    };
    window.addEventListener('keydown', handleHistoryShortcut);
    return () => window.removeEventListener('keydown', handleHistoryShortcut);
  }, [canRedo, canUndo, redo, undo]);

  async function handleFiles(files: File[], source = '文件') {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (!imageFiles.length) {
      setNotice({ type: 'warning', text: '没有识别到可处理的图片文件' });
      return;
    }
    try {
      const loaded = (await Promise.all(imageFiles.map(fileToAsset))).filter((asset): asset is ImageAsset => Boolean(asset));
      checkpoint();
      addAssets(loaded);
      setNotice({ type: 'success', text: `${source}导入 ${loaded.length} 张图片，文件仍只在本机处理` });
      if (!activeTool) setActiveTool('resize');
    } catch {
      setNotice({ type: 'error', text: '图片读取失败，请尝试其他文件' });
    }
  }

  function chooseTool(tool: ToolId) {
    setActiveTool(tool);
    if (!assets.length) fileInput.current?.click();
  }

  function handleLanguageChange(preference: LanguagePreference) {
    setLanguagePreference(preference);
    setStoredLanguagePreference(preference);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    void handleFiles(Array.from(event.dataTransfer.files), '拖拽');
  }

  function clearAssets() {
    if (!assets.length) return;
    checkpoint();
    replaceAssets([]);
    setActiveTool(null);
    setNotice(null);
  }

  function deleteAsset(id: string) {
    const target = assets.find((asset) => asset.id === id);
    if (!target) return;
    const wasActive = activeAsset?.id === id;
    const targetIndex = assets.findIndex((asset) => asset.id === id);
    const remaining = assets.filter((asset) => asset.id !== id);
    checkpoint();
    replaceAssets(remaining);
    const nextActive = wasActive
      ? remaining[Math.min(targetIndex, remaining.length - 1)]
      : remaining.find((asset) => asset.id === activeAsset?.id);
    setActiveAsset(nextActive?.id ?? null);
    if (!remaining.length) setActiveTool(null);
    setNotice({ type: 'success', text: `已删除 ${target.name}` });
  }

  function openTool(tool: ToolId) {
    setActiveTool(tool);
    setNotice(null);
  }

  async function replaceActive(next: ImageAsset, label: string, detail: string) {
    if (!activeAsset) return;
    checkpoint();
    replaceAssets(assets.map((asset) => (asset.id === activeAsset.id ? next : asset)));
    setActiveAsset(next.id);
    addOperation(operation(label, { detail }));
    addHistory({ name: activeAsset.name, label, detail });
    setNotice({ type: 'success', text: `${label}完成` });
  }

  async function applyResize(width: number, height: number) {
    if (!activeAsset || width < 1 || height < 1) return;
    await replaceActive(await resizeAsset(activeAsset, width, height), '调整尺寸', `${width} × ${height}`);
  }

  async function applyCrop(values: { x: number; y: number; width: number; height: number }) {
    if (!activeAsset) return;
    await replaceActive(await cropAsset(activeAsset, values.x, values.y, values.width, values.height), '裁剪', `${values.width} × ${values.height}`);
  }

  async function previewIdPhoto(values: { x: number; y: number; width: number; height: number }, mattingMode: 'local' | 'ai', method: 'solid' | 'connected', samples: BackgroundColorSample[], targetColor: [number, number, number] | null, tolerance: number, feather: number) {
    if (!activeAsset) return null;
    try {
      const cropped = await cropAsset(activeAsset, values.x, values.y, values.width, values.height, '证件照裁剪');
      const dominantColor = targetColor ?? await estimateDominantColor(cropped);
      const targetColors = samples.length ? samples.map((sample) => sample.color) : [dominantColor];
      const seeds = samples.map(({ x, y }) => ({ x, y }));
      const subject = mattingMode === 'ai'
        ? await aiAdapter.run(cropped, { modelId: 'modnet' })
        : await removeBackgroundAsset(cropped, { method, targetColor: targetColors[0], targetColors, seedX: seeds[0]?.x ?? 0, seedY: seeds[0]?.y ?? 0, seeds, tolerance, feather });
      return { subject, source: cropped, targetColor: targetColors[0], targetColors } satisfies IdPhotoMattingPreview;
    } catch (error) {
      setNotice({ type: 'warning', text: error instanceof Error ? error.message : '证件照抠图失败，请检查抠图模块配置' });
      return null;
    }
  }

  async function brushIdPhoto(preview: IdPhotoMattingPreview, stroke: BackgroundBrushStroke) {
    const subject = await applyBackgroundBrush(preview.subject, preview.source, stroke);
    return { ...preview, subject };
  }

  async function loadIdPhotoClothing(source: File | string, removeBackground: boolean) {
    try {
      const blob = typeof source === 'string' ? await fetch(source).then((response) => {
        if (!response.ok) throw new Error('服装素材读取失败');
        return response.blob();
      }) : await normalizeImageOrientation(source);
      const name = typeof source === 'string' ? source.split('/').at(-1) ?? '服装.png' : source.name;
      const clothing = await createAssetFromBlob(blob, name, typeof source === 'string' ? undefined : source);
      if (!removeBackground) return clothing;
      const targetColor = await estimateDominantColor(clothing);
      return removeBackgroundAsset(clothing, { method: 'solid', targetColor, targetColors: [targetColor], seedX: 0, seedY: 0, tolerance: 28, feather: 3 });
    } catch (error) {
      setNotice({ type: 'warning', text: error instanceof Error ? error.message : '服装素材处理失败' });
      return null;
    }
  }

  async function applyIdPhoto(preview: IdPhotoMattingPreview, background: string, values: { width: number; height: number }, mattingMode: 'local' | 'ai', clothingLayers: IdPhotoClothingLayer[]) {
    const next = await composeIdPhotoAsset(preview.subject, background, clothingLayers);
    const clothingDetail = clothingLayers.length ? ` · ${clothingLayers.length} 个服装图层` : '';
    await replaceActive(next, '生成证件照', `${Math.round(values.width)} × ${Math.round(values.height)} · ${mattingMode === 'ai' ? 'AI 抠图' : '本地抠图'}${clothingDetail} · ${background.toUpperCase()}`);
  }

  async function applyEdit(values: EditValues) {
    if (!activeAsset) return;
    await replaceActive(await applyAdjustments(activeAsset, values), '图片编辑', '色彩调整');
  }

  async function applyMatting(request: LocalBackgroundRemovalOptions) {
    if (!activeAsset) return;
    const next = await removeBackgroundAsset(activeAsset, request);
    await replaceActive(next, '本地抠图', request.method === 'solid' ? '纯色批量抠除' : '联通色块抠除');
  }

  async function applyAi(request: AiRequest) {
    if (!activeAsset) return;
    if (request.mode === 'model') {
      try {
        const next = await aiAdapter.run(activeAsset, { modelId: aiModelId(request.task, request.scale), scale: request.scale });
        await replaceActive(next, aiTaskLabels[request.task], `本地模型 · ${request.task === 'upscale' ? `${request.scale ?? 2} 倍` : '按模型输出'}`);
      } catch (error) {
        setNotice({ type: 'warning', text: error instanceof Error ? error.message : 'AI 模型暂不可用，请先准备模型' });
      }
      return;
    }
    try {
      const next = await applyLocalAiFallback(activeAsset, request.task, request.scale);
      await replaceActive(next, `${aiTaskLabels[request.task]}（本地降级）`, '未加载模型，使用浏览器处理');
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '本地降级处理失败' });
    }
  }

  async function applyAiBrush(sourceAsset: ImageAsset, stroke: BackgroundBrushStroke) {
    if (!activeAsset) return;
    const next = await applyBackgroundBrush(activeAsset, sourceAsset, stroke);
    await replaceActive(next, stroke.mode === 'erase' ? '抠图擦除' : '抠图还原', `${stroke.mode === 'erase' ? '擦除' : '还原'} · 画笔 ${Math.round(stroke.size)} px`);
  }

  async function applyCleanup(stroke: CleanupBrushStroke) {
    if (!activeAsset) return;
    try {
      const next = await applyCleanupBrush(activeAsset, stroke);
      await replaceActive(next, stroke.mode === 'ai' ? 'AI 去水印' : '普通消除笔', `智能填充 · 画笔 ${Math.round(stroke.size)} px`);
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '消除处理失败' });
    }
  }

  async function applyWatermarkValue(options: WatermarkOptions) {
    if (!activeAsset || (options.kind === 'text' && !options.text.trim()) || (options.kind === 'image' && !options.image)) return;
    await replaceActive(await applyWatermark(activeAsset, options), '添加水印', options.kind === 'text' ? options.text : '图片水印');
  }

  async function applyMetadataValue(values: Record<string, string>) {
    if (!activeAsset) return;
    const metadata = { ...(activeAsset.metadata ?? {}) };
    Object.entries(values).forEach(([key, value]) => {
      if (value.trim()) metadata[key] = value.trim();
      else delete metadata[key];
    });
    const format = activeAsset.type === 'image/jpeg' || activeAsset.type === 'image/png' ? activeAsset.type : 'image/jpeg';
    const blob = await encodeAsset(asProcessedAsset(activeAsset), {
      format,
      quality: 0.94,
      background: '#ffffff',
      preserveTransparency: format !== 'image/jpeg',
      preserveMetadata: false,
    });
    const updatedBlob = await updateImageMetadata(blob, metadata);
    const next = await createAssetFromBlob(updatedBlob, `${fileNameWithoutExtension(activeAsset.name)}.${format === 'image/jpeg' ? 'jpg' : 'png'}`);
    await replaceActive({ ...next, metadata }, '修改照片信息', '已写入常见照片信息');
  }

  async function clearMetadataValue() {
    if (!activeAsset) return;
    const format = activeAsset.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await encodeAsset(asProcessedAsset(activeAsset), {
      format,
      quality: 0.94,
      background: '#ffffff',
      preserveTransparency: format !== 'image/jpeg',
      preserveMetadata: false,
    });
    const next = await createAssetFromBlob(blob, `${fileNameWithoutExtension(activeAsset.name)}.${format === 'image/jpeg' ? 'jpg' : 'png'}`);
    await replaceActive(next, '清除照片数据', '已移除 EXIF 与 GPS');
  }

  async function applyEncoding(format: ExportFormat, quality: number, background: string) {
    if (!activeAsset) return;
    const blob = await encodeAsset(asProcessedAsset(activeAsset), {
      format,
      quality,
      background,
      preserveTransparency: format !== 'image/jpeg',
      preserveMetadata: false,
    });
    const next = await createAssetFromBlob(blob, `${fileNameWithoutExtension(activeAsset.name)}.${format.split('/')[1].replace('jpeg', 'jpg')}`);
    await replaceActive(next, format === 'image/jpeg' ? '压缩图片' : '转换格式', `${format} · ${formatBytes(blob.size)}`);
  }

  async function applySplit(direction: 'horizontal' | 'vertical' | 'grid', rows: number, columns: number, lines: SplitLine[] = []) {
    if (!activeAsset) return;
    const pieces = await splitAsset(activeAsset, rows, columns, direction, lines);
    checkpoint();
    addAssets(pieces);
    setActiveAsset(pieces[0]?.id ?? activeAsset.id);
    addHistory({ name: activeAsset.name, label: '分割图片', detail: `${pieces.length} 张` });
    setNotice({ type: 'success', text: `已生成 ${pieces.length} 张切图` });
  }

  async function applyMerge(layout: 'horizontal' | 'vertical' | 'grid', gap: number, background: string) {
    if (assets.length < 2) {
      setNotice({ type: 'warning', text: '至少导入两张图片才能拼图' });
      return;
    }
    const merged = await createCollage(assets, layout, gap, background);
    checkpoint();
    addAssets([merged]);
    setActiveAsset(merged.id);
    addHistory({ name: merged.name, label: '图片拼图', detail: `${assets.length} 张图片` });
    setNotice({ type: 'success', text: '拼图已生成，可继续编辑或导出' });
  }

  async function exportActive(format: ExportFormat = 'image/png', quality = 0.88) {
    if (!activeAsset) return;
    await exportImage(asProcessedAsset(activeAsset), {
      format,
      quality,
      background: '#ffffff',
      preserveTransparency: format !== 'image/jpeg',
      preserveMetadata: false,
    });
    setNotice({ type: 'success', text: `已下载 ${activeAsset.name}` });
  }

  async function exportAll() {
    for (const asset of assets) {
      await exportImage(asProcessedAsset(asset), {
        format: asset.type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
        quality: 0.88,
        background: '#ffffff',
        preserveTransparency: asset.type !== 'image/jpeg',
        preserveMetadata: false,
      });
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
    setNotice({ type: 'success', text: `已准备下载 ${assets.length} 张图片` });
  }

  async function exportGif() {
    if (assets.length < 2) {
      setNotice({ type: 'warning', text: 'GIF 合成至少需要两张图片' });
      return;
    }
    const blob = await encodeGifFrames(assets, 8);
    downloadBlob(blob, 'alun-image-animation.gif');
    setNotice({ type: 'success', text: 'GIF 已导出' });
  }

  async function applyBatch(options: BatchOptions) {
    if (!assets.length || batchProgress.running) return;
    const nextAssets: ImageAsset[] = [];
    let failed = 0;
    setBatchProgress({ running: true, completed: 0, failed: 0, total: assets.length });
    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index];
      setBatchProgress({ running: true, completed: index, failed, total: assets.length, currentName: asset.name });
      try {
        let next: ImageAsset;
        if (options.kind === 'matting') {
          const samples = await estimateBackgroundSamples(asset, options.sampling);
          next = await removeBackgroundAsset(asset, {
            method: samples.method,
            targetColor: samples.colors[0],
            targetColors: samples.colors,
            seedX: samples.seeds[0].x,
            seedY: samples.seeds[0].y,
            seeds: samples.seeds,
            tolerance: options.tolerance,
            feather: options.feather,
          });
        } else if (options.kind === 'crop') {
          const rect = alignedCropRect(asset.width, asset.height, options.width, options.height, options.alignment);
          next = await cropAsset(asset, rect.x, rect.y, rect.width, rect.height, '批量裁剪');
        } else if (options.kind === 'upscale') {
          try {
            next = await aiAdapter.run(asset, { modelId: aiModelId('upscale', options.scale), scale: options.scale });
          } catch {
            next = await applyLocalAiFallback(asset, 'upscale', options.scale);
          }
        } else if (options.kind === 'rename') {
          const extension = asset.name.match(/\.([^.]+)$/)?.[1] ?? asset.type.split('/')[1].replace('jpeg', 'jpg');
          const sequence = String(options.start + index).padStart(options.digits, '0');
          const name = `${options.template.replaceAll('{name}', fileNameWithoutExtension(asset.name)).replaceAll('{n}', sequence)}.${extension}`;
          next = { ...asset, id: crypto.randomUUID(), name };
        } else {
          const blob = await encodeAsset(asProcessedAsset(asset), { format: options.format, quality: options.quality, background: '#ffffff', preserveTransparency: options.format !== 'image/jpeg', preserveMetadata: false });
          next = await createAssetFromBlob(blob, `${fileNameWithoutExtension(asset.name)}.${options.format === 'image/jpeg' ? 'jpg' : 'webp'}`);
        }
        nextAssets.push(next);
      } catch {
        failed += 1;
        nextAssets.push(asset);
      }
      setBatchProgress({ running: true, completed: index + 1, failed, total: assets.length, currentName: asset.name });
    }
    checkpoint();
    replaceAssets(nextAssets);
    const labels: Record<BatchOptions['kind'], string> = { matting: '批量抠图', crop: '批量裁剪', upscale: '批量超分', rename: '批量改名', compress: '批量压缩' };
    addHistory({ name: `${assets.length} 张图片`, label: labels[options.kind], detail: failed ? `${assets.length - failed} 成功 · ${failed} 失败` : '全部成功' });
    setBatchProgress({ running: false, completed: assets.length, failed, total: assets.length });
    setNotice({ type: failed ? 'warning' : 'success', text: failed ? `批量处理完成：${assets.length - failed} 张成功，${failed} 张保留原图` : `批量处理完成，共 ${nextAssets.length} 张` });
  }

  const pageClass = `app-shell ${theme === 'dark' ? 'theme-dark' : ''} ${assets.length ? 'has-workspace' : ''}`;

  return (
    <div className={pageClass} style={assets.length ? workspaceStyle : undefined}>
      <input ref={fileInput} className="visually-hidden" type="file" accept="image/*" multiple onChange={(event) => void handleFiles(Array.from(event.target.files ?? []))} />
      <input ref={folderInput} className="visually-hidden" type="file" accept="image/*" multiple {...({ webkitdirectory: '' } as Record<string, string>)} onChange={(event) => void handleFiles(Array.from(event.target.files ?? []), '文件夹')} />
      <header className="topbar">
        <button className="brand" onClick={clearAssets} aria-label="返回 Alun Image 首页">
          <span className="brand-mark">AI</span>
          <span className="brand-copy"><strong>Alun Image</strong><small>LOCAL IMAGE LAB</small></span>
        </button>
        <div className="topbar-actions">
          <span className="secure-chip"><LockKeyhole size={13} /> 本地处理</span>
          <button className="icon-button" title="查看处理历史" onClick={() => setShowHistory((value) => !value)}><RotateCcw size={17} /></button>
          <button className="icon-button" title="切换主题" onClick={() => setTheme((value) => value === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}</button>
          <button className="icon-button" title="设置" onClick={() => setShowSettings((value) => !value)}><Settings2 size={17} /></button>
          <button className="menu-button" title="打开菜单"><Menu size={18} /></button>
        </div>
      </header>

      {showHistory && <HistoryPopover history={history} onClear={clearHistory} onClose={() => setShowHistory(false)} />}
      {showSettings && <SettingsPopover languagePreference={languagePreference} onLanguageChange={handleLanguageChange} onClose={() => setShowSettings(false)} />}
      {notice && <NoticeBanner notice={notice} onClose={() => setNotice(null)} />}

      {!assets.length ? (
        <HomeScreen
          tools={tools}
          onChooseTool={chooseTool}
          onOpenFiles={() => fileInput.current?.click()}
          onOpenFolder={() => folderInput.current?.click()}
          isDragging={isDragging}
          onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        />
      ) : (
        <Workspace
          assets={assets}
          activeAsset={activeAsset}
          activeTool={activeTool ?? 'resize'}
          onSelectAsset={setActiveAsset}
          onSelectTool={openTool}
          onAddFiles={() => fileInput.current?.click()}
          onClear={clearAssets}
          onExport={() => void exportActive()}
          onExportAll={() => void exportAll()}
          onResize={applyResize}
          onCrop={applyCrop}
          onIdPhotoPreview={previewIdPhoto}
          onIdPhotoBrush={brushIdPhoto}
          onIdPhotoClothing={loadIdPhotoClothing}
          onIdPhoto={applyIdPhoto}
          onSplit={applySplit}
          onMerge={applyMerge}
          onEncode={applyEncoding}
          onEdit={applyEdit}
          onMattingApply={applyMatting}
          onMattingBrushApply={applyAiBrush}
          onAiApply={applyAi}
          onCleanup={applyCleanup}
          onWatermark={applyWatermarkValue}
          onMetadata={applyMetadataValue}
          onClearMetadata={clearMetadataValue}
          onExportGif={exportGif}
          onBatch={applyBatch}
          batchProgress={batchProgress}
          onDeleteAsset={deleteAsset}
          onUndo={() => { undo(); setNotice({ type: 'success', text: '已撤销上一步操作' }); }}
          onRedo={() => { redo(); setNotice({ type: 'success', text: '已重做上一步操作' }); }}
          canUndo={canUndo}
          canRedo={canRedo}
          setNotice={setNotice}
        />
      )}

      <footer className="site-footer">
        <span><ShieldCheck size={14} /> 图片默认只在你的设备上处理，不会上传服务器</span>
        <span>Alun Image <i>0.1</i></span>
      </footer>
    </div>
  );
}

function HomeScreen({
  tools: availableTools,
  onChooseTool,
  onOpenFiles,
  onOpenFolder,
  isDragging,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  tools: ToolDefinition[];
  onChooseTool: (tool: ToolId) => void;
  onOpenFiles: () => void;
  onOpenFolder: () => void;
  isDragging: boolean;
  onDragEnter: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <main className="home-page">
      <section className="hero-section">
        <div className="hero-kicker"><span className="status-dot" /> 你的图片工作台 · 立即可用</div>
        <h1>把图片处理，<em>留在本地。</em></h1>
        <p className="hero-subtitle">从尺寸、裁剪到压缩与批量导出，一个安静、快速、隐私优先的图片工具箱。</p>
        <div
          className={`dropzone ${isDragging ? 'is-dragging' : ''}`}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={onOpenFiles}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => event.key === 'Enter' && onOpenFiles()}
        >
          <div className="dropzone-icon"><UploadCloud size={27} strokeWidth={1.7} /></div>
          <div className="dropzone-copy"><strong>{isDragging ? '松开即可导入' : '拖入图片到这里'}</strong><span>或点击选择图片 · 支持多选与粘贴</span></div>
          <button className="primary-button" onClick={(event) => { event.stopPropagation(); onOpenFiles(); }}><ImagePlus size={17} /> 选择图片</button>
          <button className="text-button" onClick={(event) => { event.stopPropagation(); onOpenFolder(); }}><FolderOpen size={15} /> 导入文件夹</button>
        </div>
        <div className="upload-meta"><span><ClipboardPaste size={14} /> 支持从剪贴板粘贴</span><span><LockKeyhole size={14} /> 无需注册，无需上传</span><span><PackageOpen size={14} /> 支持批量文件</span></div>
      </section>
      <section className="toolbox-section">
        <div className="section-heading"><div><span className="eyebrow">TOOLKIT</span><h2>选择一个工具开始</h2></div><span className="tool-count">{availableTools.length} 个工具</span></div>
        <div className="tool-groups">
          {(['基础处理', '智能工具', '工作流'] as const).map((category) => (
            <div className="tool-group" key={category} data-tool-category={category === '智能工具' ? 'smart' : category === '基础处理' ? 'basic' : 'workflow'}>
              <div className="group-label"><span>{category}</span><span className="group-line" /></div>
              <div className="tool-grid">
                {availableTools.filter((tool) => tool.category === category).map((tool) => <ToolCard key={tool.id} tool={tool} onClick={() => onChooseTool(tool.id)} />)}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="home-note"><div className="note-icon"><ShieldCheck size={18} /></div><div><strong>隐私是默认设置</strong><p>图片处理在浏览器 Canvas 中完成，原图不会离开你的设备。AI 能力也优先使用本地 WebGPU / WASM。</p></div><ArrowRightLeft size={17} /></section>
    </main>
  );
}

function ToolCard({ tool, onClick }: { tool: ToolDefinition; onClick: () => void }) {
  const Icon = tool.icon;
  return <button className={`tool-card accent-${tool.accent}`} data-tool-id={tool.id} onClick={onClick}><span className="tool-card-icon"><Icon size={19} /></span><span className="tool-card-copy"><strong>{tool.label}</strong><small>{tool.description}</small></span><ArrowRightLeft className="tool-arrow" size={15} /></button>;
}

function Workspace({
  assets,
  activeAsset,
  activeTool,
  onSelectAsset,
  onSelectTool,
  onAddFiles,
  onClear,
  onExport,
  onExportAll,
  onResize,
  onCrop,
  onIdPhotoPreview,
  onIdPhotoBrush,
  onIdPhotoClothing,
  onIdPhoto,
  onSplit,
  onMerge,
  onEncode,
  onEdit,
  onMattingApply,
  onMattingBrushApply,
  onAiApply,
  onCleanup,
  onWatermark,
  onMetadata,
  onClearMetadata,
  onExportGif,
  onBatch,
  batchProgress,
  onDeleteAsset,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  setNotice,
}: {
  assets: ImageAsset[];
  activeAsset: ImageAsset | null;
  activeTool: ToolId;
  onSelectAsset: (id: string) => void;
  onSelectTool: (tool: ToolId) => void;
  onAddFiles: () => void;
  onClear: () => void;
  onExport: () => void;
  onExportAll: () => void;
  onResize: (width: number, height: number) => Promise<void>;
  onCrop: (values: { x: number; y: number; width: number; height: number }) => Promise<void>;
  onIdPhotoPreview: (values: { x: number; y: number; width: number; height: number }, mattingMode: 'local' | 'ai', method: 'solid' | 'connected', samples: BackgroundColorSample[], targetColor: [number, number, number] | null, tolerance: number, feather: number) => Promise<IdPhotoMattingPreview | null>;
  onIdPhotoBrush: (preview: IdPhotoMattingPreview, stroke: BackgroundBrushStroke) => Promise<IdPhotoMattingPreview>;
  onIdPhotoClothing: (source: File | string, removeBackground: boolean) => Promise<ImageAsset | null>;
  onIdPhoto: (preview: IdPhotoMattingPreview, background: string, values: { width: number; height: number }, mattingMode: 'local' | 'ai', clothingLayers: IdPhotoClothingLayer[]) => Promise<void>;
  onSplit: (direction: 'horizontal' | 'vertical' | 'grid', rows: number, columns: number, lines?: SplitLine[]) => Promise<void>;
  onMerge: (layout: 'horizontal' | 'vertical' | 'grid', gap: number, background: string) => Promise<void>;
  onEncode: (format: ExportFormat, quality: number, background: string) => Promise<void>;
  onEdit: (values: EditValues) => Promise<void>;
  onMattingApply: (request: LocalBackgroundRemovalOptions) => Promise<void>;
  onMattingBrushApply: (sourceAsset: ImageAsset, stroke: BackgroundBrushStroke) => Promise<void>;
  onAiApply: (request: AiRequest) => Promise<void>;
  onCleanup: (stroke: CleanupBrushStroke) => Promise<void>;
  onWatermark: (options: WatermarkOptions) => Promise<void>;
  onMetadata: (values: Record<string, string>) => Promise<void>;
  onClearMetadata: () => Promise<void>;
  onExportGif: () => Promise<void>;
  onBatch: (options: BatchOptions) => Promise<void>;
  batchProgress: BatchProgress;
  onDeleteAsset: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  setNotice: (notice: Notice) => void;
}) {
  const [overlayHost, setOverlayHost] = useState<HTMLDivElement | null>(null);
  const [editPreview, setEditPreview] = useState<EditValues>(defaultEditValues);
  const activeToolDefinition = tools.find((tool) => tool.id === activeTool) ?? tools[0];
  const Icon = activeToolDefinition.icon;
  useEffect(() => setEditPreview(defaultEditValues), [activeAsset?.id, activeTool]);
  return (
    <EditorOverlayContext.Provider value={overlayHost}>
    <main className="workspace-page">
      <div className="workspace-breadcrumb"><button className="back-button" onClick={onClear}><ArrowLeft size={15} /> 工具箱</button><span>/</span><span>{activeToolDefinition.label}</span><div className="workspace-actions"><button className="secondary-button" onClick={onAddFiles}><Plus size={16} /> 添加图片</button><button className="secondary-button" onClick={onExportAll}><Download size={16} /> 全部下载</button><button className="primary-button compact" onClick={onExport}><FileDown size={16} /> 导出当前</button></div></div>
      <div className="asset-strip"><div className="asset-strip-label"><span className="eyebrow">WORKSPACE</span><strong>{assets.length} 张图片</strong></div><div className="asset-thumbs">{assets.map((asset, index) => <div className="asset-thumb-wrap" key={asset.id}><button className={`asset-thumb ${asset.id === activeAsset?.id ? 'is-active' : ''}`} aria-label={`选中 ${asset.name}`} aria-pressed={asset.id === activeAsset?.id} onClick={() => onSelectAsset(asset.id)}><img src={asset.url} alt={asset.name} /><span>{index + 1}</span></button><button className="asset-delete-button" title={`删除 ${asset.name}`} aria-label={`删除 ${asset.name}`} onClick={() => onDeleteAsset(asset.id)}><X size={11} /></button></div>)}<button className="add-thumb" title="添加图片" aria-label="添加图片" onClick={onAddFiles}><Plus size={17} /></button></div><div className="asset-total">总计 {formatBytes(assets.reduce((sum, asset) => sum + asset.size, 0))}</div></div>
      <div className="workspace-layout">
        <aside className="tool-sidebar"><div className="sidebar-title"><PanelLeft size={15} /><span>工具</span></div><div className="sidebar-list">{tools.map((tool) => { const ToolIcon = tool.icon; return <button className={`sidebar-tool ${activeTool === tool.id ? 'is-active' : ''}`} data-tool-id={tool.id} key={tool.id} onClick={() => onSelectTool(tool.id)} title={tool.description}><ToolIcon size={17} /><span>{tool.label}</span>{activeTool === tool.id && <span className="active-bar" />}</button>; })}</div><div className="sidebar-bottom"><ShieldCheck size={16} /><small>本地模式<br />Local only</small></div></aside>
        <section className="preview-column"><div className="preview-toolbar"><span><span className="live-dot" /> 直接编辑</span><span>{activeAsset ? `${activeAsset.width} × ${activeAsset.height}` : '未选择图片'}</span></div><div className={`preview-stage ${activeAsset && activeAsset.height > activeAsset.width ? 'is-portrait' : 'is-landscape'}`}><div className="stage-grid" />{activeAsset ? <PreviewImage asset={activeAsset} editValues={activeTool === 'edit' ? editPreview : undefined} onOverlayHost={setOverlayHost} /> : <div className="preview-empty"><ImagePlus size={32} /><span>选择一张图片开始</span></div>}<div className="preview-badge"><CheckCircle2 size={14} /> 本地处理</div></div><div className="preview-footer"><div className="preview-file"><FileImage size={16} /><span><strong>{activeAsset?.name ?? '未选择文件'}</strong><small>{activeAsset ? `${formatBytes(activeAsset.size)} · ${activeAsset.type.replace('image/', '').toUpperCase()}` : '拖入图片或点击添加'}</small></span></div><div className="preview-controls"><button className="icon-button" title="帮助"><CircleHelp size={16} /></button><button className="icon-button" title="撤销上一步操作" aria-label="撤销上一步操作" disabled={!canUndo} onClick={onUndo}><Undo2 size={16} /></button><button className="icon-button" title="重做上一步操作" aria-label="重做上一步操作" disabled={!canRedo} onClick={onRedo}><Redo2 size={16} /></button>{activeAsset && <button className="icon-button" title="删除当前图片" aria-label="删除当前图片" onClick={() => onDeleteAsset(activeAsset.id)}><Trash2 size={16} /></button>}</div></div></section>
        <aside className="control-column"><div className="control-heading"><div className="control-icon"><Icon size={19} /></div><div><span className="eyebrow">CURRENT TOOL</span><h2>{activeToolDefinition.label}</h2></div><button className="icon-button mobile-close" title="关闭面板"><X size={17} /></button></div><div className="control-scroll"><ToolPanel tool={activeTool} asset={activeAsset} assets={assets} onResize={onResize} onCrop={onCrop} onIdPhotoPreview={onIdPhotoPreview} onIdPhotoBrush={onIdPhotoBrush} onIdPhotoClothing={onIdPhotoClothing} onIdPhoto={onIdPhoto} onSplit={onSplit} onMerge={onMerge} onEncode={onEncode} onEdit={onEdit} onEditPreview={setEditPreview} onMattingApply={onMattingApply} onMattingBrushApply={onMattingBrushApply} onAiApply={onAiApply} onCleanup={onCleanup} onWatermark={onWatermark} onMetadata={onMetadata} onClearMetadata={onClearMetadata} onExportGif={onExportGif} onBatch={onBatch} batchProgress={batchProgress} setNotice={setNotice} /></div><div className="control-footer"><span><ShieldCheck size={14} /> 本地安全处理</span><button className="help-link"><CircleHelp size={14} /> 需要帮助</button></div></aside>
      </div>
    </main>
    </EditorOverlayContext.Provider>
  );
}

function ToolPanel({ tool, asset, assets, onResize, onCrop, onIdPhotoPreview, onIdPhotoBrush, onIdPhotoClothing, onIdPhoto, onSplit, onMerge, onEncode, onEdit, onEditPreview, onMattingApply, onMattingBrushApply, onAiApply, onCleanup, onWatermark, onMetadata, onClearMetadata, onExportGif, onBatch, batchProgress, setNotice }: {
  tool: ToolId;
  asset: ImageAsset | null;
  assets: ImageAsset[];
  onResize: (width: number, height: number) => Promise<void>;
  onCrop: (values: { x: number; y: number; width: number; height: number }) => Promise<void>;
  onIdPhotoPreview: (values: { x: number; y: number; width: number; height: number }, mattingMode: 'local' | 'ai', method: 'solid' | 'connected', samples: BackgroundColorSample[], targetColor: [number, number, number] | null, tolerance: number, feather: number) => Promise<IdPhotoMattingPreview | null>;
  onIdPhotoBrush: (preview: IdPhotoMattingPreview, stroke: BackgroundBrushStroke) => Promise<IdPhotoMattingPreview>;
  onIdPhotoClothing: (source: File | string, removeBackground: boolean) => Promise<ImageAsset | null>;
  onIdPhoto: (preview: IdPhotoMattingPreview, background: string, values: { width: number; height: number }, mattingMode: 'local' | 'ai', clothingLayers: IdPhotoClothingLayer[]) => Promise<void>;
  onSplit: (direction: 'horizontal' | 'vertical' | 'grid', rows: number, columns: number, lines?: SplitLine[]) => Promise<void>;
  onMerge: (layout: 'horizontal' | 'vertical' | 'grid', gap: number, background: string) => Promise<void>;
  onEncode: (format: ExportFormat, quality: number, background: string) => Promise<void>;
  onEdit: (values: EditValues) => Promise<void>;
  onEditPreview: (values: EditValues) => void;
  onMattingApply: (request: LocalBackgroundRemovalOptions) => Promise<void>;
  onMattingBrushApply: (sourceAsset: ImageAsset, stroke: BackgroundBrushStroke) => Promise<void>;
  onAiApply: (request: AiRequest) => Promise<void>;
  onCleanup: (stroke: CleanupBrushStroke) => Promise<void>;
  onWatermark: (options: WatermarkOptions) => Promise<void>;
  onMetadata: (values: Record<string, string>) => Promise<void>;
  onClearMetadata: () => Promise<void>;
  onExportGif: () => Promise<void>;
  onBatch: (options: BatchOptions) => Promise<void>;
  batchProgress: BatchProgress;
  setNotice: (notice: Notice) => void;
}) {
  if (!asset) return <EmptyPanel />;
  switch (tool) {
    case 'resize': return <ResizePanel asset={asset} onApply={onResize} />;
    case 'crop': return <CropPanel asset={asset} onApply={onCrop} />;
    case 'split': return <SplitPanel asset={asset} onApply={onSplit} />;
    case 'merge': return <MergePanel assets={assets} onApply={onMerge} setNotice={setNotice} />;
    case 'compress': return <EncodePanel mode="compress" asset={asset} onApply={onEncode} />;
    case 'convert': return <EncodePanel mode="convert" asset={asset} onApply={onEncode} />;
    case 'matting': return <MattingPanel asset={asset} onApply={onMattingApply} onBrushApply={onMattingBrushApply} onAiApply={onAiApply} setNotice={setNotice} />;
    case 'cleanup': return <CleanupPanel asset={asset} onApply={onCleanup} />;
    case 'ai-upscale': return <AiModelPanel task="upscale" asset={asset} onApply={onAiApply} setNotice={setNotice} />;
    case 'edit': return <EditPanel onApply={onEdit} onPreview={onEditPreview} />;
    case 'watermark': return <WatermarkPanel asset={asset} onApply={onWatermark} />;
    case 'metadata': return <MetadataPanel asset={asset} onApply={onMetadata} onClear={onClearMetadata} setNotice={setNotice} />;
    case 'batch': return <BatchPanel count={assets.length} progress={batchProgress} onApply={onBatch} />;
    case 'gif': return <GifPanel count={assets.length} onApply={onExportGif} />;
    case 'id-photo': return <IdPhotoPanel asset={asset} onPreview={onIdPhotoPreview} onBrushApply={onIdPhotoBrush} onLoadClothing={onIdPhotoClothing} onApply={onIdPhoto} />;
    default: return <EmptyPanel />;
  }
}

function PanelIntro({ title, description }: { title: string; description: string }) { return <div className="panel-intro"><h3>{title}</h3><p>{description}</p></div>; }

function Field({ label, children, suffix }: { label: string; children: React.ReactNode; suffix?: string }) { return <label className="field"><span>{label}</span><div className="field-control">{children}{suffix && <small>{suffix}</small>}</div></label>; }

function ResizePanel({ asset, onApply }: { asset: ImageAsset; onApply: (width: number, height: number) => Promise<void> }) {
  const [width, setWidth] = useState(asset.width);
  const [height, setHeight] = useState(asset.height);
  const [locked, setLocked] = useState(true);
  const ratio = asset.width / asset.height;
  return <><PanelIntro title="调整图片尺寸" description="输入目标尺寸，浏览器会在本地完成高质量缩放。" /><div className="control-section"><div className="field-row"><Field label="宽度"><input type="number" value={width} min="1" onChange={(event) => { const next = Number(event.target.value); setWidth(next); if (locked) setHeight(Math.round(next / ratio)); }} /></Field><span className="multiply">×</span><Field label="高度"><input type="number" value={height} min="1" onChange={(event) => { const next = Number(event.target.value); setHeight(next); if (locked) setWidth(Math.round(next * ratio)); }} /></Field></div><button className={`toggle-row ${locked ? 'is-on' : ''}`} onClick={() => setLocked((value) => !value)}><span className="toggle"><span /></span><span>锁定宽高比</span><small>{ratio.toFixed(2)} : 1</small></button></div><div className="control-section"><div className="section-label">常用尺寸</div><div className="preset-grid">{presets.map((preset) => <button key={preset.label} className="preset-button" onClick={() => { setWidth(preset.width); setHeight(preset.height); }}><strong>{preset.label}</strong><small>{preset.width} × {preset.height}</small></button>)}</div></div><div className="control-section compact-section"><div className="section-label">插值算法 <CircleHelp size={13} /></div><select className="select-input"><option>自动</option><option>双三次</option><option>Lanczos</option><option>双线性</option><option>最近邻</option></select></div><ApplyButton onClick={() => void onApply(width, height)} label="应用尺寸" /> </>;
}

function CropPanel({ asset, onApply }: { asset: ImageAsset; onApply: (values: { x: number; y: number; width: number; height: number }) => Promise<void> }) {
  return <DirectCropPanel asset={asset} onApply={onApply} />;
}

function SplitPanel({ asset, onApply }: { asset: ImageAsset; onApply: (direction: 'horizontal' | 'vertical' | 'grid', rows: number, columns: number, lines?: SplitLine[]) => Promise<void> }) {
  return <DirectSplitPanel asset={asset} onApply={onApply} />;
}

function MergePanel({ assets, onApply, setNotice }: { assets: ImageAsset[]; onApply: (layout: 'horizontal' | 'vertical' | 'grid', gap: number, background: string) => Promise<void>; setNotice: (notice: Notice) => void }) {
  const count = assets.length;
  const sameSize = assets.length > 0 && assets.every((asset) => asset.width === assets[0].width && asset.height === assets[0].height);
  const [layout, setLayout] = useState<'horizontal' | 'vertical' | 'grid'>(sameSize ? 'grid' : 'horizontal');
  const [gap, setGap] = useState(16);
  const [background, setBackground] = useState('#ffffff');
  function chooseLayout(next: 'horizontal' | 'vertical' | 'grid') {
    if (next === 'grid' && !sameSize) {
      setNotice({ type: 'warning', text: '网格拼图要求所有图片尺寸一致，请先统一图片大小' });
      return;
    }
    setLayout(next);
  }
  function apply() {
    if (layout === 'grid' && !sameSize) {
      setNotice({ type: 'warning', text: '网格拼图要求所有图片尺寸一致，请先统一图片大小' });
      return;
    }
    void onApply(layout, gap, background);
  }
  return <><PanelIntro title="合并与拼图" description="横向和纵向按原图边缘拼接，网格要求所有图片尺寸一致。" /><div className="inline-info"><Layers3 size={16} /><span>当前工作区 <strong>{count} 张图片</strong></span></div>{!sameSize && <div className="inline-info merge-warning"><Info size={16} /><span>当前图片尺寸不同，网格按钮已置灰；横向、纵向仍可直接拼接。</span></div>}<div className="control-section"><div className="section-label">布局</div><div className="segmented-grid three"><button className={layout === 'horizontal' ? 'is-selected' : ''} onClick={() => chooseLayout('horizontal')}>横向</button><button className={layout === 'vertical' ? 'is-selected' : ''} onClick={() => chooseLayout('vertical')}>纵向</button><button className={`${layout === 'grid' ? 'is-selected' : ''} ${!sameSize ? 'is-disabled' : ''}`} aria-disabled={!sameSize} title={!sameSize ? '网格拼图要求所有图片尺寸一致' : '网格拼图'} onClick={() => chooseLayout('grid')}>网格</button></div></div><div className="control-section"><Field label="图片间距" suffix="px"><input type="number" min="0" max="200" value={gap} onChange={(event) => setGap(Number(event.target.value))} /></Field><div className="color-field"><span>背景颜色</span><label><input type="color" value={background} onChange={(event) => setBackground(event.target.value)} /><b>{background.toUpperCase()}</b></label></div></div><ApplyButton onClick={apply} label="生成拼图" /></>;
}

function EncodePanel({ mode, asset, onApply }: { mode: 'compress' | 'convert'; asset: ImageAsset; onApply: (format: ExportFormat, quality: number, background: string) => Promise<void> }) {
  const [quality, setQuality] = useState(85);
  const [format, setFormat] = useState<ExportFormat>(mode === 'compress' ? 'image/jpeg' : 'image/webp');
  const [background, setBackground] = useState('#ffffff');
  const estimated = Math.max(1, Math.round(asset.size * (mode === 'compress' ? 0.34 + quality / 300 : 0.48)));
  return <><PanelIntro title={mode === 'compress' ? '压缩图片' : '转换格式'} description={mode === 'compress' ? '在画质和文件体积之间找到合适的平衡。' : '选择输出格式，转换在本地完成。'} /><div className="compare-stats"><div><span>原始文件</span><strong>{formatBytes(asset.size)}</strong></div><ArrowRightLeft size={16} /><div><span>预计输出</span><strong>{formatBytes(estimated)}</strong></div><div className="saving"><span>预计节省</span><strong>{Math.max(1, Math.round((1 - estimated / asset.size) * 100))}%</strong></div></div><div className="control-section"><div className="section-label">输出格式</div><div className="format-pills">{formatOptions.map((option) => <button key={option.value} className={format === option.value ? 'is-selected' : ''} onClick={() => setFormat(option.value)}>{option.label}</button>)}</div></div><div className="control-section"><div className="range-heading"><span>质量</span><strong>{quality}</strong></div><input className="range-input" type="range" min="10" max="100" value={quality} onChange={(event) => setQuality(Number(event.target.value))} /><div className="range-labels"><span>更小体积</span><span>更高画质</span></div></div>{format === 'image/jpeg' && <div className="control-section"><div className="color-field"><span>透明区域背景</span><label><input type="color" value={background} onChange={(event) => setBackground(event.target.value)} /><b>{background.toUpperCase()}</b></label></div></div>}<ApplyButton onClick={() => void onApply(format, quality / 100, background)} label={mode === 'compress' ? '压缩并应用' : '转换并应用'} /></>;
}

function EditPanel({ onApply, onPreview }: { onApply: (values: EditValues) => Promise<void>; onPreview: (values: EditValues) => void }) {
  const [values, setValues] = useState<EditValues>(defaultEditValues);
  const fields = [['brightness', '亮度', -100, 100], ['contrast', '对比度', -100, 100], ['saturation', '饱和度', -100, 100], ['blur', '模糊', 0, 12]] as const;
  function updateValue(key: keyof EditValues, value: number) {
    const next = { ...values, [key]: value };
    setValues(next);
    onPreview(next);
  }
  async function apply() {
    await onApply(values);
    setValues(defaultEditValues);
    onPreview(defaultEditValues);
  }
  return <><PanelIntro title="图片编辑" description="做一点轻量调整，保持原图清晰和色彩自然。" /><div className="control-section adjustment-list">{fields.map(([key, label, min, max]) => <div className="adjustment-row" key={key}><div><span>{label}</span><strong>{values[key]}</strong></div><input className="range-input" type="range" min={min} max={max} value={values[key]} onInput={(event) => updateValue(key, Number(event.currentTarget.value))} /></div>)}</div><div className="filter-row"><button>自然</button><button>黑白</button><button>胶片</button><button>暖色</button></div><ApplyButton onClick={() => void apply()} label="应用调整" /></>;
}

function WatermarkPanel({ asset, onApply }: { asset: ImageAsset; onApply: (options: WatermarkOptions) => Promise<void> }) {
  const overlayHost = useEditorOverlay();
  const [kind, setKind] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('Alun Image');
  const [opacity, setOpacity] = useState(0.72);
  const [position, setPosition] = useState('right-bottom');
  const [x, setX] = useState(65);
  const [y, setY] = useState(80);
  const [width, setWidth] = useState(28);
  const [watermarkImage, setWatermarkImage] = useState<ImageAsset | undefined>();
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; x: number; y: number; width: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const watermarkHeight = watermarkImage ? width * (watermarkImage.height / watermarkImage.width) * (asset.width / asset.height) : width * 0.18;

  useEffect(() => {
    return () => {
      if (watermarkImage) URL.revokeObjectURL(watermarkImage.url);
    };
  }, [watermarkImage]);

  function setPreset(nextPosition: string) {
    const nextX = nextPosition.includes('left') ? 5 : nextPosition.includes('right') ? 95 - width : (100 - width) / 2;
    const nextY = nextPosition.includes('top') ? 5 : nextPosition.includes('bottom') ? 95 - watermarkHeight : (100 - watermarkHeight) / 2;
    setPosition(nextPosition);
    setX(Math.max(0, nextX));
    setY(Math.max(0, nextY));
  }

  function pointerPoint(event: React.PointerEvent<HTMLElement>) {
    const frame = frameRef.current;
    if (!frame) return { x: 0, y: 0 };
    const rect = frame.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 };
  }

  function startDrag(event: React.PointerEvent<HTMLElement>, mode: 'move' | 'resize') {
    const point = pointerPoint(event);
    event.preventDefault();
    event.stopPropagation();
    frameRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = { mode, startX: point.x, startY: point.y, x, y, width };
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointerPoint(event);
    if (drag.mode === 'move') {
      setX(Math.max(0, Math.min(100 - width, drag.x + point.x - drag.startX)));
      setY(Math.max(0, Math.min(100 - watermarkHeight, drag.y + point.y - drag.startY)));
    } else {
      setWidth(Math.max(6, Math.min(90, drag.width + point.x - drag.startX)));
    }
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  async function chooseWatermark(file: File | undefined) {
    if (!file?.type.startsWith('image/')) return;
    const next = await createAssetFromBlob(file, file.name, file);
    setWatermarkImage(next);
    setKind('image');
  }

  const options: WatermarkOptions = { kind, text, opacity, position, x, y, width, fontSize: Math.max(2, Math.min(12, width / 5.6)), image: watermarkImage };
  const overlay = <div className="editor-tool-overlay watermark-interaction" ref={frameRef} onPointerDown={(event) => event.stopPropagation()} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>{(kind === 'text' || watermarkImage) && <div className={`watermark-overlay ${kind}`} style={{ left: `${x}%`, top: `${y}%`, width: `${width}%`, opacity }} onPointerDown={(event) => startDrag(event, event.target instanceof Element && event.target.closest('.watermark-resize-handle') ? 'resize' : 'move')}>{kind === 'text' ? text : <img src={watermarkImage?.url} alt="图片水印" />}<button type="button" className="watermark-resize-handle" aria-label="调整水印大小" /></div>}</div>;
  return <>
    {overlayHost && createPortal(overlay, overlayHost)}
    <PanelIntro title="添加水印" description="文字或图片水印都可直接在原图比例画布上拖动和缩放。" />
    <input ref={fileInput} className="visually-hidden" type="file" accept="image/*" onChange={(event) => void chooseWatermark(event.target.files?.[0])} />
    <div className="control-section"><div className="segmented-grid two"><button className={kind === 'text' ? 'is-selected' : ''} onClick={() => setKind('text')}>文字水印</button><button className={kind === 'image' ? 'is-selected' : ''} onClick={() => { setKind('image'); fileInput.current?.click(); }}>图片水印</button></div>{kind === 'text' ? <Field label="水印文字"><input value={text} maxLength={40} onChange={(event) => setText(event.target.value)} /></Field> : <button className="watermark-file-button" onClick={() => fileInput.current?.click()}><ImagePlus size={16} /><span>{watermarkImage?.name ?? '选择一张水印图片'}</span></button>}<div className="range-heading"><span>透明度</span><strong>{Math.round(opacity * 100)}%</strong></div><input className="range-input" type="range" min="0.1" max="1" step="0.01" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></div>
    <div className="inline-info"><Droplets size={16} /><span>在中央图片上拖动水印，拖动右下角控制点调整大小。</span></div>
    <div className="control-section"><div className="section-label">快速定位</div><div className="position-grid">{['left-top', 'center-top', 'right-top', 'left-bottom', 'center', 'right-bottom'].map((value) => <button key={value} className={position === value ? 'is-selected' : ''} onClick={() => setPreset(value)}><span /></button>)}</div></div>
    <ApplyButton onClick={() => void onApply(options)} label="应用水印" />
  </>;
}

function MetadataPanel({ asset, onApply, onClear, setNotice }: { asset: ImageAsset; onApply: (values: Record<string, string>) => Promise<void>; onClear: () => Promise<void>; setNotice: (notice: Notice) => void }) {
  const metadata = asset.metadata ?? {};
  const rows = [['文件名', asset.name], ['文件类型', asset.type.replace('image/', '').toUpperCase()], ['尺寸', `${asset.width} × ${asset.height}`], ['文件大小', formatBytes(asset.size)], ['相机', String(metadata.Make ?? metadata.Model ?? '未读取')], ['拍摄时间', String(metadata.DateTimeOriginal ?? '未读取')], ['GPS', metadata.GPSLatitude && metadata.GPSLongitude ? '已记录' : '未记录']];
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => setValues(Object.fromEntries(metadataFields.map(([key]) => [key, asset.metadata?.[key] === undefined ? '' : String(asset.metadata[key])]))), [asset.id, asset.metadata]);
  return <><PanelIntro title="图片信息与元数据" description="查看照片信息，修改常见 EXIF 字段，或清除全部隐私数据。" /><div className="metadata-list">{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><div className="control-section metadata-editor"><div className="section-label">编辑照片信息 <span className="muted">JPEG / PNG</span></div>{metadataFields.map(([key, label]) => <Field key={key} label={label}><input value={values[key] ?? ''} placeholder={key === 'GPSLatitude' || key === 'GPSLongitude' ? '例如 31.2304' : '未填写'} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} /></Field>)}</div><div className="privacy-callout"><ShieldCheck size={17} /><span><strong>隐私建议</strong><small>清除操作会移除 EXIF、GPS 和编辑痕迹；修改操作只写入常见照片字段。</small></span></div><div className="metadata-actions"><button className="secondary-button full" onClick={() => { void onApply(values); setNotice({ type: 'success', text: '正在写入照片信息' }); }}><CheckCircle2 size={16} /> 保存修改</button><button className="secondary-button full danger-action" onClick={() => { void onClear(); setNotice({ type: 'success', text: '已清除照片元数据' }); }}><Trash2 size={16} /> 清除全部数据</button></div></>;
}

function BatchPanel({ count, progress, onApply }: { count: number; progress: BatchProgress; onApply: (options: BatchOptions) => Promise<void> }) {
  const [kind, setKind] = useState<BatchOptions['kind']>('matting');
  const [sampling, setSampling] = useState<'largest' | 'center' | 'corners'>('largest');
  const [tolerance, setTolerance] = useState(24);
  const [feather, setFeather] = useState(3);
  const [cropWidth, setCropWidth] = useState(1080);
  const [cropHeight, setCropHeight] = useState(1080);
  const [alignment, setAlignment] = useState<BatchCropAlignment>('center');
  const [scale, setScale] = useState<2 | 4>(2);
  const [template, setTemplate] = useState('{name}-{n}');
  const [start, setStart] = useState(1);
  const [digits, setDigits] = useState(3);
  const [format, setFormat] = useState<'image/jpeg' | 'image/webp'>('image/webp');
  const [quality, setQuality] = useState(0.8);
  const alignments: Array<{ id: BatchCropAlignment; label: string }> = [
    { id: 'top-left', label: '左上' }, { id: 'top', label: '上' }, { id: 'top-right', label: '右上' },
    { id: 'left', label: '左' }, { id: 'center', label: '中间' }, { id: 'right', label: '右' },
    { id: 'bottom-left', label: '左下' }, { id: 'bottom', label: '下' }, { id: 'bottom-right', label: '右下' },
  ];
  const tabs: Array<{ id: BatchOptions['kind']; label: string }> = [
    { id: 'matting', label: '抠图' }, { id: 'crop', label: '裁剪' }, { id: 'upscale', label: '超分' }, { id: 'rename', label: '改名' }, { id: 'compress', label: '压缩' },
  ];

  function options(): BatchOptions {
    if (kind === 'matting') return { kind, sampling, tolerance, feather };
    if (kind === 'crop') return { kind, width: cropWidth, height: cropHeight, alignment };
    if (kind === 'upscale') return { kind, scale };
    if (kind === 'rename') return { kind, template: template.trim() || '{name}-{n}', start, digits };
    return { kind, format, quality };
  }

  const percentage = progress.total ? Math.round(progress.completed / progress.total * 100) : 0;
  return <>
    <PanelIntro title="批量处理" description="为当前工作区的全部图片应用同一套本地处理规则。" />
    <div className="batch-summary"><strong>{count}</strong><span>张图片<br /><small>{progress.running ? `正在处理 ${progress.completed + 1}/${progress.total}` : progress.total ? `上次完成 ${progress.completed}/${progress.total}` : '等待处理'}</small></span></div>
    <div className="batch-tabs">{tabs.map((tab) => <button type="button" key={tab.id} className={kind === tab.id ? 'is-selected' : ''} disabled={progress.running} onClick={() => setKind(tab.id)}>{tab.label}</button>)}</div>

    {kind === 'matting' && <div className="control-section batch-options"><div className="section-label">自动取色区域</div><div className="segmented-grid three"><button className={sampling === 'largest' ? 'is-selected' : ''} onClick={() => setSampling('largest')}>最大色块</button><button className={sampling === 'center' ? 'is-selected' : ''} onClick={() => setSampling('center')}>中心色块</button><button className={sampling === 'corners' ? 'is-selected' : ''} onClick={() => setSampling('corners')}>四角色块</button></div><div className="field-grid"><Field label="容差"><input type="number" min="1" max="100" value={tolerance} onChange={(event) => setTolerance(Number(event.target.value))} /></Field><Field label="羽化" suffix="px"><input type="number" min="0" max="30" value={feather} onChange={(event) => setFeather(Number(event.target.value))} /></Field></div></div>}
    {kind === 'crop' && <div className="control-section batch-options"><div className="field-grid"><Field label="宽度" suffix="px"><input type="number" min="1" value={cropWidth} onChange={(event) => setCropWidth(Number(event.target.value))} /></Field><Field label="高度" suffix="px"><input type="number" min="1" value={cropHeight} onChange={(event) => setCropHeight(Number(event.target.value))} /></Field></div><div className="section-label">对齐方位</div><div className="batch-position-grid">{alignments.map((item) => <button type="button" key={item.id} title={item.label} aria-label={item.label} className={alignment === item.id ? 'is-selected' : ''} onClick={() => setAlignment(item.id)}><span /></button>)}</div></div>}
    {kind === 'upscale' && <div className="control-section batch-options"><div className="section-label">输出倍率</div><div className="segmented-grid two"><button className={scale === 2 ? 'is-selected' : ''} onClick={() => setScale(2)}>2x 标准</button><button className={scale === 4 ? 'is-selected' : ''} onClick={() => setScale(4)}>4x 高清</button></div><div className="inline-info"><Sparkles size={16} /><span>优先使用 ESPCN 本地模型，模型不可用时自动使用浏览器高质量插值。</span></div></div>}
    {kind === 'rename' && <div className="control-section batch-options"><Field label="文件名模板"><input type="text" value={template} onChange={(event) => setTemplate(event.target.value)} /></Field><div className="field-grid"><Field label="起始序号"><input type="number" min="0" value={start} onChange={(event) => setStart(Number(event.target.value))} /></Field><Field label="序号位数"><input type="number" min="1" max="8" value={digits} onChange={(event) => setDigits(Number(event.target.value))} /></Field></div><div className="batch-template-preview"><span>预览</span><strong>{(template || '{name}-{n}').replaceAll('{name}', '照片').replaceAll('{n}', String(start).padStart(digits, '0'))}.jpg</strong></div></div>}
    {kind === 'compress' && <div className="control-section batch-options"><div className="section-label">输出格式</div><div className="segmented-grid two"><button className={format === 'image/webp' ? 'is-selected' : ''} onClick={() => setFormat('image/webp')}>WebP</button><button className={format === 'image/jpeg' ? 'is-selected' : ''} onClick={() => setFormat('image/jpeg')}>JPG</button></div><div className="range-heading"><span>输出质量</span><strong>{Math.round(quality * 100)}%</strong></div><input className="range-input" type="range" min="0.2" max="1" step="0.01" value={quality} onChange={(event) => setQuality(Number(event.target.value))} /></div>}

    {progress.running && <div className="batch-progress"><div><span>{progress.currentName}</span><strong>{percentage}%</strong></div><div className="batch-progress-track"><span style={{ width: `${percentage}%` }} /></div>{progress.failed > 0 && <small>{progress.failed} 张处理失败，将保留原图</small>}</div>}
    <button className="apply-button" disabled={progress.running || !count} onClick={() => void onApply(options())}>{progress.running ? <><Gauge size={17} /> 本地处理中…</> : <><Layers3 size={17} /> 开始批量处理<ArrowRightLeft size={15} /></>}</button>
  </>;
}

function GifPanel({ count, onApply }: { count: number; onApply: () => Promise<void> }) { return <><PanelIntro title="GIF / 动图" description="用当前工作区的图片生成轻量动图。" /><div className="gif-timeline">{Array.from({ length: Math.min(count, 6) }, (_, index) => <span key={index}>{index + 1}</span>)}{count > 6 && <b>+{count - 6}</b>}</div><div className="control-section"><Field label="帧率" suffix="FPS"><input type="number" defaultValue="8" min="1" max="60" /></Field><Field label="循环"><select className="select-input"><option>无限循环</option><option>播放一次</option></select></Field></div><div className="inline-info"><Film size={16} /><span>浏览器支持 GIF 编码，输出将保留在本机</span></div><ApplyButton onClick={() => void onApply()} label="导出 GIF" /></>;
}

function hexToRgb(value: string): [number, number, number] {
  const normalized = value.replace('#', '').padEnd(6, '0').slice(0, 6);
  return [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16)) as [number, number, number];
}

function rgbToHex(color: [number, number, number]) {
  return `#${color.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;
}

function MattingPanel({ asset, onApply, onBrushApply, onAiApply, setNotice }: { asset: ImageAsset; onApply: (request: LocalBackgroundRemovalOptions) => Promise<void>; onBrushApply: (sourceAsset: ImageAsset, stroke: BackgroundBrushStroke) => Promise<void>; onAiApply: (request: AiRequest) => Promise<void>; setNotice: (notice: Notice) => void }) {
  const [mode, setMode] = useState<'local' | 'ai'>('local');
  return <>
    <PanelIntro title="智能抠图" description="按图片类型选择本地颜色抠除或 AI 人像抠图，结果均在浏览器内生成。" />
    <div className="control-section"><div className="section-label">抠图方式</div><div className="segmented-grid two"><button className={mode === 'local' ? 'is-selected' : ''} onClick={() => setMode('local')}>本地抠图</button><button className={mode === 'ai' ? 'is-selected' : ''} onClick={() => setMode('ai')}>AI 抠图</button></div></div>
    {mode === 'local' ? <LocalMattingPanel asset={asset} onApply={onApply} onBrushApply={onBrushApply} setNotice={setNotice} /> : <AiModelPanel task="remove-background" asset={asset} onApply={onAiApply} setNotice={setNotice} compact />}
  </>;
}

function LocalMattingPanel({ asset, onApply, onBrushApply, setNotice }: { asset: ImageAsset; onApply: (request: LocalBackgroundRemovalOptions) => Promise<void>; onBrushApply: (sourceAsset: ImageAsset, stroke: BackgroundBrushStroke) => Promise<void>; setNotice: (notice: Notice) => void }) {
  const overlayHost = useEditorOverlay();
  const [method, setMethod] = useState<'solid' | 'connected'>('solid');
  const [interaction, setInteraction] = useState<'brush' | 'sample'>('brush');
  const [brushMode, setBrushMode] = useState<BackgroundBrushStroke['mode']>('erase');
  const [brushSize, setBrushSize] = useState(64);
  const [strokePoints, setStrokePoints] = useState<Array<{ x: number; y: number }>>([]);
  const [targetColor, setTargetColor] = useState<[number, number, number]>([255, 255, 255]);
  const [seed, setSeed] = useState({ x: 50, y: 50 });
  const [tolerance, setTolerance] = useState(18);
  const [feather, setFeather] = useState(4);
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const sourceAssetRef = useRef<ImageAsset | null>(null);
  const sourceBlobRef = useRef<Blob | null>(null);
  const paintingRef = useRef(false);
  const strokePointsRef = useRef<Array<{ x: number; y: number }>>([]);

  const sourceBlob = asset.backgroundSourceBlob ?? asset.blob;
  if (sourceBlobRef.current !== sourceBlob) {
    sourceBlobRef.current = sourceBlob;
    sourceAssetRef.current = { ...asset, blob: sourceBlob, size: sourceBlob.size };
  }

  useEffect(() => setSeed({ x: 50, y: 50 }), [asset.id]);

  function pointFromEvent(event: React.PointerEvent<HTMLDivElement>) {
    const frame = frameRef.current;
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)), y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)) };
  }

  function pickColor(event: React.PointerEvent<HTMLDivElement>) {
    const image = imageRef.current;
    const point = pointFromEvent(event);
    if (!image || !point) return;
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(image, (point.x / 100) * image.naturalWidth, (point.y / 100) * image.naturalHeight, 1, 1, 0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    setTargetColor([pixel[0], pixel[1], pixel[2]]);
    setSeed(point);
    setNotice({ type: 'success', text: method === 'solid' ? '已取样全图要移除的颜色' : '已选择联通色块起点' });
  }

  function updateStroke(points: Array<{ x: number; y: number }>) {
    strokePointsRef.current = points;
    setStrokePoints(points);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (interaction === 'sample') {
      pickColor(event);
      return;
    }
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    paintingRef.current = true;
    updateStroke([point]);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!paintingRef.current) return;
    const point = pointFromEvent(event);
    if (!point) return;
    const previous = strokePointsRef.current.at(-1);
    if (previous && Math.abs(previous.x - point.x) < 0.15 && Math.abs(previous.y - point.y) < 0.15) return;
    updateStroke([...strokePointsRef.current, point]);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>, apply: boolean) {
    if (!paintingRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    paintingRef.current = false;
    const points = strokePointsRef.current;
    updateStroke([]);
    if (apply && points.length) void onBrushApply(sourceAssetRef.current ?? asset, { mode: brushMode, size: brushSize, points });
  }

  const brushPath = strokePoints.map((point) => `${point.x * asset.width / 100},${point.y * asset.height / 100}`).join(' ');
  const maxBrushSize = Math.max(80, Math.min(800, Math.round(Math.max(asset.width, asset.height) * 0.4)));
  const options: LocalBackgroundRemovalOptions = { method, targetColor, seedX: seed.x, seedY: seed.y, tolerance, feather };
  const overlay = <div className={`editor-tool-overlay background-pick-frame ${interaction === 'brush' ? 'brush-interaction' : ''}`} ref={frameRef} onPointerDown={(event) => { event.stopPropagation(); handlePointerDown(event); }} onPointerMove={handlePointerMove} onPointerUp={(event) => handlePointerUp(event, true)} onPointerCancel={(event) => handlePointerUp(event, false)}><img ref={imageRef} className="editor-sampling-source" src={asset.url} alt="" aria-hidden="true" />{interaction === 'brush' && strokePoints.length > 0 && <svg className="brush-mask-preview" viewBox={`0 0 ${asset.width} ${asset.height}`} preserveAspectRatio="none" aria-hidden="true">{strokePoints.length === 1 ? <circle cx={strokePoints[0].x * asset.width / 100} cy={strokePoints[0].y * asset.height / 100} r={brushSize / 2} fill={brushMode === 'erase' ? '#e78f49' : '#6f9fda'} opacity=".65" /> : <polyline points={brushPath} fill="none" stroke={brushMode === 'erase' ? '#e78f49' : '#6f9fda'} strokeWidth={brushSize} strokeLinecap="round" strokeLinejoin="round" opacity=".65" />}</svg>}{interaction === 'sample' && <span className="background-pick-marker" style={{ left: `${seed.x}%`, top: `${seed.y}%` }} />}</div>;

  return <>
    {overlayHost && createPortal(overlay, overlayHost)}
    <div className="inline-info"><Eraser size={16} /><span>适合纯色背景，可取样后批量抠除并用画笔修边。</span></div>
    <div className="control-section"><div className="segmented-grid two"><button className={method === 'solid' ? 'is-selected' : ''} onClick={() => setMethod('solid')}>纯色批量抠除</button><button className={method === 'connected' ? 'is-selected' : ''} onClick={() => setMethod('connected')}>联通色块抠除</button></div></div>
    <div className="control-section brush-control-section"><div className="segmented-grid two"><button className={interaction === 'brush' ? 'is-selected' : ''} onClick={() => setInteraction('brush')}><Paintbrush size={13} /> 画笔</button><button className={interaction === 'sample' ? 'is-selected' : ''} onClick={() => setInteraction('sample')}><Pipette size={13} /> 取样</button></div><div className="segmented-grid two"><button className={brushMode === 'erase' ? 'is-selected' : ''} onClick={() => setBrushMode('erase')}>擦除背景</button><button className={brushMode === 'restore' ? 'is-selected' : ''} onClick={() => setBrushMode('restore')}>还原区域</button></div><div className="range-heading"><span>画笔大小</span><strong>{brushSize} px</strong></div><input className="range-input" type="range" min="4" max={maxBrushSize} value={Math.min(brushSize, maxBrushSize)} onChange={(event) => setBrushSize(Number(event.target.value))} /></div>
    <div className="inline-info"><Pipette size={16} /><span>{interaction === 'brush' ? '直接在中央图片上涂抹，松开后立即应用遮罩。' : `点击中央图片取样颜色，当前为${method === 'solid' ? '全图匹配' : '联通区域'}。`}</span></div>
    <div className="control-section"><div className="color-field"><span>目标颜色</span><label><input type="color" value={rgbToHex(targetColor)} onChange={(event) => setTargetColor(hexToRgb(event.target.value))} /><b>{rgbToHex(targetColor).toUpperCase()}</b></label></div><div className="range-heading"><span>色彩匹配度</span><strong>{tolerance}%</strong></div><input className="range-input" type="range" min="1" max="100" value={tolerance} onChange={(event) => setTolerance(Number(event.target.value))} /><div className="range-labels"><span>更严格</span><span>更宽松</span></div><div className="range-heading"><span>羽化半径</span><strong>{feather} px</strong></div><input className="range-input" type="range" min="0" max="40" value={feather} onChange={(event) => setFeather(Number(event.target.value))} /></div>
    <div className="inline-info"><CheckCircle2 size={16} /><span>输出透明 PNG，纯色模式会批量移除所有匹配像素。</span></div>
    <ApplyButton onClick={() => void onApply(options)} label="应用离线抠图" />
    <div className="ai-footnote"><Info size={14} /><span>当前文件：{asset.name} · 处理过程不会上传图片</span></div>
  </>;
}

function CleanupPanel({ asset, onApply }: { asset: ImageAsset; onApply: (stroke: CleanupBrushStroke) => Promise<void> }) {
  const overlayHost = useEditorOverlay();
  const [mode, setMode] = useState<CleanupBrushStroke['mode']>('ai');
  const [brushSize, setBrushSize] = useState(48);
  const [strokePoints, setStrokePoints] = useState<Array<{ x: number; y: number }>>([]);
  const [busy, setBusy] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const paintingRef = useRef(false);
  const strokePointsRef = useRef<Array<{ x: number; y: number }>>([]);

  useEffect(() => {
    strokePointsRef.current = [];
    setStrokePoints([]);
  }, [asset.id]);

  function pointFromEvent(event: React.PointerEvent<HTMLDivElement>) {
    const frame = frameRef.current;
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)) };
  }

  function updateStroke(points: Array<{ x: number; y: number }>) {
    strokePointsRef.current = points;
    setStrokePoints(points);
  }

  function startStroke(event: React.PointerEvent<HTMLDivElement>) {
    if (busy) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    paintingRef.current = true;
    updateStroke([point]);
  }

  function moveStroke(event: React.PointerEvent<HTMLDivElement>) {
    if (!paintingRef.current) return;
    const point = pointFromEvent(event);
    if (!point) return;
    const previous = strokePointsRef.current.at(-1);
    if (previous && Math.hypot(previous.x - point.x, previous.y - point.y) < 0.15) return;
    updateStroke([...strokePointsRef.current, point]);
  }

  async function finishStroke(event: React.PointerEvent<HTMLDivElement>, apply: boolean) {
    if (!paintingRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    paintingRef.current = false;
    const points = strokePointsRef.current;
    if (!apply || !points.length) {
      updateStroke([]);
      return;
    }
    setBusy(true);
    try {
      await onApply({ mode, size: brushSize, points });
    } finally {
      updateStroke([]);
      setBusy(false);
    }
  }

  const path = strokePoints.map((point) => `${point.x * asset.width / 100},${point.y * asset.height / 100}`).join(' ');
  const previewColor = mode === 'ai' ? '#d4f66e' : '#e78f49';
  const maxBrushSize = Math.max(80, Math.min(320, Math.round(Math.max(asset.width, asset.height) * 0.25)));
  const overlay = <div className={`editor-tool-overlay cleanup-interaction ${busy ? 'is-busy' : ''}`} ref={frameRef} onPointerDown={(event) => { event.stopPropagation(); startStroke(event); }} onPointerMove={moveStroke} onPointerUp={(event) => void finishStroke(event, true)} onPointerCancel={(event) => void finishStroke(event, false)}>{strokePoints.length > 0 && <svg className="brush-mask-preview" viewBox={`0 0 ${asset.width} ${asset.height}`} preserveAspectRatio="none" aria-hidden="true">{strokePoints.length === 1 ? <circle cx={strokePoints[0].x * asset.width / 100} cy={strokePoints[0].y * asset.height / 100} r={brushSize / 2} fill={previewColor} opacity=".68" /> : <polyline points={path} fill="none" stroke={previewColor} strokeWidth={brushSize} strokeLinecap="round" strokeLinejoin="round" opacity=".68" />}</svg>}{busy && <span className="cleanup-busy">正在填充选区...</span>}</div>;
  return <>
    {overlayHost && createPortal(overlay, overlayHost)}
    <PanelIntro title="对象消除" description="涂抹水印、文字或杂物，松开后使用周边画面填充选区。" />
    <div className="control-section"><div className="section-label">处理方式</div><div className="segmented-grid two"><button className={mode === 'ai' ? 'is-selected' : ''} onClick={() => setMode('ai')}><WandSparkles size={13} /> AI 去水印</button><button className={mode === 'standard' ? 'is-selected' : ''} onClick={() => setMode('standard')}><Eraser size={13} /> 普通消除笔</button></div><div className="direct-tool-caption"><span>{mode === 'ai' ? '多方向纹理智能填充' : '轻量快速周边填充'}</span><span>全程本地</span></div></div>
    <div className="control-section brush-control-section"><div className="range-heading"><span>画笔大小</span><strong>{brushSize} px</strong></div><input className="range-input" type="range" min="6" max={maxBrushSize} value={Math.min(brushSize, maxBrushSize)} onChange={(event) => setBrushSize(Number(event.target.value))} /></div>
    <div className="inline-info"><Paintbrush size={16} /><span>直接在中央图片的目标区域按住涂抹，松开后立即处理。</span></div>
    <div className="inline-info"><ShieldCheck size={16} /><span>{mode === 'ai' ? 'AI 模式会扩大采样范围，复杂背景可能需要分段涂抹。' : '普通模式适合小面积文字和纯色区域。'}</span></div>
  </>;
}

function AiModelPanel({ task, asset, onApply, setNotice, compact = false }: { task: AiTask; asset: ImageAsset; onApply: (request: AiRequest) => Promise<void>; setNotice: (notice: Notice) => void; compact?: boolean }) {
  const [scale, setScale] = useState<2 | 4>(2);
  const [capability, setCapability] = useState<AiCapability | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [compareMode, setCompareMode] = useState<'before' | 'after'>('after');
  const [sourceUrl, setSourceUrl] = useState(asset.url);
  const [sourceName, setSourceName] = useState(asset.name);
  const pendingResultRef = useRef(false);

  useEffect(() => {
    void aiAdapter.capability().then(setCapability);
  }, []);

  useEffect(() => {
    if (pendingResultRef.current) {
      pendingResultRef.current = false;
      setCompareMode('after');
      return;
    }
    setSourceUrl(asset.url);
    setSourceName(asset.name);
    setCompareMode('after');
  }, [asset.id, asset.name, asset.url]);

  const selectedTask = aiTasks.find((item) => item.id === task) ?? aiTasks[0];
  const SelectedTaskIcon = selectedTask.icon;
  const modelId = aiModelId(task, scale);
  const outputLabel = task === 'remove-background' ? '透明 PNG' : `${scale}x PNG`;

  async function runModel() {
    setLoading(true);
    setProgress(0.08);
    setCompareMode('after');
    setSourceUrl(asset.url);
    setSourceName(asset.name);
    pendingResultRef.current = true;
    try {
      await aiAdapter.load(modelId, (value) => setProgress(value * 0.72));
      setProgress(0.78);
      await onApply({ mode: 'model', task, scale });
      setProgress(1);
    } catch (error) {
      pendingResultRef.current = false;
      setNotice({ type: 'warning', text: error instanceof Error ? error.message : '模型暂不可用，请检查模型文件配置' });
    } finally {
      setLoading(false);
    }
  }

  function downloadResult() {
    downloadBlob(asset.blob, asset.name.replace(/\.[^/.]+$/, '.png'));
    setNotice({ type: 'success', text: '已下载处理结果，文件没有离开本机' });
  }

  const isSameAsset = sourceUrl === asset.url;
  return <>
    {!compact && <PanelIntro title="AI 超分" description="使用 ESPCN 本地模型智能放大图片，增强像素密度并恢复边缘细节。" />}
    <div className="ai-model-note"><ShieldCheck size={15} /><span><strong>本地推理</strong><small>WebGPU 优先 · WASM 自动降级 · 无需上传原图</small></span></div>
    <div className="control-section"><div className="ai-task-card is-selected single"><SelectedTaskIcon size={17} /><span><strong>{selectedTask.label}</strong><small>{selectedTask.description}</small><em>{selectedTask.model.toUpperCase()} · ONNX</em></span><Check size={14} /></div></div>
    {task === 'upscale' && <div className="control-section"><div className="section-label">输出倍率</div><div className="segmented-grid two"><button type="button" className={scale === 2 ? 'is-selected' : ''} onClick={() => setScale(2)}>2x 标准</button><button type="button" className={scale === 4 ? 'is-selected' : ''} onClick={() => setScale(4)}>4x 高清</button></div></div>}
    <div className="ai-status"><div className={`ai-orb ${capability?.runtime === 'unavailable' ? 'is-muted' : ''}`}><WandSparkles size={20} /></div><div><strong>{capability ? capability.runtime === 'webgpu' ? 'WebGPU 已就绪' : capability.runtime === 'wasm' ? 'WASM 兼容模式' : '当前设备不支持' : '正在检测本机能力'}</strong><small>{capability?.runtime === 'webgpu' ? '首次使用下载模型，之后复用浏览器缓存' : capability?.runtime === 'wasm' ? '首次使用下载模型和运行时，之后复用浏览器缓存' : '按需加载本地模型，不上传原图'}</small></div><span className="ai-runtime-chip">{capability?.runtime === 'webgpu' ? 'GPU' : 'LOCAL'}</span></div>
    <div className="ai-compare"><div className="ai-compare-toolbar"><div><span className="section-label">前后对比</span><small>{sourceName} → {isSameAsset ? '等待处理' : asset.name}</small></div><div className="segmented-control"><button type="button" className={compareMode === 'before' ? 'is-selected' : ''} onClick={() => setCompareMode('before')}>原图</button><button type="button" className={compareMode === 'after' ? 'is-selected' : ''} onClick={() => setCompareMode('after')}>结果</button></div></div><div className="ai-compare-stage"><img src={compareMode === 'before' ? sourceUrl : asset.url} alt={compareMode === 'before' ? 'AI 处理前原图' : 'AI 处理后结果'} />{task === 'remove-background' && compareMode === 'after' && !isSameAsset && <span className="transparency-label">透明背景</span>}</div><div className="ai-compare-meta"><span>{compareMode === 'before' ? `${asset.originalWidth} × ${asset.originalHeight}` : `${asset.width} × ${asset.height}`}</span><span>{compareMode === 'before' ? '处理前' : isSameAsset ? '尚未运行' : outputLabel}</span></div></div>
    <div className="ai-progress" aria-hidden={!loading}><div><span>{loading ? `正在准备 ${selectedTask.label}` : `按需加载 ${selectedTask.model.toUpperCase()} 模型`}</span><strong>{loading ? `${Math.round(progress * 100)}%` : '就绪'}</strong></div><div className="ai-progress-track"><span style={{ width: `${loading ? Math.round(progress * 100) : 0}%` }} /></div></div>
    <div className="ai-action-group"><button className="apply-button" type="button" onClick={() => void runModel()} disabled={loading}><WandSparkles size={17} />{loading ? '本地处理中…' : `加载并运行 ${selectedTask.label}`}<ArrowRightLeft size={15} /></button>{!isSameAsset && <button className="download-result-button" type="button" onClick={downloadResult}><Download size={16} /> 下载处理结果</button>}</div>
    <div className="ai-footnote"><Info size={14} /><span>首次下载：<code>{modelId}.onnx</code> · {aiModelDownloadSizes[modelId]} · 可用 <code>VITE_MODEL_BASE_URL</code> 自托管</span></div>
  </>;
}

function EmptyPanel() { return <div className="empty-panel"><ImagePlus size={29} /><strong>先添加一张图片</strong><span>选择图片后，这里会显示当前工具的参数。</span></div>; }

function ApplyButton({ onClick, label }: { onClick: () => void; label: string }) { return <button className="apply-button" onClick={onClick}><CheckCircle2 size={17} /> {label}<ArrowRightLeft size={15} /></button>; }

function NoticeBanner({ notice, onClose }: { notice: Notice; onClose: () => void }) { if (!notice) return null; const Icon = notice.type === 'success' ? CheckCircle2 : AlertTriangle; return <div className={`notice-banner notice-${notice.type}`}><Icon size={16} /><span>{notice.text}</span><button onClick={onClose} aria-label="关闭提示"><X size={15} /></button></div>; }

function HistoryPopover({ history, onClear, onClose }: { history: Array<{ id: string; name: string; label: string; detail: string; createdAt: number }>; onClear: () => void; onClose: () => void }) { return <div className="popover history-popover"><div className="popover-heading"><div><span className="eyebrow">LOCAL HISTORY</span><h3>最近处理</h3></div><button className="icon-button" onClick={onClose}><X size={15} /></button></div>{history.length ? <div className="history-list">{history.map((entry) => <div className="history-item" key={entry.id}><span className="history-icon"><CheckCircle2 size={15} /></span><span><strong>{entry.label}</strong><small>{entry.name} · {entry.detail}</small></span></div>)}</div> : <div className="empty-history">还没有处理记录</div>}{history.length > 0 && <button className="text-button danger" onClick={onClear}><Trash2 size={14} /> 清空历史</button>}</div>; }

function SettingsPopover({ languagePreference, onLanguageChange, onClose }: { languagePreference: LanguagePreference; onLanguageChange: (preference: LanguagePreference) => void; onClose: () => void }) { return <div className="popover settings-popover"><div className="popover-heading"><div><span className="eyebrow">SETTINGS</span><h3>设置</h3></div><button className="icon-button" onClick={onClose}><X size={15} /></button></div><div className="settings-language"><label htmlFor="language-preference">语言</label><select id="language-preference" className="select-input" value={languagePreference} onChange={(event) => onLanguageChange(event.target.value as LanguagePreference)}><option value="auto">跟随浏览器</option><option value="zh">中文</option><option value="en">English</option></select></div><div className="settings-list"><div><span>默认输出</span><strong>PNG / 保留透明</strong></div><div><span>元数据</span><strong>默认清除</strong></div><div><span>模型策略</span><strong>本地优先</strong></div></div><div className="privacy-callout"><LockKeyhole size={16} /><span><strong>隐私模式已开启</strong><small>当前版本没有上传通道。</small></span></div></div>; }

export default App;
