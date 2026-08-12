# Alun Image

隐私优先的本地图片处理工具箱。图片默认只在浏览器中处理，不上传服务器。

## 开发

```bash
npm install
npm run dev
```

## 本地 AI 模型

AI 适配器默认从当前站点的 `models/` 目录按需加载 ONNX 模型。请将 `modnet.onnx`、`espcn-2x.onnx` 和 `espcn-4x.onnx` 放入 `public/models/`，构建后会发布到 `/photo/models/`。也可通过 `VITE_MODEL_BASE_URL` 指定其他静态模型目录。模型缺失时，界面会显示明确的文件提示，不会伪造处理结果。

## 发布

推送 `main` 分支后，GitHub Actions 会执行检查、构建并发布到 GitHub Pages：

`https://unknownparticles.github.io/photo/`
