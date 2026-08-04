import { describe, it, expect } from 'vitest';

describe('env test', () => {
  it('should have localStorage', () => {
    expect(typeof localStorage).toBe('object');
  });
});
