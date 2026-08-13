import { createContext, useContext } from 'react';

export const EditorOverlayContext = createContext<HTMLElement | null>(null);

export function useEditorOverlay() {
  return useContext(EditorOverlayContext);
}
