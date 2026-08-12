# AI 模型资源

这些 ONNX 文件由前端在用户首次运行对应功能时按需读取，不会随普通页面首屏加载：

- `modnet.onnx`：MODNet 人物抠图
- `espcn-2x.onnx`：ESPCN 2 倍超分
- `espcn-4x.onnx`：ESPCN 4 倍超分

模型不会随前端代码自动生成，也不会上传原图。生产环境默认通过固定提交的 GitHub Raw 地址访问；若要自托管，请将此目录发布为静态目录并通过 `VITE_MODEL_BASE_URL` 指向它。
