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
  Eye,
  EyeOff,
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
  Pencil,
  PanelLeft,
  Paintbrush,
  Pipette,
  Plus,
  QrCode,
  RotateCcw,
  ScanSearch,
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
  Zap,
  Redo2,
} from 'lucide-react';
import { aiAdapter } from './core/ai';
import { documentFromAsset, flattenDocument, layerFromAsset, topmostVisibleLayer } from './core/documents';
import { originLayerStyle } from './core/originLayout';
import {
  applyAdjustments,
  applyDetailPass,
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
  splitAsset,
  updateImageMetadata,
  loadImage,
  canvasToBlob,
} from './core/image';
import { useAppStore } from './store';
import { extractWatermarkFromSelections, removeWatermarkByTemplate, removeWatermarkByTemplates, enhanceWatermark } from './core/watermark';
import type { AiCapability, AiModelId, AiRequest, AiTask, BackgroundBrushStroke, BackgroundColorSample, BatchCropAlignment, BatchOptions, BatchProgress, CleanupBrushStroke, ExportFormat, IdPhotoClothingLayer, IdPhotoMattingPreview, ImageAsset, ImageOperation, Layer, LocalBackgroundRemovalOptions, PhotoDocument, SplitLine, ToolId, WatermarkOptions } from './types';
import { DirectCropPanel, DirectSplitPanel, IdPhotoPanel } from './components/DirectImageControls';
import { QrCodePanel } from './components/QrCodePanel';
import { CollagePanel } from './components/CollagePanel';
import { EditorOverlayContext, useEditorOverlay } from './components/EditorOverlay';
import { getStoredLanguagePreference, observeDocumentLocale, resolveLocale, setStoredLanguagePreference } from './i18n';
import type { LanguagePreference } from './i18n';

export type Notice = { type: 'success' | 'warning' | 'error'; text: string } | null;

type EditValues = { brightness: number; contrast: number; saturation: number; blur: number; denoise: number; sharpen: number };

const defaultEditValues: EditValues = { brightness: 0, contrast: 0, saturation: 0, blur: 0, denoise: 0, sharpen: 0 };

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
  { id: 'qrcode', label: '二维码', description: '生成自定义二维码', icon: QrCode, category: '工作流', accent: 'emerald' },
  { id: 'collage', label: '拼贴', description: '底图加贴纸自由拼贴', icon: Combine, category: '工作流', accent: 'pink' },
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




