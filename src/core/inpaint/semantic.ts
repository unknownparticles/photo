export interface SemanticPromptProfile {
  label: string;
  maskGrowPx: number;
  normalized: string;
}

const rules: Array<{ pattern: RegExp; label: string; maskGrowPx: number }> = [
  { pattern: /(去除|移除|删除|擦除|消除|remove|erase|delete|object)/i, label: '物体移除', maskGrowPx: 10 },
  { pattern: /(水印|文字|字幕|logo|标志|text|watermark)/i, label: '文字 / 标记移除', maskGrowPx: 8 },
  { pattern: /(脸|面部|皮肤|人像|头发|五官|face|skin|portrait|hair)/i, label: '人像细节', maskGrowPx: 2 },
  { pattern: /(天空|云|水面|海|湖|草地|草坪|墙|墙面|道路|地面|木纹|背景|sky|cloud|water|sea|lake|grass|wall|road|ground|wood|background)/i, label: '连续纹理', maskGrowPx: 5 },
];

export function parseSemanticPrompt(prompt?: string): SemanticPromptProfile {
  const normalized = (prompt ?? '').trim().slice(0, 80);
  if (!normalized) return { label: '通用补全', maskGrowPx: 0, normalized: '' };
  const matched = rules.find((rule) => rule.pattern.test(normalized));
  return matched
    ? { label: matched.label, maskGrowPx: matched.maskGrowPx, normalized }
    : { label: '通用语义提示', maskGrowPx: 4, normalized };
}
