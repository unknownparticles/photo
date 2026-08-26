import { create } from 'zustand';
import type { ImageOperation, PhotoDocument, ToolId } from './types';

interface HistoryEntry {
  id: string;
  name: string;
  label: string;
  detail: string;
  createdAt: number;
}

interface ImageSnapshot {
  documents: PhotoDocument[];
  activeDocumentId: string | null;
  activeTool: ToolId | null;
}

interface AppState {
  documents: PhotoDocument[];
  activeDocumentId: string | null;
  activeTool: ToolId | null;
  operations: ImageOperation[];
  undoStack: ImageSnapshot[];
  redoStack: ImageSnapshot[];
  history: HistoryEntry[];
  isDark: boolean;
  addDocuments: (documents: PhotoDocument[]) => void;
  replaceDocuments: (documents: PhotoDocument[]) => void;
  updateDocument: (id: string, updater: (document: PhotoDocument) => PhotoDocument) => void;
  setActiveDocument: (id: string | null) => void;
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
  documents: [],
  activeDocumentId: null,
  activeTool: null,
  operations: [],
  undoStack: [],
  redoStack: [],
  history: JSON.parse(localStorage.getItem('alun-image-history') ?? '[]') as HistoryEntry[],
  isDark: false,
  addDocuments: (documents) => set((state) => ({ documents: [...state.documents, ...documents], activeDocumentId: state.activeDocumentId ?? documents[0]?.id ?? null })),
  replaceDocuments: (documents) => set({ documents, activeDocumentId: documents[0]?.id ?? null }),
  updateDocument: (id, updater) => set((state) => ({ documents: state.documents.map((document) => (document.id === id ? updater(document) : document)) })),
  setActiveDocument: (activeDocumentId) => set({ activeDocumentId }),
  setActiveTool: (activeTool) => set({ activeTool }),
  addOperation: (operation) => set((state) => ({ operations: [...state.operations, operation] })),
  checkpoint: () => set((state) => ({ undoStack: [...state.undoStack, { documents: state.documents, activeDocumentId: state.activeDocumentId, activeTool: state.activeTool }].slice(-20), redoStack: [] })),
  undo: () => set((state) => {
    const previous = state.undoStack[state.undoStack.length - 1];
    if (!previous) return state;
    return {
      documents: previous.documents,
      activeDocumentId: previous.activeDocumentId,
      activeTool: previous.activeTool,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, { documents: state.documents, activeDocumentId: state.activeDocumentId, activeTool: state.activeTool }],
    };
  }),
  redo: () => set((state) => {
    const next = state.redoStack[state.redoStack.length - 1];
    if (!next) return state;
    return {
      documents: next.documents,
      activeDocumentId: next.activeDocumentId,
      activeTool: next.activeTool,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, { documents: state.documents, activeDocumentId: state.activeDocumentId, activeTool: state.activeTool }],
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
