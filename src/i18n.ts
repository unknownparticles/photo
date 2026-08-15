export type AppLocale = 'zh' | 'en';
export type LanguagePreference = 'auto' | AppLocale;

const languagePreferenceStorageKey = 'alun-image-language-preference';

const originalTextByNode = new WeakMap<Text, string>();
const lastLocalizedTextByNode = new WeakMap<Text, string>();
const originalAttributeByElement = new WeakMap<Element, Map<string, string>>();
const lastLocalizedAttributeByElement = new WeakMap<Element, Map<string, string>>();

const translations: Record<string, string> = {
  'Alun Image · 本地图片工具箱': 'Alun Image · Local Image Toolkit',
  'Alun Image - 隐私优先的本地图片处理工具箱': 'Alun Image - Privacy-first local image toolkit',
  '基础处理': 'Basic editing',
  '智能工具': 'Smart tools',
  '工作流': 'Workflow',
  '尺寸': 'Resize',
  '精准调整宽高': 'Precisely adjust width and height',
  '裁剪': 'Crop',
  '比例与画布裁切': 'Crop by ratio or canvas',
  '分割': 'Split',
  '横纵网格切图': 'Split into rows, columns, or grids',
  '拼图': 'Collage',
  '多图自由合并': 'Combine multiple images freely',
  '压缩': 'Compress',
  '更小体积交付': 'Deliver smaller files',
  '格式': 'Format',
  'JPG / PNG / WebP': 'JPG / PNG / WebP',
  '抠图': 'Background removal',
  '本地与 AI 智能抠图': 'Local and AI background removal',
  '消除笔': 'Cleanup brush',
  'AI 去水印与普通消除': 'AI watermark removal and cleanup',
  'AI 超分': 'AI upscale',
  '智能放大恢复细节': 'Upscale and restore detail',
  '编辑': 'Edit',
  '色彩与滤镜': 'Color and filters',
  '水印': 'Watermark',
  '文字与图片标记': 'Text and image marks',
  '信息': 'Metadata',
  'EXIF 与隐私': 'EXIF and privacy',
  '批处理': 'Batch',
  '一套规则多张图': 'One rule set for many images',
  '动图帧与导出': 'Animation frames and export',
  '证件照': 'ID photo',
  '规格快速出片': 'Quickly create standard photos',
  '横屏 16:9': 'Landscape 16:9',
  '头像 1:1': 'Avatar 1:1',
  '小红书': 'Portrait 4:5',
  '手机壁纸': 'Phone wallpaper',
  '制造商': 'Make',
  '相机型号': 'Camera model',
  '图片描述': 'Image description',
  '作者': 'Artist',
  '版权': 'Copyright',
  '拍摄时间': 'Date taken',
  '纬度': 'Latitude',
  '经度': 'Longitude',
  'MODNet 抠图': 'MODNet removal',
  '人物主体自动分离': 'Automatically separate the person',
  'ESPCN 超分': 'ESPCN upscale',
  '细节放大与恢复': 'Upscale and restore detail',
  '约 26 MB': 'About 26 MB',
  '约 87 KB': 'About 87 KB',
  '约 101 KB': 'About 101 KB',
  '剪贴板': 'Clipboard',
  '文件': 'file',
  '文件夹': 'folder',
  '拖拽': 'Drop',
  '已重做上一步操作': 'Redid the previous action',
  '已撤销上一步操作': 'Undid the previous action',
  '没有识别到可处理的图片文件': 'No supported image files were found',
  '图片读取失败，请尝试其他文件': 'Could not read the image. Try another file',
  '已删除': 'Deleted',
  '完成': 'completed',
  '调整尺寸': 'Resize image',
  '证件照裁剪': 'ID photo crop',
  '证件照抠图失败，请检查抠图模块配置': 'ID photo removal failed. Check the background removal configuration',
  '服装素材读取失败': 'Could not read the clothing asset',
  '服装素材处理失败': 'Could not process the clothing asset',
  '生成证件照': 'Create ID photo',
  'AI 抠图': 'AI removal',
  '本地抠图': 'Local removal',
  '纯色批量抠除': 'Remove matching color',
  '联通色块抠除': 'Remove connected color area',
  '抠图擦除': 'Removal erase',
  '抠图还原': 'Removal restore',
  'AI 模型暂不可用，请先准备模型': 'AI model unavailable. Prepare the model first',
  '未加载模型，使用浏览器处理': 'Model not loaded; using browser processing',
  '本地降级处理失败': 'Local fallback processing failed',
  '消除处理失败': 'Cleanup failed',
  'AI 去水印': 'AI watermark removal',
  '普通消除笔': 'Standard cleanup brush',
  '添加水印': 'Add watermark',
  '修改照片信息': 'Edit photo metadata',
  '已写入常见照片信息': 'Common photo metadata saved',
  '清除照片数据': 'Clear photo data',
  '已移除 EXIF 与 GPS': 'EXIF and GPS removed',
  '压缩图片': 'Compress image',
  '转换格式': 'Convert format',
  '分割图片': 'Split image',
  '图片拼图': 'Image collage',
  '已生成': 'Created',
  '至少导入两张图片才能拼图': 'Import at least two images to create a collage',
  '拼图已生成，可继续编辑或导出': 'Collage created. You can keep editing or export it',
  'GIF 合成至少需要两张图片': 'GIF creation requires at least two images',
  'GIF 已导出': 'GIF exported',
  '正在写入照片信息': 'Saving photo metadata',
  '拖入图片到这里': 'Drop images here',
  '松开即可导入': 'Release to import',
  '或点击选择图片 · 支持多选与粘贴': 'or click to choose · multiple selection and paste supported',
  '选择图片': 'Choose images',
  '导入文件夹': 'Import folder',
  '支持从剪贴板粘贴': 'Paste from clipboard',
  '无需注册，无需上传': 'No sign-up or upload required',
  '支持批量文件': 'Batch files supported',
  '你的图片工作台 · 立即可用': 'Your image workspace · ready to use',
  '把图片处理，': 'Process images, ',
  '留在本地。': 'keep them local.',
  '从尺寸、裁剪到压缩与批量导出，一个安静、快速、隐私优先的图片工具箱。': 'From resizing and cropping to compression and batch export, a quiet, fast, privacy-first image toolkit.',
  '选择一个工具开始': 'Choose a tool to get started',
  '个工具': ' tools',
  '隐私是默认设置': 'Privacy is the default',
  '图片处理在浏览器 Canvas 中完成，原图不会离开你的设备。AI 能力也优先使用本地 WebGPU / WASM。': 'Image processing happens in the browser Canvas, so originals never leave your device. AI features also prioritize local WebGPU / WASM.',
  '本地处理': 'Local processing',
  '添加图片': 'Add images',
  '全部下载': 'Download all',
  '导出当前': 'Export current',
  '工具箱': 'Toolkit',
  '张图片': ' images',
  '选中': 'Select',
  '删除': 'Delete',
  '总计': 'Total',
  '工具': 'Tools',
  '本地模式': 'Local mode',
  '未选择图片': 'No image selected',
  '选择一张图片开始': 'Choose an image to begin',
  '未选择文件': 'No file selected',
  '拖入图片或点击添加': 'Drop an image or click Add',
  '直接编辑': 'Direct edit',
  '帮助': 'Help',
  '查看处理历史': 'View processing history',
  '切换主题': 'Toggle theme',
  '设置': 'Settings',
  '语言': 'Language',
  '跟随浏览器': 'Follow browser',
  '中文': 'Chinese',
  '打开菜单': 'Open menu',
  '关闭面板': 'Close panel',
  '删除当前图片': 'Delete current image',
  '撤销上一步操作': 'Undo previous action',
  '重做上一步操作': 'Redo previous action',
  '本地安全处理': 'Secure local processing',
  '需要帮助': 'Need help',
  '问题反馈': 'Feedback',
  '调整图片尺寸': 'Resize image',
  '输入目标尺寸，浏览器会在本地完成高质量缩放。': 'Enter a target size. High-quality resizing happens locally in your browser.',
  '宽度': 'Width',
  '高度': 'Height',
  '锁定宽高比': 'Lock aspect ratio',
  '常用尺寸': 'Common sizes',
  '插值算法': 'Interpolation',
  '自动': 'Auto',
  '双三次': 'Bicubic',
  '双线性': 'Bilinear',
  '最近邻': 'Nearest neighbor',
  '应用尺寸': 'Apply size',
  '合并与拼图': 'Merge and collage',
  '横向和纵向按原图边缘拼接，网格要求所有图片尺寸一致。': 'Join images edge to edge horizontally or vertically. Grid layouts require equal dimensions.',
  '当前工作区': 'Current workspace',
  '布局': 'Layout',
  '横向': 'Horizontal',
  '纵向': 'Vertical',
  '网格': 'Grid',
  '图片间距': 'Image spacing',
  '背景颜色': 'Background color',
  '生成拼图': 'Create collage',
  '网格拼图要求所有图片尺寸一致': 'Grid collages require equal image dimensions',
  '网格拼图要求所有图片尺寸一致，请先统一图片大小': 'Grid collages require equal image dimensions. Resize images first',
  '压缩并应用': 'Compress and apply',
  '转换并应用': 'Convert and apply',
  '原始文件': 'Original file',
  '预计输出': 'Estimated output',
  '预计节省': 'Estimated savings',
  '更小体积': 'Smaller file',
  '更高画质': 'Higher quality',
  '输出格式': 'Output format',
  '输出质量': 'Output quality',
  '透明区域背景': 'Transparent area background',
  '质量': 'Quality',
  '编辑图片': 'Edit image',
  '做一点轻量调整，保持原图清晰和色彩自然。': 'Make light adjustments while keeping the image clear and natural.',
  '亮度': 'Brightness',
  '对比度': 'Contrast',
  '饱和度': 'Saturation',
  '模糊': 'Blur',
  '自然': 'Natural',
  '黑白': 'Black and white',
  '胶片': 'Film',
  '暖色': 'Warm',
  '应用调整': 'Apply adjustments',
  '文字或图片水印都可直接在原图比例画布上拖动和缩放。': 'Drag and resize text or image watermarks directly on the image canvas.',
  '文字水印': 'Text watermark',
  '图片水印': 'Image watermark',
  '选择一张水印图片': 'Choose a watermark image',
  '水印文字': 'Watermark text',
  '透明度': 'Opacity',
  '快速定位': 'Quick position',
  '应用水印': 'Apply watermark',
  '图片信息与元数据': 'Image information and metadata',
  '查看照片信息，修改常见 EXIF 字段，或清除全部隐私数据。': 'View photo information, edit common EXIF fields, or clear all privacy data.',
  '编辑照片信息': 'Edit photo information',
  '未填写': 'Not set',
  '例如 31.2304': 'For example 31.2304',
  '隐私建议': 'Privacy tip',
  '清除操作会移除 EXIF、GPS 和编辑痕迹；修改操作只写入常见照片字段。': 'Clearing removes EXIF, GPS, and editing traces; editing writes only common photo fields.',
  '保存修改': 'Save changes',
  '清除全部数据': 'Clear all data',
  '批量处理': 'Batch processing',
  '为当前工作区的全部图片应用同一套本地处理规则。': 'Apply the same local processing rules to every image in the workspace.',
  '等待处理': 'Waiting',
  '自动取色区域': 'Automatic color sample area',
  '最大色块': 'Largest area',
  '中心色块': 'Center area',
  '四角色块': 'Four corners',
  '容差': 'Tolerance',
  '羽化': 'Feather',
  '文件名模板': 'Filename template',
  '起始序号': 'Starting number',
  '序号位数': 'Number of digits',
  '预览': 'Preview',
  '全部成功': 'All succeeded',
  '批量抠图': 'Batch removal',
  '批量裁剪': 'Batch crop',
  '批量超分': 'Batch upscale',
  '批量改名': 'Batch rename',
  '批量压缩': 'Batch compress',
  '正在处理': 'Processing',
  '开始批量处理': 'Start batch processing',
  'GIF / 动图': 'GIF / Animation',
  '用当前工作区的图片生成轻量动图。': 'Create a lightweight animation from workspace images.',
  '帧率': 'Frame rate',
  '循环': 'Loop',
  '无限循环': 'Infinite loop',
  '播放一次': 'Play once',
  '浏览器支持 GIF 编码，输出将保留在本机': 'GIF encoding runs in the browser and stays on this device',
  '导出 GIF': 'Export GIF',
  '智能抠图': 'Smart background removal',
  '按图片类型选择本地颜色抠除或 AI 人像抠图，结果均在浏览器内生成。': 'Choose local color removal or AI portrait removal by image type. Results are generated in the browser.',
  '抠图方式': 'Removal method',
  '画笔': 'Brush',
  '取样': 'Sample',
  '擦除背景': 'Erase background',
  '还原区域': 'Restore area',
  '画笔大小': 'Brush size',
  '目标颜色': 'Target color',
  '色彩匹配度': 'Color match',
  '更严格': 'Strict',
  '更宽松': 'Loose',
  '羽化半径': 'Feather radius',
  '输出透明 PNG，纯色模式会批量移除所有匹配像素。': 'Outputs a transparent PNG. Matching pixels are removed across the image in solid-color mode.',
  '应用离线抠图': 'Apply offline removal',
  '对象消除': 'Object cleanup',
  '涂抹水印、文字或杂物，松开后使用周边画面填充选区。': 'Brush over watermarks, text, or unwanted objects. The surrounding image fills the selection on release.',
  '处理方式': 'Processing method',
  '多方向纹理智能填充': 'Multi-directional texture fill',
  '轻量快速周边填充': 'Lightweight nearby fill',
  '全程本地': 'Fully local',
  '直接在中央图片的目标区域按住涂抹，松开后立即处理。': 'Brush over the target area in the center image and release to process it.',
  'AI 模式会扩大采样范围，复杂背景可能需要分段涂抹。': 'AI mode samples a wider area. Complex backgrounds may need several strokes.',
  '普通模式适合小面积文字和纯色区域。': 'Standard mode works well for small text and solid-color areas.',
  '使用 ESPCN 本地模型智能放大图片，增强像素密度并恢复边缘细节。': 'Use the local ESPCN model to upscale images, increase pixel density, and restore edge detail.',
  '本地推理': 'Local inference',
  'WebGPU 优先 · WASM 自动降级 · 无需上传原图': 'WebGPU first · automatic WASM fallback · no original upload',
  '输出倍率': 'Output scale',
  '2x 标准': '2x Standard',
  '4x 高清': '4x High definition',
  'WebGPU 已就绪': 'WebGPU ready',
  'WASM 兼容模式': 'WASM compatibility mode',
  '当前设备不支持': 'Unsupported on this device',
  '正在检测本机能力': 'Checking device capability',
  '前后对比': 'Before and after',
  '原图': 'Original',
  '结果': 'Result',
  '透明背景': 'Transparent background',
  '处理前': 'Before processing',
  '尚未运行': 'Not run yet',
  '按需加载本地模型，不上传原图': 'Load the local model on demand. The original is never uploaded',
  '首次使用下载模型，之后复用浏览器缓存': 'The model downloads on first use and is reused from browser cache',
  '首次使用下载模型和运行时，之后复用浏览器缓存': 'The model and runtime download on first use and are reused from browser cache',
  '就绪': 'Ready',
  '下载处理结果': 'Download result',
  '加载并运行': 'Load and run',
  '本地处理中…': 'Processing locally…',
  '先添加一张图片': 'Add an image first',
  '选择图片后，这里会显示当前工具的参数。': 'The current tool settings will appear here after you choose an image.',
  '最近处理': 'Recent processing',
  '还没有处理记录': 'No processing history',
  '清空历史': 'Clear history',
  '默认输出': 'Default output',
  'PNG / 保留透明': 'PNG / preserve transparency',
  '元数据': 'Metadata',
  '默认清除': 'Clear by default',
  '模型策略': 'Model strategy',
  '本地优先': 'Local first',
  '隐私模式已开启': 'Privacy mode enabled',
  '当前版本没有上传通道。': 'This version has no upload channel.',
  '关闭提示': 'Close notice',
  '图片默认只在你的设备上处理，不会上传服务器': 'Images are processed only on your device by default and are never uploaded',
  '优先使用 ESPCN 本地模型，模型不可用时自动使用浏览器高质量插值。': 'The local ESPCN model is preferred, with high-quality browser interpolation as a fallback.',
  '点击中央图片取样颜色，当前为': 'Click the center image to sample a color. Current mode: ',
  '已取样全图要移除的颜色': 'Selected the color to remove across the image',
  '已选择联通色块起点': 'Selected the connected-area starting point',
  '色彩调整': 'Color adjustments',
  '选择输出格式，转换在本地完成。': 'Choose an output format. Conversion happens locally.',
  '在中央图片上拖动水印，拖动右下角控制点调整大小。': 'Drag the watermark on the center image. Drag the lower-right handle to resize it.',
  '适合纯色背景，可取样后批量抠除并用画笔修边。': 'For solid-color backgrounds. Sample a color, remove it, then refine the edges with the brush.',
  '普通模式': 'Standard mode',
  '智能填充 · 画笔': 'Smart fill · brush',
  '首次下载：': 'First download: ',
  '可用': 'Use',
  '自托管': 'self-hosted',
  '按模型输出': 'Model output',
  '本地模型 ·': 'Local model ·',
  '倍': 'x',
  '处理失败，将保留原图': ' failed; originals will be kept',
  '正在填充选区...': 'Filling the selection...',
  '调整裁剪框': 'Adjust crop box',
  '调整证件照裁剪框': 'Adjust ID photo crop box',
  '裁剪比例': 'Crop ratio',
  '直接在中央图片上移动或缩放裁剪框，滚轮或双指可缩放画布。': 'Move or resize the crop box on the center image. Use the wheel or two fingers to zoom the canvas.',
  '裁剪区域': 'Crop area',
  '左': 'Left',
  '上': 'Top',
  '宽': 'Width',
  '高': 'Height',
  '输入时锁定比例': 'Lock ratio while editing',
  '应用裁剪': 'Apply crop',
  '自由': 'Free',
  '先预览并调整取景位置，再将人物背景替换为纯色。': 'Preview and adjust the framing, then replace the person background with a solid color.',
  '照片规格': 'Photo size',
  '复用抠图模块': 'Reuse removal module',
  '复用 AI / MODNet 模块': 'Reuse AI / MODNet module',
  '先预览再确认': 'Preview before confirming',
  '联通色块': 'Connected area',
  '全图颜色': 'Full-image color',
  '默认目标颜色': 'Default target color',
  '首次预览自动选择占比最大的颜色': 'The first preview automatically selects the most common color',
  '参数可调整': 'Adjustable parameters',
  '裁剪前预览': 'Pre-crop preview',
  '拖动框调整位置': 'Drag the box to adjust position',
  '调整裁剪': 'Adjust crop',
  '批量取色': 'Batch sample',
  '点击证件照背景批量取色': 'Click the ID photo background to sample colors',
  '证件照裁剪前预览': 'ID photo pre-crop preview',
  '在裁剪框内连续点击背景': 'Click the background repeatedly inside the crop box',
  '拖动角点调整比例': 'Drag a corner to adjust the ratio',
  '移除样本': 'Remove sample',
  '清空': 'Clear',
  '正在生成抠图预览…': 'Generating removal preview…',
  '重新生成抠图预览': 'Regenerate removal preview',
  '生成抠图预览': 'Generate removal preview',
  '图层预览': 'Layer preview',
  '拖动服装调整位置': 'Drag clothing to adjust position',
  '人物图层': 'Person layer',
  '处理中…': 'Processing…',
  '透明主体预览': 'Transparent subject preview',
  '内置': 'Built-in',
  '款': ' items',
  '服装素材': 'Clothing assets',
  '上方优先显示': 'Top layers appear first',
  '上传服装': 'Upload clothing',
  '上传后抠图': 'Remove background after upload',
  '图层': 'Layers',
  '人物前方': 'In front of person',
  '人物后方': 'Behind person',
  '隐藏图层': 'Hide layer',
  '显示图层': 'Show layer',
  '移到人物后方': 'Move behind person',
  '移到人物前方': 'Move in front of person',
  '删除图层': 'Delete layer',
  '人物': 'Person',
  '基础图层': 'Base layer',
  '服装大小': 'Clothing size',
  '分割方式': 'Split mode',
  '一列多行': 'One column, multiple rows',
  '一行多列': 'One row, multiple columns',
  '行 × 列': 'Rows × columns',
  '点击中央图片添加': 'Click the center image to add',
  '横线': 'Horizontal line',
  '竖线': 'Vertical line',
  '实时预览': 'Live preview',
  '自定义分割线': 'Custom split lines',
  '双击或右键删除': 'Double-click or right-click to delete',
  '点击图片切换为自定义': 'Click the image to switch to custom mode',
  '行数': 'Rows',
  '列数': 'Columns',
  '生成切图': 'Generate split images',
  '直接在中央图片上涂抹，松开后立即应用遮罩。': 'Brush directly on the center image and release to apply the mask.',
  '透明 PNG': 'Transparent PNG',
  '当前文件：': 'Current file: ',
  '处理过程不会上传图片': 'processing never uploads images',
  '已取样': 'Sampled',
  '人物主体': 'Person subject',
  '证件照透明抠图预览': 'Transparent ID photo removal preview',
  '添加': 'Add',
  '西服': 'Suit',
  '西装': 'Blazer',
  '衬衫': 'Shirt',
  '领带衬衫': 'Tie shirt',
  '一寸 · 25 × 35 mm': '1-inch · 25 × 35 mm',
  '二寸 · 35 × 49 mm': '2-inch · 35 × 49 mm',
  '小一寸 · 22 × 32 mm': 'Small 1-inch · 22 × 32 mm',
  '护照 · 35 × 45 mm': 'Passport · 35 × 45 mm',
  '身份证 · 26 × 32 mm': 'ID card · 26 × 32 mm',
  '文件名': 'Filename',
  '文件大小': 'File size',
  '文件类型': 'File type',
  '改名': 'Rename',
  '照片': 'Photo',
  '通用': 'General',
  '保持原蒙版': 'Keep original mask',
  '移除对象': 'Remove object',
  '扩大边缘，减少残影': 'Expand edges to reduce artifacts',
  '连续纹理': 'Continuous texture',
  '天空 / 墙面 / 草地': 'Sky / wall / grass',
  '人像细节': 'Portrait detail',
  '收紧边缘，保护细节': 'Tighten edges to preserve detail',
  '文字 / 水印': 'Text / watermark',
  '适度扩边清理标记': 'Expand edges to clean marks',
  '局部重绘': 'Local inpainting',
  '抓手：拖动画布，松开空格返回画笔': 'Hand tool: drag the canvas, release Space to return to the brush',
  '滚轮缩放 · 按住空格拖动画布': 'Scroll to zoom · hold Space to pan the canvas',
  '默认使用轻量 MI-GAN，根据周围纹理和结构快速补全涂抹区域。': 'Uses lightweight MI-GAN by default to quickly fill brushed areas from surrounding texture and structure.',
  '使用 Moebius 0.22B 进行更重的扩散式补全，适合复杂或较大的缺失区域。': 'Uses Moebius 0.22B for heavier diffusion-based filling of complex or larger missing areas.',
  '处理模式': 'Processing mode',
  '推荐': 'Recommended',
  '快速修复': 'Quick repair',
  '0 MB · 小污点/细线': '0 MB · small spots / thin lines',
  '智能重绘': 'Smart inpainting',
  'MI-GAN · 约 28 MB': 'MI-GAN · about 28 MB',
  '高质量': 'High quality',
  'Moebius · 约 1.24 GB': 'Moebius · about 1.24 GB',
  '蒙版画笔': 'Mask brush',
  '画布上滚轮缩放 · 按住空格临时切换抓手': 'Scroll on the canvas to zoom · hold Space to temporarily use the hand tool',
  '撤销一笔': 'Undo stroke',
  '清空蒙版': 'Clear mask',
  '修复偏好': 'Repair preference',
  '边缘策略': 'Edge strategy',
  '这里只调整蒙版扩展和边缘处理。MI-GAN / 当前 Moebius 权重都不支持文本条件生成，不会按文字生成指定的新物体。': 'This only adjusts mask expansion and edge handling. The current MI-GAN / Moebius weights do not support text-conditioned generation.',
  '推理步数': 'Inference steps',
  '引导强度': 'Guidance strength',
  '随机种子': 'Random seed',
  'MI-GAN 已缓存': 'MI-GAN cached',
  'MI-GAN 按需下载': 'Download MI-GAN on demand',
  'WASM 模式': 'WASM mode',
  '当前浏览器不支持本地 MI-GAN': 'This browser does not support local MI-GAN',
  'MI-GAN 根据原图上下文补全蒙版区域；“修复偏好”只改变边缘策略，不作为语义生成提示词。': 'MI-GAN fills masked areas from the original context. Repair preference only changes edge strategy and is not a text generation prompt.',
  'Moebius 首次使用约需下载 1.24 GB ONNX 权重，仅建议桌面端高性能浏览器按需安装。': 'Moebius downloads about 1.24 GB of ONNX weights on first use and is recommended only for high-performance desktop browsers.',
  'Moebius 当前权重也没有文本条件接口；“修复偏好”只影响蒙版边缘策略。': 'The current Moebius weights also have no text-conditioning interface; repair preference only affects mask edge strategy.',
  '正在局部重绘…': 'Inpainting…',
  '高质量重绘': 'High-quality inpainting',
  'MI-GAN 默认 · 修复偏好': 'MI-GAN default · repair preference',
  '轻量智能重绘，支持修复偏好和可选高质量模式': 'Lightweight smart inpainting with repair preference and optional high-quality mode',
  '准备 MI-GAN': 'Preparing MI-GAN',
  '准备 Moebius 0.22B': 'Preparing Moebius 0.22B',
  '局部重绘完成': 'Local inpainting complete',
  '局部重绘失败': 'Local inpainting failed',
  '模型下载失败': 'Model download failed',
  '无法创建局部重绘画布': 'Could not create the inpainting canvas',
  '无法创建局部重绘蒙版': 'Could not create the inpainting mask',
  '无法创建局部重绘输出画布': 'Could not create the inpainting output canvas',
  '请先在图片上涂抹需要重绘的区域': 'Brush the area to inpaint first',
  'MI-GAN 尚未初始化': 'MI-GAN is not initialized',
  'MI-GAN 模型已缓存': 'MI-GAN model cached',
  '下载 MI-GAN 模型': 'Downloading MI-GAN model',
  '初始化 MI-GAN': 'Initializing MI-GAN',
  '准备 MI-GAN 输入': 'Preparing MI-GAN input',
  'MI-GAN 智能重绘': 'MI-GAN inpainting',
  'MI-GAN 没有返回图像结果': 'MI-GAN returned no image result',
  '编码图片': 'Encoding image',
  '解码结果': 'Decoding result',
  '语义提示：': 'Semantic hint: ',
  '通用补全': 'General fill',
  '通用语义提示': 'General semantic hint',
  '物体移除': 'Object removal',
  '文字 / 标记移除': 'Text / mark removal',
  '局部重绘需要支持 WebGPU 的浏览器': 'Local inpainting requires a WebGPU-capable browser',
  '当前浏览器无法运行 MI-GAN': 'This browser cannot run MI-GAN',
  '当前浏览器不支持 WebGPU 或 WebAssembly': 'This browser does not support WebGPU or WebAssembly',
  '默认智能重绘 · 约 28 MB': 'Smart inpainting by default · about 28 MB',
  '高质量重绘 · 约 1.24 GB': 'High-quality inpainting · about 1.24 GB',
  'Moebius 0.22B 局部重绘需要支持 WebGPU 的浏览器': 'Moebius 0.22B local inpainting requires a WebGPU-capable browser',
  '无法创建 MI-GAN 蒙版画布': 'Could not create the MI-GAN mask canvas',
  'MI-GAN 输出尺寸异常': 'MI-GAN returned an invalid output size',
  '无法创建 MI-GAN 输出画布': 'Could not create the MI-GAN output canvas',
  '无法创建 MI-GAN 输入画布': 'Could not create the MI-GAN input canvas',
  'MI-GAN 输入节点无法识别': 'Could not identify MI-GAN input nodes',
  'WebGPU 初始化失败，切换 WASM': 'WebGPU initialization failed; switching to WASM',
  'MI-GAN 局部重绘': 'MI-GAN local inpainting',
  'Moebius 高质量重绘': 'Moebius high-quality inpainting',
};

