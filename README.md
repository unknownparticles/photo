# Alun Image

隐私优先的本地图片处理工具箱。图片默认只在浏览器中处理，不上传服务器。

## 开发

```bash
npm install
npm run dev
```

## 本地 AI 模型

AI 模型和 ONNX Runtime WASM 文件不会进入首屏构建产物，也不会被 PWA 预缓存。用户进入 AI 抠图或 AI 超分模块并运行时，才会从固定版本的 GitHub Raw / npm CDN 地址按需下载对应文件；浏览器会通过 HTTP 缓存复用已下载资源。MODNet 约 26 MB，ESPCN 约 87-101 KB；WASM 兼容模式还需要约 26 MB 运行时。

模型文件仍保存在 `resources/ai/models/`，方便审查、替换和自托管。部署到无法访问 GitHub Raw 的环境时，可以通过 `VITE_MODEL_BASE_URL` 指向包含模型文件的静态目录；WASM 运行时默认从 ONNX Runtime 1.27.0 的 npm CDN 获取，也可以通过 `VITE_ORT_WASM_BASE_URL` 指向 `resources/ai/ort/` 或其他静态目录。两个地址都支持绝对 URL 和相对站点路径。

## 发布

推送 `main` 分支后，GitHub Actions 会执行检查、构建并发布到 GitHub Pages：

`https://unknownparticles.github.io/photo/`
