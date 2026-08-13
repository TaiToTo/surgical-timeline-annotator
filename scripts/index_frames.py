#!/usr/bin/env python3
"""Register an existing directory of frame images as an annotatable sequence.

Use this instead of extract_frames.py when the material arrives as images
rather than video. The source images are linked (or copied) into

    outputs/frames/<name>/frame_NNNNN.<ext>          (single view)
    outputs/frames/<name>/<view>/frame_NNNNN.<ext>   (console/body[/hands] subdirs)

in filename order, and a meta.json is written so the annotator can play them.
The source directory is never modified.

Layout is detected from the source: console/ + body/ + hands/ subdirectories
give 'grid', console/ + body/ give 'duo', anything else is a single view.

`--fps` is required — it is the sequence's timebase, so annotation times are
frame_index / fps. Pass `--native-fps` as well when the images were sampled
from a video at a different rate and you want source frame numbers on export.

Usage:
    python scripts/index_frames.py /path/to/images --name CASE01 --fps 5
    python scripts/index_frames.py /path/to/images --name CASE01 --fps 5 --native-fps 30
    python scripts/index_frames.py /path/to/images --name CASE01 --fps 5 --copy
    python scripts/index_frames.py outputs/frames/CASE01 --fps 5    # already in place
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from frameseq import (
    FRAME_RE, FRAMES_ROOT, IMAGE_EXTS, LAYOUT_VIEWS, REPO_ROOT, frame_name,
    natural_key, probe_image, write_meta,
)


def detect_layout(src: Path) -> str:
    """Layout implied by the source directory's per-view subfolders."""
    has = lambda sub: (src / sub).is_dir()
    if has('console') and has('body'):
        return 'grid' if has('hands') else 'duo'
    return 'single'


def source_images(directory: Path) -> list[Path]:
    """Image files of one view, in natural filename order."""
    files = [p for p in directory.iterdir()
             if p.is_file() and p.suffix.lower() in IMAGE_EXTS]
    return sorted(files, key=natural_key)


def collect(src: Path, layout: str) -> dict[str, list[Path]]:
    """Map view name ('' for single) to its ordered image list. Fails closed."""
    views = LAYOUT_VIEWS[layout] or ['']
    per_view = {v: source_images(src / v if v else src) for v in views}
    counts = {v: len(f) for v, f in per_view.items()}
    if not any(counts.values()):
        sys.exit(f'ERROR: no images ({", ".join(IMAGE_EXTS)}) found under {src}')
    if len(set(counts.values())) > 1:
        detail = ', '.join(f'{v or "root"}={n}' for v, n in counts.items())
        sys.exit(f'ERROR: view image counts differ — {detail}')
    exts = {p.suffix.lower() for files in per_view.values() for p in files}
    if len(exts) > 1:
        sys.exit(f'ERROR: mixed image types {sorted(exts)} — convert them to one format first')
    return per_view


def link_frames(per_view: dict[str, list[Path]], seq_dir: Path, ext: str,
                copy: bool) -> None:
    """Materialize outputs/frames/<name>/ as links (or copies) of the sources."""
    for view, files in per_view.items():
        out_dir = seq_dir / view if view else seq_dir
        out_dir.mkdir(parents=True, exist_ok=True)
        for idx, src_file in enumerate(files):
            dst = out_dir / frame_name(idx, ext)
            if dst.exists() or dst.is_symlink():
                dst.unlink()
            if copy:
                shutil.copy2(src_file, dst)
            else:
                dst.symlink_to(src_file.resolve())


def check_in_place(per_view: dict[str, list[Path]]) -> None:
    """Verify an already-in-place sequence uses the frame_NNNNN.<ext> naming.

    Nothing is renamed here: the annotator addresses frames by index, so a
    directory that is already its own output must already match the scheme.
    """
    for view, files in per_view.items():
        for idx, path in enumerate(files):
            m = FRAME_RE.match(path.name)
            if not m or int(m.group(1)) != idx:
                where = f'{view}/' if view else ''
                sys.exit(
                    f'ERROR: {where}{path.name} does not match the expected '
                    f'{frame_name(idx)} naming. Point --name at a NEW sequence '
                    f'name and re-run so the frames are linked in order instead.')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('source', type=Path,
                        help='Directory holding the frame images')
    parser.add_argument('--name', default=None,
                        help='Sequence name (default: the source directory name)')
    parser.add_argument('--fps', type=float, required=True,
                        help='Frames per second these images represent')
    parser.add_argument('--native-fps', type=float, default=None,
                        help='Frame rate of the source video, when the images '
                             'were sampled from one (default: --fps)')
    parser.add_argument('--copy', action='store_true',
                        help='Copy the images instead of symlinking them')
    parser.add_argument('--force', action='store_true',
                        help='Replace an existing sequence of the same name')
    args = parser.parse_args()

    if args.fps <= 0:
        sys.exit('ERROR: --fps must be positive')
    src = args.source.resolve()
    if not src.is_dir():
        sys.exit(f'ERROR: not a directory: {src}')

    name     = args.name or src.name
    seq_dir  = FRAMES_ROOT / name
    in_place = (seq_dir.resolve() == src)
    layout   = detect_layout(src)
    per_view = collect(src, layout)

    if in_place:
        check_in_place(per_view)
    elif seq_dir.exists():
        if not args.force:
            sys.exit(f'ERROR: {seq_dir.relative_to(REPO_ROOT)} already exists '
                     f'(--force to replace it)')
        shutil.rmtree(seq_dir)

    ext         = next(iter(per_view.values()))[0].suffix.lower().lstrip('.')
    frame_count = len(next(iter(per_view.values())))
    width, height = probe_image(next(iter(per_view.values()))[0])

    print(f'{name}: {frame_count} frames x {len(per_view)} view(s), layout "{layout}", '
          f'{width}x{height}, {args.fps} fps')
    if not in_place:
        link_frames(per_view, seq_dir, ext, args.copy)
        print(f'  -> {"copied" if args.copy else "linked"} into '
              f'{seq_dir.relative_to(REPO_ROOT)}')
    else:
        print('  -> already in place, writing meta.json only')

    write_meta(
        seq_dir, video=name, layout=layout, fps=args.fps,
        native_fps=args.native_fps or args.fps,
        duration=frame_count / args.fps, frame_count=frame_count,
        width=width, height=height, frame_ext=ext,
    )
    print('\nDone. Start the annotator with `npm run dev`.')


if __name__ == '__main__':
    main()
