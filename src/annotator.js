// Timeline annotator: phase / gesture region annotation over an extracted frame
// sequence. Frames come from outputs/frames/<seq>/ (see scripts/extract_frames.py);
// exports are written back to outputs/annotations/ through the dev-server API.
// The label vocabularies live in ./labels.js.

import { PHASE_COLORS, mergeGesturePalette, phaseSetFor } from './labels.js';

// ─── State ────────────────────────────────────────────────────────────────────

let nextId = 1;
const uid = () => `id_${nextId++}`;

const undoStack = [];
const MAX_UNDO  = 50;

function pushUndo() {
  undoStack.push({
    annotations:   JSON.parse(JSON.stringify(state.annotations)),
    markStart:     state.markStart,
    markEnd:       state.markEnd,
    selectedAnnId: state.selectedAnnId,
  });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function undo() {
  if (!undoStack.length) return;
  const snap = undoStack.pop();
  state.annotations   = snap.annotations;
  state.markStart     = snap.markStart;
  state.markEnd       = snap.markEnd;
  state.selectedAnnId = snap.selectedAnnId;
  state.picking       = null;

  markStartVal.textContent = snap.markStart != null ? fmt(snap.markStart) : '—';
  markEndVal.textContent   = snap.markEnd   != null ? fmt(snap.markEnd)   : '—';
  btnMarkStart.classList.toggle('has-val', snap.markStart != null);
  btnMarkEnd.classList.toggle('has-val',   snap.markEnd   != null);

  syncFilmstripRange();
  updatePickingUI();
  updateAddBtn();
  renderAnnotations();
  renderAnnList();
  updateFilmstripBars();
  updatePlayhead();
}

function makePhases(defs) {
  return defs.map(d => ({ id: uid(), ...d }));
}

/** The gesture palette for a loaded file (or a fresh full default set). */
function makeGesturePalette(loadedPhases) {
  return mergeGesturePalette(loadedPhases, uid);
}

// Every sequence carries a gesture layer — the gesture palette is seeded from
// the full default set (labels.js GESTURES), so there is nothing task-specific
// to switch on here. Kept as a predicate so a per-sequence rule can be dropped
// in later without touching the call sites.
const hasGestureLayer = (name) => !!name;

const state = {
  duration:        0,
  markStart:       null,
  markEnd:         null,
  selectedAnnId:   null,
  phases:          makePhases(phaseSetFor('')),
  selectedPhaseId: null,
  annotations:     [],

  // Annotation mode, switched from the sidebar. 'phase' = coarse task stages;
  // 'gesture' = gesture sub-segmentation. The non-active track is shown
  // read-only in the reference lane. `tracks` holds both editable copies in
  // memory so toggling Phase<->Gesture preserves unsaved edits.
  mode:   'phase',
  tracks: { phase: null, gesture: null },   // each { phases:[], annotations:[] } | null

  // Read-only reference track (the non-editable layer). Shown as a second lane
  // below the editable lane; never exported.
  refPhases:      [],
  refAnnotations: [],
  refName:        null,

  frameSeq:    null,
  frameLayout: 'single',  // 'single' = one view; 'duo' = console/body; 'grid' = console/body/hands
  frameExt:    'jpg',     // frame file extension (meta.frame_ext)
  frameCount:  0,
  frameFps:    1,
  frameFpsNative: 1,      // source-video fps (meta.native_fps), for native frame numbers on export
  frameIndex:  0,
  frameTimer:  null,
  picking:     null,   // 'start' | 'end' | null
  speed:       1,      // playback rate multiplier
  limit:       null,   // {start,end} (sec): restrict playback/seek to a phase region
};

// name -> 'single' | 'duo' | 'grid', filled by loadFrameSeqList from /api/frame-sequences.
const seqLayouts = {};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const frameConsoleEl = document.getElementById('frame-console');
const frameHandsEl   = document.getElementById('frame-hands');
const frameFitEl     = document.getElementById('frame-fit');
const frameSeqSelect = document.getElementById('frame-seq-select');
const btnRefreshSeq  = document.getElementById('btn-refresh-seq');
const phaseListEl    = document.getElementById('phase-list');
const annListEl      = document.getElementById('ann-list');
const phaseCtrl      = document.getElementById('phase-select-ctrl');
const btnPlay        = document.getElementById('btn-play');
const btnSeekBack    = document.getElementById('btn-seek-back');
const btnSeekFwd     = document.getElementById('btn-seek-fwd');
const btnFrameBack   = document.getElementById('btn-frame-back');
const btnFrameFwd    = document.getElementById('btn-frame-fwd');
const btnMarkStart   = document.getElementById('btn-mark-start');
const btnMarkEnd     = document.getElementById('btn-mark-end');
const btnAddSeg      = document.getElementById('btn-add-seg');
const btnExport      = document.getElementById('btn-export');
const btnImport      = document.getElementById('btn-import');
const importPopover  = document.getElementById('import-popover');
const importFileList = document.getElementById('import-file-list');
const importCancel   = document.getElementById('import-cancel');
const btnAddPhase    = document.getElementById('btn-add-phase');
const timeDisplay        = document.getElementById('time-display');
const currentPhaseBadge  = document.getElementById('current-phase-badge');
const markStartVal       = document.getElementById('mark-start-val');
const markEndVal         = document.getElementById('mark-end-val');
const rulerWrap      = document.getElementById('ruler-wrap');
const rulerFill      = document.getElementById('ruler-fill');
const rulerHead      = document.getElementById('ruler-head');
const speedSelect    = document.getElementById('speed-select');
const limitSelect    = document.getElementById('limit-select');
const videoContainer = document.getElementById('video-container');
const filmstripWrap  = document.getElementById('filmstrip-wrap');
const thumbStrip     = document.getElementById('thumb-strip');
const filmstripEl    = document.getElementById('filmstrip');
const annLane        = document.getElementById('ann-lane');
const lanePlayhead   = document.getElementById('ann-lane-playhead');
const segGhost       = document.getElementById('seg-ghost');
const refLane        = document.getElementById('ref-lane');
const refLaneLabel   = document.getElementById('ref-lane-label');
const refPlayhead    = document.getElementById('ref-lane-playhead');
const gestureBadge   = document.getElementById('current-gesture-badge');
const ovlPhaseDot    = document.getElementById('ovl-phase-dot');
const ovlPhaseVal    = document.getElementById('ovl-phase-val');
const ovlPoseDot     = document.getElementById('ovl-pose-dot');
const ovlPoseVal     = document.getElementById('ovl-pose-val');
const phasePopover   = document.getElementById('phase-popover');
const popTitle       = document.getElementById('pop-title');
const popPhaseList   = document.getElementById('pop-phase-list');
const popCancel      = document.getElementById('pop-cancel');
const laneLabel      = document.getElementById('lane-label');
const modeGroup      = document.getElementById('mode-group');
const btnModePhase   = document.getElementById('btn-mode-phase');
const btnModeGesture = document.getElementById('btn-mode-gesture');
const paletteTitle   = document.getElementById('palette-title');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(secs) {
  if (!isFinite(secs)) return '0:00.0';
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

function fmtShort(secs) {
  if (!isFinite(secs) || secs == null) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// The visible time window: the active phase limit if set (timeline zooms into
// that region), else the full clip. Drives the ruler, both lanes and playhead.
function viewWindow() {
  return state.limit
    ? { lo: state.limit.start, hi: state.limit.end }
    : { lo: 0, hi: state.duration };
}

function timeToPercent(t) {
  const { lo, hi } = viewWindow();
  const span = hi - lo;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(100, ((t - lo) / span) * 100));
}

function xToTime(clientX, rect) {
  const { lo, hi } = viewWindow();
  const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return lo + frac * (hi - lo);
}

function phaseById(id) { return state.phases.find(p => p.id === id); }
function refPhaseById(id) { return state.refPhases.find(p => p.id === id); }

// ─── Playback abstraction ─────────────────────────────────────────────────────

function getCurrentTime() {
  return state.frameIndex / state.frameFps;
}

function seekTo(t) {
  // When a phase limit is active, keep the playhead inside its range.
  if (state.limit) t = Math.max(state.limit.start, Math.min(state.limit.end, t));
  const clamped = Math.max(0, Math.min(state.duration, t));
  state.frameIndex = Math.min(state.frameCount - 1,
                     Math.max(0, Math.round(clamped * state.frameFps)));
  showFrame(state.frameIndex);
  const cur = getCurrentTime();
  if (state.picking === 'start') {
    state.markStart = cur;
    markStartVal.textContent = fmt(cur);
    btnMarkStart.classList.add('has-val');
    syncFilmstripRange();
    updateAddBtn();
  } else if (state.picking === 'end') {
    state.markEnd = cur;
    markEndVal.textContent = fmt(cur);
    btnMarkEnd.classList.add('has-val');
    syncFilmstripRange();
    updateAddBtn();
  }
  updatePlayhead();
}

function togglePlay() {
  if (state.frameTimer) stopFrameLoop(); else startFrameLoop();
}

// ─── UI visibility ────────────────────────────────────────────────────────────

function applySourceUI() {
  const hasSeq = !!state.frameSeq;
  videoContainer.style.display = hasSeq ? 'none' : '';
  filmstripWrap.style.display  = hasSeq ? 'flex' : 'none';
}

function updatePickingUI() {
  filmstripWrap.classList.toggle('picking-start', state.picking === 'start');
  filmstripWrap.classList.toggle('picking-end',   state.picking === 'end');
  btnMarkStart.classList.toggle('picking', state.picking === 'start');
  btnMarkEnd.classList.toggle('picking',   state.picking === 'end');
}

// ─── Frame sequence loading ───────────────────────────────────────────────────

async function loadFrameSeqList() {
  const prev = frameSeqSelect.value;
  frameSeqSelect.innerHTML = '';
  try {
    const seqs = await fetch('/api/frame-sequences').then(r => r.json());
    seqs.forEach(({ name, layout }) => { seqLayouts[name] = layout || 'single'; });
    if (seqs.length === 0) {
      const opt = document.createElement('option');
      opt.value = ''; opt.textContent = 'No sequences — run scripts/extract_frames.py first';
      opt.disabled = true;
      frameSeqSelect.appendChild(opt);
    } else {
      const ph = document.createElement('option');
      ph.value = ''; ph.textContent = '— select frame sequence —';
      frameSeqSelect.appendChild(ph);
      seqs.forEach(({ name, phases, gestures }) => {
        const opt = document.createElement('option');
        const tags = [phases ? `phase ${phases}` : null, gestures ? `gesture ${gestures}` : null]
          .filter(Boolean).join(' · ');
        opt.value = name; opt.textContent = tags ? `${name}  —  ${tags}` : name;
        frameSeqSelect.appendChild(opt);
      });
      if (prev) frameSeqSelect.value = prev;
    }
  } catch {
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = '— server not running —'; opt.disabled = true;
    frameSeqSelect.appendChild(opt);
  }
}

frameSeqSelect.addEventListener('change', () => {
  if (frameSeqSelect.value) loadFrameSequence(frameSeqSelect.value);
});

// Re-scan outputs/frames/ without a page reload (a sequence extracted while the
// annotator was open shows up here).
btnRefreshSeq.addEventListener('click', () => loadFrameSeqList());

async function loadFrameSequence(name) {
  try {
    const meta = await fetch(
      `/outputs/frames/${encodeURIComponent(name)}/meta.json`
    ).then(r => r.json());
    state.frameSeq       = name;
    state.frameExt       = meta.frame_ext || 'jpg';   // set before any frame URL is built
    state.frameLayout    = await resolveLayout(name, meta);
    applyLayoutClass();
    applyFitAspect(meta);
    state.frameFps       = meta.fps;
    state.frameFpsNative = meta.native_fps || meta.fps;
    state.frameCount     = meta.frame_count;
    state.duration       = meta.duration;
    resetSession();
    initDefaultMarks();
    updatePickingUI();
    applySourceUI();
    showFrame(0);
    buildFilmstrip();
    buildRuler();
    renderAll();
    await autoLoadLatestAnnotation(name);
  } catch (err) {
    alert(`Could not load frame sequence "${name}": ${err.message}`);
  }
}

// A gesture export (level:"gesture", or "_gesture" in the name) is loaded into
// the gesture track instead of overwriting the phases.
const isGestureFile = (name) => /_gesture/i.test(name);

async function autoLoadLatestAnnotation(seqName) {
  try {
    const files = (await fetch('/api/annotations').then(r => r.json()))
      .filter(f => f.startsWith(seqName + '_annotations_'))
      .sort((a, b) => b.localeCompare(a));
    const phaseName = files.find(f => !isGestureFile(f));
    const gestureName = files.find(f => isGestureFile(f));
    const fetchDoc  = (n) =>
      fetch(`/outputs/annotations/${encodeURIComponent(n)}`).then(r => r.json());
    const phaseDoc   = phaseName   ? await fetchDoc(phaseName)   : null;
    const gestureDoc = gestureName ? await fetchDoc(gestureName) : null;
    bumpNextId(phaseDoc); bumpNextId(gestureDoc);

    // Phase track: the loaded phase file, else the sequence's default palette.
    state.tracks.phase = (phaseDoc && phaseDoc.level !== 'gesture')
      ? { phases: phaseDoc.phases || [], annotations: phaseDoc.annotations || [] }
      : { phases: makePhases(phaseSetFor(seqName)), annotations: [] };

    // Gesture track: a loaded gesture file (topped up with any missing default
    // gestures), else the full default gesture palette to annotate from scratch.
    state.tracks.gesture = gestureDoc
      ? { phases: makeGesturePalette(gestureDoc.phases), annotations: gestureDoc.annotations || [] }
      : (hasGestureLayer(seqName) ? { phases: makeGesturePalette([]), annotations: [] } : null);

    activateTrack('phase');   // open in phase mode; switch to gesture from the sidebar
    applyModeUI();
    renderAll();
    updateFilmstripBars();
    updatePlayhead();
  } catch {
    applyDefaultPhases(seqName);
    applyModeUI();
    renderAll();
  }
}

// Bump the id counter past any "id_<n>" in a loaded document so freshly minted
// ids (uid) never collide with imported ones.
function bumpNextId(doc) {
  for (const arr of [doc?.phases, doc?.annotations]) {
    (arr || []).forEach(x => {
      const m = /^id_(\d+)$/.exec(x?.id || '');
      if (m) nextId = Math.max(nextId, parseInt(m[1], 10) + 1);
    });
  }
}

// Persist the live editing state back into its track slot (before swapping mode).
function syncActiveTrack() {
  state.tracks[state.mode] = { phases: state.phases, annotations: state.annotations };
}

// Make `mode` the editable track; the other track becomes the read-only
// reference (context) lane. Phase and gesture are symmetric apart from which edits.
function activateTrack(mode) {
  state.mode = mode;
  const t = state.tracks[mode] || { phases: [], annotations: [] };
  state.phases          = t.phases;
  state.annotations     = t.annotations;
  state.selectedPhaseId = t.phases[0]?.id ?? null;
  state.selectedAnnId   = null;
  const other = state.tracks[mode === 'gesture' ? 'phase' : 'gesture'];
  state.refPhases      = other?.phases || [];
  state.refAnnotations = other?.annotations || [];
  state.refName        = mode === 'gesture' ? 'Phase' : 'Gesture';
}

function applyDefaultPhases(seqName) {
  state.tracks.phase = {
    phases: makePhases(phaseSetFor(seqName)),
    annotations: [],
  };
  state.tracks.gesture = hasGestureLayer(seqName)
    ? { phases: makeGesturePalette([]), annotations: [] } : null;
  activateTrack('phase');
}

// ─── Annotation-layer (Phase / Gesture) sidebar toggle ────────────────────────

function applyModeUI() {
  modeGroup.style.display = hasGestureLayer(state.frameSeq) ? '' : 'none';
  btnModePhase.classList.toggle('active-mode',   state.mode === 'phase');
  btnModeGesture.classList.toggle('active-mode', state.mode === 'gesture');
  const gesture = state.mode === 'gesture';
  if (paletteTitle) paletteTitle.textContent = gesture ? 'Gesture Palette' : 'Phase Palette';
  if (btnAddPhase)  btnAddPhase.textContent  = gesture ? '+ Add gesture'   : '+ Add phase';
  laneLabel.textContent = gesture
    ? 'Gesture — drag to create, click to select'
    : 'Phase Annotations — drag to create, click to select';

  // Keep the phase bar always on top and the gesture bar on the bottom,
  // regardless of which one is editable, so they don't jump on mode toggle.
  // The editable lane is #ann-lane (the current mode's track); #ref-lane holds
  // the other. In phase mode the editable lane is phase (top); in gesture mode
  // it's gesture (bottom).
  const editTop = !gesture;
  laneLabel.style.order    = editTop ? 1 : 3;
  annLane.style.order      = editTop ? 2 : 4;
  refLaneLabel.style.order = editTop ? 3 : 1;
  refLane.style.order      = editTop ? 4 : 2;
}

function setMode(mode) {
  if (mode === state.mode) return;
  syncActiveTrack();
  if (mode === 'gesture' && !state.tracks.gesture)
    state.tracks.gesture = { phases: makeGesturePalette([]), annotations: [] };
  activateTrack(mode);
  applyModeUI();
  renderAll();
  updateFilmstripBars();
  updatePlayhead();
}

btnModePhase.addEventListener('click',   () => setMode('phase'));
btnModeGesture.addEventListener('click', () => setMode('gesture'));

const padFrame   = (idx) => `frame_${String(idx).padStart(5, '0')}.${state.frameExt}`;
const seqBaseFor = (name) => `/outputs/frames/${encodeURIComponent(name)}`;
const seqBase    = () => seqBaseFor(state.frameSeq);

// Resolve a sequence's on-disk layout: the sequence's own meta.json wins, then
// the server's tag, then a probe of the disk (a top-level frame = single view;
// otherwise the views nest under console/, with hands/ → grid and body-only →
// duo). Probing keeps loading robust with a stale sequence list.
async function resolveLayout(name, meta) {
  if (meta?.layout) return meta.layout;
  if (seqLayouts[name]) return seqLayouts[name];
  const head = (url) => fetch(url, { method: 'HEAD' }).then(r => r.ok).catch(() => false);
  if (await head(`${seqBaseFor(name)}/${padFrame(0)}`)) return 'single';
  if (await head(`${seqBaseFor(name)}/hands/${padFrame(0)}`)) return 'grid';
  if (await head(`${seqBaseFor(name)}/body/${padFrame(0)}`)) return 'duo';
  return 'single';
}

function applyLayoutClass() {
  document.body.classList.toggle('layout-single', state.frameLayout === 'single');
  document.body.classList.toggle('layout-grid',   state.frameLayout === 'grid');
  document.body.classList.toggle('layout-duo',    state.frameLayout === 'duo');
}

// Single-view sequences size their preview box from the frame's own aspect
// ratio (meta width/height) so non-16:9 sources are not letterboxed. The
// two-view layouts keep the stacked 8:9 box from the stylesheet.
function applyFitAspect(meta) {
  frameFitEl.style.aspectRatio =
    (state.frameLayout === 'single' && meta?.width && meta?.height)
      ? `${meta.width} / ${meta.height}` : '';
}

// Thumbnail src — the whole frame for single-view sequences, the console view
// for the split layouts (the most useful scrub cue).
function thumbUrl(idx) {
  return state.frameLayout === 'single'
    ? `${seqBase()}/${padFrame(idx)}`
    : `${seqBase()}/console/${padFrame(idx)}`;
}

function setPanel(el, image, size, pos) {
  el.style.backgroundImage    = image;
  el.style.backgroundSize     = size;
  el.style.backgroundPosition = pos;
}

// Paint the preview for frame idx. Single-view sequences fill the one panel
// with the whole frame; the split layouts stack console (top) over a second
// view — hands/ for 'grid', body/ for 'duo'.
function setPanelFrame(idx) {
  const base = seqBase();
  if (state.frameLayout === 'single') {
    setPanel(frameConsoleEl, `url("${base}/${padFrame(idx)}")`, 'contain', 'center');
  } else {
    const second = state.frameLayout === 'duo' ? 'body' : 'hands';
    setPanel(frameConsoleEl, `url("${base}/console/${padFrame(idx)}")`,   'cover', 'center');
    setPanel(frameHandsEl,   `url("${base}/${second}/${padFrame(idx)}")`, 'cover', 'center');
  }
}

function showFrame(idx) {
  if (!state.frameSeq) return;
  setPanelFrame(idx);
  updateFilmstripCursor(idx);
}

// ─── Filmstrip ────────────────────────────────────────────────────────────────

function buildFilmstrip() {
  filmstripEl.innerHTML = '';
  if (!state.frameSeq || !state.frameCount) return;

  for (let i = 0; i < state.frameCount; i++) {
    const wrap = document.createElement('div');
    wrap.className   = 'thumb-wrap';
    wrap.dataset.idx = i;

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src     = thumbUrl(i);
    img.alt     = '';
    wrap.appendChild(img);

    const bar = document.createElement('div');
    bar.className = 'thumb-phase-bar';
    wrap.appendChild(bar);

    wrap.addEventListener('click', () => seekTo(i / state.frameFps));

    filmstripEl.appendChild(wrap);
  }
  updateFilmstripCursor(0);
}

function updateFilmstripCursor(idx) {
  filmstripEl.querySelectorAll('.thumb-wrap').forEach((el, i) => {
    el.classList.toggle('current', i === idx);
  });
  const current = filmstripEl.children[idx];
  if (current) {
    const stripRect = thumbStrip.getBoundingClientRect();
    const thumbRect = current.getBoundingClientRect();
    const targetScroll = thumbStrip.scrollLeft + thumbRect.left - stripRect.left
                         - (stripRect.width / 2 - thumbRect.width / 2);
    thumbStrip.scrollTo({ left: targetScroll, behavior: 'smooth' });
  }
}

function updateFilmstripBars() {
  if (!state.frameSeq) return;
  filmstripEl.querySelectorAll('.thumb-wrap').forEach((wrap, i) => {
    const t   = i / state.frameFps;
    const ann = state.annotations.find(a => t >= a.startTime && t < a.endTime);
    const bar = wrap.querySelector('.thumb-phase-bar');
    bar.style.background = ann ? (phaseById(ann.phaseId)?.color ?? '') : '';
  });
}

function updateFilmstripRange(lo, hi) {
  filmstripEl.querySelectorAll('.thumb-wrap').forEach((el, i) => {
    el.classList.toggle('in-range', i >= lo && i <= hi);
  });
}

function clearFilmstripRange() {
  filmstripEl.querySelectorAll('.thumb-wrap.in-range').forEach(el =>
    el.classList.remove('in-range'));
}

// Keep filmstrip range in sync with markStart/markEnd (called from both mouse and keyboard paths)
function syncFilmstripRange() {
  if (state.markStart === null || state.markEnd === null) { clearFilmstripRange(); return; }
  const lo = Math.round(Math.min(state.markStart, state.markEnd) * state.frameFps);
  const hi = Math.round(Math.max(state.markStart, state.markEnd) * state.frameFps);
  updateFilmstripRange(lo, Math.min(hi, state.frameCount - 1));
}

// Last playable frame: end of the active phase limit, else the last frame.
function lastPlayFrame() {
  return state.limit
    ? Math.min(state.frameCount - 1, Math.round(state.limit.end * state.frameFps))
    : state.frameCount - 1;
}

function startFrameLoop() {
  if (state.frameTimer || !state.frameSeq) return;
  // If a limit is active and the playhead is outside it, snap to its start.
  if (state.limit) {
    const lo = Math.round(state.limit.start * state.frameFps);
    if (state.frameIndex < lo || state.frameIndex >= lastPlayFrame()) {
      state.frameIndex = lo;
      setPanelFrame(state.frameIndex);
      updatePlayhead();
    }
  }
  btnPlay.textContent = '⏸';
  const ms = 1000 / (state.frameFps * state.speed);
  state.frameTimer = setInterval(() => {
    if (state.frameIndex >= lastPlayFrame()) { stopFrameLoop(); return; }
    state.frameIndex++;
    setPanelFrame(state.frameIndex);
    updatePlayhead();
    if (state.frameIndex % 5 === 0) updateFilmstripCursor(state.frameIndex);
  }, ms);
}

function stopFrameLoop() {
  clearInterval(state.frameTimer);
  state.frameTimer = null;
  btnPlay.textContent = '▶';
}

// ─── Session reset ─────────────────────────────────────────────────────────────

function resetSession() {
  state.annotations   = [];
  state.mode          = 'phase';
  state.tracks        = { phase: null, gesture: null };
  state.refPhases     = [];
  state.refAnnotations = [];
  state.refName       = null;
  state.markStart     = null;
  state.markEnd       = null;
  state.selectedAnnId = null;
  state.frameIndex    = 0;
  state.picking       = null;
  state.limit         = null;
  if (limitSelect) limitSelect.value = '';
  stopFrameLoop();
  clearMarks();
}

function initDefaultMarks() {
  state.markStart = 0;
  markStartVal.textContent = fmt(0);
  btnMarkStart.classList.add('has-val');
  state.picking = 'end';
  updateAddBtn();
}

// ─── Ruler & playhead ─────────────────────────────────────────────────────────

function buildRuler() {
  rulerWrap.querySelectorAll('.ruler-tick').forEach(el => el.remove());
  if (!state.duration) return;
  const { lo, hi } = viewWindow();
  const span = hi - lo;
  if (span <= 0) return;
  const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const interval = candidates.find(c => span / c <= 12) || 300;
  for (let t = Math.ceil(lo / interval) * interval; t <= hi + 1e-6; t += interval) {
    const tick = document.createElement('div');
    tick.className = 'ruler-tick';
    tick.style.left = `${timeToPercent(t)}%`;
    tick.textContent = fmtShort(t);
    rulerWrap.appendChild(tick);
  }
}

function updatePlayhead() {
  const t   = getCurrentTime();
  const pct = timeToPercent(t);
  rulerFill.style.width   = `${pct}%`;
  rulerHead.style.left    = `${pct}%`;
  lanePlayhead.style.left = `${pct}%`;
  refPlayhead.style.left  = `${pct}%`;
  timeDisplay.textContent =
    `${fmt(t)} / ${fmt(state.duration)}  [${state.frameIndex + 1}/${state.frameCount}]`;

  // PHASE overlay always reflects the phase track and the second row the gesture
  // track, independent of which one is currently editable (in gesture mode the
  // phase track lives in the reference lane, and vice-versa).
  const editing = { anns: state.annotations,    byId: phaseById };
  const refTrk  = { anns: state.refAnnotations, byId: refPhaseById };
  const phaseTrk   = state.mode === 'gesture' ? refTrk : editing;
  const gestureTrk = state.mode === 'gesture' ? editing : refTrk;

  const pa = phaseTrk.anns.find(a => t >= a.startTime && t < a.endTime);
  const pp = pa ? phaseTrk.byId(pa.phaseId) : null;
  setBadge(currentPhaseBadge, pp?.label ?? pa?.label, pp?.color ?? pa?.color);
  setOverlay(ovlPhaseDot, ovlPhaseVal, pp?.label ?? pa?.label, pp?.color ?? pa?.color);

  if (gestureTrk.anns.length) {
    const g  = gestureTrk.anns.find(a => t >= a.startTime && t < a.endTime);
    const gp = g ? gestureTrk.byId(g.phaseId) : null;
    gestureBadge.style.display = '';
    setBadge(gestureBadge, gp?.label ?? g?.label, gp?.color ?? g?.color);
    setOverlay(ovlPoseDot, ovlPoseVal, gp?.label ?? g?.label, gp?.color ?? g?.color);
  } else {
    gestureBadge.style.display = 'none';
    setOverlay(ovlPoseDot, ovlPoseVal, null, null);
  }
}

// Update one on-frame overlay row (colored dot + label) over the video.
function setOverlay(dot, val, label, color) {
  val.textContent = label || '—';
  dot.style.background = label ? (color || '#888') : '#888';
}

function setBadge(el, label, color) {
  if (label) {
    el.textContent        = label;
    el.style.background    = color || '#888';
    el.style.borderColor   = color || '#888';
    el.style.color         = '#fff';
  } else {
    el.textContent        = '—';
    el.style.background    = 'transparent';
    el.style.borderColor   = '#ddd';
    el.style.color         = '#bbb';
  }
}

rulerWrap.addEventListener('click', (e) => {
  if (!state.duration) return;
  seekTo(xToTime(e.clientX, rulerWrap.getBoundingClientRect()));
});

// ─── Playback controls ────────────────────────────────────────────────────────

btnPlay.addEventListener('click', togglePlay);
btnSeekBack.addEventListener('click',  () => seekTo(getCurrentTime() - 5));
btnSeekFwd.addEventListener('click',   () => seekTo(getCurrentTime() + 5));
btnFrameBack.addEventListener('click', () => seekTo(getCurrentTime() - 1 / state.frameFps));
btnFrameFwd.addEventListener('click',  () => seekTo(getCurrentTime() + 1 / state.frameFps));

// ─── Playback speed ───────────────────────────────────────────────────────────

speedSelect.addEventListener('change', () => {
  state.speed = parseFloat(speedSelect.value) || 1;
  if (state.frameTimer) { stopFrameLoop(); startFrameLoop(); }   // apply live
});

// ─── Limit playback to a phase region ─────────────────────────────────────────
// The phase track regardless of edit mode (in gesture mode it's the reference).

function getPhaseTrack() {
  return state.mode === 'phase'
    ? { phases: state.phases, annotations: state.annotations }
    : (state.tracks.phase || { phases: [], annotations: [] });
}

// Fill the limit dropdown from the phase regions (sorted by start time).
function populateLimitSelect() {
  const prev = limitSelect.value;
  const { phases, annotations } = getPhaseTrack();
  limitSelect.innerHTML = '<option value="">Limit: all</option>';
  [...annotations].sort((a, b) => a.startTime - b.startTime).forEach(a => {
    const label = phases.find(p => p.id === a.phaseId)?.label ?? a.label ?? '?';
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = `▸ ${label}  ${fmtShort(a.startTime)}–${fmtShort(a.endTime)}`;
    limitSelect.appendChild(opt);
  });
  if (prev && [...limitSelect.options].some(o => o.value === prev)) {
    limitSelect.value = prev;
  } else if (state.limit) {
    state.limit = null;            // selected region no longer exists
    applyLimitView();
  }
}

// Rebuild the timeline for the current window: the ruler, both lanes and the
// playhead all zoom into the active phase limit (or back to the full clip).
function applyLimitView() {
  buildRuler();
  renderAnnotations();
  renderRefAnnotations();
  updateFilmstripBars();
  updatePlayhead();
}

// Context padding (sec) shown on each side of the limited phase region, so a
// little of the adjacent phases is visible/playable around it.
const LIMIT_PAD_SEC = 5;

limitSelect.addEventListener('change', () => {
  const id = limitSelect.value;
  if (!id) {
    state.limit = null;
  } else {
    const a = getPhaseTrack().annotations.find(x => x.id === id);
    state.limit = a ? {
      start: Math.max(0, a.startTime - LIMIT_PAD_SEC),
      end:   Math.min(state.duration, a.endTime + LIMIT_PAD_SEC),
    } : null;
  }
  if (state.limit) seekTo(state.limit.start);
  applyLimitView();
  if (state.frameTimer) { stopFrameLoop(); startFrameLoop(); }
});

// ─── Mark start / end ─────────────────────────────────────────────────────────

btnMarkStart.addEventListener('click', () => {
  if (state.picking === 'start') { state.picking = 'end'; }
  else                           { state.picking = 'start'; markStart(); }
  updatePickingUI();
});
btnMarkEnd.addEventListener('click', () => {
  if (state.picking === 'end') { state.picking = null; }
  else                         { state.picking = 'end'; markEnd(); }
  updatePickingUI();
});

function markStart() {
  state.markStart = getCurrentTime();
  markStartVal.textContent = fmt(state.markStart);
  btnMarkStart.classList.add('has-val');
  syncFilmstripRange();
  updateAddBtn();
}

function markEnd() {
  state.markEnd = getCurrentTime();
  markEndVal.textContent = fmt(state.markEnd);
  btnMarkEnd.classList.add('has-val');
  syncFilmstripRange();
  updateAddBtn();
}

function clearMarks() {
  state.markStart = null;
  state.markEnd   = null;
  markStartVal.textContent = '—';
  markEndVal.textContent   = '—';
  btnMarkStart.classList.remove('has-val');
  btnMarkEnd.classList.remove('has-val');
  clearFilmstripRange();
  updateAddBtn();
}

function updateAddBtn() {
  // Note: a selected palette entry is not required — if the palette is empty
  // (e.g. every entry was deleted) ensureSelectedPhase() creates one.
  btnAddSeg.disabled = !(
    state.markStart != null &&
    state.markEnd   != null &&
    Math.abs(state.markEnd - state.markStart) > 0.05
  );
}

// Return a valid selected palette id, creating a first entry if the palette is
// empty (so segments can be added before any gesture/phase has been defined).
function ensureSelectedPhase() {
  if (state.selectedPhaseId && phaseById(state.selectedPhaseId)) return state.selectedPhaseId;
  if (state.phases.length) { state.selectedPhaseId = state.phases[0].id; }
  else {
    const kind = state.mode === 'gesture' ? 'Gesture' : 'Phase';
    state.phases.push({ id: uid(), label: `${kind} 1`, color: PHASE_COLORS[0] });
    state.selectedPhaseId = state.phases[0].id;
  }
  renderPhasePalette();
  return state.selectedPhaseId;
}

btnAddSeg.addEventListener('click', () => {
  if (btnAddSeg.disabled) return;
  const lo = Math.min(state.markStart, state.markEnd);
  const hi = Math.max(state.markStart, state.markEnd);
  addAnnotation(ensureSelectedPhase(), lo, hi);
  // Advance: new start = segment end, await new end
  state.markStart = hi;
  markStartVal.textContent = fmt(hi);
  btnMarkStart.classList.add('has-val');
  state.markEnd = null;
  markEndVal.textContent = '—';
  btnMarkEnd.classList.remove('has-val');
  clearFilmstripRange();
  state.picking = 'end';
  updatePickingUI();
  updateAddBtn();
});

// ─── Annotations (CRUD) ───────────────────────────────────────────────────────

function addAnnotation(phaseId, startTime, endTime) {
  pushUndo();
  const ann = { id: uid(), phaseId, startTime, endTime };
  state.annotations.push(ann);
  state.annotations.sort((a, b) => a.startTime - b.startTime);
  state.selectedAnnId = ann.id;
  renderAnnotations();
  renderAnnList();
  populateLimitSelect();   // the new region is immediately selectable as a limit
  updateFilmstripBars();
  updatePlayhead();
}

function deleteAnnotation(id) {
  pushUndo();
  state.annotations = state.annotations.filter(a => a.id !== id);
  if (state.selectedAnnId === id) state.selectedAnnId = null;
  renderAnnotations();
  renderAnnList();
  populateLimitSelect();   // drops the region from the limit list (and clears an active one)
  updateFilmstripBars();
}

// ─── Annotation lane rendering ────────────────────────────────────────────────

function renderAnnotations() {
  annLane.querySelectorAll('.seg').forEach(el => el.remove());
  state.annotations.forEach(ann => {
    const phase = phaseById(ann.phaseId);
    if (!phase) return;
    const seg = document.createElement('div');
    seg.className    = 'seg' + (ann.id === state.selectedAnnId ? ' selected' : '');
    seg.style.background = phase.color;
    seg.style.left   = `${timeToPercent(ann.startTime)}%`;
    seg.style.width  = `${timeToPercent(ann.endTime) - timeToPercent(ann.startTime)}%`;
    seg.title = `${phase.label}  ${fmtShort(ann.startTime)} – ${fmtShort(ann.endTime)}`;

    const label = document.createElement('span');
    label.className   = 'seg-label';
    label.textContent = phase.label;
    seg.appendChild(label);

    const delBtn = document.createElement('button');
    delBtn.className   = 'seg-del';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteAnnotation(ann.id); });
    seg.appendChild(delBtn);

    seg.addEventListener('click', (e) => {
      e.stopPropagation();
      state.selectedAnnId = ann.id;
      seekTo(ann.startTime);
      renderAnnotations();
      renderAnnList();
      if (state.phases.length) showRelabelPopover(e.clientX, e.clientY, ann);
    });
    seg.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; seg.classList.add('drop-target'); });
    seg.addEventListener('dragleave', () => seg.classList.remove('drop-target'));
    seg.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      seg.classList.remove('drop-target');
      const pid = e.dataTransfer.getData('phaseId');
      if (!pid || !phaseById(pid)) return;
      pushUndo();
      ann.phaseId = pid;
      renderAnnotations(); renderAnnList(); updateFilmstripBars(); updatePlayhead();
    });
    annLane.appendChild(seg);
  });
}

