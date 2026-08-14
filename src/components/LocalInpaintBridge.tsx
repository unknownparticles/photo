import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightLeft, Brush, Eraser, Gauge, Hand, Info, Sparkles, WandSparkles } from 'lucide-react';
import { miganAdapter, runInpaint } from '../core/inpaint';
import type { InpaintMode, InpaintStroke } from '../core/inpaint';
import { useAppStore } from '../store';
import './LocalInpaintBridge.css';

type Hosts = {
  homeGrid: HTMLElement | null;
  sidebar: HTMLElement | null;
  controls: HTMLElement | null;
  overlay: HTMLElement | null;
};

type MiganStatus = {
  installed: boolean;
  runtime: 'webgpu' | 'wasm' | 'unavailable';
  supported: boolean;
};

type BrushCursorState = {
  x: number;
  y: number;
  diameter: number;
  visible: boolean;
};

const repairPreferences = [
  { id: 'general', label: '通用', description: '保持原蒙版', prompt: '' },
  { id: 'remove', label: '移除对象', description: '扩大边缘，减少残影', prompt: '移除对象' },
  { id: 'texture', label: '连续纹理', description: '天空 / 墙面 / 草地', prompt: '补背景连续纹理' },
  { id: 'portrait', label: '人像细节', description: '收紧边缘，保护细节', prompt: '人像皮肤' },
  { id: 'text', label: '文字 / 水印', description: '适度扩边清理标记', prompt: '文字水印' },
] as const;

type RepairPreferenceId = (typeof repairPreferences)[number]['id'];

const emptyHosts: Hosts = { homeGrid: null, sidebar: null, controls: null, overlay: null };
const emptyMiganStatus: MiganStatus = { installed: false, runtime: 'unavailable', supported: true };
const emptyBrushCursor: BrushCursorState = { x: 0, y: 0, diameter: 0, visible: false };

function repairPreferenceDefinition(id: RepairPreferenceId) {
  return repairPreferences.find((item) => item.id === id) ?? repairPreferences[0];
}

function sameHosts(first: Hosts, second: Hosts) {
  return first.homeGrid === second.homeGrid && first.sidebar === second.sidebar && first.controls === second.controls && first.overlay === second.overlay;
}

function findHosts(): Hosts {
  const smartGroup = Array.from(document.querySelectorAll<HTMLElement>('.tool-group')).find((group) => group.querySelector('.group-label')?.textContent?.includes('智能工具'));
  return {
    homeGrid: smartGroup?.querySelector<HTMLElement>('.tool-grid') ?? null,
    sidebar: document.querySelector<HTMLElement>('.sidebar-list'),
    controls: document.querySelector<HTMLElement>('.control-scroll'),
    overlay: document.querySelector<HTMLElement>('.editor-overlay-host'),
  };
}

function clickNativeCleanup() {
  const candidates = Array.from(document.querySelectorAll<HTMLButtonElement>('.tool-card, .sidebar-tool'));
  const cleanup = candidates.find((button) => button.textContent?.includes('消除笔'));
  cleanup?.click();
}

