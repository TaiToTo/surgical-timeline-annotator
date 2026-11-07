# フレーム準備

アノテータが読むのは動画そのものではなく、**フレームシーケンス**（連番 JPEG ＋
`meta.json`）。この文書はその作り方と、`meta.json` の契約を定義する。

---

## 1. ディスク上の形

```
outputs/frames/<seq>/
├── meta.json                  # 必須。アノテータはまずこれを読む
├── frame_00000.jpg …          # layout: single のときはここに直接置く
├── console/frame_00000.jpg …  # layout: duo / grid
├── body/frame_00000.jpg …     # layout: duo / grid
└── hands/frame_00000.jpg …    # layout: grid のみ
```

- ファイル名は **`frame_NNNNN.<ext>`（5 桁ゼロ埋め、0 始まり、連番）** で固定。
  アノテータは番号でフレームを直接組み立てるので、欠番があるとその位置で表示が
  壊れる。`scripts/check_sequences.py` が先頭・末尾の存在と枚数を検査する。
- 拡張子は全ビューで統一（`meta.frame_ext`）。混在は準備スクリプトが弾く。
- `outputs/frames/<seq>/` そのもの、またはビューのディレクトリ（`console/` など）は
  共有ストレージへのシンボリックリンクでもよい。フレームが 1 本数万枚あり、1 枚ずつ
  リンクを張ると NFS 上で数十万本になる場合に使う。`meta.json` は実ファイルでも
  リンク先のものでもよい。

### レイアウト

| layout | 元素材の形 | ビュー | プレビュー表示 |
|--------|-----------|--------|----------------|
| `single` | 1 画面 | （サブフォルダなし） | 1 段。アスペクト比は `meta.width/height` |
| `duo` | 横 2 分割 | console（左）/ body（右） | console 上・body 下の 2 段 |
| `grid` | 2×2 合成 | console（左上）/ body（右上）/ hands（左下） | console 上・hands 下の 2 段 |

`grid` の右下クォドラントは無視される（元の OPUSim 収録では黒画面だった枠）。
ビュー名は多カメラ収録の慣習的な呼び名で、意味を持つのは**表示位置だけ** —
別の呼称の素材でも「メインに出したい方を console」に入れれば動く。

---

## 2. meta.json（準備スクリプトとアプリの契約）

```jsonc
{
  "video":       "CASE01.mp4",   // 出力 stem 由来。生の入力ファイル名は書かない
  "layout":      "single",       // single | duo | grid
  "views":       [],             // duo: ["console","body"] / grid: +["hands"]
  "fps":         5.0,            // 抽出後のタイムベース = アノテーションの時間分解能
  "native_fps":  59.94,          // 元動画のフレームレート
  "duration":    220.38,         // 秒
  "frame_count": 1102,           // 1 ビューあたりの枚数
  "width":       960,            // 1 ビューの出力幅
  "height":      540,
  "frame_ext":   "jpg"
}
```

- **`fps` と `native_fps` を混同しない。** アノテータの時刻は
  `frame_index / fps`、Export の `startFrame` は抽出後インデックス、
  `startFrameNative` は `startTime * native_fps`（＝元動画のフレーム番号）。
  元動画から区間を切り出すときに使うのは後者。
- `duration` は元動画の実尺（ffprobe）。取得できない場合のみ
  `frame_count / fps` にフォールバックする。
- 書き出しは [scripts/frameseq.py](../scripts/frameseq.py) の `write_meta()` に
  一本化してある。項目を増やすときはここと `loadFrameSequence()`
  （[src/annotator.js](../src/annotator.js)）を同時に直す。

---

## 3. 動画から: `extract_frames.py`

```bash
python scripts/extract_frames.py                        # data/videos/ の全動画、single、5 fps
python scripts/extract_frames.py --layout duo --fps 10
python scripts/extract_frames.py --fps 0                # ネイティブのフレームレート
python scripts/extract_frames.py --video clip_a.mov=CASE01 clip_b.mov=CASE02
python scripts/extract_frames.py --width 1280 --force
```

- 1 動画につき ffmpeg のデコードは 1 パス（`split` → `crop` → `scale`）。4K
  素材を分割しても複数回デコードしない。
- `--width` はビューあたりの幅。元より大きい値を指定しても**拡大はしない**。
- `--fps` の選び方: Phase / Gesture の境界精度がそのまま `1/fps` 秒になる。
  一方でフィルムストリップは 1 フレーム = 1 サムネイルなので、長尺を native fps
  で切ると DOM が数万要素になり重い。**5〜10 fps が実用域**。
- 既存シーケンスは skip。`--force` で作り直す（古い連番が残らないよう
  ディレクトリごと消してから再生成する）。

---

## 4. フレーム画像から: `index_frames.py`

```bash
python scripts/index_frames.py /path/to/images --name CASE01 --fps 5
python scripts/index_frames.py /path/to/images --name CASE01 --fps 5 --native-fps 30
python scripts/index_frames.py /path/to/images --name CASE01 --fps 5 --copy
```

- 元ディレクトリは**書き換えない**。ファイル名順（自然順: `img2` < `img10`）に
  `outputs/frames/<name>/frame_NNNNN.<ext>` としてシンボリックリンクを張る
  （`--copy` で実体コピー）。
- レイアウトは元ディレクトリの構成から判定 — `console/`+`body/`+`hands/` なら
  `grid`、`console/`+`body/` なら `duo`、それ以外は `single`。
- `--fps` は必須。画像だけからは時間軸が決まらないため、推測せずエラーにする。
  元動画のレートが分かるなら `--native-fps` も渡す（Export の元フレーム番号が
  正しくなる）。
- すでに `outputs/frames/<name>/` に置いてある場合は in-place モードになり、
  `meta.json` の生成だけ行う。ただしその場合はファイル名が
  `frame_NNNNN.<ext>` の連番になっている必要がある（違えば理由を出して停止）。

---

## 5. 検証: `check_sequences.py`

```bash
python scripts/check_sequences.py
```

各シーケンスについて meta.json の読み取り、layout の妥当性、ビューの実在、
枚数一致、先頭・末尾フレームの存在、`fps`/`duration`/サイズの有無を検査する。
1 つでも問題があれば非ゼロ終了。**アノテーション開始前のプリフライトとして毎回
通す**こと。
