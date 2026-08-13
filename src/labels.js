/**
 * Label vocabularies for the annotator — the phase palettes and the gesture set.
 *
 * This module is deliberately pure (no DOM, no fetch) so the vocabularies are
 * editable in one place and the palette-merge logic is unit-testable. New ids
 * are minted by the caller (annotator.js owns the id counter), which is why
 * `mergeGesturePalette` takes a `mintId` function instead of generating ids.
 *
 * To adapt the annotator to a different task, edit PHASE_SETS / GESTURES /
 * PHASE_SET_RULES here — nothing else in the app hard-codes a label.
 * See docs/label_sets.md.
 */

/** Fallback colors for palette entries added by hand from the sidebar. */
export const PHASE_COLORS = [
  '#e94560', '#2196F3', '#4CAF50', '#FF9800',
  '#9C27B0', '#00BCD4', '#FF5722', '#795548',
  '#607D8B', '#F06292',
];

/**
 * Phase (coarse task-stage) palettes, keyed by set name.
 *
 * - `default`  — station-relay task. The four colors are the colored stations
 *   on the simulator console, plus a Preparation stage before the first pick.
 * - `suturing` — needle/suture task, labelled by the hand-motion plane and
 *   direction of the pass.
 */
export const PHASE_SETS = {
  default: [
    { label: 'Preparation', color: '#607D8B' },
    { label: 'Blue',        color: '#2196F3' },
    { label: 'Red',         color: '#F44336' },
    { label: 'Yellow',      color: '#FFC107' },
    { label: 'Green',       color: '#4CAF50' },
  ],
  suturing: [
    { label: 'Preparation',            color: '#607D8B' },
    { label: '↑←↓ H.Plane R→L',      color: '#2196F3' },
    { label: '↓→↑ H.Plane L→R',      color: '#4CAF50' },
    { label: '↓・↑ H.Plane→V.Plane', color: '#FF9800' },
    { label: '・↑ V.Plane→H.Plane',  color: '#9C27B0' },
    { label: '・←・ V.Plane R→L',     color: '#e94560' },
    { label: '・→・ V.Plane L→R',     color: '#00BCD4' },
  ],
};

/**
 * Which phase set a sequence opens with, by sequence name. First matching rule
 * wins; sequences matching nothing get PHASE_SETS.default. Rename your frame
 * sequences (or edit these patterns) to steer the initial palette — the palette
 * is editable in the sidebar afterwards either way.
 */
export const PHASE_SET_RULES = [
  { match: /(^|[_-])S\d/, set: 'suturing' },
];

/** The phase palette definition (label/color pairs) a sequence opens with. */
export function phaseSetFor(seqName) {
  const hit = PHASE_SET_RULES.find(rule => rule.match.test(seqName || ''));
  return PHASE_SETS[hit ? hit.set : 'default'];
}

/**
 * JIGSAWS standard 15 surgical gestures plus a G0 background/idle class. The
 * gesture track is pre-populated with this full set so every G category is
 * available to annotate without typing it in.
 */
export const GESTURES = [
  { label: 'G0 background / idle',                                color: '#9E9E9E' },
  { label: 'G1 Reaching for needle with right hand',              color: '#E91E63' },
  { label: 'G2 Positioning needle',                               color: '#2196F3' },
  { label: 'G3 Pushing needle through tissue',                    color: '#F44336' },
  { label: 'G4 Transferring needle from left to right',           color: '#009688' },
  { label: 'G5 Moving to center with needle in grip',             color: '#FF9800' },
  { label: 'G6 Pulling suture with left hand',                    color: '#8BC34A' },
  { label: 'G7 Pulling suture with right hand',                   color: '#CDDC39' },
  { label: 'G8 Orienting needle',                                 color: '#3F51B5' },
  { label: 'G9 Using right hand to help tighten suture',          color: '#00BCD4' },
  { label: 'G10 Loosening more suture',                           color: '#FFEB3B' },
  { label: 'G11 Dropping suture at end and moving to end points', color: '#FF5722' },
  { label: 'G12 Reaching for needle with left hand',              color: '#9C27B0' },
  { label: 'G13 Making C loop around right hand',                 color: '#673AB7' },
  { label: 'G14 Reaching for suture with right hand',             color: '#795548' },
  { label: 'G15 Pulling suture with both hands',                  color: '#4CAF50' },
];

/**
 * Leading "G<n>" token of a gesture label, or null. Used to dedupe defaults
 * against a loaded file by gesture number, tolerating label-text variants like
 * "G1 Reaching … (free)".
 */
export const gestureNum = (label) => (/^G(\d+)\b/.exec(label || '') || [])[1] ?? null;

/**
 * Build the gesture palette: one entry per GESTURES, in definition (G0→G15)
 * order. Where `loadedPhases` already carries that G number its entry is reused
 * as-is (id + label preserved, so existing annotations stay linked); otherwise a
 * fresh default entry is minted with `mintId()`. Non-G entries in the loaded
 * file (e.g. error/recovery labels) are dropped — they belong to another layer.
 */
export function mergeGesturePalette(loadedPhases, mintId) {
  const loadedByNum = new Map();
  for (const p of (loadedPhases || [])) {
    const num = gestureNum(p.label);
    if (num != null && !loadedByNum.has(num)) loadedByNum.set(num, p);
  }
  return GESTURES.map(g => {
    const loaded = loadedByNum.get(gestureNum(g.label));
    return loaded ? { ...loaded } : { id: mintId(), ...g };
  });
}