function MaskOverlay({ strokes, brushSize, imageWidth, imageHeight, panMode, onChange }: {
  strokes: InpaintStroke[];
  brushSize: number;
  imageWidth: number;
  imageHeight: number;
  panMode: boolean;
  onChange: (strokes: InpaintStroke[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const activePointerRef = useRef<number | null>(null);
  const cursorClientRef = useRef<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<BrushCursorState>(emptyBrushCursor);

  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    context.strokeStyle = 'rgba(255, 86, 122, .72)';
    context.fillStyle = 'rgba(255, 86, 122, .72)';
    context.lineCap = 'round';
    context.lineJoin = 'round';
    const scale = Math.min(rect.width / Math.max(1, imageWidth), rect.height / Math.max(1, imageHeight));
    for (const stroke of strokes) {
      if (!stroke.points.length) continue;
      context.lineWidth = Math.max(2, stroke.size * scale);
      const first = stroke.points[0];
      context.beginPath();
      context.moveTo(first.x * rect.width, first.y * rect.height);
      for (const point of stroke.points.slice(1)) context.lineTo(point.x * rect.width, point.y * rect.height);
      if (stroke.points.length === 1) {
        context.arc(first.x * rect.width, first.y * rect.height, context.lineWidth / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        context.stroke();
      }
    }
  }

  function updateBrushCursor(clientX: number, clientY: number, visible = true) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    cursorClientRef.current = { x: clientX, y: clientY };
    const rect = canvas.getBoundingClientRect();
    const normalizedX = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const normalizedY = Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height)));
    const scale = Math.min(canvas.clientWidth / Math.max(1, imageWidth), canvas.clientHeight / Math.max(1, imageHeight));
    setCursor({
      x: normalizedX * canvas.clientWidth,
      y: normalizedY * canvas.clientHeight,
      diameter: Math.max(4, brushSize * scale),
      visible,
    });
  }

  useEffect(() => {
    redraw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      redraw();
      const last = cursorClientRef.current;
      if (last) updateBrushCursor(last.x, last.y, cursor.visible);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [strokes, imageWidth, imageHeight]);

  useEffect(() => {
    const last = cursorClientRef.current;
    if (last) updateBrushCursor(last.x, last.y, cursor.visible);
  }, [brushSize, imageWidth, imageHeight]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = canvas?.closest<HTMLElement>('.preview-image-viewport');
    viewport?.classList.toggle('local-inpaint-pan-mode', panMode);
    if (panMode) {
      drawingRef.current = false;
      const pointerId = activePointerRef.current;
      if (canvas && pointerId !== null && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
      activePointerRef.current = null;
    }
    return () => viewport?.classList.remove('local-inpaint-pan-mode');
  }, [panMode]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (panMode) return;
    event.preventDefault();
    event.stopPropagation();
    updateBrushCursor(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    drawingRef.current = true;
    onChange([...strokes, { size: brushSize, points: [point(event)] }]);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    updateBrushCursor(event.clientX, event.clientY);
    if (!drawingRef.current || panMode) return;
    event.preventDefault();
    event.stopPropagation();
    const next = point(event);
    onChange(strokes.map((stroke, index) => index === strokes.length - 1 ? { ...stroke, points: [...stroke.points, next] } : stroke));
  }

  function end(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    drawingRef.current = false;
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function forwardWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const viewport = event.currentTarget.closest<HTMLElement>('.preview-image-viewport');
    if (!viewport) return;
    viewport.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: event.clientX,
      clientY: event.clientY,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ,
      deltaMode: event.deltaMode,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    }));
  }

  return <div className={`local-inpaint-mask ${panMode ? 'is-pan-mode' : ''}`} onPointerDown={(event) => event.stopPropagation()} onWheel={forwardWheel}>
    <canvas
      ref={canvasRef}
      onPointerEnter={(event) => updateBrushCursor(event.clientX, event.clientY)}
      onPointerLeave={() => !drawingRef.current && setCursor((current) => ({ ...current, visible: false }))}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    />
    <div
      className="local-inpaint-brush-cursor"
      style={{ left: cursor.x, top: cursor.y, width: cursor.diameter, height: cursor.diameter, opacity: cursor.visible && !panMode ? 1 : 0 }}
    />
    <div className="local-inpaint-mask-hint">{panMode ? <><Hand size={13} /> 抓手：拖动画布，松开空格返回画笔</> : <><Brush size={13} /> 滚轮缩放 · 按住空格拖动画布</>}</div>
  </div>;
}

