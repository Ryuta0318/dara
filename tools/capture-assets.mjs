// ロゴ画像・OG画像・アイコンを 3D から書き出す
//   npx http-server -p 8080 -c-1 .   (リポジトリのルートで)
//   node tools/capture-assets.mjs
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const base = process.env.BASE_URL || "http://localhost:8080";
const out = new URL("../public/assets/", import.meta.url).pathname;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

async function shot(size, file, { dpr = 2 } = {}) {
  const [w, h] = size.split("x").map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, ignoreHTTPSErrors: true });
  await page.goto(`${base}/tools/capture.html?size=${size}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await page.locator("#stage").screenshot({ path: out + file, omitBackground: true });
  await page.close();
}

await shot("600x290", "logo.png");

await browser.close();
console.log("done");
