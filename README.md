# DARA — ランディングサイト

友達だけが集まる、3Dでかわいいグループ型のスレッドSNS「DARA」の紹介サイト。

黒い背景に、真珠のようにふくらんだ3D。ビルド不要の HTML / CSS / JavaScript と three.js（`public/vendor` に同梱）で作っています。

## 3Dの体験

| セクション | 内容 |
| --- | --- |
| Home | 風船のようにふくらんだ真珠の「DARA」。傾き・ドラッグで回転・タップでぷるん。まわりにパステルの玉が浮かぶ |
| About | ぷっくりした真珠のアイコン（招待制 / 雑談 / 写真 / 秘密）。タップでくるっと回る |
| Rooms | 星・ハート・花などの形をしたキャラクターが、つやのある床に並ぶ。タップでジャンプして部屋の名前が出る |
| Play | 部屋のカードの山（タップ / スワイプで次へ）と、その部屋のチャット。メッセージを送ると返事が来る |
| Features | できること / はじめかた / やらないこと |

- 文字やキャラクターの形は、2Dの形を「ふくらませる」距離関数から Surface Nets でメッシュ化しています（`public/js/sdf.js`、Web Worker で並列処理）
- 日本語 / 英語の切り替え（JP | EN）
- `prefers-reduced-motion` のときは動きを止め、WebGL が使えない環境では画像のロゴに切り替え

## ファイル構成

```
public/                公開するファイル一式
  index.html
  css/style.css
  js/main.js           ページ全体（言語・カードの山・チャット・スクロール表示）
  js/lib.js            3D共通（レンダラー・質感・メッシュ化の Worker プール）
  js/sdf.js            ふくらんだ形の距離関数と Surface Nets
  js/mesher-worker.js
  js/hero.js           DARAロゴ
  js/icons.js          Aboutのアイコン
  js/rooms.js          Roomsのキャラクター
  assets/              ロゴ・OG画像・アイコン（tools で3Dから書き出し）
  vendor/three/        three.js r170（MIT）
tools/                 ロゴ画像を書き出すためのページとスクリプト
wrangler.jsonc         Cloudflare Workers で公開する設定
```

アプリへのリンク先は `public/js/main.js` の `APP_URL` で変更できます。

## ローカルで見る

```sh
npx http-server -c-1 public
# http://localhost:8080
```

## ロゴ画像を作り直す

```sh
npx http-server -p 8080 -c-1 .     # リポジトリのルートで
node tools/capture-assets.mjs       # public/assets/logo.png を書き出す
```

## 公開

`npx wrangler deploy` で Cloudflare Workers の静的アセットとして公開できます。独自ドメインは、ドメインを Cloudflare に追加したうえで `wrangler.jsonc` の `routes` を設定します。
