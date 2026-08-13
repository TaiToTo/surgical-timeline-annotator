#!/usr/bin/env python3
"""Shared helpers for the frame-sequence scripts.

A *frame sequence* is one annotatable clip on disk:

    outputs/frames/<name>/frame_NNNNN.jpg          (layout 'single')
    outputs/frames/<name>/<view>/frame_NNNNN.jpg   (layout 'duo' / 'grid')
    outputs/frames/<name>/meta.json                (always)

meta.json is what the annotator reads to set up playback, so it is the contract
between these scripts and the viewer. See docs/frame_preparation.md.

Only the Python standard library is used; ffmpeg/ffprobe are called as external
commands and their absence is reported instead of crashing mid-run.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT   = Path(__file__).resolve().parent.parent
VIDEO_ROOT  = REPO_ROOT / 'data' / 'videos'
FRAMES_ROOT = REPO_ROOT / 'outputs' / 'frames'

# On-disk layouts and the per-view subfolders each one uses. 'single' keeps its
# frames directly in the sequence folder (no per-view subfolder). The view names
# are a convention for multi-camera surgical captures; the annotator shows
# 'console' on top and 'body' (duo) / 'hands' (grid) below it.
LAYOUT_VIEWS = {
    'single': [],
    'duo':    ['console', 'body'],
    'grid':   ['console', 'body', 'hands'],
}

IMAGE_EXTS = ('.jpg', '.jpeg', '.png', '.webp')

# Frame filename the annotator addresses: zero-padded to 5 digits, from 0.
FRAME_RE = re.compile(r'^frame_(\d{5})\.(jpg|jpeg|png|webp)$')


def frame_name(idx: int, ext: str = 'jpg') -> str:
    """Filename of frame `idx` (the annotator's addressing scheme)."""
    return f'frame_{idx:05d}.{ext}'


def require_tool(name: str) -> str:
    """Absolute path of an external tool, or exit with an install hint."""
    path = shutil.which(name)
    if path is None:
        sys.exit(f'ERROR: `{name}` not found on PATH. Install ffmpeg '
                 f'(macOS: `brew install ffmpeg`, Ubuntu: `apt install ffmpeg`).')
    return path


def _ffprobe(target: Path, entries: str, stream: bool) -> str | None:
    """First value ffprobe reports for `entries`, or None when absent."""
    cmd = ['ffprobe', '-v', 'error']
    if stream:
        cmd += ['-select_streams', 'v:0']
    cmd += ['-show_entries', entries, '-of', 'default=nw=1:nk=1', str(target)]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout.strip()
    lines = [ln for ln in out.splitlines() if ln and ln != 'N/A']
    return lines[0] if lines else None


def probe_video(video: Path) -> dict:
    """Return {'fps', 'duration', 'width', 'height'} of a video's first stream.

    Raises SystemExit if the fps or the dimensions cannot be determined — a
    sequence whose timebase is unknown would silently mis-time every annotation.
    """
    require_tool('ffprobe')
    rate = _ffprobe(video, 'stream=avg_frame_rate', stream=True)
    if not rate or rate.startswith('0/'):
        sys.exit(f'ERROR: could not read a frame rate from {video}')
    num, den = rate.split('/')
    fps = float(num) / float(den)

    duration = _ffprobe(video, 'format=duration', stream=False) \
        or _ffprobe(video, 'stream=duration', stream=True)
    width  = _ffprobe(video, 'stream=width',  stream=True)
    height = _ffprobe(video, 'stream=height', stream=True)
    if not (width and height):
        sys.exit(f'ERROR: could not read the frame size of {video}')

    return {
        'fps':      fps,
        'duration': float(duration) if duration else 0.0,
        'width':    int(width),
        'height':   int(height),
    }


def probe_image(image: Path) -> tuple[int, int]:
    """Return (width, height) of a still image."""
    require_tool('ffprobe')
    width  = _ffprobe(image, 'stream=width',  stream=True)
    height = _ffprobe(image, 'stream=height', stream=True)
    if not (width and height):
        sys.exit(f'ERROR: could not read the size of {image}')
    return int(width), int(height)


def scaled(src_w: int, src_h: int, target_w: int) -> tuple[int, int]:
    """Output size for a source view scaled to `target_w`, never upscaling.

    The height is rounded to an even number because several JPEG/H.264 paths
    reject odd dimensions.
    """
    out_w = min(target_w, src_w)
    out_h = max(2, round(src_h * out_w / src_w / 2) * 2)
    return out_w, out_h


def view_dirs(seq_dir: Path, layout: str) -> list[Path]:
    """Directories holding the frame files of a sequence (one per view)."""
    views = LAYOUT_VIEWS[layout]
    return [seq_dir] if not views else [seq_dir / v for v in views]


def list_frames(directory: Path) -> list[Path]:
    """Frame files in one view directory, sorted by their frame index."""
    files = [p for p in directory.iterdir()
             if p.is_file() and FRAME_RE.match(p.name)] if directory.is_dir() else []
    return sorted(files, key=lambda p: int(FRAME_RE.match(p.name).group(1)))


def count_frames(seq_dir: Path, layout: str) -> int:
    """Frame count of a sequence. Fails closed on empty or mismatched views."""
    counts = {d.name: len(list_frames(d)) for d in view_dirs(seq_dir, layout)}
    values = set(counts.values())
    if len(values) > 1:
        detail = ', '.join(f'{k}={v}' for k, v in counts.items())
        sys.exit(f'ERROR: {seq_dir.name} view frame counts differ — {detail}')
    n = values.pop() if values else 0
    if n == 0:
        sys.exit(f'ERROR: {seq_dir.name} has no frames')
    return n


def natural_key(path: Path):
    """Sort key that orders img2 before img10 (digit runs compared as numbers)."""
    return [int(tok) if tok.isdigit() else tok.lower()
            for tok in re.split(r'(\d+)', path.name)]


def write_meta(seq_dir: Path, *, video: str, layout: str, fps: float,
               native_fps: float, duration: float, frame_count: int,
               width: int, height: int, frame_ext: str = 'jpg') -> dict:
    """Write meta.json for a sequence and return the written document.

    `fps` is the timebase of the extracted frames (annotation times are
    frame_index / fps); `native_fps` is the source video's rate, kept so an
    annotated span can be mapped back to source frame numbers.
    """
    meta = {
        'video':       video,
        'layout':      layout,
        'views':       LAYOUT_VIEWS[layout],
        'fps':         round(fps, 4),
        'native_fps':  round(native_fps, 4),
        'duration':    round(duration, 4),
        'frame_count': frame_count,
        'width':       width,
        'height':      height,
        'frame_ext':   frame_ext,
    }
    (seq_dir / 'meta.json').write_text(json.dumps(meta, indent=2) + '\n')
    return meta


def read_meta(seq_dir: Path) -> dict | None:
    """Parse a sequence's meta.json, or None when it is missing/unreadable."""
    try:
        return json.loads((seq_dir / 'meta.json').read_text())
    except (OSError, json.JSONDecodeError):
        return None
