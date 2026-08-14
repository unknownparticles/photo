import { describe, expect, it } from 'vitest';
import { parseSemanticPrompt } from './semantic';

describe('parseSemanticPrompt', () => {
  it('keeps an empty prompt neutral', () => {
    expect(parseSemanticPrompt('')).toEqual({ label: '通用补全', maskGrowPx: 0, normalized: '' });
  });

  it('uses a wider mask for object removal', () => {
    const profile = parseSemanticPrompt('移除路人');
    expect(profile.label).toBe('物体移除');
    expect(profile.maskGrowPx).toBe(10);
  });

  it('preserves tighter masks for portrait details', () => {
    const profile = parseSemanticPrompt('修皮肤');
    expect(profile.label).toBe('人像细节');
    expect(profile.maskGrowPx).toBe(2);
  });

  it('recognizes continuous texture hints', () => {
    expect(parseSemanticPrompt('补天空').label).toBe('连续纹理');
    expect(parseSemanticPrompt('grass').label).toBe('连续纹理');
  });
});