annLane.addEventListener('click', (e) => {
  if (e.target === annLane || e.target === lanePlayhead || e.target === segGhost) {
    state.selectedAnnId = null;
    renderAnnotations();
    renderAnnList();
  }
});

// ─── Reference lane (read-only: the non-editable annotation layer) ────────────

function renderRefAnnotations() {
  // Always show the reference lane once a sequence is loaded, so both the
  // editable and the read-only annotation bars stay visible (2 bars). The
  // reference track may be empty (e.g. an unstarted gesture layer).
  const show = !!state.frameSeq;
  refLane.style.display      = show ? '' : 'none';
  refLaneLabel.style.display = show ? '' : 'none';
  refLane.querySelectorAll('.seg').forEach(el => el.remove());
  if (!show) return;

  const refLabel = state.refName || 'Reference';
  refLaneLabel.textContent = state.refAnnotations.length
    ? `${refLabel} — read-only (click a segment to seek)`
    : `${refLabel} — read-only (empty)`;

  state.refAnnotations.forEach(ann => {
    const phase = refPhaseById(ann.phaseId);
    const color = phase?.color ?? ann.color ?? '#9E9E9E';
    const label = phase?.label ?? ann.label ?? '?';
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.style.background = color;
    seg.style.left  = `${timeToPercent(ann.startTime)}%`;
    seg.style.width = `${timeToPercent(ann.endTime) - timeToPercent(ann.startTime)}%`;
    seg.title = `${label}  ${fmtShort(ann.startTime)} – ${fmtShort(ann.endTime)}`;

    const lab = document.createElement('span');
    lab.className   = 'seg-label';
    lab.textContent = label;
    seg.appendChild(lab);

    seg.addEventListener('click', (e) => { e.stopPropagation(); seekTo(ann.startTime); });
    refLane.appendChild(seg);
  });
}

