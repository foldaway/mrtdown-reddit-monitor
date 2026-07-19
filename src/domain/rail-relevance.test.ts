import { describe, expect, it } from 'vitest';

import { isTextRailRelated } from './rail-relevance.js';

describe('rail relevance filter', () => {
  it('preserves the legacy crawler rail terms and phrases', () => {
    expect(isTextRailRelated('Delay on the Circle Line')).toBe(true);
    expect(isTextRailRelated('Please allow additional travel time')).toBe(true);
    expect(isTextRailRelated('NEL service update')).toBe(true);
  });

  it('uses word boundaries and rejects unrelated substrings', () => {
    expect(isTextRailRelated('This is an online discussion')).toBe(false);
    expect(isTextRailRelated('A training course starts tomorrow')).toBe(false);
  });
});
