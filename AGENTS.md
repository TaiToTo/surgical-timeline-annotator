# AGENTS.md

Router for AI coding assistants (Claude Code, GitHub Copilot, …) working in this
repo. This file holds the repo map, the setup flow to run when new material
arrives, the universal rules, and a dispatch table. Anything task-specific lives
in the doc the dispatch table points to — go there first before doing real work.

---

## What this repo is

A standalone **timeline annotator**: a browser tool for labelling time regions of
a surgical video on two layers — **Phase** (coarse task stages) and **Gesture**
(JIGSAWS-style sub-segmentation). It is a Vite dev server plus a handful of
stdlib-only Python scripts; there is no backend, no database and no model. The
filesystem is the store: frames under `outputs/frames/`, exported labels under
`outputs/annotations/`.

It was extracted from the `endo_3d_verbalization` research workbench, where the
same annotator lived inside a larger Three.js viewer. The label vocabularies came
across unchanged; the video material and the annotations did not.

It is a **public MIT-licensed repository**, so assume a reader who has never seen
the research workbench: changes that alter setup or usage belong in both
`README.md` (English) and `README.ja.md` (Japanese). The app has no hosted demo —
frame listing, frame serving and annotation saving are all dev-server middleware
in [vite.config.js](vite.config.js), so a static build of `index.html` alone is
not a working annotator. Do not describe one as if it were.

---

## Folder layout

```
timeline_annotator/
├── AGENTS.md               # This file (CLAUDE.md is a symlink to it)
├── README.md               # Human quickstart (English) — README.ja.md is the
├── README.ja.md            #   Japanese version; keep the two in sync
├── LICENSE                 # MIT
├── .github/workflows/ci.yml# npm test on Node 18/20/22 + Python script smoke test
├── index.html              # The annotator page (the only page)
├── package.json            # vite + vitest only — no runtime dependencies
├── vite.config.js          # Dev server: /api/frame-sequences, /api/annotations, /outputs/*
├── vitest.config.js
├── src/
│   ├── annotator.js        # The whole app (state, playback, lanes, export/import)
│   ├── labels.js           # Phase palettes + gesture set (pure, unit-tested)
│   ├── labels.test.js
│   └── styles/annotator.css
├── scripts/                # Frame preparation (stdlib + ffmpeg, no pip installs)
│   ├── frameseq.py         #   Shared helpers + the meta.json contract
│   ├── extract_frames.py   #   Video  → outputs/frames/<seq>/
│   ├── index_frames.py     #   Images → outputs/frames/<seq>/  (link or copy)
│   └── check_sequences.py  #   Preflight: is every sequence loadable?
├── docs/
│   ├── annotator_spec.md   # UI, data model, exported JSON schema
│   ├── frame_preparation.md# Layouts, meta.json, which script for which input
│   └── label_sets.md       # The phase / gesture vocabularies and how to change them
├── data/videos/            # Drop input videos here (gitignored)
└── outputs/
    ├── frames/             # Extracted frame sequences (gitignored)
    └── annotations/        # Exported label JSON — the deliverable, committed
```

---

## Setup flow — run this when new material appears

The intended entry point: someone clones the repo, drops videos or frame images
in, and asks for annotation to be set up. Work through these steps.

1. **Find the material.** Look in `data/videos/` (videos) and anywhere the user
   named (image directories). If nothing is there, ask where it is instead of
   guessing.
2. **Identify the source shape** by opening one frame (or `ffprobe` the video):
   - one camera view filling the frame → `single`
   - two views side by side → `duo` (left = console, right = body)
   - a 2×2 composite → `grid` (top-left = console, top-right = body,
     bottom-left = hands; bottom-right is ignored)
3. **Prepare the sequence.**
   - Video: `python scripts/extract_frames.py --layout <shape> --fps 5`
     (`--fps` is the annotation time resolution; `--fps 0` keeps the native rate.
     Add `--video PATH=STEM` to select/rename specific inputs.)
   - Images: `python scripts/index_frames.py <dir> --name <SEQ> --fps <fps>`
     (add `--native-fps` when the images were sampled from a video at a
     different rate).
4. **Verify:** `python scripts/check_sequences.py` — it must report every
   sequence `ok`. Do not proceed past a `FAIL`; fix the input instead.
5. **Check the vocabulary** in [src/labels.js](src/labels.js) against the task at
   hand ([docs/label_sets.md](docs/label_sets.md)). If the phases don't fit the
   new material, edit `PHASE_SETS` / `PHASE_SET_RULES` — do not leave a
   mismatched palette for the annotator to work around by hand.
6. **Start it:** `npm install` (first run only) then `npm run dev`, and tell the
   user the URL (`http://localhost:5180`) plus which sequences are ready.

Annotation itself is manual — this repo has no auto-labelling. The tool's job is
to make a human's segment boundaries fast and reproducible.

---

## Conventions

- **Fail closed.** A script that cannot verify an invariant (view frame counts
  equal, fps known, frame naming contiguous) must exit with the reason. Never
  write a `meta.json` you could not verify — a wrong fps silently mis-times every
  annotation downstream.
- **meta.json is the contract** between the preparation scripts and the app.
  Change its shape in [scripts/frameseq.py](scripts/frameseq.py) and in
  `loadFrameSequence` (annotator.js) together, and update
  [docs/frame_preparation.md](docs/frame_preparation.md) in the same change.
- **No new runtime dependencies.** The page ships no npm dependencies (vite and
  vitest are dev-only) and the scripts are stdlib + `ffmpeg`/`ffprobe`. Adding
  one needs a reason in the PR description.
- **Comments and docstrings in English**, Google-style docstrings in Python.
  Say what the code does and why, not what it once did.
- **Don't claim a mechanism the code doesn't have.** If a value is only a
  convention (not enforced anywhere), the comment says so.
- **Times are seconds; frames are indices.** `startTime` is seconds in the
  extracted timebase; `startFrame` is an index into the extracted frames;
  `startFrameNative` is the frame number in the source video. Keep the three
  distinct — mixing them is the classic bug in this kind of tool.

## Workflow

After any code or structural change, audit the docs it could make stale and fix
them in the same change. Then print a copy-pasteable commit message.

Tests: `npm test` (vitest, `src/**/*.test.js`). Only pure modules are covered —
`src/labels.js` today. Keep new pure logic in a module that can be tested rather
than growing `annotator.js`'s DOM-coupled body.

---

## Where to look for what

| Task | Read first |
|------|------------|
| Preparing frames from video or images, layouts, meta.json | [docs/frame_preparation.md](docs/frame_preparation.md), [scripts/frameseq.py](scripts/frameseq.py) |
| Changing the phase / gesture vocabulary | [docs/label_sets.md](docs/label_sets.md), [src/labels.js](src/labels.js) |
| Annotator UI, keyboard shortcuts, two-track model | [docs/annotator_spec.md](docs/annotator_spec.md), [src/annotator.js](src/annotator.js) |
| Exported JSON schema / consuming the labels downstream | [docs/annotator_spec.md](docs/annotator_spec.md) §Export |
| Dev-server API and static serving | [vite.config.js](vite.config.js) |
