# ラベル語彙（Phase / Gesture）

語彙は [src/labels.js](../src/labels.js) の 1 ファイルに集約されている。アプリ側
（annotator.js）にラベル文字列はハードコードされていないので、**この 1 ファイル
を編集してリロードすれば反映される**（ビルド不要）。

---

## 1. 2 つのレイヤ

| レイヤ | 粒度 | 出力ファイル |
|--------|------|--------------|
| **Phase** | 大まかな作業段階 | `<seq>_annotations_<ts>.json` |
| **Gesture** | 手技の細分化（JIGSAWS 準拠） | `<seq>_annotations_<ts>_gesture.json`（`level:"gesture"`） |

2 つは独立したトラックで、サイドバーの Annotation Layer で編集対象を切り替える。
非アクティブ側は下段の読み取り専用レーンに表示され、Gesture 区間の Export 時には
その時刻の Phase ラベルが `parentPhaseLabel` として各区間に付く。

---

## 2. Phase セット

`PHASE_SETS` に名前付きで定義する。既定で 2 つ入っている:

- **`default`** — ステーション中継課題。`Preparation` ＋ シミュレータのコンソール
  画面上の色付きステーション 4 色（Blue / Red / Yellow / Green）。色名がそのまま
  ステーションを指す。
- **`suturing`** — 縫合（運針）課題。手の運動平面と方向でラベリングする
  （`H.Plane R→L`、`V.Plane→H.Plane` など）。

どのシーケンスがどのセットで開くかは `PHASE_SET_RULES` が決める。先頭から順に
評価し、最初にマッチしたルールのセットを使う。マッチしなければ `default`。

```js
export const PHASE_SET_RULES = [
  { match: /(^|[_-])S\d/, set: 'suturing' },   // 例: E1_S1, trainee-S2
];
```

新しい課題を足すときは `PHASE_SETS` にセットを追加し、必要ならルールを 1 行足す。
ルールを増やさなくても、**パレットは UI 側で編集できる**（`+ Add phase`、
ラベルはダブルクリックでリネーム、✕ で削除）。ただし UI での編集はその
シーケンス限りなので、繰り返し使う語彙は必ず `labels.js` 側に入れること。

---

## 3. Gesture セット

`GESTURES` は JIGSAWS の標準 15 ジェスチャ（G1–G15）＋ 背景クラス G0。
Gesture トラックは常にこの全セットで開くので、使うものだけ選べばよい。

読み込み時のマージ規則（`mergeGesturePalette`）:

- 既存ファイルのエントリは**先頭の `G<n>` 番号で照合**され、一致したものは
  id とラベルをそのまま維持する（既存アノテーションのリンクが切れない）。
  `G1 Reaching … (free)` のような表記ゆれも `G1` として扱われる。
- ファイルに無い G 番号は既定値から補充される。
- 先頭が `G<n>` でないエントリ（`error` / `recovery` など別レイヤ由来のもの）は
  取り込まない。

順序は常に `GESTURES` の定義順（G0→G15）に正規化される。

---

## 4. 色

`PHASE_COLORS` は UI で手動追加したパレット項目に順番に割り当てるフォールバック。
`PHASE_SETS` / `GESTURES` の各エントリは自前の `color` を持つ。色はタイムライン
のセグメント、フィルムストリップ下端のバー、フレーム上のオーバーレイで共通に
使われるので、隣接して出やすいラベル同士は明度差をつけると読みやすい。

---

## 5. テスト

`src/labels.test.js` が `phaseSetFor` / `gestureNum` / `mergeGesturePalette` を
カバーしている。語彙そのものを増減するだけならテストは触らなくてよいが、
**マージ規則やルール解決の挙動を変えたらここも直す**。

```bash
npm test
```