// ─── Drag-to-create on annotation lane ───────────────────────────────────────

let dragState = null;

annLane.addEventListener('mousedown', (e) => {
  if (e.target !== annLane && e.target !== segGhost) return;
  if (!state.duration) return;
  const rect = annLane.getBoundingClientRect();
  dragState = { startTime: xToTime(e.clientX, rect), rect };
  segGhost.style.display    = 'block';
  segGhost.style.left       = `${timeToPercent(dragState.startTime)}%`;
  segGhost.style.width      = '0%';
  const ap = phaseById(state.selectedPhaseId);
  segGhost.style.background = ap ? ap.color : '#999';
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!dragState) return;
  const cur   = xToTime(e.clientX, dragState.rect);
  const start = Math.min(dragState.startTime, cur);
  const end   = Math.max(dragState.startTime, cur);
  segGhost.style.left  = `${timeToPercent(start)}%`;
  segGhost.style.width = `${timeToPercent(end) - timeToPercent(start)}%`;
});

document.addEventListener('mouseup', (e) => {
  if (!dragState) return;
  const endTime = xToTime(e.clientX, dragState.rect);
  const start   = Math.min(dragState.startTime, endTime);
  const end     = Math.max(dragState.startTime, endTime);
  dragState = null;
  segGhost.style.display = 'none';
  const { lo, hi } = viewWindow();   // min span relative to the visible window (so short gestures register)
  if (end - start < (hi - lo) * 0.005) return;
  if (state.selectedPhaseId && phaseById(state.selectedPhaseId)) {
    addAnnotation(state.selectedPhaseId, start, end);
  } else if (state.phases.length) {
    showPopover(e.clientX, e.clientY, start, end);
  } else {
    addAnnotation(ensureSelectedPhase(), start, end);   // empty palette: auto-create
  }
});

