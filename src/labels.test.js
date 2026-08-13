import { describe, it, expect } from 'vitest';
import {
  GESTURES, PHASE_SETS, gestureNum, mergeGesturePalette, phaseSetFor,
} from './labels.js';

describe('phaseSetFor', () => {
  it('falls back to the default set', () => {
    expect(phaseSetFor('CASE01')).toBe(PHASE_SETS.default);
    expect(phaseSetFor('')).toBe(PHASE_SETS.default);
    expect(phaseSetFor(null)).toBe(PHASE_SETS.default);
  });

  it('routes suturing-task names to the suturing set', () => {
    expect(phaseSetFor('E1_S1')).toBe(PHASE_SETS.suturing);
    expect(phaseSetFor('trainee-S2')).toBe(PHASE_SETS.suturing);
  });
});

describe('gestureNum', () => {
  it('reads the leading G token', () => {
    expect(gestureNum('G12 Reaching for needle with left hand')).toBe('12');
    expect(gestureNum('G1 Reaching … (free)')).toBe('1');
  });

  it('is null for non-G labels', () => {
    expect(gestureNum('Preparation')).toBeNull();
    expect(gestureNum('')).toBeNull();
    expect(gestureNum(undefined)).toBeNull();
  });
});

describe('mergeGesturePalette', () => {
  const mint = () => {
    let n = 0;
    return () => `new_${++n}`;
  };

  it('mints the full default set when nothing is loaded', () => {
    const palette = mergeGesturePalette([], mint());
    expect(palette).toHaveLength(GESTURES.length);
    expect(palette.map(p => p.label)).toEqual(GESTURES.map(g => g.label));
    expect(palette.every(p => p.id)).toBe(true);
  });

  it('reuses a loaded entry by G number, keeping its id and label', () => {
    const loaded = [{ id: 'id_7', label: 'G3 Pushing needle (variant)', color: '#000' }];
    const palette = mergeGesturePalette(loaded, mint());
    const g3 = palette.find(p => gestureNum(p.label) === '3');
    expect(g3).toEqual({ id: 'id_7', label: 'G3 Pushing needle (variant)', color: '#000' });
    expect(palette).toHaveLength(GESTURES.length);   // still topped up to the full set
  });

  it('drops non-G entries from the loaded file', () => {
    const palette = mergeGesturePalette([{ id: 'id_1', label: 'error', color: '#f00' }], mint());
    expect(palette.some(p => p.label === 'error')).toBe(false);
  });

  it('keeps numeric G0→G15 order regardless of the loaded order', () => {
    const loaded = [
      { id: 'id_9', label: 'G9 …', color: '#111' },
      { id: 'id_2', label: 'G2 …', color: '#222' },
    ];
    const palette = mergeGesturePalette(loaded, mint());
    expect(palette.map(p => gestureNum(p.label)))
      .toEqual(GESTURES.map(g => gestureNum(g.label)));
  });
});