function InpaintPanel({ mode, onModeChange, strokes, setStrokes, brushSize, setBrushSize, repairPreference, setRepairPreference, steps, setSteps, guidance, setGuidance, seed, setSeed, busy, status, progress, miganStatus, onRun }: {
  mode: InpaintMode;
  onModeChange: (mode: InpaintMode) => void;
  strokes: InpaintStroke[];
  setStrokes: (strokes: InpaintStroke[]) => void;
  brushSize: number;
  setBrushSize: (value: number) => void;
  repairPreference: RepairPreferenceId;
  setRepairPreference: (value: RepairPreferenceId) => void;
  steps: number;
  setSteps: (value: number) => void;
  guidance: number;
  setGuidance: (value: number) => void;
  seed: number;
  setSeed: (value: number) => void;
  busy: boolean;
  status: string;
  progress: number | null;
  miganStatus: MiganStatus;
  onRun: () => void;
}) {
  const smart = mode === 'smart';
  const hq = mode === 'hq';
  return <div className="local-inpaint-panel">
    <div className="local-inpaint-intro">
      <span className="local-inpaint-model">{smart ? <><Sparkles size={15} /> MI-GAN 512</> : <><WandSparkles size={15} /> Moebius 0.22B</>}</span>
      <h3>局部重绘</h3>
      <p>{smart ? '默认使用轻量 MI-GAN，根据周围纹理和结构快速补全涂抹区域。' : '使用 Moebius 0.22B 进行更重的扩散式补全，适合复杂或较大的缺失区域。'}</p>
    </div>

    <div className="local-inpaint-section">
      <div className="local-inpaint-section-title"><span>处理模式</span><strong>{smart ? '推荐' : '高质量'}</strong></div>
      <div className="local-inpaint-mode-grid">
        <button type="button" disabled={busy} onClick={() => onModeChange('fast')}><Eraser size={16} /><strong>快速修复</strong><small>0 MB · 小污点/细线</small></button>
        <button type="button" disabled={busy} className={smart ? 'is-selected' : ''} onClick={() => onModeChange('smart')}><Sparkles size={16} /><strong>智能重绘</strong><small>MI-GAN · 约 28 MB</small></button>
        <button type="button" disabled={busy} className={hq ? 'is-selected' : ''} onClick={() => onModeChange('hq')}><WandSparkles size={16} /><strong>高质量</strong><small>Moebius · 约 1.24 GB</small></button>
      </div>
    </div>

    <div className="local-inpaint-section">
      <div className="local-inpaint-section-title"><span>蒙版画笔</span><strong>{brushSize}px</strong></div>
      <input type="range" min="8" max="256" step="4" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} />
      <small className="local-inpaint-shortcut-help">画布上滚轮缩放 · 按住空格临时切换抓手</small>
      <div className="local-inpaint-actions">
        <button type="button" onClick={() => setStrokes(strokes.slice(0, -1))} disabled={!strokes.length || busy}><ArrowRightLeft size={14} /> 撤销一笔</button>
        <button type="button" onClick={() => setStrokes([])} disabled={!strokes.length || busy}><Eraser size={14} /> 清空蒙版</button>
      </div>
    </div>

    <div className="local-inpaint-section">
      <div className="local-inpaint-section-title"><span>修复偏好</span><strong>边缘策略</strong></div>
      <div className="local-inpaint-repair-grid">
        {repairPreferences.map((item) => <button type="button" key={item.id} disabled={busy} className={repairPreference === item.id ? 'is-selected' : ''} onClick={() => setRepairPreference(item.id)}><strong>{item.label}</strong><small>{item.description}</small></button>)}
      </div>
      <small className="local-inpaint-repair-help">这里只调整蒙版扩展和边缘处理。MI-GAN / 当前 Moebius 权重都不支持文本条件生成，不会按文字生成指定的新物体。</small>
    </div>

    {hq && <div className="local-inpaint-section">
      <div className="local-inpaint-section-title"><span>推理步数</span><strong>{steps}</strong></div>
      <input type="range" min="12" max="28" step="1" value={steps} disabled={busy} onChange={(event) => setSteps(Number(event.target.value))} />
      <div className="local-inpaint-section-title"><span>引导强度</span><strong>{guidance.toFixed(1)}</strong></div>
      <input type="range" min="1" max="4" step="0.1" value={guidance} disabled={busy} onChange={(event) => setGuidance(Number(event.target.value))} />
      <label className="local-inpaint-seed"><span>随机种子</span><input type="number" value={seed} disabled={busy} onChange={(event) => setSeed(Number(event.target.value) || 1)} /></label>
    </div>}

    {smart ? <>
      <div className="local-inpaint-model-state"><Gauge size={15} /><span><strong>{miganStatus.installed ? 'MI-GAN 已缓存' : 'MI-GAN 按需下载'}</strong><small>{miganStatus.supported ? `${miganStatus.runtime === 'webgpu' ? 'WebGPU 优先' : 'WASM 模式'} · 模型约 28 MB` : '当前浏览器不支持本地 MI-GAN'}</small></span></div>
      <div className="local-inpaint-note"><Info size={15} /><span>MI-GAN 根据原图上下文补全蒙版区域；“修复偏好”只改变边缘策略，不作为语义生成提示词。</span></div>
    </> : <>
      <div className="local-inpaint-note"><Info size={15} /><span>Moebius 首次使用约需下载 1.24 GB ONNX 权重，仅建议桌面端高性能浏览器按需安装。</span></div>
      <div className="local-inpaint-note"><Info size={15} /><span>Moebius 当前权重也没有文本条件接口；“修复偏好”只影响蒙版边缘策略。</span></div>
    </>}

    {status && <div className="local-inpaint-status"><span>{status}</span>{progress !== null && <strong>{Math.round(progress * 100)}%</strong>}<div>{progress !== null && <i style={{ width: `${Math.max(2, progress * 100)}%` }} />}</div></div>}

    <button className="local-inpaint-run" type="button" disabled={busy || !strokes.length || (smart && !miganStatus.supported)} onClick={onRun}>
      {smart ? <Sparkles size={17} /> : <WandSparkles size={17} />} {busy ? '正在局部重绘…' : smart ? '智能重绘' : '高质量重绘'}
    </button>
  </div>;
}

