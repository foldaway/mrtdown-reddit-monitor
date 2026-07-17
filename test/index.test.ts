import { describe, expect, it } from 'vitest';

import worker from '../src/index.js';

describe('placeholder Worker', () => {
  it('acknowledges requests without content', async () => {
    const response = await worker.fetch();

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });
});