const dynamicTranslations: Array<[RegExp, string]> = [
  [/^(.+)导入 (\d+) 张图片，文件仍只在本机处理$/, '$1 imported $2 images. Files stay on this device'],
  [/^(.+)完成$/, '$1 completed'],
  [/^已删除 (.+)$/, 'Deleted $1'],
  [/^已生成 (\d+) 张切图$/, 'Created $1 split images'],
  [/^已下载 (.+)$/, 'Downloaded $1'],
  [/^已准备下载 (\d+) 张图片$/, '$1 images ready to download'],
  [/^总计 (.+)$/, 'Total $1'],
  [/^选中 (.+)$/, 'Select $1'],
  [/^删除 (.+)$/, 'Delete $1'],
  [/^(\d+) 张图片$/, '$1 images'],
  [/^(\d+) 个工具$/, '$1 tools'],
  [/^当前文件：(.+) · 处理过程不会上传图片$/, 'Current file: $1 · processing never uploads images'],
  [/^当前工作区 (\d+) 张图片$/, 'Current workspace: $1 images'],
  [/^正在处理 (\d+)\/(\d+)$/, 'Processing $1/$2'],
  [/^上次完成 (\d+)\/(\d+)$/, 'Last completed $1/$2'],
  [/^批量处理完成：(\d+) 张成功，(\d+) 张保留原图$/, 'Batch processing complete: $1 succeeded, $2 originals kept'],
  [/^批量处理完成，共 (\d+) 张$/, 'Batch processing complete: $1 images'],
  [/^已取 (\d+) 个颜色样本$/, '$1 color samples selected'],
  [/^清空 (\d+) 个取色样本$/, 'Clear $1 color samples'],
  [/^(\d+) 个可见图层$/, '$1 visible layers'],
  [/^(\d+) 条自定义分割线$/, '$1 custom split lines'],
  [/^(\d+) 行$/, '$1 rows'],
  [/^(\d+) 列$/, '$1 columns'],
  [/^(\d+) 张$/, '$1 images'],
  [/^加载并运行 (.+)$/, 'Load and run $1'],
  [/^正在准备 (.+)$/, 'Preparing $1'],
  [/^按需加载 (.+) 模型$/, 'Load $1 model on demand'],
  [/^当前为全图匹配。$/, 'Current mode: full-image match.'],
  [/^当前为联通区域。$/, 'Current mode: connected area.'],
  [/^(.+) · 已缓存$/, '$1 · cached'],
  [/^下载 (.+)$/, 'Downloading $1'],
  [/^语义提示：(.+)$/, 'Semantic hint: $1'],
  [/^局部重绘 (\d+)\/(\d+)$/, 'Inpainting $1/$2'],
  [/^模型下载失败：HTTP (\d+)$/, 'Model download failed: HTTP $1'],
  [/^MI-GAN (.+) 后端初始化失败：(.*)$/, 'MI-GAN $1 backend initialization failed: $2'],
  [/^MI-GAN 本地运行时初始化失败：(.*)$/, 'MI-GAN local runtime initialization failed: $1'],
  [/^模型约 28 MB$/, 'Model about 28 MB'],
  [/^(WebGPU 优先|WASM 模式) · 模型约 28 MB$/, '$1 · model about 28 MB'],
  [/^MI-GAN 512 · (.+)$/, 'MI-GAN 512 · $1'],
  [/^Moebius 0\.22B · (\d+) steps · (.+)$/, 'Moebius 0.22B · $1 steps · $2'],
];

