# Alun Image

隐私优先的本地图片处理工具箱。图片默认只在浏览器中处理，不上传服务器。

## 开发

```bash
npm install
npm run dev
```

## 本地 AI 模型

AI 适配器默认从 `/photo/models` 按需加载 ONNX 模型。可通过 `VITE_MODEL_BASE_URL` 指定静态模型目录；模型缺失时，界面会显示能力提示，不会伪造处理结果。

## 发布

推送 `main` 分支后，GitHub Actions 会执行检查、构建并发布到 GitHub Pages：

`https://unknownparticles.github.io/photo/`
