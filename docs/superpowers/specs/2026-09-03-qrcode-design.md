# QR Code Generator Feature Design

## Overview

Add a QR code generation tool to the local image toolbox. Users can input text, customize colors, upload a logo, preview the result, and either download it or embed it into the current document.

## Approach

Implement as an independent tool (`ToolId: 'qrcode'`) with its own panel component, consistent with existing tools like `watermark` and `id-photo`. Core rendering logic lives in `src/core/qrcode.ts` as pure functions.

## Architecture

```
src/core/qrcode.ts
  - generateQrCodeDataURL(text, options) → string
  - generateQrCodeBlob(text, options) → Promise<Blob>

src/components/QrCodePanel.tsx
  - Text input
  - Foreground / background color pickers
  - Logo upload with size slider
  - Live preview canvas
  - Actions: download, embed into document

src/App.tsx
  - Register tool: { id: 'qrcode', label: '二维码', ... }
  - Add onQrGenerate callback to Workspace
```

## Core Logic (`src/core/qrcode.ts`)

### Dependencies

- `qrcode` (npm package): provides `QRCode.toDataURL()` for QR matrix rendering

### Function Signatures

```ts
export interface QrCodeOptions {
  text: string
  width: number
  fgColor: string
  bgColor: string
  logo?: { dataUrl: string; size: number } // size = logo width as fraction of QR width (0–0.3)
}

export async function generateQrCodeDataURL(options: QrCodeOptions): Promise<string>
export async function generateQrCodeBlob(options: QrCodeOptions): Promise<Blob>
```

### Rendering Steps

1. Call `QRCode.toDataURL(options.text, { width, margin: 2, color: { dark: fgColor, light: bgColor } })`
2. Load the resulting data URL into an `Image`
3. Draw the QR image onto a `<canvas>` of the target size
4. If `logo` is provided, load logo image and draw it centered at `size * width` dimensions
5. Call `canvas.toBlob()` or return `canvas.toDataURL()`

### Error Handling

- Return `null` / throw if `text` is empty
- If logo fails to load, generate QR without logo rather than failing the whole operation
- Validate `logo.size` is within `[0, 0.3]` to avoid obscuring too much of the QR code

## UI Panel (`src/components/QrCodePanel.tsx`)

### State

- `text`: string
- `width`: number (default 512)
- `fgColor`: string (default `#000000`)
- `bgColor`: string (default `#FFFFFF`)
- `logo`: `{ dataUrl: string; size: number } | null`
- `previewUrl`: string | null
- `isGenerating`: boolean

### Layout

- Top: text input (textarea, required)
- Middle: color pickers row (fg, bg), width slider
- Below: logo upload button + size slider (hidden when no logo)
- Center: preview canvas/image
- Bottom: two action buttons — "下载" and "嵌入当前文档"

### Actions

- **下载**: call `generateQrCodeBlob()` → create object URL → trigger `<a download>` click
- **嵌入当前文档**: call `generateQrCodeBlob()` → `createAssetFromBlob(blob, name)` → invoke `onQrGenerate(asset)` callback

## Integration (`src/App.tsx`)

- Add to `tools` array:

```ts
{
  id: 'qrcode',
  label: '二维码',
  description: '生成自定义二维码',
  icon: QrCode,
  category: '工具',
  accent: 'emerald'
}
```

- In `Workspace` render branch for `'qrcode'`:

```tsx
<QrCodePanel onGenerate={(asset) => { /* add asset to document */ }} />
```

- Import `QrCode` icon from `lucide-react`.

## Testing Considerations

- Unit test `generateQrCodeBlob` with various color combinations and logo sizes
- Verify logo is centered and sized correctly
- Verify download triggers correct filename
- Verify `onQrGenerate` receives a valid `ImageAsset`

## Dependencies to Add

```
qrcode
```