export function getBrowserLocale(): AppLocale {
  const language = typeof navigator !== 'undefined' ? (navigator.languages?.[0] ?? navigator.language) : 'en';
  return language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function getStoredLanguagePreference(): LanguagePreference {
  if (typeof window === 'undefined') return 'auto';
  try {
    const stored = window.localStorage.getItem(languagePreferenceStorageKey);
    return stored === 'zh' || stored === 'en' || stored === 'auto' ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

export function setStoredLanguagePreference(preference: LanguagePreference) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(languagePreferenceStorageKey, preference);
  } catch {
    // Storage may be unavailable in private or restricted browsing contexts.
  }
}

export function resolveLocale(preference: LanguagePreference): AppLocale {
  return preference === 'auto' ? getBrowserLocale() : preference;
}

export function translateText(value: string, locale: AppLocale) {
  if (locale === 'zh' || !value.trim()) return value;
  const leadingWhitespace = value.match(/^\s*/)?.[0] ?? '';
  const trailingWhitespace = value.match(/\s*$/)?.[0] ?? '';
  const content = value.slice(leadingWhitespace.length, value.length - trailingWhitespace.length || undefined);
  const exact = translations[content];
  if (exact) return `${leadingWhitespace}${exact}${trailingWhitespace}`;
  for (const [pattern, replacement] of dynamicTranslations) {
    if (pattern.test(content)) {
      const translated = content.replace(pattern, replacement);
      const localized = Object.entries(translations).sort(([first], [second]) => second.length - first.length).reduce((result, [source, target]) => result.replaceAll(source, target), translated);
      return `${leadingWhitespace}${localized}${trailingWhitespace}`;
    }
  }
  return value;
}

function shouldSkip(element: Element) {
  return ['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'INPUT', 'TEXTAREA'].includes(element.tagName) || Boolean(element.closest('[data-i18n-ignore]'));
}

export function localizeDocument(root: ParentNode, locale: AppLocale) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (current.parentElement && !shouldSkip(current.parentElement)) textNodes.push(current as Text);
  }
  textNodes.forEach((node) => {
    const current = node.nodeValue ?? '';
    const lastLocalized = lastLocalizedTextByNode.get(node);
    if (!originalTextByNode.has(node) || (lastLocalized !== undefined && current !== lastLocalized)) originalTextByNode.set(node, current);
    const original = originalTextByNode.get(node) ?? '';
    const translated = locale === 'zh' ? original : translateText(original, locale);
    if (translated !== node.nodeValue) node.nodeValue = translated;
    lastLocalizedTextByNode.set(node, translated);
  });
  root.querySelectorAll?.('[title], [aria-label], [placeholder], [alt]').forEach((element) => {
    if (shouldSkip(element)) return;
    let originalAttributes = originalAttributeByElement.get(element);
    if (!originalAttributes) {
      originalAttributes = new Map<string, string>();
      originalAttributeByElement.set(element, originalAttributes);
    }
    let lastLocalizedAttributes = lastLocalizedAttributeByElement.get(element);
    if (!lastLocalizedAttributes) {
      lastLocalizedAttributes = new Map<string, string>();
      lastLocalizedAttributeByElement.set(element, lastLocalizedAttributes);
    }
    ['title', 'aria-label', 'placeholder', 'alt'].forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (!value) return;
      const lastLocalized = lastLocalizedAttributes?.get(attribute);
      if (!originalAttributes?.has(attribute) || (lastLocalized !== undefined && value !== lastLocalized)) originalAttributes?.set(attribute, value);
      const original = originalAttributes?.get(attribute) ?? value;
      const translated = locale === 'zh' ? original : translateText(original, locale);
      if (translated !== value) element.setAttribute(attribute, translated);
      lastLocalizedAttributes?.set(attribute, translated);
    });
  });
}

export function applyDocumentLocale(locale: AppLocale) {
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  document.title = translateText('Alun Image · 本地图片工具箱', locale);
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (description) description.content = translateText('Alun Image - 隐私优先的本地图片处理工具箱', locale);
  let manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!manifest) {
    manifest = document.createElement('link');
    manifest.rel = 'manifest';
    document.head.appendChild(manifest);
  }
  manifest.href = new URL(locale === 'zh' ? 'manifest.zh.webmanifest' : 'manifest.webmanifest', document.baseURI).toString();
  localizeDocument(document.body, locale);
}

export function observeDocumentLocale(locale: AppLocale) {
  applyDocumentLocale(locale);
  if (locale === 'zh') return () => undefined;
  const observer = new MutationObserver(() => {
    observer.disconnect();
    localizeDocument(document.body, locale);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder', 'alt'] });
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder', 'alt'] });
  return () => observer.disconnect();
}