function PreviewImage({ document, editValues, compare, onOverlayHost, activeTool, selectedLayerId, onLayerSelect, onLayerUpdate }: { document: PhotoDocument; editValues?: EditValues; compare?: { url: string; width: number; height: number; map: { scaleX: number; scaleY: number; x: number; y: number } } | null; onOverlayHost: (host: HTMLDivElement | null) => void; activeTool?: ToolId; selectedLayerId?: string | null; onLayerSelect?: (layerId: string | null) => void; onLayerUpdate?: (layerId: string, patch: Partial<Layer>) => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, PreviewPoint>());
  const interactionRef = useRef<PreviewInteraction>(null);
  const layerDragRef = useRef<{ id: string; startX: number; startY: number; initialOffsetX: number; initialOffsetY: number; scaleX: number; scaleY: number; zoom: number } | null>(null);
  const layerResizeRef = useRef<{ id: string; startX: number; startY: number; initialWidth: number; initialHeight: number; initialOffsetX: number; initialOffsetY: number; scaleX: number; scaleY: number; zoom: number } | null>(null);
  const layerRotateRef = useRef<{ id: string; centerX: number; centerY: number; startAngle: number; initialRotation: number } | null>(null);
  const [zoom, setZoom] = useState(MIN_PREVIEW_ZOOM);
  const [offset, setOffset] = useState<PreviewPoint>({ x: 0, y: 0 });
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });

  const fitImage = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !document.canvasWidth || !document.canvasHeight) return;
    const scale = Math.min((stage.clientWidth - 32) / document.canvasWidth, (stage.clientHeight - 32) / document.canvasHeight, 1);
    setDisplaySize({ width: Math.max(1, document.canvasWidth * scale), height: Math.max(1, document.canvasHeight * scale) });
  }, [document.canvasWidth, document.canvasHeight]);

  useLayoutEffect(() => {
    fitImage();
    const observer = new ResizeObserver(fitImage);
    if (stageRef.current) observer.observe(stageRef.current);
    window.addEventListener('resize', fitImage);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fitImage);
    };
  }, [fitImage]);

  useEffect(() => {
    setZoom(MIN_PREVIEW_ZOOM);
    setOffset({ x: 0, y: 0 });
    pointersRef.current.clear();
    interactionRef.current = null;
  }, [document.id]);

  function localPoint(event: React.PointerEvent<HTMLDivElement>): PreviewPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const target = event.target as Element | null;

    if (activeTool === 'collage' && selectedLayerId) {
      const resizeHandle = target?.closest('[data-resize-handle]');
      const rotateHandle = target?.closest('[data-rotate-handle]');
      const layerEl = target?.closest('[data-layer-id]');

      if (layerEl) {
        const layerId = layerEl.getAttribute('data-layer-id') ?? '';

        if (resizeHandle) {
          const layer = document.layers.find((item) => item.id === layerId);
          if (layer) {
            const point = localPoint(event);
            layerResizeRef.current = { id: layerId, startX: point.x, startY: point.y, initialWidth: layer.width, initialHeight: layer.height, initialOffsetX: layer.offsetX, initialOffsetY: layer.offsetY, scaleX, scaleY, zoom };
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        }

        if (rotateHandle) {
          const layer = document.layers.find((item) => item.id === layerId);
          if (layer && stageRef.current) {
            const rect = stageRef.current.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const point = localPoint(event);
            const startAngle = Math.atan2(point.y - centerY, point.x - centerX) * 180 / Math.PI;
            layerRotateRef.current = { id: layerId, centerX, centerY, startAngle, initialRotation: layer.rotation ?? 0 };
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        }

        if (layerId === selectedLayerId) {
          const layer = document.layers.find((item) => item.id === layerId);
          if (layer) {
            const point = localPoint(event);
            layerDragRef.current = { id: layerId, startX: point.x, startY: point.y, initialOffsetX: layer.offsetX, initialOffsetY: layer.offsetY, scaleX, scaleY, zoom };
          }
        } else {
          onLayerSelect?.(layerId);
        }
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    if (target?.closest('.editor-overlay-host')) return;
    const point = localPoint(event);
    pointersRef.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointersRef.current.size >= 2) {
      const [a, b] = Array.from(pointersRef.current.values());
      interactionRef.current = { type: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y), midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, zoom, offset };
    } else if (pointersRef.current.size === 1) {
      const [point] = Array.from(pointersRef.current.values());
      interactionRef.current = { type: 'pan', start: point, offset };
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (layerDragRef.current) {
      const point = localPoint(event);
      const drag = layerDragRef.current;
      const dx = (point.x - drag.startX) / (drag.scaleX * drag.zoom);
      const dy = (point.y - drag.startY) / (drag.scaleY * drag.zoom);
      onLayerUpdate?.(drag.id, { offsetX: drag.initialOffsetX + dx, offsetY: drag.initialOffsetY + dy });
      return;
    }
    if (layerResizeRef.current) {
      const point = localPoint(event);
      const resize = layerResizeRef.current;
      const dx = (point.x - resize.startX) / (resize.scaleX * resize.zoom);
      const dy = (point.y - resize.startY) / (resize.scaleY * resize.zoom);
      const aspect = resize.initialWidth / Math.max(1, resize.initialHeight);
      const delta = Math.max(dx, dy * aspect);
      const newWidth = Math.max(10, resize.initialWidth + delta);
      const newHeight = Math.max(10, resize.initialHeight + delta / aspect);
      const newOffsetX = resize.initialOffsetX - (newWidth - resize.initialWidth) / 2;
      const newOffsetY = resize.initialOffsetY - (newHeight - resize.initialHeight) / 2;
      onLayerUpdate?.(resize.id, { width: newWidth, height: newHeight, offsetX: newOffsetX, offsetY: newOffsetY });
      return;
    }
    if (layerRotateRef.current) {
      const point = localPoint(event);
      const rotate = layerRotateRef.current;
      const currentAngle = Math.atan2(point.y - rotate.centerY, point.x - rotate.centerX) * 180 / Math.PI;
      const delta = currentAngle - rotate.startAngle;
      onLayerUpdate?.(rotate.id, { rotation: rotate.initialRotation + delta });
      return;
    }

    const previous = pointersRef.current.get(event.pointerId);
    if (!previous || !interactionRef.current) return;
    const point = localPoint(event);
    pointersRef.current.set(event.pointerId, point);
    const interaction = interactionRef.current;
    if (interaction.type === 'pan') {
      const dx = point.x - interaction.start.x;
      const dy = point.y - interaction.start.y;
      setOffset((current) => ({ x: current.x + dx, y: current.y + dy }));
      interaction.start = point;
    } else if (interaction.type === 'pinch' && pointersRef.current.size >= 2) {
      const [a, b] = Array.from(pointersRef.current.values());
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      updateTransform(interaction.zoom * (distance / interaction.distance), offset);
    }
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    layerDragRef.current = null;
    layerResizeRef.current = null;
    layerRotateRef.current = null;
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 1) {
      const [point] = Array.from(pointersRef.current.values());
      interactionRef.current = { type: 'pan', start: point, offset };
    } else if (!pointersRef.current.size) {
      interactionRef.current = null;
    }
  }

  function updateTransform(nextZoom: number, nextOffset: PreviewPoint) {
    const stage = stageRef.current;
    if (!stage) return;
    const safeZoom = Math.max(MIN_PREVIEW_ZOOM, Math.min(MAX_PREVIEW_ZOOM, nextZoom));
    const image = displaySize;
    const clampedX = image.width * safeZoom <= stage.clientWidth - 0 ? 0 : Math.min(0, Math.max(-(image.width * safeZoom - stage.clientWidth), nextOffset.x));
    const clampedY = image.height * safeZoom <= stage.clientHeight ? 0 : Math.min(0, Math.max(-(image.height * safeZoom - stage.clientHeight), nextOffset.y));
    setZoom(safeZoom);
    setOffset({ x: clampedX, y: clampedY });
  }

  const scaleX = displaySize.width / document.canvasWidth;
  const scaleY = displaySize.height / document.canvasHeight;

  return (
    <div
      ref={stageRef}
      className={`preview-image-viewport ${zoom > MIN_PREVIEW_ZOOM ? 'is-zoomed' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <div className="preview-image-canvas" style={{ width: displaySize.width, height: displaySize.height, transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})` }}>
        {(() => {
          const visible = document.layers.filter((layer) => layer.visible);
          return visible.map((layer, index) => {
            const isSelected = activeTool === 'collage' && selectedLayerId === layer.id;
            return (
              <div
                key={layer.id}
                data-layer-id={layer.id}
                style={{
                  position: 'absolute',
                  left: layer.offsetX * scaleX,
                  top: layer.offsetY * scaleY,
                  width: layer.width * scaleX,
                  height: layer.height * scaleY,
                  cursor: activeTool === 'collage' ? 'move' : undefined,
                  ...(isSelected ? { outline: '2px solid #3b82f6', outlineOffset: '2px' } : {}),
                }}
              >
                <img
                  src={layer.url}
                  alt={layer.name}
                  draggable={false}
                  style={{
                    width: '100%',
                    height: '100%',
                    boxShadow: '0 16px 40px rgba(36,44,38,.16)',
                    filter: editValues && index === visible.length - 1 ? editPreviewFilter(editValues) : undefined,
                    pointerEvents: activeTool === 'collage' ? 'none' : undefined,
                  }}
                />
                {isSelected && activeTool === 'collage' ? (
                  <>
                    <div data-resize-handle className="layer-resize-handle" />
                    <div data-rotate-handle className="layer-rotate-handle" />
                  </>
                ) : null}
              </div>
            );
          });
        })()}
        {compare && displaySize.width > 0 ? (
          <div className="preview-origin-layer">
            <img src={compare.url} alt="原图对比" draggable={false} style={originLayerStyle(document.canvasWidth, document.canvasHeight, displaySize.width, displaySize.height, compare.width, compare.height, compare.map)} />
            <span className="preview-origin-tag">原图 · 仅保留裁剪</span>
          </div>
        ) : null}
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
  const withOrigin: ImageAsset = { ...asset, origin: { assetId: asset.id, url: asset.url, width: asset.width, height: asset.height }, originMap: { scaleX: 1, scaleY: 1, x: 0, y: 0 } };
  return metadata ? { ...withOrigin, metadata } : withOrigin;
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
    documents,
    activeDocumentId,
    activeTool,
    history,
    addDocuments,
    replaceDocuments,
    updateDocument,
    setActiveDocument,
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
  const activeDocument = documents.find((document) => document.id === activeDocumentId) ?? documents[0] ?? null;
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
      const docs = loaded.map(documentFromAsset);
      checkpoint();
      addDocuments(docs);
      setNotice({ type: 'success', text: `${source}导入 ${loaded.length} 张图片，文件仍只在本机处理` });
      if (!activeTool) setActiveTool('resize');
    } catch {
      setNotice({ type: 'error', text: '图片读取失败，请尝试其他文件' });
    }
  }

  function chooseTool(tool: ToolId) {
    setActiveTool(tool);
    if (!documents.length) fileInput.current?.click();
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
    if (!documents.length) return;
    checkpoint();
    replaceDocuments([]);
    setActiveTool(null);
    setNotice(null);
  }

  function deleteDocument(id: string) {
    const target = documents.find((document) => document.id === id);
    if (!target) return;
    const wasActive = activeDocument?.id === id;
    const targetIndex = documents.findIndex((document) => document.id === id);
    const remaining = documents.filter((document) => document.id !== id);
    checkpoint();
    replaceDocuments(remaining);
    const nextActive = wasActive
      ? remaining[Math.min(targetIndex, remaining.length - 1)]
      : remaining.find((document) => document.id === activeDocument?.id);
    setActiveDocument(nextActive?.id ?? null);
    if (!remaining.length) setActiveTool(null);
    setNotice({ type: 'success', text: `已删除 ${target.name}` });
  }

  function openTool(tool: ToolId) {
    setActiveTool(tool);
    setNotice(null);
  }

  function commitDocument(next: PhotoDocument, label: string, detail: string) {
    checkpoint();
    updateDocument(next.id, () => next);
    addOperation(operation(label, { detail }));
    addHistory({ name: next.name, label, detail });
    setNotice({ type: 'success', text: `${label}完成` });
  }

  function showIdPhotoStage(subject: ImageAsset, opts: { reset?: boolean } = {}) {
    if (!activeDocument) return;
    const firstPush = !activeDocument.edited && activeDocument.layers.every((layer) => !layer.name.startsWith('证件照'));
    if (firstPush) checkpoint();
    const stageLayer: Layer = {
      id: crypto.randomUUID(),
      name: '证件照 · 实时预览',
      type: 'image/png',
      blob: subject.blob,
      url: subject.url,
      width: subject.width,
      height: subject.height,
      visible: true,
      offsetX: 0,
      offsetY: 0,
    };
    updateDocument(activeDocument.id, (current) => ({
      ...current,
      canvasWidth: subject.width,
      canvasHeight: subject.height,
      layers: [...current.layers.map((layer) => ({ ...layer, visible: false })), ...(opts.reset ? [] : current.layers.filter((layer) => layer.name.startsWith('证件照'))), stageLayer],
      activeLayerId: stageLayer.id,
    }));
  }

  async function updateIdPhotoStageLayer(asset: ImageAsset) {
    if (!activeDocument) return;
    const existing = [...activeDocument.layers].reverse().find((layer) => layer.name.startsWith('证件照'));
    if (!existing) { showIdPhotoStage(asset); return; }
    URL.revokeObjectURL(existing.url);
    const blob = asset.blob;
    updateDocument(activeDocument.id, (current) => ({
      ...current,
      canvasWidth: asset.width,
      canvasHeight: asset.height,
      layers: current.layers.map((layer) => (layer.id === existing.id ? { ...layer, blob, url: URL.createObjectURL(blob), width: asset.width, height: asset.height } : layer)),
    }));
  }

  async function applyEffectLayer(label: string, detail: string, run: (flat: ImageAsset) => Promise<ImageAsset>) {
    if (!activeDocument) return;
    const flat = await flattenDocument(activeDocument);
    const result = await run(flat);
    const layer = layerFromAsset(result, `${label} · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
    commitDocument({
      ...activeDocument,
      edited: true,
      type: result.type,
      canvasWidth: result.width,
      canvasHeight: result.height,
      layers: [...activeDocument.layers.map((item) => ({ ...item, visible: false })), layer],
      activeLayerId: layer.id,
    }, label, detail);
  }

  async function bakeTopLayer(label: string, detail: string, run: (flat: ImageAsset) => Promise<ImageAsset>) {
    if (!activeDocument) return;
    const target = topmostVisibleLayer(activeDocument) ?? activeDocument.layers[activeDocument.layers.length - 1];
    if (!target) return;
    const flat = await flattenDocument(activeDocument);
    const result = await run(flat);
    const fitted = document.createElement('canvas');
    fitted.width = target.width;
    fitted.height = target.height;
    const context = fitted.getContext('2d');
    if (!context) throw new Error('当前浏览器无法创建画布');
    context.drawImage(await loadImage(result.blob), 0, 0, fitted.width, fitted.height);
    const blob = await canvasToBlob(fitted, 'image/png');
    URL.revokeObjectURL(target.url);
    const replaced: Layer = { ...target, blob, url: URL.createObjectURL(blob), type: 'image/png' };
    commitDocument({ ...activeDocument, edited: true, layers: activeDocument.layers.map((item) => (item.id === target.id ? replaced : item)) }, label, detail);
  }

  async function bakeCanvasGeometry(kind: 'resize' | 'crop', rect: { x: number; y: number; width: number; height: number }, label: string) {
    if (!activeDocument) return;
    const document = activeDocument;
    const previous = document.originMap ?? { scaleX: 1, scaleY: 1, x: 0, y: 0 };
    const layers = await Promise.all(document.layers.filter((layer) => layer.visible).map(async (layer) => {
      const image = await loadImage(layer.blob);
      const canvas = document2d(rect.width, rect.height);
      if (kind === 'resize') canvas.context.drawImage(image, 0, 0, rect.width, rect.height);
      else canvas.context.drawImage(image, layer.offsetX - rect.x, layer.offsetY - rect.y, layer.width, layer.height);
      const blob = await canvasToBlob(canvas.canvas, 'image/png');
      return { ...layer, blob, url: URL.createObjectURL(blob), width: rect.width, height: rect.height, offsetX: 0, offsetY: 0 };
    }));
    const hidden = document.layers.filter((layer) => !layer.visible).map((layer) => ({ ...layer, offsetX: kind === 'crop' ? layer.offsetX - rect.x : layer.offsetX * (rect.width / document.canvasWidth), offsetY: kind === 'crop' ? layer.offsetY - rect.y : layer.offsetY * (rect.height / document.canvasHeight) }));
    const originMap = kind === 'crop'
      ? { scaleX: previous.scaleX, scaleY: previous.scaleY, x: previous.x + previous.scaleX * rect.x, y: previous.y + previous.scaleY * rect.y }
      : { scaleX: previous.scaleX * document.canvasWidth / rect.width, scaleY: previous.scaleY * document.canvasHeight / rect.height, x: previous.x, y: previous.y };
    const activeId = layers[0]?.id ?? null;
    commitDocument({
      ...document,
      edited: true,
      canvasWidth: rect.width,
      canvasHeight: rect.height,
      originMap,
      layers: [...layers, ...hidden],
      activeLayerId: document.activeLayerId && layers.some((layer) => layer.id === document.activeLayerId) ? document.activeLayerId : activeId,
    }, label, `${rect.width} × ${rect.height}`);
  }

  async function applyResize(width: number, height: number) {
    if (!activeDocument || width < 1 || height < 1) return;
    await bakeCanvasGeometry('resize', { x: 0, y: 0, width, height }, '调整尺寸');
  }

  async function applyCrop(values: { x: number; y: number; width: number; height: number }) {
    if (!activeDocument) return;
    await bakeCanvasGeometry('crop', values, '裁剪');
  }

function document2d(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建画布');
  return { canvas, context };
}

async function previewIdPhoto(values: { x: number; y: number; width: number; height: number }, mattingMode: 'local' | 'ai' | 'none', method: 'solid' | 'connected', samples: BackgroundColorSample[], targetColor: [number, number, number] | null, tolerance: number, feather: number) {
  if (!activeDocument) return null;
  try {
    const flat = await flattenDocument(activeDocument);
    const cropped = await cropAsset(flat, values.x, values.y, values.width, values.height, '证件照裁剪');
    if (mattingMode === 'none') {
      return { subject: cropped, source: cropped, targetColor: null, targetColors: [] } satisfies IdPhotoMattingPreview;
    }
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

  async function applyIdPhoto(preview: IdPhotoMattingPreview, background: string, values: { width: number; height: number }, mattingMode: 'local' | 'ai' | 'none', clothingLayers: IdPhotoClothingLayer[], backgroundImage?: ImageAsset) {
    if (!activeDocument) return;
    const next = await composeIdPhotoAsset(preview.subject, background, clothingLayers, preview.subjectOffset, backgroundImage, preview.subjectScale);
    const doc = documentFromAsset(next);
    doc.name = `证件照-${doc.id.slice(0, 6)}`;
    doc.origin = undefined;
    doc.originMap = undefined;
    const clothingDetail = clothingLayers.length ? ` · ${clothingLayers.length} 个服装图层` : '';
    checkpoint();
    addDocuments([doc]);
    setActiveDocument(doc.id);
    addHistory({ name: doc.name, label: '生成证件照', detail: `${Math.round(values.width)} × ${Math.round(values.height)} · ${mattingMode === 'ai' ? 'AI 抠图' : '本地抠图'}${clothingDetail} · ${background.toUpperCase()}` });
    setNotice({ type: 'success', text: '证件照已生成为新文档' });
  }

  async function applyEdit(values: EditValues) {
    await applyEffectLayer('图片编辑', '色彩调整', (flat) => applyAdjustments(flat, values));
  }

  async function applyMatting(request: LocalBackgroundRemovalOptions) {
    await applyEffectLayer('本地抠图', request.method === 'solid' ? '纯色批量抠除' : '联通色块抠除', (flat) => removeBackgroundAsset(flat, request));
  }

  async function applyAi(request: AiRequest) {
    if (request.mode === 'model') {
      try {
        await applyEffectLayer(aiTaskLabels[request.task], `本地模型 · ${request.task === 'upscale' ? `${request.scale ?? 2} 倍` : '按模型输出'}`, (flat) => aiAdapter.run(flat, { modelId: aiModelId(request.task, request.scale), scale: request.scale, denoise: request.denoise, sharpen: request.sharpen }));
      } catch (error) {
        setNotice({ type: 'warning', text: error instanceof Error ? error.message : 'AI 模型暂不可用，请先准备模型' });
      }
      return;
    }
    try {
      await applyEffectLayer(`${aiTaskLabels[request.task]}（本地降级）`, '未加载模型，使用浏览器处理', async (flat) => {
        let next = await applyLocalAiFallback(flat, request.task, request.scale);
        next = await applyDetailPass(next, { denoise: request.denoise, sharpen: request.sharpen });
        return next;
      });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '本地降级处理失败' });
    }
  }

  async function applyAiBrush(sourceAsset: ImageAsset, stroke: BackgroundBrushStroke) {
    await bakeTopLayer(stroke.mode === 'erase' ? '抠图擦除' : '抠图还原', `${stroke.mode === 'erase' ? '擦除' : '还原'} · 画笔 ${Math.round(stroke.size)} px`, (flat) => applyBackgroundBrush(flat, sourceAsset, stroke));
  }

  async function applyCleanup(stroke: CleanupBrushStroke) {
    try {
      await bakeTopLayer(stroke.mode === 'ai' ? 'AI 去水印' : '普通消除笔', `智能填充 · 画笔 ${Math.round(stroke.size)} px`, (flat) => applyCleanupBrush(flat, stroke));
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '消除处理失败' });
    }
  }

  async function applyCleanupTemplateValue(templates: ImageAsset[], threshold: number, edgePadding: number, fillMode: 'fast' | 'quality') {
    if (!activeDocument || templates.length === 0) return;
    try {
      const options = { threshold, edgePadding, fillMode };
      const label = `自动识别 · 匹配度 ${Math.round(threshold * 100)}% · 扩展 ${edgePadding}px · ${fillMode === 'fast' ? '普通填充' : 'AI 填充'}`;
      if (templates.length > 1) {
        await bakeTopLayer('模板去水印', label, (flat) => removeWatermarkByTemplates(flat, templates, options));
      } else {
        await bakeTopLayer('模板去水印', label, (flat) => removeWatermarkByTemplate(flat, templates[0], options));
      }
      setNotice({ type: 'success', text: '模板去水印完成' });
    } catch (error) {
      setNotice({ type: 'warning', text: error instanceof Error ? error.message : '模板去水印失败' });
    }
  }

  async function applyCleanupTemplateAll(templates: ImageAsset[], threshold: number, edgePadding: number, fillMode: 'fast' | 'quality') {
    if (!documents.length || templates.length === 0) return;
    checkpoint();
    const nextDocuments: PhotoDocument[] = [];
    let failed = 0;
    const options = { threshold, edgePadding, fillMode };
    for (let index = 0; index < documents.length; index += 1) {
      const target = documents[index];
      setNotice({ type: 'success', text: `模板去水印进度 ${index + 1}/${documents.length}` });
      try {
        const flat = await flattenDocument(target);
        const cleaned = templates.length > 1 ? await removeWatermarkByTemplates(flat, templates, options) : await removeWatermarkByTemplate(flat, templates[0], options);
        const layer = layerFromAsset(cleaned, `${target.name} · 去水印`);
        nextDocuments.push({
          ...target,
          edited: true,
          type: cleaned.type,
          canvasWidth: cleaned.width,
          canvasHeight: cleaned.height,
          layers: [...target.layers.map((item) => ({ ...item, visible: false })), layer],
          activeLayerId: layer.id,
        });
      } catch {
        failed += 1;
        nextDocuments.push(target);
      }
    }
    replaceDocuments(nextDocuments);
    addHistory({ name: `${documents.length} 张图片`, label: '模板批量去水印', detail: failed ? `${documents.length - failed} 成功 · ${failed} 失败` : '全部成功' });
    setNotice({ type: failed ? 'warning' : 'success', text: failed ? `批量去水印完成：${documents.length - failed} 张成功，${failed} 张未识别到水印` : `批量去水印完成，已处理 ${nextDocuments.length} 张图片` });
  }

  async function applyWatermarkValue(options: WatermarkOptions) {
    if ((options.kind === 'text' && !options.text.trim()) || (options.kind === 'image' && !options.image)) return;
    await applyEffectLayer('添加水印', options.kind === 'text' ? options.text : '图片水印', (flat) => applyWatermark(flat, options));
  }

  async function applyQrGenerate(asset: ImageAsset) {
    if (!activeDocument) return;
    const layer = layerFromAsset(asset, `二维码 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
    commitDocument({
      ...activeDocument,
      edited: true,
      type: asset.type,
      canvasWidth: asset.width,
      canvasHeight: asset.height,
      layers: [...activeDocument.layers.map((item) => ({ ...item, visible: false })), layer],
      activeLayerId: layer.id,
    }, '生成二维码', asset.name);
  }

  function getCollageStickers(document: PhotoDocument): Layer[] {
    return document.layers.filter((layer) => layer.name.startsWith('sticker:'));
  }

  function addCollageSticker(sticker: Layer) {
    if (!activeDocument) return;
    updateDocument(activeDocument.id, (current) => ({
      ...current,
      layers: [...current.layers, sticker],
    }));
  }

  function updateCollageSticker(id: string, patch: Partial<Layer>) {
    if (!activeDocument) return;
    updateDocument(activeDocument.id, (current) => ({
      ...current,
      layers: current.layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)),
    }));
  }

  function removeCollageSticker(id: string) {
    if (!activeDocument) return;
    updateDocument(activeDocument.id, (current) => ({
      ...current,
      layers: current.layers.filter((layer) => layer.id !== id),
    }));
  }

  async function applyCollageExport(asset: ImageAsset) {
    if (!activeDocument) return;
    const doc = documentFromAsset(asset);
    doc.name = `拼贴-${doc.id.slice(0, 6)}`;
    checkpoint();
    addDocuments([doc]);
    setActiveDocument(doc.id);
    addHistory({ name: doc.name, label: '自由拼贴', detail: '导出拼贴' });
    setNotice({ type: 'success', text: '拼贴已生成为新文档' });
  }

  async function applyMetadataValue(values: Record<string, string>) {
    if (!activeDocument) return;
    const flat = await flattenDocument(activeDocument);
    const metadata = { ...(flat.metadata ?? {}) };
    Object.entries(values).forEach(([key, value]) => {
      if (value.trim()) metadata[key] = value.trim();
      else delete metadata[key];
    });
    const format = activeDocument.type === 'image/jpeg' || activeDocument.type === 'image/png' ? activeDocument.type : 'image/jpeg';
    const blob = await encodeAsset(asProcessedAsset(flat), {
      format,
      quality: 0.94,
      background: '#ffffff',
      preserveTransparency: format !== 'image/jpeg',
      preserveMetadata: false,
    });
    const updatedBlob = await updateImageMetadata(blob, metadata);
    await bakeTopLayer('修改照片信息', '已写入常见照片信息', async () => createAssetFromBlob(updatedBlob, activeDocument.name));
  }

  async function clearMetadataValue() {
    if (!activeDocument) return;
    const flat = await flattenDocument(activeDocument);
    const format = activeDocument.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await encodeAsset(asProcessedAsset(flat), {
      format,
      quality: 0.94,
      background: '#ffffff',
      preserveTransparency: format !== 'image/jpeg',
      preserveMetadata: false,
    });
    await bakeTopLayer('清除照片数据', '已移除 EXIF 与 GPS', () => createAssetFromBlob(blob, activeDocument.name));
  }

  async function applyEncoding(format: ExportFormat, quality: number, background: string) {
    if (!activeDocument) return;
    const flat = await flattenDocument(activeDocument);
    const blob = await encodeAsset(asProcessedAsset(flat), {
      format,
      quality,
      background,
      preserveTransparency: format !== 'image/jpeg',
      preserveMetadata: false,
    });
    await bakeTopLayer(format === 'image/jpeg' ? '压缩图片' : '转换格式', `${format} · ${formatBytes(blob.size)}`, () => createAssetFromBlob(blob, activeDocument.name));
  }

  async function applySplit(direction: 'horizontal' | 'vertical' | 'grid', rows: number, columns: number, lines: SplitLine[] = []) {
    if (!activeDocument) return;
    const flat = await flattenDocument(activeDocument);
    const pieces = await splitAsset(flat, rows, columns, direction, lines);
    const layers = pieces.map((piece, index) => ({ ...layerFromAsset(piece, `${activeDocument.name}-第${index + 1}层`), visible: index === 0 }));
    commitDocument({
      ...activeDocument,
      edited: true,
      layers,
      activeLayerId: layers[0]?.id ?? null,
    }, '分割图片', `切为 ${layers.length} 个图层`);
    setNotice({ type: 'success', text: `已生成 ${layers.length} 个图层，可在图层面板切换显隐` });
  }

  async function applyMerge(layout: 'horizontal' | 'vertical' | 'grid', gap: number, background: string) {
    if (documents.length < 2) {
      setNotice({ type: 'warning', text: '至少导入两张图片才能拼图' });
      return;
    }
    const sources = await Promise.all(documents.map((document) => flattenDocument(document)));
    const merged = await createCollage(sources, layout, gap, background);
    const doc = documentFromAsset(merged);
    doc.name = `拼图-${new Date().toISOString().slice(0, 10)}`;
    doc.origin = undefined;
    doc.originMap = undefined;
    checkpoint();
    addDocuments([doc]);
    setActiveDocument(doc.id);
    addHistory({ name: doc.name, label: '图片拼图', detail: `${sources.length} 张图片` });
    setNotice({ type: 'success', text: '拼图已生成为新文档，可继续编辑或导出' });
  }

  async function exportActive(format: ExportFormat = 'image/png', quality = 0.88) {
    if (!activeDocument) return;
    const flat = await flattenDocument(activeDocument);
    await exportImage(asProcessedAsset(flat), {
      format,
      quality,
      background: '#ffffff',
      preserveTransparency: format !== 'image/jpeg',
      preserveMetadata: false,
    });
    setNotice({ type: 'success', text: `已下载 ${activeDocument.name}` });
  }

  async function exportAll() {
    for (const document of documents) {
      const flat = await flattenDocument(document);
      await exportImage(asProcessedAsset(flat), {
        format: document.type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
        quality: 0.88,
        background: '#ffffff',
        preserveTransparency: document.type !== 'image/jpeg',
        preserveMetadata: false,
      });
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
    setNotice({ type: 'success', text: `已准备下载 ${documents.length} 个文档` });
  }

  async function exportGif() {
    if (documents.length < 2) {
      setNotice({ type: 'warning', text: 'GIF 合成至少需要两张图片' });
      return;
    }
    const frames = await Promise.all(documents.map((document) => flattenDocument(document)));
    const blob = await encodeGifFrames(frames, 8);
    downloadBlob(blob, 'alun-image-animation.gif');
    setNotice({ type: 'success', text: 'GIF 已导出' });
  }

  async function applyBatch(options: BatchOptions) {
    if (!documents.length || batchProgress.running) return;
    const nextDocuments: PhotoDocument[] = [];
    let failed = 0;
    setBatchProgress({ running: true, completed: 0, failed: 0, total: documents.length });
    for (let index = 0; index < documents.length; index += 1) {
      const document = documents[index];
      setBatchProgress({ running: true, completed: index, failed, total: documents.length, currentName: document.name });
      try {
        const flat = await flattenDocument(document);
        let next: ImageAsset;
        if (options.kind === 'matting') {
          const samples = await estimateBackgroundSamples(flat, options.sampling);
          next = await removeBackgroundAsset(flat, {
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
          const rect = alignedCropRect(flat.width, flat.height, options.width, options.height, options.alignment);
          next = await cropAsset(flat, rect.x, rect.y, rect.width, rect.height, '批量裁剪');
        } else if (options.kind === 'upscale') {
          try {
            next = await aiAdapter.run(flat, { modelId: aiModelId('upscale', options.scale), scale: options.scale });
          } catch {
            next = await applyLocalAiFallback(flat, 'upscale', options.scale);
          }
        } else if (options.kind === 'rename') {
          const sequence = String(options.start + index).padStart(options.digits, '0');
          const name = `${options.template.replaceAll('{name}', fileNameWithoutExtension(document.name)).replaceAll('{n}', sequence)}.png`;
          nextDocuments.push({ ...document, name });
          setBatchProgress({ running: true, completed: index + 1, failed, total: documents.length, currentName: document.name });
          continue;
        } else {
          const blob = await encodeAsset(asProcessedAsset(flat), { format: options.format, quality: options.quality, background: '#ffffff', preserveTransparency: options.format !== 'image/jpeg', preserveMetadata: false });
          next = await createAssetFromBlob(blob, document.name);
        }
        const layer = layerFromAsset(next, `${document.name} · 效果`);
        nextDocuments.push({
          ...document,
          edited: true,
          canvasWidth: next.width,
          canvasHeight: next.height,
          layers: [...document.layers.map((item) => ({ ...item, visible: false })), layer],
          activeLayerId: layer.id,
        });
      } catch {
        failed += 1;
        nextDocuments.push(document);
      }
      setBatchProgress({ running: true, completed: index + 1, failed, total: documents.length, currentName: document.name });
    }
    checkpoint();
    replaceDocuments(nextDocuments);
    const labels: Record<BatchOptions['kind'], string> = { matting: '批量抠图', crop: '批量裁剪', upscale: '批量超分', rename: '批量改名', compress: '批量压缩' };
    addHistory({ name: `${documents.length} 张图片`, label: labels[options.kind], detail: failed ? `${documents.length - failed} 成功 · ${failed} 失败` : '全部成功' });
    setBatchProgress({ running: false, completed: documents.length, failed, total: documents.length });
    setNotice({ type: failed ? 'warning' : 'success', text: failed ? `批量处理完成：${documents.length - failed} 张成功，${failed} 张保留原图` : `批量处理完成，共 ${nextDocuments.length} 个文档` });
  }

  const pageClass = `app-shell ${theme === 'dark' ? 'theme-dark' : ''} ${documents.length ? 'has-workspace' : ''}`;

  return (
    <div className={pageClass} style={documents.length ? workspaceStyle : undefined}>
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

      {!documents.length ? (
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
          documents={documents}
          activeDocument={activeDocument}
          activeTool={activeTool ?? 'resize'}
          onSelectDocument={setActiveDocument}
          onRenameDocument={(id, name) => updateDocument(id, (document) => ({ ...document, name }))}
          onUpdateDocument={(updater) => { if (activeDocument) updateDocument(activeDocument.id, updater); }}
          onSelectTool={openTool}
          onAddFiles={() => fileInput.current?.click()}
          onClear={clearAssets}
          onExport={() => void exportActive()}
          onExportAll={() => void exportAll()}
          onResize={applyResize}
          onCrop={applyCrop}
          onIdPhotoPreview={previewIdPhoto}
          onIdPhotoStage={showIdPhotoStage}
          onIdPhotoStageUpdate={updateIdPhotoStageLayer}
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
          onCleanupTemplate={applyCleanupTemplateValue}
          onCleanupTemplateAll={applyCleanupTemplateAll}
          onWatermark={applyWatermarkValue}
          onQrGenerate={applyQrGenerate}
          onCollageExport={applyCollageExport}
          onAddCollageSticker={addCollageSticker}
          onUpdateCollageSticker={updateCollageSticker}
          onRemoveCollageSticker={removeCollageSticker}
          collageStickers={activeDocument ? getCollageStickers(activeDocument) : []}
          onMetadata={applyMetadataValue}
          onClearMetadata={clearMetadataValue}
          onExportGif={exportGif}
          onBatch={applyBatch}
          batchProgress={batchProgress}
          onDeleteAsset={deleteDocument}
          onUndo={() => { undo(); setNotice({ type: 'success', text: '已撤销上一步操作' }); }}
          onRedo={() => { redo(); setNotice({ type: 'success', text: '已重做上一步操作' }); }}
          canUndo={canUndo}
          canRedo={canRedo}
          setNotice={setNotice}
        />
      )}

      <footer className="site-footer">
        <span><ShieldCheck size={14} /> 图片默认只在你的设备上处理，不会上传服务器</span>
        <span className="site-footer-meta"><a className="site-footer-contact" href="mailto:alunnb@outlook.com">问题反馈：alunnb@outlook.com</a><span>Alun Image <i>0.1</i></span></span>
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
  documents,
  activeDocument,
  activeTool,
  onSelectDocument,
  onRenameDocument,
  onUpdateDocument,
  onIdPhotoStage,
  onIdPhotoStageUpdate,
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
  onCleanupTemplate,
  onCleanupTemplateAll,
  onWatermark,
  onQrGenerate,
  onCollageExport,
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
  onAddCollageSticker,
  onUpdateCollageSticker,
  onRemoveCollageSticker,
  collageStickers,
}: {
  documents: PhotoDocument[];
  activeDocument: PhotoDocument | null;
  activeTool: ToolId;
  onSelectDocument: (id: string) => void;
  onRenameDocument: (id: string, name: string) => void;
  onUpdateDocument: (updater: (document: PhotoDocument) => PhotoDocument) => void;
  onSelectTool: (tool: ToolId) => void;
  onAddFiles: () => void;
  onClear: () => void;
  onExport: () => void;
  onExportAll: () => void;
  onResize: (width: number, height: number) => Promise<void>;
  onCrop: (values: { x: number; y: number; width: number; height: number }) => Promise<void>;
  onIdPhotoPreview: (values: { x: number; y: number; width: number; height: number }, mattingMode: 'local' | 'ai' | 'none', method: 'solid' | 'connected', samples: BackgroundColorSample[], targetColor: [number, number, number] | null, tolerance: number, feather: number) => Promise<IdPhotoMattingPreview | null>;
  onIdPhotoBrush: (preview: IdPhotoMattingPreview, stroke: BackgroundBrushStroke) => Promise<IdPhotoMattingPreview>;
  onIdPhotoClothing: (source: File | string, removeBackground: boolean) => Promise<ImageAsset | null>;
  onIdPhoto: (preview: IdPhotoMattingPreview, background: string, values: { width: number; height: number }, mattingMode: 'local' | 'ai' | 'none', clothingLayers: IdPhotoClothingLayer[], backgroundImage?: ImageAsset) => Promise<void>;
  onSplit: (direction: 'horizontal' | 'vertical' | 'grid', rows: number, columns: number, lines?: SplitLine[]) => Promise<void>;
  onMerge: (layout: 'horizontal' | 'vertical' | 'grid', gap: number, background: string) => Promise<void>;
  onEncode: (format: ExportFormat, quality: number, background: string) => Promise<void>;
  onEdit: (values: EditValues) => Promise<void>;
  onMattingApply: (request: LocalBackgroundRemovalOptions) => Promise<void>;
  onMattingBrushApply: (sourceAsset: ImageAsset, stroke: BackgroundBrushStroke) => Promise<void>;
  onAiApply: (request: AiRequest) => Promise<void>;
  onCleanup: (stroke: CleanupBrushStroke) => Promise<void>;
  onCleanupTemplate: (templates: ImageAsset[], threshold: number, edgePadding: number, fillMode: 'fast' | 'quality') => Promise<void>;
  onCleanupTemplateAll: (templates: ImageAsset[], threshold: number, edgePadding: number, fillMode: 'fast' | 'quality') => Promise<void>;
  onWatermark: (options: WatermarkOptions) => Promise<void>;
  onQrGenerate: (asset: ImageAsset) => Promise<void>;
  onCollageExport: (asset: ImageAsset) => Promise<void>;
  onAddCollageSticker: (sticker: Layer) => void;
  onUpdateCollageSticker: (id: string, patch: Partial<Layer>) => void;
  onRemoveCollageSticker: (id: string) => void;
  collageStickers: Layer[];
  onMetadata: (values: Record<string, string>) => Promise<void>;
  onClearMetadata: () => Promise<void>;
  onExportGif: () => Promise<void>;
  onIdPhotoStage: (subject: ImageAsset, opts?: { reset?: boolean }) => void;
  onIdPhotoStageUpdate: (asset: ImageAsset) => Promise<void> | void;
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
  const [compareLocked, setCompareLocked] = useState(false);
  const [comparePeeking, setComparePeeking] = useState(false);
  const [viewAsset, setViewAsset] = useState<ImageAsset | null>(null);
  const [renamingDocument, setRenamingDocument] = useState(false);
  const [documentNameDraft, setDocumentNameDraft] = useState('');
  const [selectedCollageStickerId, setSelectedCollageStickerId] = useState<string | null>(null);
  const comparePressStartRef = useRef(0);
  const activeToolDefinition = tools.find((tool) => tool.id === activeTool) ?? tools[0];
  const Icon = activeToolDefinition.icon;
  useEffect(() => {
    setEditPreview(defaultEditValues);
    setCompareLocked(false);
    setComparePeeking(false);
    setRenamingDocument(false);
  }, [activeDocument?.id, activeTool]);
  useEffect(() => {
    let cancelled = false;
    if (!activeDocument) { setViewAsset(null); return; }
    void flattenDocument(activeDocument).then((flat) => { if (!cancelled) setViewAsset(flat); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeDocument]);
  const originReady = Boolean(activeDocument?.edited && activeDocument.origin && activeDocument.originMap);
  const compareActive = (comparePeeking || compareLocked) && originReady;
  const compare = compareActive && activeDocument?.origin && activeDocument.originMap ? { url: activeDocument.origin.url, width: activeDocument.origin.width, height: activeDocument.origin.height, map: activeDocument.originMap } : null;

  function endComparePress(withToggle: boolean) {
    setComparePeeking(false);
    if (withToggle && performance.now() - comparePressStartRef.current < 250) setCompareLocked((value) => !value);
  }
  function startDocumentRename() {
    if (!activeDocument) return;
    setDocumentNameDraft(activeDocument.name);
    setRenamingDocument(true);
  }
  function commitDocumentRename() {
    if (activeDocument && documentNameDraft.trim()) onRenameDocument(activeDocument.id, documentNameDraft.trim());
    setRenamingDocument(false);
  }
  function handleCollageLayerSelect(layerId: string | null) {
    setSelectedCollageStickerId(layerId);
  }
  function handleCollageLayerUpdate(layerId: string, patch: Partial<Layer>) {
    if (!activeDocument) return;
    onUpdateDocument((current) => ({
      ...current,
      layers: current.layers.map((layer) => (layer.id === layerId ? { ...layer, ...patch } : layer)),
    }));
  }
  const canvasAspectPortrait = Boolean(activeDocument && activeDocument.canvasHeight > activeDocument.canvasWidth);
  return (
    <EditorOverlayContext.Provider value={overlayHost}>
    <main className="workspace-page">
      <div className="workspace-breadcrumb"><button className="back-button" onClick={onClear}><ArrowLeft size={15} /> 工具箱</button><span>/</span><span>{activeToolDefinition.label}</span><div className="workspace-actions"><button className="secondary-button" onClick={onAddFiles}><Plus size={16} /> 添加图片</button><button className="secondary-button" onClick={onExportAll}><Download size={16} /> 全部下载</button><button className="primary-button compact" onClick={onExport}><FileDown size={16} /> 导出当前</button></div></div>
      <div className="asset-strip"><div className="asset-strip-label"><span className="eyebrow">WORKSPACE</span><strong>{documents.length} 个文档</strong></div><div className="asset-thumbs">{documents.map((document, index) => { const top = [...document.layers].reverse().find((layer) => layer.visible) ?? document.layers[0]; return <div className="asset-thumb-wrap" key={document.id}><button className={`asset-thumb ${document.id === activeDocument?.id ? 'is-active' : ''}`} aria-label={`选中 ${document.name}`} aria-pressed={document.id === activeDocument?.id} onClick={() => onSelectDocument(document.id)}><img src={top?.url} alt={document.name} /><span>{index + 1}</span></button><button className="asset-delete-button" title={`删除 ${document.name}`} aria-label={`删除 ${document.name}`} onClick={() => onDeleteAsset(document.id)}><X size={11} /></button></div>; })}<button className="add-thumb" title="添加图片" aria-label="添加图片" onClick={onAddFiles}><Plus size={17} /></button></div><div className="asset-total">{activeDocument?.edited ? '已编辑' : '未编辑'}</div></div>
      <div className="workspace-layout">
        <aside className="tool-sidebar"><div className="sidebar-title"><PanelLeft size={15} /><span>工具</span></div><div className="sidebar-list">{tools.map((tool) => { const ToolIcon = tool.icon; return <button className={`sidebar-tool ${activeTool === tool.id ? 'is-active' : ''}`} data-tool-id={tool.id} key={tool.id} onClick={() => onSelectTool(tool.id)} title={tool.description}><ToolIcon size={17} /><span>{tool.label}</span>{activeTool === tool.id && <span className="active-bar" />}</button>; })}</div><div className="sidebar-bottom"><ShieldCheck size={16} /><small>本地模式<br />Local only</small></div></aside>
        <section className="preview-column"><div className="preview-toolbar"><span><span className="live-dot" /> 直接编辑</span>{renamingDocument && activeDocument ? <span className="doc-rename"><input autoFocus value={documentNameDraft} onChange={(event) => setDocumentNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') commitDocumentRename(); if (event.key === 'Escape') setRenamingDocument(false); }} /><button type="button" className="text-button" onClick={commitDocumentRename}>确定</button><button type="button" className="text-button" onClick={() => setRenamingDocument(false)}>取消</button></span> : <button type="button" className="doc-name-button" title="点击重命名文档（同时是导出文件名）" onClick={startDocumentRename}>{activeDocument?.name ?? '未选择文档'}<Pencil size={12} /></button>}<span>{activeDocument ? `${activeDocument.canvasWidth} × ${activeDocument.canvasHeight}` : ''}</span></div><div className={`preview-stage ${canvasAspectPortrait ? 'is-portrait' : 'is-landscape'}`}><div className="stage-grid" />{activeDocument ? <PreviewImage document={activeDocument} editValues={activeTool === 'edit' ? editPreview : undefined} compare={compare} onOverlayHost={setOverlayHost} activeTool={activeTool} selectedLayerId={selectedCollageStickerId} onLayerSelect={handleCollageLayerSelect} onLayerUpdate={handleCollageLayerUpdate} /> : <div className="preview-empty"><ImagePlus size={32} /><span>选择一张图片开始</span></div>}{originReady && <button type="button" className={`preview-compare-pill ${compareActive ? 'is-engaged' : ''}`} aria-pressed={compareLocked} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); comparePressStartRef.current = performance.now(); setComparePeeking(true); }} onPointerUp={() => endComparePress(true)} onPointerCancel={() => endComparePress(false)}><ArrowRightLeft size={13} /><span>{compareActive ? '原图对比中 · 点按退出' : '按住看原图'}</span></button>}<div className="preview-badge"><CheckCircle2 size={14} /> 本地处理</div></div><div className="preview-footer"><div className="preview-file"><FileImage size={16} /><span><strong>{activeDocument?.name ?? '未选择文件'}</strong><small>{activeDocument ? `${activeDocument.layers.filter((layer) => layer.visible).length}/${activeDocument.layers.length} 图层可见` : '拖入图片或点击添加'}</small></span></div><div className="preview-controls"><button className="icon-button" title="帮助"><CircleHelp size={16} /></button><button className="icon-button" title="撤销上一步操作" aria-label="撤销上一步操作" disabled={!canUndo} onClick={onUndo}><Undo2 size={16} /></button><button className="icon-button" title="重做上一步操作" aria-label="重做上一步操作" disabled={!canRedo} onClick={onRedo}><Redo2 size={16} /></button>{activeDocument && <button className="icon-button" title="删除当前文档" aria-label="删除当前文档" onClick={() => onDeleteAsset(activeDocument.id)}><Trash2 size={16} /></button>}</div></div></section>
        <aside className="control-column"><div className="control-heading"><div className="control-icon"><Icon size={19} /></div><div><span className="eyebrow">CURRENT TOOL</span><h2>{activeToolDefinition.label}</h2></div><button className="icon-button mobile-close" title="关闭面板"><X size={17} /></button></div>{activeDocument && <LayerPanel document={activeDocument} onSelectLayer={(layerId) => onUpdateDocument((current) => ({ ...current, activeLayerId: layerId }))} onToggleLayer={(layerId) => onUpdateDocument((current) => ({ ...current, edited: true, layers: current.layers.map((layer) => (layer.id === layerId ? { ...layer, visible: !layer.visible } : layer)) }))} onRenameLayer={(layerId, name) => onUpdateDocument((current) => ({ ...current, layers: current.layers.map((layer) => (layer.id === layerId ? { ...layer, name } : layer)) }))} onDeleteLayer={(layerId) => onUpdateDocument((current) => { const layers = current.layers.filter((layer) => layer.id !== layerId); return { ...current, layers, activeLayerId: current.activeLayerId === layerId ? layers[0]?.id ?? null : current.activeLayerId }; })} onExportLayer={async (layerId) => { const layer = activeDocument.layers.find((item) => item.id === layerId); if (!layer) return; await exportImage(asProcessedAsset({ id: layer.id, name: layer.name, type: layer.type, size: layer.blob.size, width: layer.width, height: layer.height, originalWidth: layer.width, originalHeight: layer.height, blob: layer.blob, url: layer.url }), { format: 'image/png', quality: 0.92, background: '#ffffff', preserveTransparency: true, preserveMetadata: false }); setNotice({ type: 'success', text: `已下载图层 ${layer.name}` }); }} />}        <div className="control-scroll"><ToolPanel tool={activeTool} asset={viewAsset} onIdPhotoStage={onIdPhotoStage} onIdPhotoStageUpdate={onIdPhotoStageUpdate} onResize={onResize} onCrop={onCrop} onIdPhotoPreview={onIdPhotoPreview} onIdPhotoBrush={onIdPhotoBrush} onIdPhotoClothing={onIdPhotoClothing} onIdPhoto={onIdPhoto} onSplit={onSplit} onMerge={onMerge} onEncode={onEncode} onEdit={onEdit} onEditPreview={setEditPreview} onMattingApply={onMattingApply} onMattingBrushApply={onMattingBrushApply} onAiApply={onAiApply} onCleanup={onCleanup} onCleanupTemplate={onCleanupTemplate} onCleanupTemplateAll={onCleanupTemplateAll} documentCount={documents.length} onWatermark={onWatermark} onQrGenerate={onQrGenerate} onAddCollageSticker={onAddCollageSticker} onUpdateCollageSticker={onUpdateCollageSticker} onRemoveCollageSticker={onRemoveCollageSticker} collageStickers={collageStickers} selectedCollageStickerId={selectedCollageStickerId} setSelectedCollageStickerId={setSelectedCollageStickerId} onMetadata={onMetadata} onClearMetadata={onClearMetadata} onExportGif={onExportGif} onBatch={onBatch} batchProgress={batchProgress} setNotice={setNotice} /></div><div className="control-footer"><span><ShieldCheck size={14} /> 本地安全处理</span><button className="help-link"><CircleHelp size={14} /> 需要帮助</button></div></aside>
      </div>
    </main>
    </EditorOverlayContext.Provider>
  );
}

function LayerPanel({ document: doc, onSelectLayer, onToggleLayer, onRenameLayer, onDeleteLayer, onExportLayer }: {
  document: PhotoDocument;
  onSelectLayer: (layerId: string) => void;
  onToggleLayer: (layerId: string) => void;
  onRenameLayer: (layerId: string, name: string) => void;
  onDeleteLayer: (layerId: string) => void;
  onExportLayer: (layerId: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const rows = [...doc.layers].reverse();
  return (
    <div className="layer-panel">
      <div className="layer-panel-head"><Layers3 size={14} /><span>图层</span><small>{doc.layers.filter((layer) => layer.visible).length}/{doc.layers.length}</small></div>
      <div className="layer-rows">
        {rows.map((layer) => (
          <div key={layer.id} className={`layer-row ${doc.activeLayerId === layer.id ? 'is-active' : ''} ${layer.visible ? '' : 'is-hidden'}`}>
            <button type="button" className="layer-thumb" onClick={() => onSelectLayer(layer.id)} title="设为激活图层"><img src={layer.url} alt={layer.name} draggable={false} /></button>
            {editingId === layer.id ? (
              <input
                autoFocus
                className="layer-name-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && draft.trim()) { onRenameLayer(layer.id, draft.trim()); setEditingId(null); }
                  if (event.key === 'Escape') setEditingId(null);
                }}
                onBlur={() => { if (draft.trim()) onRenameLayer(layer.id, draft.trim()); setEditingId(null); }}
              />
            ) : (
              <button type="button" className="layer-name" title="双击重命名" onDoubleClick={() => { setDraft(layer.name); setEditingId(layer.id); }} onClick={() => onSelectLayer(layer.id)}>
                <strong>{layer.name}</strong>
                <small>{layer.width} × {layer.height}</small>
              </button>
            )}
            <button type="button" className="layer-action" title={layer.visible ? '隐藏图层' : '显示图层'} aria-label={layer.visible ? '隐藏图层' : '显示图层'} onClick={() => onToggleLayer(layer.id)}>{layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
            <button type="button" className="layer-action" title="单独导出此层" aria-label="单独导出此层" onClick={() => void onExportLayer(layer.id)}><Download size={13} /></button>
            <button type="button" className="layer-action danger" title="删除图层" aria-label="删除图层" onClick={() => onDeleteLayer(layer.id)}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolPanel({ tool, asset, onIdPhotoStage, onIdPhotoStageUpdate, onResize, onCrop, onIdPhotoPreview, onIdPhotoBrush, onIdPhotoClothing, onIdPhoto, onSplit, onMerge, onEncode, onEdit, onEditPreview, onMattingApply, onMattingBrushApply, onAiApply, onCleanup, onCleanupTemplate, onCleanupTemplateAll, documentCount, onWatermark, onQrGenerate, onAddCollageSticker, onUpdateCollageSticker, onRemoveCollageSticker, collageStickers, selectedCollageStickerId, setSelectedCollageStickerId, onMetadata, onClearMetadata, onExportGif, onBatch, batchProgress, setNotice }: {
  tool: ToolId;
  asset: ImageAsset | null;
  onResize: (width: number, height: number) => Promise<void>;
  onCrop: (values: { x: number; y: number; width: number; height: number }) => Promise<void>;
  onIdPhotoPreview: (values: { x: number; y: number; width: number; height: number }, mattingMode: 'local' | 'ai' | 'none', method: 'solid' | 'connected', samples: BackgroundColorSample[], targetColor: [number, number, number] | null, tolerance: number, feather: number) => Promise<IdPhotoMattingPreview | null>;
  onIdPhotoBrush: (preview: IdPhotoMattingPreview, stroke: BackgroundBrushStroke) => Promise<IdPhotoMattingPreview>;
  onIdPhotoClothing: (source: File | string, removeBackground: boolean) => Promise<ImageAsset | null>;
  onIdPhoto: (preview: IdPhotoMattingPreview, background: string, values: { width: number; height: number }, mattingMode: 'local' | 'ai' | 'none', clothingLayers: IdPhotoClothingLayer[], backgroundImage?: ImageAsset) => Promise<void>;
  onSplit: (direction: 'horizontal' | 'vertical' | 'grid', rows: number, columns: number, lines?: SplitLine[]) => Promise<void>;
  onMerge: (layout: 'horizontal' | 'vertical' | 'grid', gap: number, background: string) => Promise<void>;
  onEncode: (format: ExportFormat, quality: number, background: string) => Promise<void>;
  onEdit: (values: EditValues) => Promise<void>;
  onEditPreview: (values: EditValues) => void;
  onMattingApply: (request: LocalBackgroundRemovalOptions) => Promise<void>;
  onMattingBrushApply: (sourceAsset: ImageAsset, stroke: BackgroundBrushStroke) => Promise<void>;
  onAiApply: (request: AiRequest) => Promise<void>;
  onCleanup: (stroke: CleanupBrushStroke) => Promise<void>;
  onCleanupTemplate: (templates: ImageAsset[], threshold: number, edgePadding: number, fillMode: 'fast' | 'quality') => Promise<void>;
  onCleanupTemplateAll: (templates: ImageAsset[], threshold: number, edgePadding: number, fillMode: 'fast' | 'quality') => Promise<void>;
  documentCount: number;
  onWatermark: (options: WatermarkOptions) => Promise<void>;
  onQrGenerate: (asset: ImageAsset) => Promise<void>;
  onAddCollageSticker: (sticker: Layer) => void;
  onUpdateCollageSticker: (id: string, patch: Partial<Layer>) => void;
  onRemoveCollageSticker: (id: string) => void;
  collageStickers: Layer[];
  selectedCollageStickerId: string | null;
  setSelectedCollageStickerId: (id: string | null) => void;
  onMetadata: (values: Record<string, string>) => Promise<void>;
  onClearMetadata: () => Promise<void>;
  onExportGif: () => Promise<void>;
  onIdPhotoStage: (subject: ImageAsset, opts?: { reset?: boolean }) => void;
  onIdPhotoStageUpdate: (asset: ImageAsset) => Promise<void> | void;
  onBatch: (options: BatchOptions) => Promise<void>;
  batchProgress: BatchProgress;
  setNotice: (notice: Notice) => void;
}) {
  if (!asset && tool !== 'qrcode' && tool !== 'collage') return <EmptyPanel />;
  const safeAsset = asset!;
  switch (tool) {
    case 'resize': return <ResizePanel asset={safeAsset} onApply={onResize} />;
    case 'crop': return <CropPanel asset={safeAsset} onApply={onCrop} />;
    case 'split': return <SplitPanel asset={safeAsset} onApply={onSplit} />;
    case 'merge': return <MergePanel count={0} onApply={onMerge} setNotice={setNotice} />;
    case 'compress': return <EncodePanel mode="compress" asset={safeAsset} onApply={onEncode} />;
    case 'convert': return <EncodePanel mode="convert" asset={safeAsset} onApply={onEncode} />;
    case 'matting': return <MattingPanel asset={safeAsset} onApply={onMattingApply} onBrushApply={onMattingBrushApply} onAiApply={onAiApply} setNotice={setNotice} />;
    case 'cleanup': return <CleanupPanel asset={safeAsset} documentCount={documentCount} onApply={onCleanup} onApplyTemplate={onCleanupTemplate} onApplyTemplateBatch={onCleanupTemplateAll} setNotice={setNotice} />;
    case 'ai-upscale': return <AiModelPanel task="upscale" asset={safeAsset} onApply={onAiApply} setNotice={setNotice} />;
    case 'edit': return <EditPanel onApply={onEdit} onPreview={onEditPreview} />;
    case 'watermark': return <WatermarkPanel asset={safeAsset} onApply={onWatermark} />;
    case 'metadata': return <MetadataPanel asset={safeAsset} onApply={onMetadata} onClear={onClearMetadata} setNotice={setNotice} />;
    case 'batch': return <BatchPanel count={1} progress={batchProgress} onApply={onBatch} />;
    case 'gif': return <GifPanel count={0} onApply={onExportGif} />;
    case 'id-photo': return <IdPhotoPanel key={asset?.id ?? 'none'} asset={safeAsset} onPreview={onIdPhotoPreview} onBrushApply={onIdPhotoBrush} onLoadClothing={onIdPhotoClothing} onApply={onIdPhoto} onStage={onIdPhotoStage} onStageUpdate={onIdPhotoStageUpdate} setNotice={setNotice} />;
    case 'qrcode': return <QrCodePanel onGenerate={onQrGenerate} />;
    case 'collage': return <CollagePanel asset={asset} onAddSticker={onAddCollageSticker} onUpdateSticker={onUpdateCollageSticker} onRemoveSticker={onRemoveCollageSticker} stickers={collageStickers} selectedId={selectedCollageStickerId} setSelectedId={setSelectedCollageStickerId} setNotice={setNotice} />;
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

function MergePanel({ count, onApply, setNotice }: { count: number; onApply: (layout: 'horizontal' | 'vertical' | 'grid', gap: number, background: string) => Promise<void>; setNotice: (notice: Notice) => void }) {
  const [layout, setLayout] = useState<'horizontal' | 'vertical' | 'grid'>('grid');
  const [gap, setGap] = useState(16);
  const [background, setBackground] = useState('#ffffff');
  function chooseLayout(next: 'horizontal' | 'vertical' | 'grid') {
    if (next === 'grid') {
      setNotice({ type: 'warning', text: '网格拼图要求所有图片尺寸一致，请先统一图片大小' });
      return;
    }
    setLayout(next);
  }
  function apply() {
    if (layout === 'grid') {
      setNotice({ type: 'warning', text: '网格拼图要求所有图片尺寸一致，请先统一图片大小' });
      return;
    }
    void onApply(layout, gap, background);
  }
  return <><PanelIntro title="合并与拼图" description="横向和纵向按原图边缘拼接，网格要求所有图片尺寸一致。" /><div className="inline-info"><Layers3 size={16} /><span>当前工作区 <strong>{count} 个文档</strong></span></div><div className="control-section"><div className="section-label">布局</div><div className="segmented-grid three"><button className={layout === 'horizontal' ? 'is-selected' : ''} onClick={() => chooseLayout('horizontal')}>横向</button><button className={layout === 'vertical' ? 'is-selected' : ''} onClick={() => chooseLayout('vertical')}>纵向</button><button className={`${layout === 'grid' ? 'is-selected' : ''}`}  title={'网格拼图'} onClick={() => chooseLayout('grid')}>网格</button></div></div><div className="control-section"><Field label="图片间距" suffix="px"><input type="number" min="0" max="200" value={gap} onChange={(event) => setGap(Number(event.target.value))} /></Field><div className="color-field"><span>背景颜色</span><label><input type="color" value={background} onChange={(event) => setBackground(event.target.value)} /><b>{background.toUpperCase()}</b></label></div></div><ApplyButton onClick={apply} label="生成拼图" /></>;
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
  const fields = [['brightness', '亮度', -100, 100], ['contrast', '对比度', -100, 100], ['saturation', '饱和度', -100, 100], ['blur', '模糊', 0, 12], ['denoise', '降噪', 0, 100], ['sharpen', '锐化', 0, 100]] as const;
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
  const [fontSize, setFontSize] = useState(6);
  const [frameWidth, setFrameWidth] = useState(0);
  const [watermarkImage, setWatermarkImage] = useState<ImageAsset | undefined>();
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; x: number; y: number; width: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textHeightPct = (fontSize / 100) * (asset.width / asset.height) * 100;
  const watermarkHeight = kind === 'text' ? textHeightPct : watermarkImage ? width * (watermarkImage.height / watermarkImage.width) * (asset.width / asset.height) : width * 0.18;

  useEffect(() => {
    return () => {
      if (watermarkImage) URL.revokeObjectURL(watermarkImage.url);
    };
  }, [watermarkImage]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setFrameWidth(frame.clientWidth));
    observer.observe(frame);
    setFrameWidth(frame.clientWidth);
    return () => observer.disconnect();
  }, [overlayHost]);

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

  const options: WatermarkOptions = { kind, text, opacity, position, x, y, width, fontSize, image: watermarkImage };
  const textPixelSize = frameWidth > 0 ? Math.round((frameWidth * fontSize) / 100) : null;
  const overlay = <div className="editor-tool-overlay watermark-interaction" ref={frameRef} onPointerDown={(event) => event.stopPropagation()} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>{(kind === 'text' || watermarkImage) && <div className={`watermark-overlay ${kind}`} style={{ left: `${x}%`, top: `${y}%`, width: `${width}%`, opacity }} onPointerDown={(event) => startDrag(event, event.target instanceof Element && event.target.closest('.watermark-resize-handle') ? 'resize' : 'move')}>{kind === 'text' ? <span style={textPixelSize ? { fontSize: `${textPixelSize}px` } : undefined}>{text}</span> : <img src={watermarkImage?.url} alt="图片水印" />}<button type="button" className="watermark-resize-handle" aria-label="调整水印大小" /></div>}</div>;
  return <>
    {overlayHost && createPortal(overlay, overlayHost)}
    <PanelIntro title="添加水印" description="文字或图片水印都可直接在原图比例画布上拖动和缩放。" />
    <input ref={fileInput} className="visually-hidden" type="file" accept="image/*" onChange={(event) => void chooseWatermark(event.target.files?.[0])} />
    <div className="control-section"><div className="segmented-grid two"><button className={kind === 'text' ? 'is-selected' : ''} onClick={() => setKind('text')}>文字水印</button><button className={kind === 'image' ? 'is-selected' : ''} onClick={() => { setKind('image'); fileInput.current?.click(); }}>图片水印</button></div>{kind === 'text' ? <Field label="水印文字"><input value={text} maxLength={40} onChange={(event) => setText(event.target.value)} /></Field> : <button className="watermark-file-button" onClick={() => fileInput.current?.click()}><ImagePlus size={16} /><span>{watermarkImage?.name ?? '选择一张水印图片'}</span></button>}{kind === 'text' && <><div className="range-heading"><span>字体大小</span><strong>{fontSize}%{textPixelSize ? ` · 约 ${textPixelSize}px` : ''}</strong></div><input className="range-input" type="range" min="2" max="24" step="0.5" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /><div className="range-labels"><span>更小</span><span>更大</span></div></>}<div className="range-heading"><span>透明度</span><strong>{Math.round(opacity * 100)}%</strong></div><input className="range-input" type="range" min="0.1" max="1" step="0.01" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></div>
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

function CleanupPanel({ asset, documentCount, onApply, onApplyTemplate, onApplyTemplateBatch, setNotice }: { asset: ImageAsset; documentCount: number; onApply: (stroke: CleanupBrushStroke) => Promise<void>; onApplyTemplate: (templates: ImageAsset[], threshold: number, edgePadding: number, fillMode: 'fast' | 'quality') => Promise<void>; onApplyTemplateBatch: (templates: ImageAsset[], threshold: number, edgePadding: number, fillMode: 'fast' | 'quality') => Promise<void>; setNotice: (notice: Notice) => void }) {
  const overlayHost = useEditorOverlay();
  const [tool, setTool] = useState<'brush' | 'template' | 'extract'>('brush');
  const [mode, setMode] = useState<CleanupBrushStroke['mode']>('ai');
  const [brushSize, setBrushSize] = useState(48);
  const [strokePoints, setStrokePoints] = useState<Array<{ x: number; y: number }>>([]);
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<ImageAsset[]>([]);
  const [threshold, setThreshold] = useState(86);
  const [edgePadding, setEdgePadding] = useState(6);
  const [fillMode, setFillMode] = useState<'fast' | 'quality'>('quality');
  const [selection, setSelection] = useState<{ ax: number; ay: number; bx: number; by: number } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [tplBusy, setTplBusy] = useState(false);
  const [enhance, setEnhance] = useState({ contrast: 1.2, sharpen: 0.8, exposure: 1.0, saturation: 1.0, bgSuppress: 0.3 });
  const [enhancedPreview, setEnhancedPreview] = useState<string | null>(null);
  const rawExtractedRef = useRef<ImageAsset | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const templateFrameRef = useRef<HTMLDivElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);
  const paintingRef = useRef(false);
  const strokePointsRef = useRef<Array<{ x: number; y: number }>>([]);

  useEffect(() => {
    strokePointsRef.current = [];
    setStrokePoints([]);
    setSelection(null);
  }, [asset.id]);

  useEffect(() => () => {
    templates.forEach((item) => URL.revokeObjectURL(item.url));
  }, [templates]);

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

  function selectionPoint(event: React.PointerEvent<HTMLDivElement>) {
    const frame = templateFrameRef.current;
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)) };
  }

  function startSelection(event: React.PointerEvent<HTMLDivElement>) {
    if (tplBusy) return;
    const point = selectionPoint(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelecting(true);
    setSelection({ ax: point.x, ay: point.y, bx: point.x, by: point.y });
  }

  function moveSelection(event: React.PointerEvent<HTMLDivElement>) {
    if (!selecting) return;
    const point = selectionPoint(event);
    if (!point) return;
    setSelection((current) => (current ? { ...current, bx: point.x, by: point.y } : current));
  }

  function endSelection(event: React.PointerEvent<HTMLDivElement>) {
    if (!selecting) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setSelecting(false);
    setSelection((current) => (current && Math.abs(current.bx - current.ax) > 1 && Math.abs(current.by - current.ay) > 1 ? current : null));
  }

  const selectionBox = selection
    ? {
        left: Math.min(selection.ax, selection.bx),
        top: Math.min(selection.ay, selection.by),
        width: Math.abs(selection.bx - selection.ax),
        height: Math.abs(selection.by - selection.ay),
      }
    : null;

  async function captureTemplate() {
    if (!selectionBox || tplBusy) return;
    const widthPx = Math.round(selectionBox.width / 100 * asset.width);
    const heightPx = Math.round(selectionBox.height / 100 * asset.height);
    if (widthPx < 8 || heightPx < 8) {
      setNotice({ type: 'warning', text: '选区太小，请框选完整的水印区域' });
      return;
    }
    try {
      const cropped = await cropAsset(asset, Math.round(selectionBox.left / 100 * asset.width), Math.round(selectionBox.top / 100 * asset.height), widthPx, heightPx, `水印模板 ${templates.length + 1}`);
      setTemplates((current) => [...current, cropped]);
      setSelection(null);
      setNotice({ type: 'success', text: `已添加模板 ${templates.length + 1}，可继续框选更多区域` });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '模板截取失败' });
    }
  }

  async function chooseTemplateFile(file: File | undefined) {
    if (!file?.type.startsWith('image/')) return;
    try {
      const normalized = await normalizeImageOrientation(file);
      const next = await createAssetFromBlob(normalized, file.name, file);
      setTemplates((current) => [...current, next]);
      setNotice({ type: 'success', text: `已导入模板 ${templates.length + 1}` });
    } catch {
      setNotice({ type: 'warning', text: '模板图片读取失败' });
    }
  }

  function removeTemplate(index: number) {
    setTemplates((current) => {
      const next = current.filter((_, i) => i !== index);
      return next;
    });
  }

  function clearTemplates() {
    setTemplates([]);
    setSelection(null);
    rawExtractedRef.current = null;
    setEnhancedPreview(null);
  }

  async function extractWatermarkTemplate() {
    if (templates.length < 3 || tplBusy) return;
    setTplBusy(true);
    try {
      const extracted = await extractWatermarkFromSelections(templates);
      rawExtractedRef.current = extracted;
      const enhanced = await enhanceWatermark(extracted, enhance);
      setTemplates([enhanced]);
      setEnhancedPreview(enhanced.url);
      setNotice({ type: 'success', text: `水印模板已提取（${enhanced.width}×${enhanced.height}），已自动增强` });
    } catch (error) {
      setNotice({ type: 'warning', text: error instanceof Error ? error.message : '水印提取失败' });
    } finally {
      setTplBusy(false);
    }
  }

  async function applyEnhancement() {
    const raw = rawExtractedRef.current;
    if (!raw || tplBusy) return;
    setTplBusy(true);
    try {
      const enhanced = await enhanceWatermark(raw, enhance);
      setTemplates([enhanced]);
      setEnhancedPreview(enhanced.url);
      setNotice({ type: 'success', text: `增强已应用（${enhanced.width}×${enhanced.height}）` });
    } catch (error) {
      setNotice({ type: 'warning', text: error instanceof Error ? error.message : '增强失败' });
    } finally {
      setTplBusy(false);
    }
  }

  function runTemplate(action: (templates: ImageAsset[], threshold: number, edgePadding: number, fillMode: 'fast' | 'quality') => Promise<void>) {
    if (templates.length === 0 || tplBusy) return;
    setTplBusy(true);
    void action(templates, threshold / 100, edgePadding, fillMode).finally(() => setTplBusy(false));
  }

  const path = strokePoints.map((point) => `${point.x * asset.width / 100},${point.y * asset.height / 100}`).join(' ');
  const previewColor = mode === 'ai' ? '#d4f66e' : '#e78f49';
  const maxBrushSize = Math.max(80, Math.min(320, Math.round(Math.max(asset.width, asset.height) * 0.25)));
  const overlay = tool === 'brush' ? (
    <div className={`editor-tool-overlay cleanup-interaction ${busy ? 'is-busy' : ''}`} ref={frameRef} onPointerDown={(event) => { event.stopPropagation(); startStroke(event); }} onPointerMove={moveStroke} onPointerUp={(event) => void finishStroke(event, true)} onPointerCancel={(event) => void finishStroke(event, false)}>{strokePoints.length > 0 && <svg className="brush-mask-preview" viewBox={`0 0 ${asset.width} ${asset.height}`} preserveAspectRatio="none" aria-hidden="true">{strokePoints.length === 1 ? <circle cx={strokePoints[0].x * asset.width / 100} cy={strokePoints[0].y * asset.height / 100} r={brushSize / 2} fill={previewColor} opacity=".68" /> : <polyline points={path} fill="none" stroke={previewColor} strokeWidth={brushSize} strokeLinecap="round" strokeLinejoin="round" opacity=".68" />}</svg>}{busy && <span className="cleanup-busy">正在填充选区...</span>}</div>
  ) : (
    <div className={`editor-tool-overlay cleanup-interaction cleanup-template-interaction ${tplBusy ? 'is-busy' : ''}`} ref={templateFrameRef} onPointerDown={(event) => { event.stopPropagation(); startSelection(event); }} onPointerMove={moveSelection} onPointerUp={endSelection} onPointerCancel={endSelection}>
      {selectionBox && <div className="cleanup-template-selection" style={{ left: `${selectionBox.left}%`, top: `${selectionBox.top}%`, width: `${selectionBox.width}%`, height: `${selectionBox.height}%` }}><span>{Math.round(selectionBox.width / 100 * asset.width)} × {Math.round(selectionBox.height / 100 * asset.height)}</span></div>}
      {tplBusy && <><span className="cleanup-busy">正在识别并去除水印…</span><span className="cleanup-progress"><span className="cleanup-progress-bar" /></span></>}
    </div>
  );
  return <>
    {overlayHost && createPortal(overlay, overlayHost)}
    <PanelIntro title="对象消除" description="手动涂抹去除杂物，或用水印模板自动识别批量去水印。" />
    <div className="control-section"><div className="section-label">处理方式</div><div className="segmented-grid three"><button type="button" className={tool === 'brush' ? 'is-selected' : ''} onClick={() => setTool('brush')}><Paintbrush size={13} /> 手动涂抹</button><button type="button" className={tool === 'template' ? 'is-selected' : ''} onClick={() => setTool('template')}><ScanSearch size={13} /> 模板去水印</button><button type="button" className={tool === 'extract' ? 'is-selected' : ''} onClick={() => setTool('extract')}><Crop size={13} /> 提取水印</button></div></div>
    {tool === 'brush' ? <>
      <div className="control-section"><div className="segmented-grid two"><button type="button" className={mode === 'ai' ? 'is-selected' : ''} onClick={() => setMode('ai')}><WandSparkles size={13} /> AI 去水印</button><button type="button" className={mode === 'standard' ? 'is-selected' : ''} onClick={() => setMode('standard')}><Eraser size={13} /> 普通消除笔</button></div><div className="direct-tool-caption"><span>{mode === 'ai' ? '多方向纹理智能填充' : '轻量快速周边填充'}</span><span>全程本地</span></div></div>
      <div className="control-section brush-control-section"><div className="range-heading"><span>画笔大小</span><strong>{brushSize} px</strong></div><input className="range-input" type="range" min="6" max={maxBrushSize} value={Math.min(brushSize, maxBrushSize)} onChange={(event) => setBrushSize(Number(event.target.value))} /></div>
       <div className="inline-info"><Paintbrush size={16} /><span>直接在中央图片的目标区域按住涂抹，松开后立即处理。</span></div>
       <div className="inline-info"><ShieldCheck size={16} /><span>{mode === 'ai' ? 'AI 模式会扩大采样范围，复杂背景可能需要分段涂抹。' : '普通模式适合小面积文字和纯色区域。'}</span></div>
     </> : tool === 'extract' ? (
      <div className="control-section">
        <div className="section-label">提取水印模板</div>
        <div className="direct-tool-caption"><span>在左侧图片上框选 3 个以上包含水印的区域（建议不同背景）</span><span>算法会自动提取纯水印模板</span></div>
        <div className="cleanup-template-actions">
          <button type="button" className="clothing-upload-button" onClick={() => void captureTemplate()} disabled={!selectionBox || tplBusy}><Crop size={14} /> {templates.length > 0 ? '继续框选' : '框选水印区域'}</button>
          <button type="button" className="clothing-upload-button" onClick={() => templateInputRef.current?.click()} disabled={tplBusy}><UploadCloud size={14} /> 上传模板</button>
        </div>
        {templates.length > 0 && (
          <div className="control-section" style={{ marginTop: 12 }}>
            <div className="section-label">已选区域 <span className="muted">（{templates.length} 个，需要至少 3 个）</span></div>
            <div className="cleanup-template-list">
              {templates.map((tpl, index) => (
                <div className="cleanup-template-thumb" key={tpl.id}>
                  <img src={tpl.url} alt={`区域 ${index + 1}`} />
                  <span><strong>区域 {index + 1}</strong><small>{tpl.width} × {tpl.height} px</small></span>
                  <button type="button" className="icon-button" onClick={() => removeTemplate(index)} title="移除"><X size={13} /></button>
                </div>
              ))}
              <button type="button" className="text-button" onClick={clearTemplates}>清空全部</button>
            </div>
            <button type="button" className="secondary-button full" disabled={templates.length < 3 || tplBusy} onClick={() => void extractWatermarkTemplate()} style={{ marginTop: 10 }}><ScanSearch size={16} /> 提取水印模板（{templates.length}/3）</button>
          </div>
        )}
        {enhancedPreview && (
          <div className="control-section" style={{ marginTop: 12 }}>
            <div className="section-label">增强调整</div>
            <div className="cleanup-template-list" style={{ marginBottom: 8 }}>
              <div className="cleanup-template-thumb">
                <img src={enhancedPreview} alt="增强预览" />
                <span><strong>增强预览</strong><small>{templates[0]?.width} × {templates[0]?.height} px</small></span>
              </div>
            </div>
            <div className="range-heading"><span>对比度</span><strong>{enhance.contrast.toFixed(2)}</strong></div>
            <input className="range-input" type="range" min="0.3" max="2.5" step="0.05" value={enhance.contrast} onChange={(event) => setEnhance((current) => ({ ...current, contrast: Number(event.target.value) }))} />
            <div className="range-heading"><span>锐化</span><strong>{enhance.sharpen.toFixed(2)}</strong></div>
            <input className="range-input" type="range" min="0" max="3" step="0.1" value={enhance.sharpen} onChange={(event) => setEnhance((current) => ({ ...current, sharpen: Number(event.target.value) }))} />
            <div className="range-heading"><span>曝光</span><strong>{enhance.exposure.toFixed(2)}</strong></div>
            <input className="range-input" type="range" min="0.5" max="2.0" step="0.05" value={enhance.exposure} onChange={(event) => setEnhance((current) => ({ ...current, exposure: Number(event.target.value) }))} />
            <div className="range-heading"><span>饱和度</span><strong>{enhance.saturation.toFixed(2)}</strong></div>
            <input className="range-input" type="range" min="0" max="2.5" step="0.05" value={enhance.saturation} onChange={(event) => setEnhance((current) => ({ ...current, saturation: Number(event.target.value) }))} />
            <div className="range-heading"><span>背景抑制</span><strong>{enhance.bgSuppress.toFixed(2)}</strong></div>
            <input className="range-input" type="range" min="0" max="1" step="0.02" value={enhance.bgSuppress} onChange={(event) => setEnhance((current) => ({ ...current, bgSuppress: Number(event.target.value) }))} />
            <button type="button" className="secondary-button full" disabled={tplBusy || !rawExtractedRef.current} onClick={() => void applyEnhancement()} style={{ marginTop: 10 }}><ScanSearch size={16} /> 应用增强</button>
          </div>
        )}
      </div>
    ) : (
      <>
      <input ref={templateInputRef} className="visually-hidden" type="file" accept="image/*" onChange={(event) => { void chooseTemplateFile(event.target.files?.[0]); event.currentTarget.value = ''; }} />
      <div className="control-section">
        <div className="section-label">水印模板 {templates.length > 0 && <span className="muted">（{templates.length} 个区域）</span>}</div>
        {templates.length > 0 ? (
          <div className="cleanup-template-list">
            {templates.map((tpl, index) => (
              <div className="cleanup-template-thumb" key={tpl.id}>
                <img src={tpl.url} alt={`水印模板 ${index + 1}`} />
                <span><strong>{tpl.name}</strong><small>{tpl.width} × {tpl.height} px</small></span>
                <button type="button" className="icon-button" onClick={() => removeTemplate(index)} title="移除此模板"><X size={13} /></button>
              </div>
            ))}
            <button type="button" className="text-button" onClick={clearTemplates}>清空全部</button>
          </div>
        ) : (
          <div className="direct-tool-caption"><span>尚未选择水印模板</span><span>在左侧图片上框选水印区域，可框选多块提升识别率，或上传模板小图</span></div>
        )}
        <div className="cleanup-template-actions">
          <button type="button" className="clothing-upload-button" onClick={() => void captureTemplate()} disabled={!selectionBox || tplBusy}><Crop size={14} /> {templates.length > 0 ? '继续框选' : '框选水印'}</button>
          <button type="button" className="clothing-upload-button" onClick={() => templateInputRef.current?.click()} disabled={tplBusy}><UploadCloud size={14} /> 上传模板</button>
        </div>
      </div>
      <div className="control-section"><div className="range-heading"><span>匹配灵敏度</span><strong>{threshold}%</strong></div><input className="range-input" type="range" min="50" max="98" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} /><div className="range-labels"><span>仅高相似</span><span>宽松匹配</span></div></div>
      <div className="control-section"><div className="range-heading"><span>边缘扩展</span><strong>{edgePadding} px</strong></div><input className="range-input" type="range" min="0" max="40" value={edgePadding} onChange={(event) => setEdgePadding(Number(event.target.value))} /><div className="range-labels"><span>贴合边界</span><span>向外扩展</span></div></div>
      <div className="control-section"><div className="section-label">填充方式</div><div className="segmented-grid two"><button type="button" className={fillMode === 'fast' ? 'is-selected' : ''} onClick={() => setFillMode('fast')}><Zap size={13} /> 普通填充</button><button type="button" className={fillMode === 'quality' ? 'is-selected' : ''} onClick={() => setFillMode('quality')}><WandSparkles size={13} /> AI 填充</button></div><div className="direct-tool-caption"><span>{fillMode === 'fast' ? '快速处理，适合简单背景' : '多方向纹理智能填充，效果更好'}</span><span>全程本地</span></div></div>
      <div className="inline-info"><ScanSearch size={16} /><span>自动识别图中所有相同水印（含平铺重复），多块模板可提升识别率。</span></div>
      <div className="metadata-actions">
        <button type="button" className="secondary-button full" disabled={templates.length === 0 || tplBusy} onClick={() => runTemplate(onApplyTemplate)}><ScanSearch size={16} /> 识别并去除当前图片</button>
        <button type="button" className="secondary-button full" disabled={templates.length === 0 || tplBusy || documentCount < 1} onClick={() => runTemplate(onApplyTemplateBatch)}><Layers3 size={16} /> 批量处理全部（{documentCount} 张）</button>
      </div>
      <div className="inline-info"><Info size={16} /><span>批量模式会逐张识别并替换工作区全部文档，耗时取决于图片数量。</span></div>
    </>
  )}
</>;
}

function AiModelPanel({ task, asset, onApply, setNotice, compact = false }: { task: AiTask; asset: ImageAsset; onApply: (request: AiRequest) => Promise<void>; setNotice: (notice: Notice) => void; compact?: boolean }) {
  const [scale, setScale] = useState<2 | 4>(2);
  const [denoise, setDenoise] = useState(0);
  const [sharpen, setSharpen] = useState(0);
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
      await onApply({ mode: 'model', task, scale, denoise, sharpen });
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
    {task === 'upscale' && <div className="control-section"><div className="section-label">细节增强</div><div className="range-heading"><span>降噪</span><strong>{denoise}%</strong></div><input className="range-input" type="range" min="0" max="100" value={denoise} onChange={(event) => setDenoise(Number(event.target.value))} /><div className="range-labels"><span>保留颗粒</span><span>平滑噪点</span></div><div className="range-heading"><span>锐化</span><strong>{sharpen}%</strong></div><input className="range-input" type="range" min="0" max="100" value={sharpen} onChange={(event) => setSharpen(Number(event.target.value))} /><div className="range-labels"><span>自然柔和</span><span>边缘锐利</span></div></div>}
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
