/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_MODEL_BASE_URL?: string;
  readonly VITE_ORT_WASM_BASE_URL?: string;
  readonly VITE_MIGAN_MODEL_URL?: string;
  readonly VITE_MOEBIUS_MODEL_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
