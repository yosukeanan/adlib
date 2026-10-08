# Ad-lib トレーナー

ジャズギターのアドリブ練習用Webアプリ（PWA）。ビルド不要で、このフォルダをそのままGitHub Pagesに置けば動きます。

## 構成

| パス | 内容 |
|---|---|
| `index.html` | 画面の骨組み |
| `css/app.css` | スタイル |
| `js/main.js` | 起動とイベントの登録（入口） |
| `js/theory.js` `js/songs.js` | 音楽理論、進行、ポジション |
| `js/state.js` `js/util.js` | 設定の状態と保存 |
| `js/synth.js` `js/band.js` `js/player.js` `js/frame.js` | 伴奏の発音と再生 |
| `js/mic.js` `js/setup.js` | マイク判定、雑音・タイミングの測定、準備ガイド |
| `js/stats.js` | 判定の統計と練習の提案 |
| `js/voicing.js` | コンピング用のシェル・ボイシングとボイスリーディング |
| `js/board.js` `js/ui.js` | 指板と画面の描画 |
| `sw.js` | オフライン用のService Worker |
| `docs/roadmap.md` | **最新の計画**（進み具合、問題と原因、修正計画、優先順位） |
| `docs/ux-plan.md` | UI/UX改善計画（詳細） |
| `docs/comping-plan.md` | コンピング練習モードの計画とベンチマーク（詳細） |

## 手元で動かす

ES Modulesを使っているため、`index.html` をファイルとして直接開いても動きません。HTTPサーバー経由で開きます。

```sh
npm run serve        # http://localhost:8000/
```

## テスト

```sh
npm install          # 初回のみ（Playwright）
npm test
```

ヘッドレスChromiumで、再生、タブ、表示サイズ、横向き表示、マイク準備ガイド（疑似マイク入力）、コンピングモード（全シェルの音の検証、ボイスリーディング、ピアノの停止）、音量（お手本とベースの音量差を音の書き出しで測定）、ポジション移動、弦の限定、オフライン起動、新しい版の配信を確認します。
**iPhone実機と本物のギターでの確認の代わりにはなりません。**

## 更新して公開するとき

1. `js/` にファイルを足したら、`sw.js` の `ASSETS` にも追加する（`npm test` が漏れを検出します）。
2. `sw.js` の `CACHE` の版数を上げる（例：`adlib-v4` → `adlib-v5`）。上げ忘れると、入っているアプリに新しい版が届きません。
