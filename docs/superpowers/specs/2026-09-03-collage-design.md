# Freeform Collage Tool Design

## Overview

Add a freeform collage tool that lets users take the current active image as a base background, import additional sticker images, and freely arrange them on the canvas with drag, scale, and rotate. The result can be exported as a new image document or downloaded.

## Key Interaction Rule

When the user opens the collage tool, the currently active image automatically becomes the base layer. Additional imported images are treated as movable stickers. This matches the existing workspace pattern where tools operate on `activeDocument`.

## Architecture

```
src/types.ts
  - Extend Layer with optional transform fields: rotation, scaleX, scaleY, opacity

src/core/documents.ts
  - Update flattenDocument to apply layer transforms before drawImage
  - Keep defaults so existing tools remain unaffected

src/core/collage.ts
  - composeCollage({ canvasWidth, canvasHeight, background, layers }) -> Blob
  - Pure canvas composition; no React dependency

src/components/CollagePanel.tsx
  - Base layer comes from active asset
  - Sticker import, layer list, direct canvas interaction via EditorOverlay
  - Actions: add sticker, remove sticker, toggle visibility, reorder, export/download

src/App.tsx
  - Register ToolId 'collage'
  - Add onCollageExport callback
  - Wire ToolPanel branch
```

## Data Model Changes

### Layer extensions (`src/types.ts`)

Add optional transform fields to `Layer`:

```ts
export interface Layer {
  id: string;
  name: string;
  type: string;
  blob: Blob;
  url: string;
  width: number;
  height: number;
  visible: boolean;
  offsetX: number;
  offsetY: number;
  rotation?: number;      // degrees, default 0
  scaleX?: number;        // default 1
  scaleY?: number;        // default 1
  opacity?: number;       // default 1, reserved for future
}
```

### flattenDocument change (`src/core/documents.ts`)

When rendering each layer, wrap `drawImage` with transform:

```ts
context.save();
context.globalAlpha = layer.opacity ?? 1;
context.translate(layer.offsetX + layer.width / 2, layer.offsetY + layer.height / 2);
context.rotate((layer.rotation ?? 0) * Math.PI / 180);
context.scale(layer.scaleX ?? 1, layer.scaleY ?? 1);
context.drawImage(image, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
context.restore();
```

Backward compatibility: existing tools never set these fields, so default behavior is unchanged.

## Core Logic (`src/core/collage.ts`)

### composeCollage

```ts
export async function composeCollage(params: {
  canvasWidth: number;
  canvasHeight: number;
  background: string;
  layers: Array<{ asset: ImageAsset; offsetX: number; offsetY: number; rotation?: number; scaleX?: number; scaleY?: number; opacity?: number }>;
}): Promise<Blob>
```

Steps:
1. Create canvas with `canvasWidth` / `canvasHeight`
2. Fill background
3. For each layer in order, load image and draw with transform matching `flattenDocument`
4. `canvas.toBlob('image/png')`

This is intentionally parallel to `flattenDocument` so export and preview stay consistent.

## Panel UI (`src/components/CollagePanel.tsx`)

### State

- `baseAsset`: current active image asset, treated as background
- `stickers`: array of sticker assets/layers with position/rotation/scale
- `selectedStickerId`: string | null
- `background`: string color or image reference
- `canvasWidth`, `canvasHeight`: starting from base asset size
- `isExporting`: boolean

### Layout

- Top bar: canvas size inputs, background color/image, export/download buttons
- Left sidebar: sticker list with visibility toggle, delete, and bring forward/send back
- Center: `EditorOverlay` portal on top of preview, supporting:
  - pointer drag to move stickers
  - pinch/scroll to scale
  - rotation handle above selected sticker
- Bottom or right: add sticker button

### Interaction

- Sticker selection by tap/click on overlay
- Drag uses `setPointerCapture` pattern, stores percentage-based or pixel-based position
- Rotation handle: small circle above sticker; drag angle -> set `rotation`
- Scale: pinch gesture or dedicated handle; bounded to reasonable range
- Reorder: up/down buttons in sticker list instead of drag-sort, simpler and consistent with project style

### Actions

- **Add sticker**: file input -> create asset -> append to stickers at center
- **Remove sticker**: delete from array
- **Toggle visibility**: flip `visible`
- **Bring forward / send back**: swap order in stickers array
- **Export**: `composeCollage()` -> `createAssetFromBlob()` -> commit new document
- **Download**: `composeCollage()` -> `downloadBlob()`

## Integration (`src/App.tsx`)

- Add tool definition:
  ```ts
  {
    id: 'collage',
    label: '拼贴',
    description: '底图加贴纸自由拼贴',
    icon: Layers3, // or another appropriate lucide icon
    category: '工作流',
    accent: 'pink'
  }
  ```
- Add `onCollageExport` callback:
  ```ts
  async function applyCollageExport(asset: ImageAsset) {
    const doc = documentFromAsset(asset);
    doc.name = `拼贴-${doc.id.slice(0, 6)}`;
    checkpoint();
    addDocuments([doc]);
    setActiveDocument(doc.id);
    addHistory({ name: doc.name, label: '自由拼贴', detail: `${stickers.length} 个贴纸` });
    setNotice({ type: 'success', text: '拼贴已生成为新文档' });
  }
  ```
- Pass through `Workspace` -> `ToolPanel`
- `ToolPanel` render branch:
  ```tsx
  case 'collage': return <CollagePanel asset={viewAsset} onExport={onCollageExport} setNotice={setNotice} />;
  ```
  Note: unlike most tools, collage still receives `asset` because the base layer is required.

## Error Handling

- If no active document when opening collage, prompt user to import an image first
- If sticker image fails to load, show warning and remove from list
- Bound rotation to `[0, 360)` degrees, scale to `[0.1, 5]`
- Preserve sticker offsets within canvas bounds or allow overflow; current project pattern allows overflow in other tools

## Testing Considerations

- Unit test `composeCollage` with multiple stickers, rotation, scale, and transparency
- Verify `flattenDocument` produces identical output for documents with default transform values
- Verify `LayerPanel` visibility/reorder behavior works with collage-generated documents
- Manual test: create collage, export, re-open exported document, ensure layers persist

## Dependencies

No new external dependencies. Uses existing canvas, `loadImage`, `createAssetFromBlob`, `downloadBlob`.