// ─── Phase popover ────────────────────────────────────────────────────────────

// Open the phase popover at (x, y) with a list of phase buttons. `title` labels
// the popover; `activeId` highlights the current phase; `onPick(ph)` runs when a
// phase button is clicked.
function openPhasePopover(x, y, title, activeId, onPick) {
  popTitle.textContent   = title;
  popPhaseList.innerHTML = '';
  state.phases.forEach(ph => {
    const btn = document.createElement('button');
    btn.className = 'pop-phase-btn' + (ph.id === activeId ? ' active' : '');
    btn.innerHTML = `<span class="pop-phase-dot" style="background:${ph.color}"></span>${ph.label}`;
    btn.addEventListener('click', () => { onPick(ph); hidePopover(); });
    popPhaseList.appendChild(btn);
  });
  phasePopover.style.display = 'block';
  phasePopover.style.left    = `${x + 8}px`;
  phasePopover.style.top     = `${y + 8}px`;
  requestAnimationFrame(() => {
    const r = phasePopover.getBoundingClientRect();
    if (r.right  > window.innerWidth)  phasePopover.style.left = `${x - r.width - 8}px`;
    if (r.bottom > window.innerHeight) phasePopover.style.top  = `${y - r.height - 8}px`;
  });
}

// Pick a phase for a freshly drag-created segment.
function showPopover(x, y, startTime, endTime) {
  openPhasePopover(x, y, 'Assign phase', null, ph => addAnnotation(ph.id, startTime, endTime));
}

