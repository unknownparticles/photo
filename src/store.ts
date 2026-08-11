import { create } from 'zustand';
import type { ImageAsset, ImageOperation, ToolId } from './types';

interface HistoryEntry {
  id: string;
  name: string;
  label: string;
  detail: string;
  createdAt: number;
}

interface ImageSnapshot {
  assets: ImageAsset[];
  activeAssetId: string | null;
  activeTool: ToolId | null;
}

interface AppState {
  assets: ImageAsset[];
  activeAssetId: string | null;
  activeTool: ToolId | null;
  operations: ImageOperation[];
  undoStack: ImageSnapshot[];
  redoStack: ImageSnapshot[];
  history: HistoryEntry[];
  isDark: boolean;
  addAssets: (assets: ImageAsset[]) => void;
  replaceAssets: (assets: ImageAsset[]) => void;
  setActiveAsset: (id: string | null) => void;
  setActiveTool: (tool: ToolId | null) => void;
  addOperation: (operation: ImageOperation) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  addHistory: (entry: Omit<HistoryEntry, 'id' | 'createdAt'>) => void;
  clearHistory: () => void;
  toggleTheme: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  assets: [],
  activeAssetId: null,
  activeTool: null,
  operations: [],
  undoStack: [],
  redoStack: [],
  history: JSON.parse(localStorage.getItem('alun-image-history') ?? '[]') as HistoryEntry[],
  isDark: false,
  addAssets: (assets) => set((state) => ({ assets: [...state.assets, ...assets], activeAssetId: state.activeAssetId ?? assets[0]?.id ?? null })),
  replaceAssets: (assets) => set({ assets, activeAssetId: assets[0]?.id ?? null }),
  setActiveAsset: (activeAssetId) => set({ activeAssetId }),
  setActiveTool: (activeTool) => set({ activeTool }),
  addOperation: (operation) => set((state) => ({ operations: [...state.operations, operation] })),
  checkpoint: () => set((state) => ({ undoStack: [...state.undoStack, { assets: state.assets, activeAssetId: state.activeAssetId, activeTool: state.activeTool }].slice(-20), redoStack: [] })),
  undo: () => set((state) => {
    const previous = state.undoStack[state.undoStack.length - 1];
    if (!previous) return state;
    return {
      assets: previous.assets,
      activeAssetId: previous.activeAssetId,
      activeTool: previous.activeTool,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, { assets: state.assets, activeAssetId: state.activeAssetId, activeTool: state.activeTool }],
    };
  }),
  redo: () => set((state) => {
    const next = state.redoStack[state.redoStack.length - 1];
    if (!next) return state;
    return {
      assets: next.assets,
      activeAssetId: next.activeAssetId,
      activeTool: next.activeTool,
      undoStack: [...state.undoStack, { assets: state.assets, activeAssetId: state.activeAssetId, activeTool: state.activeTool }],
      redoStack: state.redoStack.slice(0, -1),
    };
  }),
  addHistory: (entry) => set((state) => {
    const history = [{ ...entry, id: crypto.randomUUID(), createdAt: Date.now() }, ...state.history].slice(0, 12);
    localStorage.setItem('alun-image-history', JSON.stringify(history));
    return { history };
  }),
  clearHistory: () => {
    localStorage.removeItem('alun-image-history');
    set({ history: [] });
  },
  toggleTheme: () => set((state) => ({ isDark: !state.isDark })),
}));
