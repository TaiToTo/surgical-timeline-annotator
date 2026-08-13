# アノテータ仕様

対象: [index.html](../index.html) ＋ [src/annotator.js](../src/annotator.js) ＋
[src/styles/annotator.css](../src/styles/annotator.css)。

---

## 1. 起動とデータ供給

```bash
npm install      # 初回のみ
npm run dev      # http://localhost:5180（ANNOTATOR_PORT で変更可）
```

Vite の開発サーバがページ配信に加えて次を提供する（[vite.config.js](../vite.config.js)）:

| エンドポイント | 役割 |
|---|---|
| `GET /api/frame-sequences` | `outputs/frames/` 直下で `meta.json` を持つディレクトリを `[{name, layout}]` で返す |
| `GET /api/annotations` | `outputs/annotations/` の `*.json` 一覧 |
| `POST /api/annotations/<file>` | アノテーション JSON を保存（`.json` かつパス区切りを含まない名前のみ許可） |
| `GET /outputs/**` | フレーム画像・meta.json・保存済み JSON の静的配信（Range 対応、`Cache-Control: no-store`） |

ポート衝突時は暗黙に別ポートへ逃げず落ちる（`strictPort`）。
ヘッダの **⟳** ボタンで、ページを再読み込みせずシーケンス一覧を再スキャンできる。

---

## 2. 画面

```
+----------+--------------------------------------------------+
| Sidebar  |  フレームプレビュー（1 段 or 2 段）＋オーバーレイ    |
|  Layer   |--------------------------------------------------|
|  Palette |  フィルムストリップ（全フレームのサムネイル）        |
|  Ann一覧 |--------------------------------------------------|
|  Export  |  ルーラ / Phase レーン / Gesture レーン            |
|  Import  |--------------------------------------------------|
|          |  再生コントロール・マーク・Add Segment・Limit       |
+----------+--------------------------------------------------+
```

- **プレビュー**: `single` は 1 段（アスペクト比は `meta.width/height`）、
  `duo` / `grid` は console を上、body / hands を下にした 2 段（8:9）。
  左上のオーバーレイは **上段が常に Phase、下段が常に Gesture** で、どちらを
  編集中かに依存しない。
- **フィルムストリップ**: 1 フレーム = 1 サムネイル（`loading="lazy"`）。
  クリックでシーク、下端の色バーが編集中トラックのラベル色。マーク中の
  区間は枠がハイライトされる。
- **レーン**: 上が Phase、下が Gesture で固定（CSS `order` で入れ替え）。
  編集対象が `#ann-lane`、もう一方が読み取り専用の `#ref-lane`。

---

## 3. 編集操作

| 操作 | 方法 |
|---|---|
| 区間作成 | レーンの空き部分をドラッグ／`S`・`E` でマークして `A`（Add Segment） |
| ラベル割当 | パレットで選択中のラベルが自動で入る。未選択ならドロップ時にポップオーバー |
| ラベル変更 | セグメントをクリック → ポップオーバー、またはパレット項目をセグメントへ D&D |
| 削除 | セグメント右上の ✕ ／ 選択して `Del` |
| undo | `Cmd/Ctrl+Z`（最大 50 段） |
| パレット編集 | `+ Add phase`／ラベルをダブルクリックでリネーム／✕ で削除 |
| 区間へズーム | `Limit` プルダウンで Phase 区間を選ぶ（前後 5 秒の余白付き）。ルーラ・両レーン・再生範囲がその窓に揃う |

ショートカット: `Space` 再生 / `←`・`→` 1 フレーム（`Shift` で 5 秒）/
`S`・`E` マーク / `A` 追加 / `Del`・`Backspace` 削除 / `Esc` 解除。

**Add Segment 後の挙動**: 直前の区間の終端が次の Start に自動でセットされ、
End 待ち状態になる。連続した区間を切っていく操作を想定している。

---

## 4. 2 トラックモデル

`state.tracks` が Phase / Gesture 両方の編集中コピーを保持する。レイヤを切り替え
ても未保存の編集は消えない（`syncActiveTrack()` → `activateTrack()`）。

シーケンスを選ぶと `autoLoadLatestAnnotation()` が走り、そのシーケンス名で始まる
最新の Phase ファイルと最新の Gesture ファイルを同時に読む。振り分けは
`level:"gesture"` またはファイル名の `_gesture` による。どちらも無ければ
Phase は `phaseSetFor(seq)` の既定パレット、Gesture は既定ジェスチャ全種で開く。

読み込んだ文書中の `id_<n>` は id カウンタを押し上げる（`bumpNextId`）ので、
新規発番が既存 id と衝突しない。

---

## 5. Export

`Export JSON` で `outputs/annotations/` に保存する。ファイル名は

```
<seq>_annotations_<ISO8601>.json            # Phase レイヤ
<seq>_annotations_<ISO8601>_gesture.json    # Gesture レイヤ（level:"gesture"）
```

```jsonc
{
  "source": "frames",
  "file": "CASE01",            // フレームシーケンス名
  "duration": 220.38,
  "fps": 5.0,                  // 抽出後のタイムベース
  "native_fps": 59.94,         // 元動画のフレームレート
  "frame_count": 1102,
  "level": "gesture",          // Gesture レイヤのみ
  "phases": [                  // このレイヤのパレット
    { "id": "id_1", "label": "Blue", "color": "#2196F3" }
  ],
  "annotations": [
    {
      "id": "id_9",
      "phaseId": "id_1",       // phases[].id への参照
      "label": "Blue",         // 書き出し時点のラベル（可読用の複製）
      "startTime": 12.4,       // 秒
      "endTime": 30.0,
      "startFrame": 62,        // 抽出後フレームの index
      "endFrame": 150,
      "startFrameNative": 743, // 元動画のフレーム番号
      "endFrameNative": 1798,
      "parentPhaseLabel": "Blue"  // Gesture レイヤのみ: 中点が属する Phase
    }
  ]
}
```

**下流で使うときの注意**

- 区間は `[startTime, endTime)`（終端は排他）。UI 上の判定も
  `t >= start && t < end` で統一されている。
- 元動画からクリップを切り出すなら `startFrameNative` / `endFrameNative`、
  抽出済みフレーム列を参照するなら `startFrame` / `endFrame`。
  `fps` と `native_fps` が違う限り両者は一致しない。
- 区間の重なりは禁止していない。相互排他が要るなら下流で検査すること。
- `label` は書き出し時点のスナップショット。ラベル名を変えて再 Export すると
  値が変わる。同定に使うのは `phaseId`。

---

## 6. Import

`Import JSON` は保存済みファイルの一覧をポップオーバーで出し、最新のものを自動で
読み込む（一覧は開いたままなので、古い版を選び直せる）。別シーケンスのファイルを
選んだ場合は、そのシーケンスへ切り替えてから読み込む。

---

## 7. 制限事項

- セグメントの端をドラッグしての伸縮は未実装（作り直すか、`S`/`E` でマークし直す）。
- フィルムストリップは全フレーム分の DOM を作るため、native fps の長尺は重い。
  抽出時に `--fps 5` 程度へ落とすのが前提（[frame_preparation.md](frame_preparation.md) §3）。
- 保存はサーバのファイルシステム宛て（開発サーバ前提）。`npm run build` した
  静的ページ単体では Export の POST 先が無い。
