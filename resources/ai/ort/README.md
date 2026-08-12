# ONNX Runtime Web 运行时

此目录保存按需加载的 ONNX Runtime Web WASM 辅助文件。浏览器只有在使用 WASM 兼容模式时才会下载它们。生产环境默认通过固定版本的 jsDelivr 地址访问；若要自托管，请通过 `VITE_ORT_WASM_BASE_URL` 指向此目录。
