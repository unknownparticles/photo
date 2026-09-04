import { useEffect, useRef, useState } from 'react';
import type { ImageAsset } from '../types';
import { generateQrCodeAsset, generateQrCodeDataURL } from '../core/qrcode';
import { Download, ImagePlus, QrCode } from 'lucide-react';

type QrLogo = { dataUrl: string; size: number } | undefined;

export function QrCodePanel({ onGenerate }: { onGenerate: (asset: ImageAsset) => Promise<void> }) {
  const [text, setText] = useState('https://example.com');
  const [width, setWidth] = useState(512);
  const [fgColor, setFgColor] = useState('#000000');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [logo, setLogo] = useState<QrLogo>(undefined);
  const [preview, setPreview] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const next = await generateQrCodeDataURL({ text, width, fgColor, bgColor, logo });
        if (!cancelled) setPreview(next);
      } catch {
        if (!cancelled) setPreview(null);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [text, width, fgColor, bgColor, logo, logo?.dataUrl, logo?.size]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const asset = await generateQrCodeAsset({ text, width, fgColor, bgColor, logo });
      await onGenerate(asset);
    } finally {
      setGenerating(false);
    }
  }

  function chooseLogo(file: File | undefined) {
    if (!file?.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      setLogo({ dataUrl: reader.result as string, size: 0.2 });
    };
    reader.readAsDataURL(file);
  }

  return (
    <>
      <div className="panel-intro"><h3>生成二维码</h3><p>输入内容，选择颜色和 Logo，生成后将嵌入当前文档，在左侧实时预览中查看。</p></div>
      <div className="control-section">
        <label className="field"><span>内容</span><div className="field-control"><input value={text} onChange={(event) => setText(event.target.value)} placeholder="文本或链接" /></div></label>
        <div className="field-grid">
          <label className="field"><span>尺寸</span><div className="field-control"><input type="number" min="128" max="2048" step="64" value={width} onChange={(event) => setWidth(Number(event.target.value))} /></div></label>
          <label className="field"><span>前景色</span><div className="field-control"><input type="color" value={fgColor} onChange={(event) => setFgColor(event.target.value)} /><b>{fgColor.toUpperCase()}</b></div></label>
          <label className="field"><span>背景色</span><div className="field-control"><input type="color" value={bgColor} onChange={(event) => setBgColor(event.target.value)} /><b>{bgColor.toUpperCase()}</b></div></label>
        </div>
        <button className="watermark-file-button" onClick={() => fileInput.current?.click()}><ImagePlus size={16} /><span>{logo ? '已选 Logo，点击替换' : '添加 Logo 图片'}</span></button>
        <input ref={fileInput} type="file" accept="image/*" className="visually-hidden" onChange={(event) => { void chooseLogo(event.target.files?.[0]); event.currentTarget.value = ''; }} />
        {logo && (
          <div className="control-section">
            <div className="range-heading"><span>Logo 大小</span><strong>{Math.round(logo.size * 100)}%</strong></div>
            <input className="range-input" type="range" min="5" max="30" value={Math.round(logo.size * 100)} onChange={(event) => setLogo((current) => current ? { ...current, size: Number(event.target.value) / 100 } : current)} />
            <div className="range-labels"><span>较小</span><span>较大</span></div>
            <button type="button" className="text-button" onClick={() => setLogo(undefined)}>移除 Logo</button>
          </div>
        )}
      </div>
      <div className="control-section">
        <button className="apply-button full" onClick={handleGenerate} disabled={generating || !preview}><QrCode size={16} /> 嵌入当前文档</button>
      </div>
    </>
  );
}
