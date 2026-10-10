import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, Settings } from '../src/ui/Settings';

describe('settings', () => {
  it('defaults to normal difficulty and accepts only known values', () => {
    expect(DEFAULT_SETTINGS.difficulty).toBe('normal');
    expect(Settings.sanitize({ difficulty: 'hard' }).difficulty).toBe('hard');
    expect(Settings.sanitize({ difficulty: 'impossible' }).difficulty).toBe('normal');
    expect(Settings.sanitize(null).difficulty).toBe('normal');
  });
});
