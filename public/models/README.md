# 本地 AI 模型目录

将以下 ONNX 模型文件放在此目录，浏览器才会在首次运行对应功能时加载它们：

- `modnet.onnx`：MODNet 人物抠图
- `espcn-2x.onnx`：ESPCN 2 倍超分
- `espcn-4x.onnx`：ESPCN 4 倍超分

模型不会随前端代码自动生成，也不会上传原图。若模型放在其他静态目录，请通过 `VITE_MODEL_BASE_URL` 指向该目录。
