#!/usr/bin/env python3
"""Extract video frames into an annotatable frame sequence.

Reads videos from data/videos/ (or explicit paths) and writes

    outputs/frames/<stem>/frame_NNNNN.jpg          --layout single
    outputs/frames/<stem>/{console,body}/…         --layout duo   (side-by-side source)
    outputs/frames/<stem>/{console,body,hands}/…   --layout grid  (2x2 composite source)

plus the meta.json the annotator reads. One ffmpeg decode pass per video (split
-> crop -> scale) keeps a large source from being decoded once per view.

`--layout grid` takes the top-left, top-right and bottom-left quadrants as
console / body / hands; the bottom-right quadrant is ignored.

Usage:
    python scripts/extract_frames.py                       # every video in data/videos/, 5 fps
    python scripts/extract_frames.py --fps 10 --width 1280
    python scripts/extract_frames.py --fps 0               # keep the native frame rate
    python scripts/extract_frames.py --layout duo
    python scripts/extract_frames.py --video clip_a.mov=CASE01 clip_b.mov=CASE02
    python scripts/extract_frames.py --force               # re-extract existing sequences
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from frameseq import (
    FRAMES_ROOT, LAYOUT_VIEWS, REPO_ROOT, VIDEO_ROOT, count_frames, probe_video,
    require_tool, scaled, view_dirs, write_meta,
)

# Extensions picked up when scanning data/videos/. Anything ffmpeg can decode
# works via --video PATH; this tuple only governs auto-discovery. .ogv/.ogg are
# included because open-access journals publish surgical clips in that container
# (see the sample video in the README).
VIDEO_EXTS = ('.mp4', '.mov', '.mkv', '.avi', '.m4v', '.webm', '.ogv', '.ogg')

# Per-view width defaults: a single view fills the preview, so it gets more
# pixels than one panel of a stacked two-view preview.
DEFAULT_WIDTH = {'single': 960, 'duo': 480, 'grid': 480}


def build_graph(layout: str, src_w: int, src_h: int, target_w: int,
                fps: float | None) -> tuple[str, list[tuple[str, str]], int, int]:
    """Build the ffmpeg filter graph for one layout.

    Returns (filter_complex, [(pad_label, view_name)], out_w, out_h), where
    view_name is '' for the single-view layout (frames go in the sequence root)
    and out_w/out_h are the per-view output dimensions.
    """
    fps_step = f'fps={fps},' if fps else ''
    views = LAYOUT_VIEWS[layout]

    if layout == 'single':
        out_w, out_h = scaled(src_w, src_h, target_w)
        return f'[0:v]{fps_step}scale={out_w}:{out_h}[v]', [('v', '')], out_w, out_h

    if src_w % 2:
        sys.exit(f'ERROR: source width {src_w} is odd — cannot split it in half')
    half_w = src_w // 2
    if layout == 'duo':
        # left half -> console, right half -> body
        crops = [(half_w, src_h, 0, 0), (half_w, src_h, half_w, 0)]
        view_h = src_h
    else:                                   # grid: 2x2 composite
        if src_h % 2:
            sys.exit(f'ERROR: source height {src_h} is odd — cannot split it in half')
        half_h = src_h // 2
        # top-left -> console, top-right -> body, bottom-left -> hands
        crops = [(half_w, half_h, 0, 0), (half_w, half_h, half_w, 0),
                 (half_w, half_h, 0, half_h)]
        view_h = half_h

    out_w, out_h = scaled(half_w, view_h, target_w)
    pads  = [f'p{i}' for i in range(len(views))]
    chain = f'[0:v]{fps_step}split={len(views)}' + ''.join(f'[{p}]' for p in pads)
    parts = [chain]
    for pad, view, (cw, ch, cx, cy) in zip(pads, views, crops):
        parts.append(f'[{pad}]crop={cw}:{ch}:{cx}:{cy},scale={out_w}:{out_h}[{view}]')
    return ';'.join(parts), [(v, v) for v in views], out_w, out_h


def extract(video: Path, stem: str, layout: str, target_fps: float | None,
            target_w: int, quality: int, force: bool) -> None:
    """Extract one video into outputs/frames/<stem>/ and write its meta.json."""
    seq_dir = FRAMES_ROOT / stem
    if (seq_dir / 'meta.json').exists() and not force:
        print(f'  {stem}: already extracted — skipping (--force to redo)')
        return

    info = probe_video(video)
    graph, outputs, out_w, out_h = build_graph(
        layout, info['width'], info['height'], target_w, target_fps)
    actual_fps = target_fps if target_fps else info['fps']

    print(f'  {stem}: {info["duration"]:.1f}s  native {info["fps"]:.2f} fps '
          f'{info["width"]}x{info["height"]}  ->  {layout} @ {actual_fps:.2f} fps '
          f'{out_w}x{out_h} per view')

    # Start from a clean slate so a --force redo never leaves stale higher-numbered frames.
    if seq_dir.exists():
        shutil.rmtree(seq_dir)
    for d in view_dirs(seq_dir, layout):
        d.mkdir(parents=True, exist_ok=True)

    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
           '-i', str(video), '-filter_complex', graph]
    for pad, view in outputs:
        out_pattern = (seq_dir / view / 'frame_%05d.jpg') if view \
            else (seq_dir / 'frame_%05d.jpg')
        cmd += ['-map', f'[{pad}]', '-start_number', '0',
                '-q:v', str(quality), str(out_pattern)]
    subprocess.run(cmd, check=True)

    n = count_frames(seq_dir, layout)     # fails closed on empty / mismatched views
    write_meta(
        seq_dir,
        # Record the output stem, never the raw source filename, so a
        # (possibly identifying) input name does not leak into the artifact.
        video=f'{stem}{video.suffix}',
        layout=layout, fps=actual_fps, native_fps=info['fps'],
        duration=info['duration'] or n / actual_fps,
        frame_count=n, width=out_w, height=out_h,
    )
    print(f'  -> {n} frames per view saved to {seq_dir.relative_to(REPO_ROOT)}')


def resolve_pairs(specs: list[str] | None) -> list[tuple[Path, str]]:
    """Resolve the (video path, output stem) pairs to extract."""
    if not specs:
        videos = sorted(p for p in VIDEO_ROOT.glob('*')
                        if p.suffix.lower() in VIDEO_EXTS)
        if not videos:
            sys.exit(f'No videos found in {VIDEO_ROOT} — drop your files there, '
                     f'or pass --video PATH[=STEM].')
        return [(v, v.stem) for v in videos]

    pairs = []
    for spec in specs:
        raw, _, stem = spec.partition('=')
        path = Path(raw)
        if not path.exists():
            path = VIDEO_ROOT / raw
        if not path.exists():
            sys.exit(f'Video not found: {raw}')
        pairs.append((path, stem or path.stem))
    return pairs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--layout', choices=sorted(LAYOUT_VIEWS), default='single',
                        help='Source shape: single view, side-by-side (duo), or '
                             '2x2 composite (grid). Default: single')
    parser.add_argument('--fps', type=float, default=5.0,
                        help='Extraction fps = annotation time resolution. '
                             '0 keeps the native rate. Default: 5')
    parser.add_argument('--width', type=int, default=None,
                        help='Output width per view in pixels (never upscales). '
                             'Default: 960 single / 480 per view otherwise')
    parser.add_argument('--quality', type=int, default=3,
                        help='ffmpeg JPEG quality, 2=best … 31=worst (default: 3)')
    parser.add_argument('--video', nargs='+', metavar='PATH[=STEM]', default=None,
                        help='Videos to extract, optionally renaming the output '
                             'sequence (default: every video in data/videos/)')
    parser.add_argument('--force', action='store_true',
                        help='Re-extract even when the sequence already exists')
    args = parser.parse_args()

    require_tool('ffmpeg')
    target_fps = args.fps if args.fps and args.fps > 0 else None
    target_w   = args.width or DEFAULT_WIDTH[args.layout]
    pairs      = resolve_pairs(args.video)

    fps_label = f'{target_fps} fps' if target_fps else 'native fps'
    print(f'Extracting {len(pairs)} video(s) as "{args.layout}" at {fps_label}, '
          f'{target_w}px/view -> {FRAMES_ROOT}\n')
    for video, stem in pairs:
        print(f'{video.name} -> {stem}')
        extract(video, stem, args.layout, target_fps, target_w, args.quality, args.force)

    print('\nDone. Start the annotator with `npm run dev`.')


if __name__ == '__main__':
    main()
