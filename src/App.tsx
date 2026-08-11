import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
  BadgeCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ClipboardPaste,
  Combine,
  Crop,
  Download,
  Droplets,
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
  applyWatermark,
  asProcessedAsset,
  createAssetFromBlob,
  createCollage,
  cropAsset,
  downloadBlob,
  encodeAsset,
  encodeGifFrames,
  exportImage,
  readImageMetadata,
  removeBackgroundAsset,
  applyLocalAiFallback,
  resizeAsset,
  splitAsset,
  updateImageMetadata,
} from './core/image';
import { useAppStore } from './store';
import type { AiCapability, AiModelId, AiRequest, AiTask, ExportFormat, ImageAsset, ImageOperation, LocalBackgroundRemovalOptions, SplitLine, ToolId, WatermarkOptions } from './types';
import { DirectCropPanel, DirectSplitPanel } from './components/DirectImageControls';

type Notice = { type: 'success' | 'warning' | 'error'; text: string } | null;

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
  { id: 'ai', label: 'AI 工具', description: '抠图、超分与增强', icon: Sparkles, category: '智能工具', accent: 'yellow' },
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

const aiTasks: Array<{ id: AiTask; label: string; description: string; icon: LucideIcon }> = [
  { id: 'remove-background', label: 'AI 抠图', description: '主体与背景分离', icon: WandSparkles },
  { id: 'upscale', label: 'AI 超分', description: '放大并恢复细节', icon: Maximize2 },
  { id: 'enhance', label: 'AI 增强', description: '自动优化色彩', icon: Sparkles },
  { id: 'denoise', label: 'AI 去噪', description: '降低颗粒与噪点', icon: Droplets },
];

const aiTaskLabels = Object.fromEntries(aiTasks.map((task) => [task.id, task.label])) as Record<AiTask, string>;

