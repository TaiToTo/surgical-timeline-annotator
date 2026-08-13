#!/usr/bin/env python3
"""Verify every frame sequence under outputs/frames/ is loadable by the annotator.

Checks per sequence: meta.json parses, the layout is known, every view directory
exists, the frame count matches meta, and the first/last frames are addressable
under the frame_NNNNN.<ext> naming. Exits non-zero if anything is off, so this
doubles as a preflight before an annotation session.

Usage:
    python scripts/check_sequences.py
"""

from __future__ import annotations

import sys

from frameseq import (
    FRAMES_ROOT, LAYOUT_VIEWS, frame_name, list_frames, read_meta, view_dirs,
)


def check(seq_dir) -> list[str]:
    """Return the problems found in one sequence (empty = healthy)."""
    meta = read_meta(seq_dir)
    if meta is None:
        return ['meta.json is missing or unreadable — re-run the preparation script']

    layout = meta.get('layout')
    if layout not in LAYOUT_VIEWS:
        return [f'unknown layout {layout!r} (expected one of {sorted(LAYOUT_VIEWS)})']

    problems = []
    ext = meta.get('frame_ext', 'jpg')
    for view_dir in view_dirs(seq_dir, layout):
        if not view_dir.is_dir():
            problems.append(f'missing view directory {view_dir.name}/')
            continue
        frames = list_frames(view_dir)
        label = view_dir.name if view_dir != seq_dir else 'root'
        if len(frames) != meta.get('frame_count'):
            problems.append(f'{label}: {len(frames)} frames on disk, '
                            f'meta.json says {meta.get("frame_count")}')
        if not frames:
            continue
        for idx in (0, meta.get('frame_count', len(frames)) - 1):
            if not (view_dir / frame_name(idx, ext)).exists():
                problems.append(f'{label}: {frame_name(idx, ext)} is missing')

    for key in ('fps', 'native_fps', 'duration', 'width', 'height'):
        if not meta.get(key):
            problems.append(f'meta.json has no usable {key}')
    return problems


def main() -> None:
    if not FRAMES_ROOT.is_dir():
        sys.exit(f'No frames directory at {FRAMES_ROOT} — nothing prepared yet.')

    seq_dirs = sorted(d for d in FRAMES_ROOT.iterdir() if d.is_dir())
    if not seq_dirs:
        sys.exit(f'No frame sequences in {FRAMES_ROOT} — run scripts/extract_frames.py '
                 f'or scripts/index_frames.py first.')

    failed = 0
    for seq_dir in seq_dirs:
        problems = check(seq_dir)
        meta = read_meta(seq_dir) or {}
        if problems:
            failed += 1
            print(f'FAIL  {seq_dir.name}')
            for p in problems:
                print(f'        {p}')
        else:
            print(f'ok    {seq_dir.name}  layout={meta["layout"]:<6} '
                  f'frames={meta["frame_count"]:<6} fps={meta["fps"]} '
                  f'({meta["duration"]:.1f}s)')

    print(f'\n{len(seq_dirs) - failed}/{len(seq_dirs)} sequence(s) ready.')
    if failed:
        sys.exit(1)


if __name__ == '__main__':
    main()