// Change the label of an existing segment in place.
function showRelabelPopover(x, y, ann) {
  openPhasePopover(x, y, 'Change label', ann.phaseId, ph => {
    if (ph.id === ann.phaseId) return;
    pushUndo();
    ann.phaseId = ph.id;
    renderAnnotations(); renderAnnList(); updateFilmstripBars(); updatePlayhead();
  });
}

function hidePopover() { phasePopover.style.display = 'none'; }
popCancel.addEventListener('click', hidePopover);
document.addEventListener('click', (e) => { if (!phasePopover.contains(e.target)) hidePopover(); });

// ─── Phase palette ────────────────────────────────────────────────────────────

function renderPhasePalette() {
  if (!state.selectedPhaseId && state.phases.length)
    state.selectedPhaseId = state.phases[0].id;

  phaseListEl.innerHTML = '';
  phaseCtrl.innerHTML   = '<option value="">— phase —</option>';

  state.phases.forEach(ph => {
    const item = document.createElement('div');
    item.className = 'phase-item' + (ph.id === state.selectedPhaseId ? ' active' : '');
    item.innerHTML = `
      <span class="phase-swatch" style="background:${ph.color}"></span>
      <span class="phase-label" title="double-click to rename">${ph.label}</span>
      <span class="phase-del" title="delete">✕</span>`;
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('phase-del')) return;
      state.selectedPhaseId = ph.id;
      renderPhasePalette();
      updateAddBtn();
    });
    item.setAttribute('draggable', 'true');
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('phaseId', ph.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    const lbl = item.querySelector('.phase-label');
    lbl.addEventListener('dblclick', () => {
      lbl.contentEditable = 'true'; lbl.focus();
      window.getSelection().selectAllChildren(lbl);
    });
    lbl.addEventListener('blur', () => {
      lbl.contentEditable = 'false';
      ph.label = lbl.textContent.trim() || ph.label;
      renderPhasePalette(); renderAnnotations(); renderAnnList();
    });
    lbl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); lbl.blur(); }
    });
    item.querySelector('.phase-del').addEventListener('click', () => {
      state.phases      = state.phases.filter(p => p.id !== ph.id);
      state.annotations = state.annotations.filter(a => a.phaseId !== ph.id);
      if (state.selectedPhaseId === ph.id) state.selectedPhaseId = null;
      renderAll();
    });
    phaseListEl.appendChild(item);

    const opt = document.createElement('option');
    opt.value = ph.id; opt.textContent = ph.label;
    phaseCtrl.appendChild(opt);
  });

  if (state.selectedPhaseId) phaseCtrl.value = state.selectedPhaseId;
}