function aiModelId(task: AiTask, scale = 2): AiModelId {
  if (task === 'upscale') return scale === 4 ? 'upscale-4x' : 'upscale-2x';
  return task;
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

async function fileToAsset(file: File) {
  if (!file.type.startsWith('image/')) return null;
  const [asset, metadata] = await Promise.all([createAssetFromBlob(file, file.name, file), readImageMetadata(file)]);
  return metadata ? { ...asset, metadata } : asset;
}

function App() {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length) await handleFiles(files, '剪贴板');
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  });

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

  async function applyEdit(values: { brightness: number; contrast: number; saturation: number; blur: number }) {
    if (!activeAsset) return;
    await replaceActive(await applyAdjustments(activeAsset, values), '图片编辑', '色彩调整');
  }

  async function applyAi(request: LocalBackgroundRemovalOptions | AiRequest) {
    if (!activeAsset) return;
    if ('method' in request) {
      const next = await removeBackgroundAsset(activeAsset, request);
      await replaceActive(next, '本地抠图', request.method === 'solid' ? '纯色批量抠除' : '联通色块抠除');
      return;
    }
    if (request.mode === 'model') {
      try {
        const next = await aiAdapter.run(activeAsset, { modelId: aiModelId(request.task, request.scale), scale: request.scale });
        await replaceActive(next, aiTaskLabels[request.task], `本地模型 · ${request.task === 'upscale' ? `${request.scale ?? 2} 倍` : '按模型输出'}`);
      } catch (error) {
        setNotice({ type: 'warning', text: error instanceof Error ? error.message : 'AI 模型暂不可用，请使用本地降级处理' });
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

  async function applyBatch(kind: 'resize' | 'webp') {
    if (!assets.length) return;
    const nextAssets: ImageAsset[] = [];
    for (const asset of assets) {
      if (kind === 'resize') nextAssets.push(await resizeAsset(asset, Math.min(asset.width, 1920), Math.round((Math.min(asset.width, 1920) / asset.width) * asset.height), '批量'));
      else {
        const blob = await encodeAsset(asProcessedAsset(asset), { format: 'image/webp', quality: 0.85, background: '#ffffff', preserveTransparency: true, preserveMetadata: false });
        nextAssets.push(await createAssetFromBlob(blob, `${fileNameWithoutExtension(asset.name)}.webp`));
      }
    }
    checkpoint();
    replaceAssets(nextAssets);
    addHistory({ name: `${assets.length} 张图片`, label: '批量处理', detail: kind === 'resize' ? '最长边 1920 px' : 'WebP 质量 85' });
    setNotice({ type: 'success', text: `批量处理完成，共 ${nextAssets.length} 张` });
  }

  const pageClass = `app-shell ${theme === 'dark' ? 'theme-dark' : ''}`;

  return (
    <div className={pageClass}>
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
      {showSettings && <SettingsPopover onClose={() => setShowSettings(false)} />}
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
          onSplit={applySplit}
          onMerge={applyMerge}
          onEncode={applyEncoding}
          onEdit={applyEdit}
          onAiApply={applyAi}
          onWatermark={applyWatermarkValue}
          onMetadata={applyMetadataValue}
          onClearMetadata={clearMetadataValue}
          onExportGif={exportGif}
          onBatch={applyBatch}
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
            <div className="tool-group" key={category}>
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
  return <button className={`tool-card accent-${tool.accent}`} onClick={onClick}><span className="tool-card-icon"><Icon size={19} /></span><span className="tool-card-copy"><strong>{tool.label}</strong><small>{tool.description}</small></span><ArrowRightLeft className="tool-arrow" size={15} /></button>;
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
  onSplit,
  onMerge,
  onEncode,
  onEdit,
  onAiApply,
  onWatermark,
  onMetadata,
  onClearMetadata,
  onExportGif,
  onBatch,
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
  onSplit: (direction: 'horizontal' | 'vertical' | 'grid', rows: number, columns: number, lines?: SplitLine[]) => Promise<void>;
  onMerge: (layout: 'horizontal' | 'vertical' | 'grid', gap: number, background: string) => Promise<void>;
  onEncode: (format: ExportFormat, quality: number, background: string) => Promise<void>;
  onEdit: (values: { brightness: number; contrast: number; saturation: number; blur: number }) => Promise<void>;
  onAiApply: (request: LocalBackgroundRemovalOptions | AiRequest) => Promise<void>;
  onWatermark: (options: WatermarkOptions) => Promise<void>;
  onMetadata: (values: Record<string, string>) => Promise<void>;
  onClearMetadata: () => Promise<void>;
  onExportGif: () => Promise<void>;
  onBatch: (kind: 'resize' | 'webp') => Promise<void>;
  onDeleteAsset: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  setNotice: (notice: Notice) => void;
}) {
  const activeToolDefinition = tools.find((tool) => tool.id === activeTool) ?? tools[0];
  const Icon = activeToolDefinition.icon;
  return (
    <main className="workspace-page">
      <div className="workspace-breadcrumb"><button className="back-button" onClick={onClear}><ArrowLeft size={15} /> 工具箱</button><span>/</span><span>{activeToolDefinition.label}</span><div className="workspace-actions"><button className="secondary-button" onClick={onAddFiles}><Plus size={16} /> 添加图片</button><button className="secondary-button" onClick={onExportAll}><Download size={16} /> 全部下载</button><button className="primary-button compact" onClick={onExport}><FileDown size={16} /> 导出当前</button></div></div>
      <div className="asset-strip"><div className="asset-strip-label"><span className="eyebrow">WORKSPACE</span><strong>{assets.length} 张图片</strong></div><div className="asset-thumbs">{assets.map((asset, index) => <div className="asset-thumb-wrap" key={asset.id}><button className={`asset-thumb ${asset.id === activeAsset?.id ? 'is-active' : ''}`} aria-label={`选中 ${asset.name}`} aria-pressed={asset.id === activeAsset?.id} onClick={() => onSelectAsset(asset.id)}><img src={asset.url} alt={asset.name} /><span>{index + 1}</span></button><button className="asset-delete-button" title={`删除 ${asset.name}`} aria-label={`删除 ${asset.name}`} onClick={() => onDeleteAsset(asset.id)}><X size={11} /></button></div>)}<button className="add-thumb" title="添加图片" aria-label="添加图片" onClick={onAddFiles}><Plus size={17} /></button></div><div className="asset-total">总计 {formatBytes(assets.reduce((sum, asset) => sum + asset.size, 0))}</div></div>
      <div className="workspace-layout">
        <aside className="tool-sidebar"><div className="sidebar-title"><PanelLeft size={15} /><span>工具</span></div><div className="sidebar-list">{tools.map((tool) => { const ToolIcon = tool.icon; return <button className={`sidebar-tool ${activeTool === tool.id ? 'is-active' : ''}`} key={tool.id} onClick={() => onSelectTool(tool.id)} title={tool.description}><ToolIcon size={17} /><span>{tool.label}</span>{activeTool === tool.id && <span className="active-bar" />}</button>; })}</div><div className="sidebar-bottom"><ShieldCheck size={16} /><small>本地模式<br />Local only</small></div></aside>
        <section className="preview-column"><div className="preview-toolbar"><span><span className="live-dot" /> 实时预览</span><span>{activeAsset ? `${activeAsset.width} × ${activeAsset.height}` : '未选择图片'}</span></div><div className={`preview-stage ${activeAsset && activeAsset.height > activeAsset.width ? 'is-portrait' : 'is-landscape'}`}><div className="stage-grid" />{activeAsset ? <img className="main-preview" src={activeAsset.url} alt={activeAsset.name} /> : <div className="preview-empty"><ImagePlus size={32} /><span>选择一张图片开始</span></div>}<div className="preview-badge"><CheckCircle2 size={14} /> 本地处理</div></div><div className="preview-footer"><div className="preview-file"><FileImage size={16} /><span><strong>{activeAsset?.name ?? '未选择文件'}</strong><small>{activeAsset ? `${formatBytes(activeAsset.size)} · ${activeAsset.type.replace('image/', '').toUpperCase()}` : '拖入图片或点击添加'}</small></span></div><div className="preview-controls"><button className="icon-button" title="帮助"><CircleHelp size={16} /></button><button className="icon-button" title="撤销上一步操作" aria-label="撤销上一步操作" disabled={!canUndo} onClick={onUndo}><Undo2 size={16} /></button><button className="icon-button" title="重做上一步操作" aria-label="重做上一步操作" disabled={!canRedo} onClick={onRedo}><Redo2 size={16} /></button>{activeAsset && <button className="icon-button" title="删除当前图片" aria-label="删除当前图片" onClick={() => onDeleteAsset(activeAsset.id)}><Trash2 size={16} /></button>}</div></div></section>
        <aside className="control-column"><div className="control-heading"><div className="control-icon"><Icon size={19} /></div><div><span className="eyebrow">CURRENT TOOL</span><h2>{activeToolDefinition.label}</h2></div><button className="icon-button mobile-close" title="关闭面板"><X size={17} /></button></div><div className="control-scroll"><ToolPanel tool={activeTool} asset={activeAsset} assets={assets} onResize={onResize} onCrop={onCrop} onSplit={onSplit} onMerge={onMerge} onEncode={onEncode} onEdit={onEdit} onAiApply={onAiApply} onWatermark={onWatermark} onMetadata={onMetadata} onClearMetadata={onClearMetadata} onExportGif={onExportGif} onBatch={onBatch} setNotice={setNotice} /></div><div className="control-footer"><span><ShieldCheck size={14} /> 本地安全处理</span><button className="help-link"><CircleHelp size={14} /> 需要帮助</button></div></aside>
      </div>
    </main>
  );
}

function ToolPanel({ tool, asset, assets, onResize, onCrop, onSplit, onMerge, onEncode, onEdit, onAiApply, onWatermark, onMetadata, onClearMetadata, onExportGif, onBatch, setNotice }: {
  tool: ToolId;
  asset: ImageAsset | null;
  assets: ImageAsset[];
  onResize: (width: number, height: number) => Promise<void>;
  onCrop: (values: { x: number; y: number; width: number; height: number }) => Promise<void>;
  onSplit: (direction: 'horizontal' | 'vertical' | 'grid', rows: number, columns: number, lines?: SplitLine[]) => Promise<void>;
  onMerge: (layout: 'horizontal' | 'vertical' | 'grid', gap: number, background: string) => Promise<void>;
  onEncode: (format: ExportFormat, quality: number, background: string) => Promise<void>;
  onEdit: (values: { brightness: number; contrast: number; saturation: number; blur: number }) => Promise<void>;
  onAiApply: (request: LocalBackgroundRemovalOptions | AiRequest) => Promise<void>;
  onWatermark: (options: WatermarkOptions) => Promise<void>;
  onMetadata: (values: Record<string, string>) => Promise<void>;
  onClearMetadata: () => Promise<void>;
  onExportGif: () => Promise<void>;
  onBatch: (kind: 'resize' | 'webp') => Promise<void>;
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
    case 'edit': return <EditPanel onApply={onEdit} />;
    case 'watermark': return <WatermarkPanel asset={asset} onApply={onWatermark} />;
    case 'metadata': return <MetadataPanel asset={asset} onApply={onMetadata} onClear={onClearMetadata} setNotice={setNotice} />;
    case 'batch': return <BatchPanel count={assets.length} onApply={onBatch} />;
    case 'gif': return <GifPanel count={assets.length} onApply={onExportGif} />;
    case 'ai': return <AiPanel asset={asset} onApply={onAiApply} setNotice={setNotice} />;
    case 'id-photo': return <IdPhotoPanel asset={asset} onApply={onCrop} />;
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

function EditPanel({ onApply }: { onApply: (values: { brightness: number; contrast: number; saturation: number; blur: number }) => Promise<void> }) {
  const [values, setValues] = useState({ brightness: 0, contrast: 0, saturation: 0, blur: 0 });
  const fields = [['brightness', '亮度', -100, 100], ['contrast', '对比度', -100, 100], ['saturation', '饱和度', -100, 100], ['blur', '模糊', 0, 12]] as const;
  return <><PanelIntro title="图片编辑" description="做一点轻量调整，保持原图清晰和色彩自然。" /><div className="control-section adjustment-list">{fields.map(([key, label, min, max]) => <div className="adjustment-row" key={key}><div><span>{label}</span><strong>{values[key]}</strong></div><input className="range-input" type="range" min={min} max={max} value={values[key]} onChange={(event) => setValues({ ...values, [key]: Number(event.target.value) })} /></div>)}</div><div className="filter-row"><button>自然</button><button>黑白</button><button>胶片</button><button>暖色</button></div><ApplyButton onClick={() => void onApply(values)} label="应用调整" /></>;
}

function WatermarkPanel({ asset, onApply }: { asset: ImageAsset; onApply: (options: WatermarkOptions) => Promise<void> }) {
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
  return <>
    <PanelIntro title="添加水印" description="文字或图片水印都可直接在原图比例画布上拖动和缩放。" />
    <input ref={fileInput} className="visually-hidden" type="file" accept="image/*" onChange={(event) => void chooseWatermark(event.target.files?.[0])} />
    <div className="control-section"><div className="segmented-grid two"><button className={kind === 'text' ? 'is-selected' : ''} onClick={() => setKind('text')}>文字水印</button><button className={kind === 'image' ? 'is-selected' : ''} onClick={() => { setKind('image'); fileInput.current?.click(); }}>图片水印</button></div>{kind === 'text' ? <Field label="水印文字"><input value={text} maxLength={40} onChange={(event) => setText(event.target.value)} /></Field> : <button className="watermark-file-button" onClick={() => fileInput.current?.click()}><ImagePlus size={16} /><span>{watermarkImage?.name ?? '选择一张水印图片'}</span></button>}<div className="range-heading"><span>透明度</span><strong>{Math.round(opacity * 100)}%</strong></div><input className="range-input" type="range" min="0.1" max="1" step="0.01" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></div>
    <div className="control-section direct-tool-section"><div className="direct-image-frame watermark-interaction" ref={frameRef} style={{ aspectRatio: `${asset.width} / ${asset.height}` }} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}><img src={asset.url} alt="水印预览原图" />{(kind === 'text' || watermarkImage) && <div className={`watermark-overlay ${kind}`} style={{ left: `${x}%`, top: `${y}%`, width: `${width}%` }} onPointerDown={(event) => startDrag(event, event.target instanceof Element && event.target.closest('.watermark-resize-handle') ? 'resize' : 'move')}>{kind === 'text' ? text : <img src={watermarkImage?.url} alt="图片水印" />}<button type="button" className="watermark-resize-handle" aria-label="调整水印大小" /></div>}</div><div className="direct-tool-caption"><span>拖动水印调整位置</span><span>拖动角点调整大小</span></div></div>
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

function BatchPanel({ count, onApply }: { count: number; onApply: (kind: 'resize' | 'webp') => Promise<void> }) { return <><PanelIntro title="批量处理" description="同一套规则处理当前工作区的所有图片。" /><div className="batch-summary"><strong>{count}</strong><span>张图片<br /><small>等待处理</small></span></div><div className="pipeline"><div className="pipeline-step is-done"><Check size={14} /> 导入</div><div className="pipeline-line" /><div className="pipeline-step"><Maximize2 size={14} /> 调整尺寸</div><div className="pipeline-line" /><div className="pipeline-step"><ArrowRightLeft size={14} /> 转换</div><div className="pipeline-line" /><div className="pipeline-step"><Download size={14} /> 导出</div></div><button className="action-row" onClick={() => void onApply('resize')}><span><Maximize2 size={17} /><strong>最长边调整至 1920 px</strong><small>保持原始比例</small></span><ArrowRightLeft size={16} /></button><button className="action-row" onClick={() => void onApply('webp')}><span><ArrowRightLeft size={17} /><strong>统一转换为 WebP</strong><small>质量 85 · 保留透明</small></span><ArrowRightLeft size={16} /></button></>;
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

function AiPanel({ asset, onApply, setNotice }: { asset: ImageAsset; onApply: (request: LocalBackgroundRemovalOptions | AiRequest) => Promise<void>; setNotice: (notice: Notice) => void }) {
  const [mode, setMode] = useState<'model' | 'local'>('model');
  const [task, setTask] = useState<AiTask>('remove-background');
  const [method, setMethod] = useState<'solid' | 'connected'>('solid');
  const [capability, setCapability] = useState<AiCapability | null>(null);
  const [loading, setLoading] = useState(false);
  const [scale, setScale] = useState<2 | 4>(2);
  const [targetColor, setTargetColor] = useState<[number, number, number]>([255, 255, 255]);
  const [seed, setSeed] = useState({ x: 50, y: 50 });
  const [tolerance, setTolerance] = useState(18);
  const [feather, setFeather] = useState(4);
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setSeed({ x: 50, y: 50 });
    void aiAdapter.capability().then(setCapability);
  }, [asset.id]);

  async function check() {
    setLoading(true);
    try { setCapability(await aiAdapter.capability()); } finally { setLoading(false); }
  }

  async function loadModel(taskId: AiTask) {
    setLoading(true);
    try {
      const modelId = aiModelId(taskId, scale);
      await aiAdapter.load(modelId, (value) => setNotice({ type: 'success', text: `模型加载 ${Math.round(value * 100)}%` }));
      setNotice({ type: 'success', text: `${aiTaskLabels[taskId]}模型已加载，可以运行` });
    } catch (error) {
      setNotice({ type: 'warning', text: error instanceof Error ? error.message : '本地模型暂不可用' });
    } finally { setLoading(false); }
  }

  async function pickColor(event: React.PointerEvent<HTMLDivElement>) {
    const frame = frameRef.current;
    const image = imageRef.current;
    if (!frame || !image) return;
    const rect = frame.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(image, (x / 100) * image.naturalWidth, (y / 100) * image.naturalHeight, 1, 1, 0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    setTargetColor([pixel[0], pixel[1], pixel[2]]);
    setSeed({ x, y });
    setNotice({ type: 'success', text: method === 'solid' ? '已取样全图要移除的颜色' : '已选择联通色块起点' });
  }

  const localOptions: LocalBackgroundRemovalOptions = { method, targetColor, seedX: seed.x, seedY: seed.y, tolerance, feather };
  const selectedTask = aiTasks.find((item) => item.id === task) ?? aiTasks[0];
  return <>
    <PanelIntro title="AI 图片增强" description="AI 模型按需运行，支持抠图、超分、增强和去噪；图片始终留在本机。" />
    <div className="control-section"><div className="segmented-grid two"><button className={mode === 'model' ? 'is-selected' : ''} onClick={() => setMode('model')}><WandSparkles size={13} /> AI 能力</button><button className={mode === 'local' ? 'is-selected' : ''} onClick={() => setMode('local')}><SlidersHorizontal size={13} /> 纯本地抠图</button></div></div>
    {mode === 'model' ? <>
      <div className="control-section"><div className="section-label">选择 AI 能力</div><div className="ai-task-grid">{aiTasks.map((item) => { const TaskIcon = item.icon; return <button key={item.id} className={`ai-task-card ${task === item.id ? 'is-selected' : ''}`} onClick={() => setTask(item.id)}><TaskIcon size={16} /><span><strong>{item.label}</strong><small>{item.description}</small></span></button>; })}</div></div>
      <div className="ai-status"><div className={`ai-orb ${capability?.runtime === 'unavailable' ? 'is-muted' : ''}`}><WandSparkles size={22} /></div><div><strong>{capability ? capability.runtime === 'webgpu' ? 'WebGPU 优先' : capability.runtime === 'wasm' ? 'WASM 降级模式' : '设备不支持' : '检查本机能力'}</strong><small>{capability?.modelConfigured ? '模型目录已配置，按需加载' : '模型目录待配置或检查'}</small></div><button className="icon-button" title="检测能力" onClick={() => void check()} disabled={loading}><RotateCcw size={15} /></button></div>
      {task === 'upscale' && <div className="control-section"><div className="section-label">放大倍率</div><div className="segmented-grid two"><button className={scale === 2 ? 'is-selected' : ''} onClick={() => setScale(2)}>2 倍</button><button className={scale === 4 ? 'is-selected' : ''} onClick={() => setScale(4)}>4 倍</button></div></div>}
      <div className="ai-actions"><button onClick={() => void loadModel(task)} disabled={loading}><WandSparkles size={17} /><span><strong>准备 {selectedTask.label} 模型</strong><small>WebGPU 优先，WASM 降级</small></span><ChevronDown size={15} /></button>{task !== 'remove-background' && <button className="ai-fallback-button" onClick={() => void onApply({ mode: 'local-fallback', task, scale })} disabled={loading}><SlidersHorizontal size={17} /><span><strong>使用本地降级处理</strong><small>无需模型，立即在浏览器完成</small></span><ChevronDown size={15} /></button>}</div>
      <div className="inline-info"><Info size={16} /><span>模型缺失或设备不支持时，不会上传图片；超分、增强和去噪可直接使用本地降级方案。</span></div>
      <ApplyButton onClick={() => void onApply({ mode: 'model', task, scale })} label={`运行 ${selectedTask.label}`} />
    </> : <>
      <div className="control-section"><div className="segmented-grid two"><button className={method === 'solid' ? 'is-selected' : ''} onClick={() => setMethod('solid')}>纯色批量抠除</button><button className={method === 'connected' ? 'is-selected' : ''} onClick={() => setMethod('connected')}>联通色块抠除</button></div></div>
      <div className="control-section direct-tool-section"><div className="direct-image-frame background-pick-frame" ref={frameRef} style={{ aspectRatio: `${asset.width} / ${asset.height}` }} onPointerDown={(event) => void pickColor(event)}><img ref={imageRef} src={asset.url} alt="点击取样抠图颜色" />{<span className="background-pick-marker" style={{ left: `${seed.x}%`, top: `${seed.y}%` }} />}</div><div className="direct-tool-caption"><span>点击图片取样颜色和起点</span><span>{method === 'solid' ? '全图匹配' : '仅联通区域'}</span></div></div>
      <div className="control-section"><div className="color-field"><span>目标颜色</span><label><input type="color" value={rgbToHex(targetColor)} onChange={(event) => setTargetColor(hexToRgb(event.target.value))} /><b>{rgbToHex(targetColor).toUpperCase()}</b></label></div><div className="range-heading"><span>色彩匹配度</span><strong>{tolerance}%</strong></div><input className="range-input" type="range" min="1" max="100" value={tolerance} onChange={(event) => setTolerance(Number(event.target.value))} /><div className="range-labels"><span>更严格</span><span>更宽松</span></div><div className="range-heading"><span>羽化半径</span><strong>{feather} px</strong></div><input className="range-input" type="range" min="0" max="40" value={feather} onChange={(event) => setFeather(Number(event.target.value))} /></div>
      <div className="inline-info"><CheckCircle2 size={16} /><span>输出透明 PNG，纯色模式会批量移除所有匹配像素。</span></div>
      <ApplyButton onClick={() => void onApply(localOptions)} label="应用本地抠图" />
    </>}
    <div className="ai-footnote"><Info size={14} /><span>模型路径可通过 <code>VITE_MODEL_BASE_URL</code> 配置。当前文件：{asset.name}</span></div>
  </>;
}

function IdPhotoPanel({ asset, onApply }: { asset: ImageAsset; onApply: (values: { x: number; y: number; width: number; height: number }) => Promise<void> }) { const [size, setSize] = useState('一寸 · 25 × 35 mm'); const [background, setBackground] = useState('#4389d6'); return <><PanelIntro title="证件照" description="快速裁剪出常用证件照比例，背景色可在导出前调整。" /><div className="control-section"><Field label="照片规格"><select className="select-input" value={size} onChange={(event) => setSize(event.target.value)}><option>一寸 · 25 × 35 mm</option><option>二寸 · 35 × 49 mm</option><option>小一寸 · 22 × 32 mm</option><option>护照 · 35 × 45 mm</option><option>身份证 · 26 × 32 mm</option></select></Field><div className="color-field"><span>背景颜色</span><label><input type="color" value={background} onChange={(event) => setBackground(event.target.value)} /><b>{background.toUpperCase()}</b></label></div></div><div className="id-photo-preview"><img src={asset.url} alt="证件照预览" /><span>证件照比例</span></div><ApplyButton onClick={() => void onApply({ x: 0, y: 0, width: asset.width, height: Math.round(asset.width * 1.4) })} label="生成证件照" /></>; }

function EmptyPanel() { return <div className="empty-panel"><ImagePlus size={29} /><strong>先添加一张图片</strong><span>选择图片后，这里会显示当前工具的参数。</span></div>; }

function ApplyButton({ onClick, label }: { onClick: () => void; label: string }) { return <button className="apply-button" onClick={onClick}><CheckCircle2 size={17} /> {label}<ArrowRightLeft size={15} /></button>; }

function NoticeBanner({ notice, onClose }: { notice: Notice; onClose: () => void }) { if (!notice) return null; const Icon = notice.type === 'success' ? CheckCircle2 : AlertTriangle; return <div className={`notice-banner notice-${notice.type}`}><Icon size={16} /><span>{notice.text}</span><button onClick={onClose} aria-label="关闭提示"><X size={15} /></button></div>; }

function HistoryPopover({ history, onClear, onClose }: { history: Array<{ id: string; name: string; label: string; detail: string; createdAt: number }>; onClear: () => void; onClose: () => void }) { return <div className="popover history-popover"><div className="popover-heading"><div><span className="eyebrow">LOCAL HISTORY</span><h3>最近处理</h3></div><button className="icon-button" onClick={onClose}><X size={15} /></button></div>{history.length ? <div className="history-list">{history.map((entry) => <div className="history-item" key={entry.id}><span className="history-icon"><CheckCircle2 size={15} /></span><span><strong>{entry.label}</strong><small>{entry.name} · {entry.detail}</small></span></div>)}</div> : <div className="empty-history">还没有处理记录</div>}{history.length > 0 && <button className="text-button danger" onClick={onClear}><Trash2 size={14} /> 清空历史</button>}</div>; }

function SettingsPopover({ onClose }: { onClose: () => void }) { return <div className="popover settings-popover"><div className="popover-heading"><div><span className="eyebrow">SETTINGS</span><h3>设置</h3></div><button className="icon-button" onClick={onClose}><X size={15} /></button></div><div className="settings-list"><div><span>默认输出</span><strong>PNG / 保留透明</strong></div><div><span>元数据</span><strong>默认清除</strong></div><div><span>模型策略</span><strong>本地优先</strong></div></div><div className="privacy-callout"><LockKeyhole size={16} /><span><strong>隐私模式已开启</strong><small>当前版本没有上传通道。</small></span></div></div>; }

export default App;
