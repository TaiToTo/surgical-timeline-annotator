# Timeline Annotator

**日本語** | [English](README.md)

手術動画の時間区間を **Phase（大まかな作業段階）** と **Gesture（JIGSAWS 準拠の
細分化）** の 2 レイヤでラベリングするブラウザツール。Vite の開発サーバと、標準
ライブラリのみの Python スクリプト数本で動く。バックエンドも DB もモデルもなく、
ファイルシステムがそのままストア（フレームは `outputs/frames/`、ラベルは
`outputs/annotations/`）。

`endo_3d_verbalization` の Three.js ビューア内にあったアノテータを単体リポジトリ
として切り出したもの。**ラベル語彙はそのまま**、動画とアノテーション結果は
引き継いでいない。

> **動画はローカルから出ません。** このツールはローカルで動く開発サーバのみで
> 完結し、外部への送信は一切ない。動画・フレーム・アノテーションはすべて自分の
> マシン上に残る。

---

## 必要なもの

| | 用途 |
|---|---|
| Node.js 18+ | 開発サーバ（`npm install` は初回のみ） |
| Python 3.10+ | フレーム準備スクリプト（pip 依存なし） |
| ffmpeg / ffprobe | 動画のデコードと画像サイズ取得 |

`ffmpeg` は動画から切り出す場合に必要。フレーム画像がすでにある場合は
`index_frames.py` だけを使えばよく、`ffprobe` は画像サイズの取得に使われる。

---

## クイックスタート

```bash
git clone https://github.com/TaiToTo/surgical-timeline-annotator.git
cd surgical-timeline-annotator

# 1. 動画を置く
cp /path/to/case01.mp4 data/videos/

# 2. フレームを切り出す（--fps がアノテーションの時間分解能）
python scripts/extract_frames.py --fps 5

# 3. 準備できたか確認（FAIL が出たら先に進まない）
python scripts/check_sequences.py

# 4. 起動
npm install        # 初回のみ
npm run dev        # → http://localhost:5180
```

ヘッダのプルダウンからフレームシーケンスを選ぶとアノテーションを開始できる。

**フレーム画像がすでに手元にある場合**は 2. の代わりに:

```bash
python scripts/index_frames.py /path/to/images --name CASE01 --fps 5
```

元ディレクトリは変更せず、`outputs/frames/CASE01/` にシンボリックリンクを張る
（`--copy` でコピー）。詳細は [docs/frame_preparation.md](docs/frame_preparation.md)。

### 動画のレイアウト

切り出し時に `--layout` で映像の構成を指定する（[docs/frame_preparation.md](docs/frame_preparation.md)）。

| レイアウト | 中身 |
|---|---|
| `single` | 1 視点が画面全体 |
| `duo` | 左右 2 分割（左 = コンソール、右 = 術野） |
| `grid` | 2×2（左上 = コンソール、右上 = 術野、左下 = 手元、右下は未使用） |

---

## 使い方の要点

- **区間の作成**: レーンの空き部分をドラッグ、または `S` / `E` でマーク → `A`
  （Add Segment）。パレットで選択中のラベルが割り当たる。
- **ラベル変更**: セグメントをクリックしてポップオーバーから選ぶか、サイドバーの
  パレット項目をセグメントへドラッグ＆ドロップ。
- **レイヤ切替**: サイドバー上部の Phase / Gesture。非アクティブ側は下段の読み取り
  専用レーンに出る（未保存の編集は保持される）。
- **Export JSON**: `outputs/annotations/<seq>_annotations_<timestamp>.json` に保存。
  Gesture レイヤは `_gesture` 付きの別ファイル。シーケンスを選び直すと最新の
  Phase / Gesture ファイルが自動で読み込まれる。
- ショートカット: `Space` 再生、`S`/`E` マーク、`A` 追加、`Del` 削除、
  `←`/`→` 1 フレーム（`Shift` で 5 秒）、`Cmd/Ctrl+Z` undo。

UI とデータモデルの詳細は [docs/annotator_spec.md](docs/annotator_spec.md)。

---

## ラベル語彙を変える

Phase パレットと Gesture 一覧は [src/labels.js](src/labels.js) の 1 ファイルに
まとまっている。編集すればページのリロードだけで反映される（ビルド不要）。
どのシーケンスがどの Phase セットで開くかは `PHASE_SET_RULES` で決まる。
→ [docs/label_sets.md](docs/label_sets.md)

---

## テスト

```bash
npm test        # vitest（src/**/*.test.js）
```

対象は純粋ロジック（`src/labels.js`）のみ。

---

## 注意

- **公開デモはない。** アプリはフレーム配信と保存を開発サーバの API に依存して
  いるため、静的ホスティングだけでは動かない。ローカルで `npm run dev` する。
- `outputs/frames/` と `data/videos/` は `.gitignore` 済み。`outputs/annotations/`
  は**意図的に追跡対象**（エクスポートした JSON がこのリポジトリの成果物のため）。
  自分の症例データを公開フォークで扱う場合はここを確認すること。

---

## ライセンス / 出自

[MIT](LICENSE)。`endo_3d_verbalization` リポジトリの viewer/annotator から派生。
AI コーディングアシスタント向けの作業ルールは [AGENTS.md](AGENTS.md)
（`CLAUDE.md` はそのシンボリックリンク）。
