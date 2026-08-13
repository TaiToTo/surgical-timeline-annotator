# Timeline Annotator

[![CI](https://github.com/TaiToTo/surgical-timeline-annotator/actions/workflows/ci.yml/badge.svg)](https://github.com/TaiToTo/surgical-timeline-annotator/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**English** | [日本語](README.ja.md)

A browser tool for labelling time regions of a surgical video on two layers:
**Phase** (coarse task stages) and **Gesture** (JIGSAWS-style sub-segmentation).
It is a Vite dev server plus a handful of stdlib-only Python scripts — no
backend, no database, no model. The filesystem is the store: frames under
`outputs/frames/`, exported labels under `outputs/annotations/`.

Extracted from the `endo_3d_verbalization` research workbench, where the same
annotator lived inside a larger Three.js viewer. The label vocabularies came
across unchanged; the video material and the annotations did not.

> **Your video never leaves your machine.** Everything runs against a local dev
> server and nothing is uploaded anywhere. Videos, frames and annotations all
> stay on disk.

---

## Requirements

| | Used for |
|---|---|
| Node.js 18+ | The dev server (`npm install` on first run only) |
| Python 3.10+ | Frame preparation scripts (no pip dependencies) |
| ffmpeg / ffprobe | Decoding video and reading image dimensions |

`ffmpeg` is only needed when extracting from video. If you already have frame
images, `index_frames.py` is enough, and `ffprobe` is used to read their size.

---

## Quickstart

```bash
git clone https://github.com/TaiToTo/surgical-timeline-annotator.git
cd surgical-timeline-annotator

# 1. Drop a video in
cp /path/to/case01.mp4 data/videos/

# 2. Extract frames (--fps sets the annotation time resolution)
python scripts/extract_frames.py --fps 5

# 3. Verify the sequence is loadable — do not continue past a FAIL
python scripts/check_sequences.py

# 4. Start it
npm install        # first run only
npm run dev        # → http://localhost:5180
```

Pick a frame sequence from the dropdown in the header to start annotating.

**If you already have frame images**, replace step 2 with:

```bash
python scripts/index_frames.py /path/to/images --name CASE01 --fps 5
```

This leaves your source directory untouched and symlinks it into
`outputs/frames/CASE01/` (`--copy` to copy instead). See
[docs/frame_preparation.md](docs/frame_preparation.md).

### Video layouts

Pass `--layout` to describe how the source frame is composed
([docs/frame_preparation.md](docs/frame_preparation.md)):

| Layout | Contents |
|---|---|
| `single` | One camera view filling the frame |
| `duo` | Two views side by side (left = console, right = body) |
| `grid` | 2×2 (top-left = console, top-right = body, bottom-left = hands; bottom-right ignored) |

---

## Using the annotator

- **Create a segment**: drag across an empty part of a lane, or mark with
  `S` / `E` and press `A` (Add Segment). The label currently selected in the
  palette is assigned.
- **Change a label**: click a segment and pick from the popover, or drag a
  palette entry from the sidebar onto the segment.
- **Switch layers**: Phase / Gesture at the top of the sidebar. The inactive
  layer shows in a read-only lane below (unsaved edits are preserved).
- **Export JSON**: saved to
  `outputs/annotations/<seq>_annotations_<timestamp>.json`. The Gesture layer
  goes to a separate file suffixed `_gesture`. Reselecting a sequence
  auto-loads the newest Phase / Gesture files.
- **Shortcuts**: `Space` play, `S`/`E` mark, `A` add, `Del` delete,
  `←`/`→` one frame (`Shift` for 5 s), `Cmd/Ctrl+Z` undo.

For the UI and data model in detail, see
[docs/annotator_spec.md](docs/annotator_spec.md).

---

## Changing the label vocabulary

The Phase palettes and the Gesture list live in a single file,
[src/labels.js](src/labels.js). Edit it and reload the page — there is no build
step. Which sequence opens with which Phase set is decided by
`PHASE_SET_RULES`. See [docs/label_sets.md](docs/label_sets.md).

---

## Tests

```bash
npm test        # vitest (src/**/*.test.js)
```

Coverage is limited to pure logic (`src/labels.js` today).

---

## Notes

- **There is no hosted demo.** The app depends on the dev server's API for
  listing sequences, serving frames and saving annotations, so static hosting
  alone will not work. Run `npm run dev` locally.
- `outputs/frames/` and `data/videos/` are gitignored. `outputs/annotations/` is
  **intentionally tracked**, since the exported JSON is this repo's deliverable.
  Check that this is what you want before committing case data to a public fork.

---

## Contributing

Issues and pull requests are welcome. Two house rules worth knowing before you
start:

- **No new runtime dependencies.** The page ships no npm dependencies (vite and
  vitest are dev-only) and the scripts are stdlib + `ffmpeg`/`ffprobe`.
- **`meta.json` is the contract** between the preparation scripts and the app.
  Change its shape in [scripts/frameseq.py](scripts/frameseq.py) and in
  `loadFrameSequence` ([src/annotator.js](src/annotator.js)) together, and update
  [docs/frame_preparation.md](docs/frame_preparation.md) in the same change.

The full working rules — including the setup flow for new material — are in
[AGENTS.md](AGENTS.md) (`CLAUDE.md` is a symlink to it).

---

## License

[MIT](LICENSE). Derived from the viewer/annotator in the
`endo_3d_verbalization` repository.