export default function LocalInpaintBridge() {
  const [hosts, setHosts] = useState<Hosts>(emptyHosts);
  const [active, setActive] = useState(false);
  const [mode, setMode] = useState<InpaintMode>('smart');
  const [strokes, setStrokes] = useState<InpaintStroke[]>([]);
  const [brushSize, setBrushSize] = useState(64);
  const [repairPreference, setRepairPreference] = useState<RepairPreferenceId>('general');
  const [panMode, setPanMode] = useState(false);
  const [steps, setSteps] = useState(20);
  const [guidance, setGuidance] = useState(2);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000) + 1);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [miganStatus, setMiganStatus] = useState<MiganStatus>(emptyMiganStatus);
  const assets = useAppStore((state) => state.assets);
  const activeAssetId = useAppStore((state) => state.activeAssetId);
  const asset = useMemo(() => assets.find((item) => item.id === activeAssetId) ?? null, [assets, activeAssetId]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = findHosts();
        setHosts((current) => sameHosts(current, next) ? current : next);
      });
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    setStrokes([]);
    setRepairPreference('general');
    setPanMode(false);
    setStatus('');
    setProgress(null);
  }, [asset?.id]);

  useEffect(() => {
    if (!active) {
      setPanMode(false);
      return;
    }
    function isFormControl(target: EventTarget | null) {
      return target instanceof Element && Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'));
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== 'Space' || event.repeat || isFormControl(event.target)) return;
      event.preventDefault();
      setPanMode(true);
    }
    function handleKeyUp(event: KeyboardEvent) {
      if (event.code !== 'Space') return;
      if (panMode) event.preventDefault();
      setPanMode(false);
    }
    function handleBlur() {
      setPanMode(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [active, panMode]);

  useEffect(() => {
    if (!active || mode !== 'smart') return;
    void miganAdapter.capability().then((capability) => setMiganStatus({ installed: capability.installed, runtime: capability.runtime, supported: capability.supported }));
  }, [active, mode]);

  useEffect(() => {
    function handleNativeNavigation(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      if (!target) return;
      if (target.matches('.sidebar-tool:not([data-local-inpaint]), .back-button')) setActive(false);
    }
    document.addEventListener('click', handleNativeNavigation, true);
    return () => document.removeEventListener('click', handleNativeNavigation, true);
  }, []);

  useEffect(() => {
    if (!active) return;
    const heading = document.querySelector<HTMLElement>('.control-heading h2');
    if (!heading) return;
    const previous = heading.textContent;
    heading.textContent = '局部重绘';
    return () => { heading.textContent = previous ?? '消除笔'; };
  }, [active, hosts.controls]);

  function activate() {
    clickNativeCleanup();
    window.setTimeout(() => {
      setMode('smart');
      setActive(true);
    }, 0);
  }

  function changeMode(next: InpaintMode) {
    if (next === 'fast') {
      setActive(false);
      setPanMode(false);
      setStrokes([]);
      clickNativeCleanup();
      return;
    }
    setMode(next);
    setStatus('');
    setProgress(null);
  }

  async function run() {
    if (!asset || busy || mode === 'fast') return;
    const engine = mode === 'smart' ? 'migan' : 'moebius';
    const repair = repairPreferenceDefinition(repairPreference);
    setBusy(true);
    setStatus(mode === 'smart' ? '准备 MI-GAN' : '准备 Moebius 0.22B');
    setProgress(null);
    try {
      const next = await runInpaint(engine, asset, strokes, {
        steps,
        guidance,
        seed,
        prompt: repair.prompt || undefined,
        onProgress(stage, loaded, total) {
          setStatus(stage);
          setProgress(total && loaded !== undefined ? Math.min(1, loaded / total) : null);
        },
      });
      const store = useAppStore.getState();
      store.checkpoint();
      store.replaceAssets(store.assets.map((item) => item.id === asset.id ? next : item));
      store.setActiveAsset(next.id);
      const model = engine === 'migan' ? 'MI-GAN-512' : 'Moebius-0.22B';
      store.addOperation({ id: crypto.randomUUID(), type: 'local-inpaint', params: { model, mode, repairPreference, ...(engine === 'moebius' ? { steps, guidance, seed } : {}) }, createdAt: Date.now() });
      store.addHistory({ name: next.name, label: '局部重绘', detail: engine === 'migan' ? `MI-GAN 512 · ${repair.label}` : `Moebius 0.22B · ${steps} steps · ${repair.label}` });
      setStrokes([]);
      setStatus('局部重绘完成');
      setProgress(1);
      setSeed(Math.floor(Math.random() * 1_000_000) + 1);
      if (engine === 'migan') {
        const capability = await miganAdapter.capability();
        setMiganStatus({ installed: capability.installed, runtime: capability.runtime, supported: capability.supported });
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '局部重绘失败');
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  const homeCard = hosts.homeGrid ? createPortal(
    <button className="tool-card accent-pink" type="button" data-local-inpaint onClick={activate}>
      <span className="tool-card-icon"><WandSparkles size={19} /></span>
      <span className="tool-card-copy"><strong>局部重绘</strong><small>MI-GAN 默认 · 修复偏好</small></span>
      <ArrowRightLeft className="tool-arrow" size={15} />
    </button>,
    hosts.homeGrid,
  ) : null;

  const sidebarButton = hosts.sidebar ? createPortal(
    <button className={`sidebar-tool ${active ? 'is-active' : ''}`} type="button" data-local-inpaint onClick={activate} title="轻量智能重绘，支持修复偏好和可选高质量模式">
      <WandSparkles size={17} /><span>局部重绘</span>{active && <span className="active-bar" />}
    </button>,
    hosts.sidebar,
  ) : null;

  return <>
    {homeCard}
    {sidebarButton}
    {active && hosts.controls && createPortal(
      <InpaintPanel mode={mode} onModeChange={changeMode} strokes={strokes} setStrokes={setStrokes} brushSize={brushSize} setBrushSize={setBrushSize} repairPreference={repairPreference} setRepairPreference={setRepairPreference} steps={steps} setSteps={setSteps} guidance={guidance} setGuidance={setGuidance} seed={seed} setSeed={setSeed} busy={busy} status={status} progress={progress} miganStatus={miganStatus} onRun={() => void run()} />,
      hosts.controls,
    )}
    {active && asset && hosts.overlay && createPortal(
      <MaskOverlay strokes={strokes} brushSize={brushSize} imageWidth={asset.width} imageHeight={asset.height} panMode={panMode} onChange={setStrokes} />,
      hosts.overlay,
    )}
  </>;
}