phaseCtrl.addEventListener('change', () => {
  state.selectedPhaseId = phaseCtrl.value || null;
  renderPhasePalette(); updateAddBtn();
});

btnAddPhase.addEventListener('click', () => {
  const color = PHASE_COLORS[state.phases.length % PHASE_COLORS.length];
  const kind = state.mode === 'gesture' ? 'Gesture' : 'Phase';
  const ph = { id: uid(), label: `${kind} ${state.phases.length + 1}`, color };
  state.phases.push(ph);
  state.selectedPhaseId = ph.id;
  renderPhasePalette(); updateAddBtn();
  const items = phaseListEl.querySelectorAll('.phase-item');
  const lbl   = items[items.length - 1]?.querySelector('.phase-label');
  if (lbl) { lbl.contentEditable = 'true'; lbl.focus(); window.getSelection().selectAllChildren(lbl); }
});

// ─── Annotation sidebar list ──────────────────────────────────────────────────

function renderAnnList() {
  annListEl.innerHTML = '';
  if (!state.annotations.length) {
    annListEl.innerHTML = '<div style="font-size:11px;color:#bbb;padding:4px 0">No annotations yet.</div>';
    return;
  }
  state.annotations.forEach(ann => {
    const phase = phaseById(ann.phaseId);
    const item  = document.createElement('div');
    item.className = 'ann-item' + (ann.id === state.selectedAnnId ? ' selected' : '');
    item.innerHTML = `
      <span class="ann-swatch" style="background:${phase?.color ?? '#ccc'}"></span>
      <span class="ann-times">${fmtShort(ann.startTime)}–${fmtShort(ann.endTime)}</span>
      <span style="font-size:11px;color:#555;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${phase?.label ?? '?'}</span>
      <span class="ann-del">✕</span>`;
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('ann-del')) return;
      state.selectedAnnId = ann.id;
      seekTo(ann.startTime);
      renderAnnotations(); renderAnnList();
    });
    item.querySelector('.ann-del').addEventListener('click', () => deleteAnnotation(ann.id));
    item.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; item.classList.add('drop-target'); });
    item.addEventListener('dragleave', () => item.classList.remove('drop-target'));
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drop-target');
      const pid = e.dataTransfer.getData('phaseId');
      if (!pid || !phaseById(pid)) return;
      pushUndo();
      ann.phaseId = pid;
      renderAnnotations(); renderAnnList(); updateFilmstripBars(); updatePlayhead();
    });
    annListEl.appendChild(item);
  });
}

