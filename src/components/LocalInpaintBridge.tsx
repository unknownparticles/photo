import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightLeft, Brush, Eraser, Gauge, Info, Sparkles, WandSparkles } from 'lucide-react';
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

const emptyHosts: Hosts = { homeGrid: null, sidebar: null, controls: null, overlay: null };
const emptyMiganStatus: MiganStatus = { installed: false, runtime: 'unavailable', supported: true };
const promptPresets = ['移除路人', '补天空', '草地', '墙面', '修皮肤'];

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

function MaskOverlay({ strokes, brushSize, imageWidth, imageHeight, onChange }: {
  strokes: InpaintStroke[];
  brushSize: number;
  imageWidth: number;
  imageHeight: number;
  onChange: (strokes: InpaintStroke[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

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

  useEffect(() => {
    redraw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [strokes, imageWidth, imageHeight]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    onChange([...strokes, { size: brushSize, points: [point(event)] }]);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const next = point(event);
    onChange(strokes.map((stroke, index) => index === strokes.length - 1 ? { ...stroke, points: [...stroke.points, next] } : stroke));
  }

  function end(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    event.stopPropagation();
    drawingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div className="local-inpaint-mask" onPointerDown={(event) => event.stopPropagation()}>
    <canvas ref={canvasRef} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
    <div className="local-inpaint-mask-hint"><Brush size={13} /> 涂抹需要重绘的区域</div>
  </div>;
}

function InpaintPanel({ mode, onModeChange, strokes, setStrokes, brushSize, setBrushSize, prompt, setPrompt, steps, setSteps, guidance, setGuidance, seed, setSeed, busy, status, progress, miganStatus, onRun }: {
  mode: InpaintMode;
  onModeChange: (mode: InpaintMode) => void;
  strokes: InpaintStroke[];
  setStrokes: (strokes: InpaintStroke[]) => void;
  brushSize: number;
  setBrushSize: (value: number) => void;
  prompt: string;
  setPrompt: (value: string) => void;
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
      <div className="local-inpaint-actions">
        <button type="button" onClick={() => setStrokes(strokes.slice(0, -1))} disabled={!strokes.length || busy}><ArrowRightLeft size={14} /> 撤销一笔</button>
        <button type="button" onClick={() => setStrokes([])} disabled={!strokes.length || busy}><Eraser size={14} /> 清空蒙版</button>
      </div>
    </div>

    <div className="local-inpaint-section">
      <div className="local-inpaint-section-title"><span>语义提示（可选）</span><strong>轻量</strong></div>
      <input className="local-inpaint-prompt" type="text" maxLength={80} disabled={busy} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：移除路人、补天空、草地、墙面、修皮肤" />
      <div className="local-inpaint-prompt-chips">{promptPresets.map((value) => <button type="button" key={value} disabled={busy} className={prompt === value ? 'is-selected' : ''} onClick={() => setPrompt(value)}>{value}</button>)}</div>
      <small className="local-inpaint-prompt-help">提示词会调整蒙版扩展和修复策略；当前本地模型不是文本条件生成模型，因此不能保证按文字生成指定的新物体。</small>
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
      <div className="local-inpaint-note"><Info size={15} /><span>首次使用只下载 MI-GAN Pipeline v2；模型会缓存在浏览器中。ONNX Runtime 的辅助模块和 WASM 现在从本站同源加载，避免第三方 CDN 模块加载失败。</span></div>
    </> : <>
      <div className="local-inpaint-note"><Info size={15} /><span>Moebius 首次使用约需下载 1.24 GB ONNX 权重，仅建议桌面端高性能浏览器按需安装。</span></div>
      <div className="local-inpaint-note"><Info size={15} /><span>Moebius 本身没有文本条件接口；上方语义提示只用于轻量修复策略调整。</span></div>
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
  const [prompt, setPrompt] = useState('');
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
    setPrompt('');
    setStatus('');
    setProgress(null);
  }, [asset?.id]);

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
    const semanticPrompt = prompt.trim();
    setBusy(true);
    setStatus(mode === 'smart' ? '准备 MI-GAN' : '准备 Moebius 0.22B');
    setProgress(null);
    try {
      const next = await runInpaint(engine, asset, strokes, {
        steps,
        guidance,
        seed,
        prompt: semanticPrompt || undefined,
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
      store.addOperation({ id: crypto.randomUUID(), type: 'local-inpaint', params: { model, mode, ...(semanticPrompt ? { prompt: semanticPrompt } : {}), ...(engine === 'moebius' ? { steps, guidance, seed } : {}) }, createdAt: Date.now() });
      const promptDetail = semanticPrompt ? ` · ${semanticPrompt.slice(0, 18)}` : '';
      store.addHistory({ name: next.name, label: '局部重绘', detail: engine === 'migan' ? `MI-GAN 512 · 智能重绘${promptDetail}` : `Moebius 0.22B · ${steps} steps${promptDetail}` });
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
      <span className="tool-card-copy"><strong>局部重绘</strong><small>MI-GAN 默认 · 支持语义提示</small></span>
      <ArrowRightLeft className="tool-arrow" size={15} />
    </button>,
    hosts.homeGrid,
  ) : null;

  const sidebarButton = hosts.sidebar ? createPortal(
    <button className={`sidebar-tool ${active ? 'is-active' : ''}`} type="button" data-local-inpaint onClick={activate} title="轻量智能重绘，支持语义提示和可选高质量模式">
      <WandSparkles size={17} /><span>局部重绘</span>{active && <span className="active-bar" />}
    </button>,
    hosts.sidebar,
  ) : null;

  return <>
    {homeCard}
    {sidebarButton}
    {active && hosts.controls && createPortal(
      <InpaintPanel mode={mode} onModeChange={changeMode} strokes={strokes} setStrokes={setStrokes} brushSize={brushSize} setBrushSize={setBrushSize} prompt={prompt} setPrompt={setPrompt} steps={steps} setSteps={setSteps} guidance={guidance} setGuidance={setGuidance} seed={seed} setSeed={setSeed} busy={busy} status={status} progress={progress} miganStatus={miganStatus} onRun={() => void run()} />,
      hosts.controls,
    )}
    {active && asset && hosts.overlay && createPortal(
      <MaskOverlay strokes={strokes} brushSize={brushSize} imageWidth={asset.width} imageHeight={asset.height} onChange={setStrokes} />,
      hosts.overlay,
    )}
  </>;
}
