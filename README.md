# DARA

友達だけが集まる、3Dでかわいいグループ型のスレッドSNS「DARA」の紹介サイト。

黒い背景に、真珠のようにふくらんだ3D。ビルド不要の HTML / CSS / JavaScript と three.js（`public/vendor` に同梱）で作っています。

## リポジトリの構成

| 場所 | 中身 |
| --- | --- |
| `public/` | 紹介サイト（ランディング）。Cloudflare Workers の静的アセットとして公開（`wrangler.jsonc`、Worker名 `dara`） |
| `app/` | アプリ本体（友達だけのスレッドSNS）。Worker + Durable Object（SQLite）+ 静的な画面（`app/wrangler.jsonc`、Worker名 `dara-app`） |

### アプリ（`app/`）

- 招待コードなしで登録できます。登録すると、自分だけの部屋「ひとりごと」が最初から1つできます。
- 友達の追加は、IDで探す・QRを見せる / 読み取る・リンクを共有、の3通りです。
- 部屋は誰でもつくれます。部屋ごとに8文字のコードがあり、コード・リンク・QRのどれでも入れます（友達でなくても入れます）。コードは、メンバーなら誰でも作り直せます。
- 部屋は、名前・色（12色＋自由な色）・キャラクターの形（8種）と顔（12種）・ひとこと・背景の模様を、メンバーなら誰でも変えられます。
- 投稿とコメントに、スタンプでリアクションできます（同じスタンプをもう一度押すと外れます）。スタンプだけのコメントも送れます。
- スタンプは、形（8）・色・顔（12）・文字（8文字まで）・かざり・かたむきを組み合わせて、自分でいくつでも（100個まで）つくれます。ほかの人のスタンプも、自分用にコピーできます。スタンプは画像ではなく、設計図（数字と文字）だけを保存し、画面でSVGとして描きます。
- 登録は同じ回線から1時間に10人まで、ログイン失敗は10分に8回まで、コードの入力は10分に30回までです。

```sh
# ローカルで動かす
npx wrangler dev --config app/wrangler.jsonc
# 公開する
cd app && npx wrangler deploy
```

`setroom` のデータは、新しい `dara-app` には引き継がれません（別のDurable Objectです）。

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

公開先のドメインは **dara-app.com**。

1. dara-app.com を取得し、Cloudflare にサイトとして追加する（Cloudflare Registrar で取得すれば自動で追加される）
2. `npx wrangler deploy` で公開すると、`wrangler.jsonc` の `routes` により `dara-app.com` と `www.dara-app.com` に紐づく

`index.html` の canonical / OG の URL も `https://dara-app.com/` にしてあります。