// ─── Render all ───────────────────────────────────────────────────────────────

function renderAll() {
  renderPhasePalette();
  renderAnnotations();
  renderRefAnnotations();
  renderAnnList();
  populateLimitSelect();
  updateAddBtn();
}

// ─── Export ───────────────────────────────────────────────────────────────────

function exportTimestamp() {
  return new Date().toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, '');
}

// In gesture mode, tag each gesture segment with the phase region it falls in
// (the phase track lives in the reference lane). Falls back to a seeded value.
function parentPhaseAt(a) {
  if (a.parentPhaseLabel) return a.parentPhaseLabel;
  const mid = (a.startTime + a.endTime) / 2;
  const r = state.refAnnotations.find(x => mid >= x.startTime && mid < x.endTime);
  return r ? (refPhaseById(r.phaseId)?.label ?? r.label ?? null) : null;
}

btnExport.addEventListener('click', async () => {
  const ts      = exportTimestamp();
  const gesture = state.mode === 'gesture';
  // Gesture annotations are a separate gesture-level file (level:"gesture",
  // "_gesture" in the name) so they load back into the dedicated lane.
  const filename = (state.frameSeq || 'annotations')
    + `_annotations_${ts}${gesture ? '_gesture' : ''}.json`;
  const data = {
    source:      'frames',
    file:        state.frameSeq,
    duration:    state.duration,
    fps:         state.frameFps,
    native_fps:  state.frameFpsNative,
    frame_count: state.frameCount,
    ...(gesture ? { level: 'gesture' } : {}),
    phases:      state.phases,
    annotations: state.annotations.map(a => {
      const out = {
        id:         a.id,
        phaseId:    a.phaseId,
        label:      phaseById(a.phaseId)?.label ?? '',
        startTime:  +a.startTime.toFixed(3),
        endTime:    +a.endTime.toFixed(3),
        startFrame: Math.round(a.startTime * state.frameFps),
        endFrame:   Math.round(a.endTime   * state.frameFps),
        // Frame numbers in the SOURCE video, so a segment can be cut from the
        // original media without knowing the extraction fps.
        startFrameNative: Math.round(a.startTime * state.frameFpsNative),
        endFrameNative:   Math.round(a.endTime   * state.frameFpsNative),
      };
      if (gesture) {
        const pl = parentPhaseAt(a);
        if (pl) out.parentPhaseLabel = pl;
      }
      return out;
    }),
  };
  try {
    const resp = await fetch(`/api/annotations/${encodeURIComponent(filename)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data, null, 2),
    });
    if (!resp.ok) throw new Error(await resp.text());
    const orig = btnExport.textContent;
    btnExport.textContent = 'Saved ✓';
    setTimeout(() => { btnExport.textContent = orig; }, 2000);
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
});

// ─── Import popover ───────────────────────────────────────────────────────────

async function loadAnnotationFile(file) {
  const data = await fetch(`/outputs/annotations/${encodeURIComponent(file)}`).then(r => r.json());
  // Switch to the file's sequence first (autoLoad sets up both tracks fresh).
  if (data.file && state.frameSeq !== data.file) {
    frameSeqSelect.value = data.file;
    if (frameSeqSelect.value === data.file) await loadFrameSequence(data.file);
  }
  bumpNextId(data);
  const track = { phases: data.phases || [], annotations: data.annotations || [] };
  const isGesture = isGestureFile(file) || data.level === 'gesture';
  if (isGesture) state.tracks.gesture = track;
  else           state.tracks.phase = track;
  // Re-activate to refresh the editable track and the reference lane. A gesture
  // file opens gesture mode; a phase file keeps the current mode.
  activateTrack(isGesture && hasGestureLayer(state.frameSeq) ? 'gesture' : state.mode);
  applyModeUI();
  renderAll();
  updateFilmstripBars();
  updatePlayhead();
}

btnImport.addEventListener('click', async () => {
  importFileList.innerHTML = '<div style="font-size:11px;color:#bbb;padding:4px 0">Loading…</div>';
  showImportPopover();
  try {
    const files = await fetch('/api/annotations').then(r => r.json());
    // Newest first (ISO timestamp in name → lexicographic desc = chronological desc)
    files.sort((a, b) => b.localeCompare(a));
    importFileList.innerHTML = '';
    if (!files.length) {
      importFileList.innerHTML =
        '<div style="font-size:11px;color:#bbb;padding:4px 0">No saved annotations yet.</div>';
      return;
    }

    // Auto-load latest silently; popover stays open so user can pick an older one
    try { await loadAnnotationFile(files[0]); } catch { /* ignore silent fail */ }

    files.forEach((file, idx) => {
      const btn = document.createElement('button');
      btn.className   = 'pop-phase-btn';
      btn.textContent = file;
      if (idx === 0) btn.style.fontWeight = '600';
      btn.addEventListener('click', async () => {
        try { await loadAnnotationFile(file); }
        catch (err) { alert('Failed to load: ' + err.message); }
        hideImportPopover();
      });
      importFileList.appendChild(btn);
    });
  } catch {
    importFileList.innerHTML =
      '<div style="font-size:11px;color:#bbb;padding:4px 0">Server not available.</div>';
  }
});

function showImportPopover() {
  const r = btnImport.getBoundingClientRect();
  importPopover.style.display = 'block';
  importPopover.style.left    = `${r.left}px`;
  importPopover.style.top     = `${r.top - 8}px`;
  requestAnimationFrame(() => {
    const pr = importPopover.getBoundingClientRect();
    importPopover.style.top = `${r.top - pr.height - 4}px`;
  });
}
function hideImportPopover() { importPopover.style.display = 'none'; }
importCancel.addEventListener('click', hideImportPopover);
document.addEventListener('click', (e) => {
  if (!importPopover.contains(e.target) && e.target !== btnImport) hideImportPopover();
});

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (document.activeElement?.contentEditable === 'true') return;

  const step = 1 / state.frameFps;

  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault(); undo(); return;
  }

  switch (e.key) {
    case ' ':         e.preventDefault(); togglePlay(); break;
    case 'ArrowLeft':
      e.preventDefault();
      seekTo(getCurrentTime() - (e.shiftKey ? 5 : step));
      break;
    case 'ArrowRight':
      e.preventDefault();
      seekTo(getCurrentTime() + (e.shiftKey ? 5 : step));
      break;
    case 's': case 'S':
      if (state.picking === 'start') { state.picking = 'end'; }
      else                           { state.picking = 'start'; markStart(); }
      updatePickingUI(); break;
    case 'e': case 'E':
      if (state.picking === 'end') { state.picking = null; }
      else                         { state.picking = 'end'; markEnd(); }
      updatePickingUI(); break;
    case 'a': case 'A': if (!btnAddSeg.disabled) btnAddSeg.click(); break;
    case 'Delete': case 'Backspace':
      if (state.selectedAnnId) { e.preventDefault(); deleteAnnotation(state.selectedAnnId); }
      break;
    case 'Escape':
      if (state.picking) { state.picking = null; updatePickingUI(); }
      else { clearMarks(); hidePopover(); state.selectedAnnId = null; renderAnnotations(); renderAnnList(); }
      break;
  }
});

// ─── Sidebar resize ───────────────────────────────────────────────────────────
// Drag the handle between the sidebar and content to change the sidebar width;
// the chosen width persists in localStorage.

const sidebarEl     = document.getElementById('sidebar');
const sidebarResizer = document.getElementById('sidebar-resizer');
const SIDEBAR_MIN = 160, SIDEBAR_MAX = 600;

(function initSidebarResize() {
  const saved = localStorage.getItem('annotatorSidebarW');
  if (saved) sidebarEl.style.width = saved;
  let dragging = false;
  sidebarResizer.addEventListener('mousedown', (e) => {
    dragging = true;
    sidebarResizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX,
      e.clientX - sidebarEl.getBoundingClientRect().left));
    sidebarEl.style.width = `${w}px`;
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    sidebarResizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem('annotatorSidebarW', sidebarEl.style.width);
  });
})();

// ─── Init ─────────────────────────────────────────────────────────────────────

applyLayoutClass();
loadFrameSeqList();
applySourceUI();
renderAll();
