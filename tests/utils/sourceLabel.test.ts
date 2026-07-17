import { describe, it, expect } from 'vitest';
import { sourceLabel } from '../../src/utils/sourceLabel.js';

describe('sourceLabel', () => {
  it('maps board tokens to friendly names', () => {
    expect(sourceLabel('greenhouse')).toBe('Greenhouse');
    expect(sourceLabel('ashby')).toBe('Ashby');
    expect(sourceLabel('lever')).toBe('Lever');
    expect(sourceLabel('newgrad')).toBe('New Grad list');
    expect(sourceLabel('swelist')).toBe('SWE List');
  });

  it('labels email senders as "<Sender> email"', () => {
    expect(sourceLabel('email:linkedin')).toBe('LinkedIn email');
    expect(sourceLabel('email:swelist')).toBe('SWE List email');
    expect(sourceLabel('email:jobrighteric')).toBe('Jobright email');
  });

  it('title-cases an unknown token / sender rather than showing a raw slug', () => {
    expect(sourceLabel('workable')).toBe('Workable');
    expect(sourceLabel('email:acme')).toBe('Acme email');
  });

  it('handles blank/undefined', () => {
    expect(sourceLabel('')).toBe('Unknown source');
    expect(sourceLabel(undefined)).toBe('Unknown source');
  });
});
