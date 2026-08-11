import { create } from 'zustand';
import type { ImageAsset, ImageOperation, ToolId } from './types';

interface HistoryEntry {
  id: string;
  name: string;
  label: string;
  detail: string;
  createdAt: number;
}

interface AppState {
  assets: ImageAsset[];
  activeAssetId: string | null;
  activeTool: ToolId | null;
  operations: ImageOperation[];
  history: HistoryEntry[];
  isDark: boolean;
  addAssets: (assets: ImageAsset[]) => void;
  replaceAssets: (assets: ImageAsset[]) => void;
  setActiveAsset: (id: string | null) => void;
  setActiveTool: (tool: ToolId | null) => void;
  addOperation: (operation: ImageOperation) => void;
  addHistory: (entry: Omit<HistoryEntry, 'id' | 'createdAt'>) => void;
  clearHistory: () => void;
  toggleTheme: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  assets: [],
  activeAssetId: null,
  activeTool: null,
  operations: [],
  history: JSON.parse(localStorage.getItem('alun-image-history') ?? '[]') as HistoryEntry[],
  isDark: false,
  addAssets: (assets) => set((state) => ({ assets: [...state.assets, ...assets], activeAssetId: state.activeAssetId ?? assets[0]?.id ?? null })),
  replaceAssets: (assets) => set({ assets, activeAssetId: assets[0]?.id ?? null }),
  setActiveAsset: (activeAssetId) => set({ activeAssetId }),
  setActiveTool: (activeTool) => set({ activeTool }),
  addOperation: (operation) => set((state) => ({ operations: [...state.operations, operation] })),
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
