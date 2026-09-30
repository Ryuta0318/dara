/* スタンプ / 部屋のキャラクターを描く部品（画像ではなく、設計図から SVG を組み立てる） */
(function(){
'use strict';

var INK = '#17131f';

/* ---- 色（番号 0〜11、または #rrggbb） ---- */
var PAL = [
  {c:'#9db8ff', l:'#d8e4ff', d:'#6a86e8'}, {c:'#ffa6cc', l:'#ffe0ee', d:'#e0709f'},
  {c:'#9ee8cf', l:'#dcfff2', d:'#55bfa0'}, {c:'#ffe17a', l:'#fff8d0', d:'#d9b02e'},
  {c:'#c0a3ff', l:'#ece0ff', d:'#8b6be0'}, {c:'#ffb48c', l:'#ffe6d6', d:'#e88650'},
  {c:'#ff8585', l:'#ffd9d9', d:'#e04f4f'}, {c:'#7fdcf0', l:'#d6f7ff', d:'#3fa9c4'},
  {c:'#c2ea6f', l:'#f0ffc9', d:'#8ab83a'}, {c:'#6c7dff', l:'#c7cfff', d:'#3c4ad0'},
  {c:'#f3efe8', l:'#ffffff', d:'#c9c0b2'}, {c:'#3b3a44', l:'#6b6977', d:'#1b1a20'}
];
function hexOk(v){ return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v); }
function rgb(hex){ return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
function toHex(a){ return '#' + a.map(function(x){ var s = Math.max(0, Math.min(255, Math.round(x))).toString(16); return s.length < 2 ? '0' + s : s; }).join(''); }
function mix(hex, to, t){ var a = rgb(hex), b = rgb(to); return toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
function lum(hex){ var a = rgb(hex); return (0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]) / 255; }
function palOf(color){
  if(hexOk(color)) return {c:color.toLowerCase(), l:mix(color, '#ffffff', 0.55), d:mix(color, '#000000', 0.28)};
  var i = typeof color === 'number' ? color : 0;
  return PAL[i >= 0 && i < PAL.length ? i : 0];
}
function isDark(color){ return lum(palOf(color).c) < 0.36; }

/* ---- 形 ---- */
function poly(n, cx, cy, ro, ri){
  var pts = [];
  for(var i = 0; i < n * 2; i++){
    var a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? ri : ro;
    pts.push((cx + Math.cos(a) * r).toFixed(1) + ',' + (cy + Math.sin(a) * r).toFixed(1));
  }
  return 'M' + pts.join('L') + 'Z';
}
// 各形：parts（塗る図形） / face（顔の中心と大きさ） / text（文字の高さと最大幅）
var SHAPES = [
  {n:'まる', parts:[{t:'circle', cx:50, cy:50, r:44}],
    face:{x:50, y:46, s:1}, text:{top:22, mid:53, bot:81, w:72}},
  {n:'しかく', parts:[{t:'path', d:'M28 8H72C90 8 92 10 92 28V72C92 90 90 92 72 92H28C10 92 8 90 8 72V28C8 10 10 8 28 8Z'}],
    face:{x:50, y:46, s:1}, text:{top:22, mid:53, bot:82, w:76}},
  {n:'ハート', parts:[{t:'path', d:'M50 91C12 63 6 41 6 29C6 14 18 6 29 6C39 6 46 12 50 20C54 12 61 6 71 6C82 6 94 14 94 29C94 41 88 63 50 91Z'}],
    face:{x:50, y:40, s:0.8}, text:{top:20, mid:46, bot:68, w:54}},
  {n:'ほし', parts:[{t:'path', d:poly(5, 50, 55, 43, 23), round:9}],
    face:{x:50, y:54, s:0.58}, text:{top:30, mid:56, bot:72, w:40}},
  {n:'おはな', parts:[{t:'circle', cx:50, cy:50, r:27}, {t:'circle', cx:50, cy:24, r:19}, {t:'circle', cx:75, cy:41, r:19},
    {t:'circle', cx:65, cy:71, r:19}, {t:'circle', cx:35, cy:71, r:19}, {t:'circle', cx:25, cy:41, r:19}],
    face:{x:50, y:49, s:0.84}, text:{top:24, mid:52, bot:78, w:60}},
  {n:'くも', parts:[{t:'circle', cx:30, cy:56, r:23}, {t:'circle', cx:52, cy:40, r:27}, {t:'circle', cx:73, cy:56, r:21},
    {t:'rect', x:16, y:56, w:68, h:28, r:14}],
    face:{x:50, y:58, s:0.78}, text:{top:38, mid:62, bot:79, w:62}},
  {n:'ぷに', parts:[{t:'path', d:'M46 8C70 4 94 22 91 48C94 70 76 94 50 91C26 96 6 76 9 50C4 28 24 12 46 8Z'}],
    face:{x:50, y:46, s:1}, text:{top:22, mid:53, bot:81, w:70}},
  {n:'ひしがた', parts:[{t:'path', d:'M50 10L90 50L50 90L10 50Z', round:10}],
    face:{x:50, y:50, s:0.66}, text:{top:32, mid:54, bot:72, w:46}}
];

/* ---- 顔（中心 0,0 の座標。幅は約 100） ---- */
function arc(d){ return '<path d="' + d + '" fill="none" stroke="' + INK + '" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>'; }
var DOTS = '<circle cx="-15" cy="-6" r="4.4"/><circle cx="15" cy="-6" r="4.4"/>';
function heartEye(x){ return '<path transform="translate(' + x + ' -6)" d="M0 6C-10 -2 -10 -10 -5 -10C-2 -10 0 -8 0 -6C0 -8 2 -10 5 -10C10 -10 10 -2 0 6Z" fill="#ff4d79"/>'; }
var FACES = [
  {n:'にっこり', g:DOTS + arc('M-9 10Q0 20 9 10')},
  {n:'にかっ', g:DOTS + '<path d="M-11 8Q0 28 11 8Z"/><ellipse cx="0" cy="17.5" rx="5" ry="3" fill="#ff8fa3"/>'},
  {n:'えがお', g:arc('M-21 -3Q-15 -14 -9 -3') + arc('M9 -3Q15 -14 21 -3') + arc('M-10 9Q0 22 10 9')},
  {n:'ウインク', g:'<circle cx="-15" cy="-6" r="4.4"/>' + arc('M9 -3Q15 -14 21 -3') + arc('M-9 10Q0 20 9 10')},
  {n:'ねむい', g:arc('M-21 -6Q-15 -1 -9 -6') + arc('M9 -6Q15 -1 21 -6') + arc('M-4 12Q0 15 4 12')},
  {n:'びっくり', g:'<circle cx="-15" cy="-6" r="5.4"/><circle cx="15" cy="-6" r="5.4"/><ellipse cx="0" cy="15" rx="5" ry="7"/>'},
  {n:'えーん', g:DOTS + arc('M-9 17Q0 8 9 17') + '<path d="M-19 0Q-23 8 -19 11Q-15 8 -19 0Z" fill="#6ec6ff"/><path d="M19 0Q23 8 19 11Q15 8 19 0Z" fill="#6ec6ff"/>'},
  {n:'すき', g:heartEye(-15) + heartEye(15) + arc('M-9 10Q0 20 9 10')},
  {n:'サングラス', g:'<path d="M-27 -13H-3V-3Q-3 5 -11 5H-19Q-27 5 -27 -3Z"/><path d="M3 -13H27V-3Q27 5 19 5H11Q3 5 3 -3Z"/><path d="M-3 -9H3" fill="none" stroke="' + INK + '" stroke-width="3"/>' + arc('M-7 13Q2 19 10 11')},
  {n:'ドヤ', g:'<circle cx="-15" cy="-5" r="4.4"/><circle cx="15" cy="-5" r="4.4"/>' + arc('M-22 -9H-8') + arc('M8 -9H22') + arc('M-8 12Q2 18 10 10')},
  {n:'しょんぼり', g:DOTS + arc('M-22 -16L-9 -12') + arc('M9 -12L22 -16') + arc('M-8 16Q0 9 8 16')},
  {n:'むっ', g:DOTS + arc('M-23 -13L-9 -7') + arc('M9 -7L23 -13') + arc('M-8 15Q0 10 8 15')}
];
var DECOS = ['なし', 'ほっぺ', 'きらきら', 'あせ', 'ハート'];
var HEART_S = 'M0 6C-10 -2 -10 -10 -5 -10C-2 -10 0 -8 0 -6C0 -8 2 -10 5 -10C10 -10 10 -2 0 6Z';
var SPARK = 'M0 -10Q1.5 -1.5 10 0Q1.5 1.5 0 10Q-1.5 1.5 -10 0Q-1.5 -1.5 0 -10Z';
function spark(x, y, s){ return '<path transform="translate(' + x + ' ' + y + ') scale(' + s + ')" d="' + SPARK + '" fill="#fff" stroke="rgba(0,0,0,.2)" stroke-width="1"/>'; }

/* ---- 設計図の整え方 ---- */
function int(v, min, max, def){ v = typeof v === 'number' && isFinite(v) ? Math.round(v) : def; return Math.max(min, Math.min(max, v)); }
function clean(s){
  s = s && typeof s === 'object' ? s : {};
  var color = hexOk(s.color) ? s.color.toLowerCase() : int(s.color, 0, PAL.length - 1, 0);
  return {
    v:1, shape:int(s.shape, 0, SHAPES.length - 1, 0), color:color, face:int(s.face, -1, FACES.length - 1, 0),
    text:String(s.text || '').replace(/[\r\n]/g, ' ').slice(0, 8), tcolor:hexOk(s.tcolor) ? s.tcolor.toLowerCase() : '',
    tsize:int(s.tsize, 0, 2, 1), tpos:int(s.tpos, 0, 2, 0), deco:int(s.deco, 0, DECOS.length - 1, 0),
    rot:int(s.rot, -20, 20, 0), ring:int(s.ring, 0, 1, 0)
  };
}
function esc(t){ return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function textWidth(t, fs){
  var w = 0;
  for(var i = 0; i < t.length; i++){ var c = t.charCodeAt(i); w += c < 0x250 ? 0.62 : 1.02; }
  return w * fs;
}

var uid = 0;
function partsStr(parts, attrs, grow){
  return parts.map(function(p){
    var extra = p.round ? ' stroke-width="' + (p.round + (grow || 0)) + '" stroke-linejoin="round"' : (grow ? ' stroke-width="' + grow + '" stroke-linejoin="round"' : '');
    if(p.t === 'circle') return '<circle cx="' + p.cx + '" cy="' + p.cy + '" r="' + p.r + '"' + attrs + extra + '/>';
    if(p.t === 'rect') return '<rect x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" rx="' + p.r + '"' + attrs + extra + '/>';
    return '<path d="' + p.d + '"' + attrs + extra + '/>';
  }).join('');
}

function svgString(spec, size){
  var s = clean(spec), sh = SHAPES[s.shape], pal = palOf(s.color), n = ++uid;
  var g = 'url(#g' + n + ')';
  var out = '<svg viewBox="0 0 100 100" width="' + size + '" height="' + size + '" aria-hidden="true" focusable="false">';
  out += '<defs><radialGradient id="g' + n + '" gradientUnits="userSpaceOnUse" cx="38" cy="30" r="84">'
    + '<stop offset="0" stop-color="' + pal.l + '"/><stop offset=".55" stop-color="' + pal.c + '"/><stop offset="1" stop-color="' + pal.d + '"/></radialGradient>'
    + '<radialGradient id="h' + n + '"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'
    + '<clipPath id="c' + n + '">' + partsStr(sh.parts, '') + '</clipPath></defs>';
  out += '<g transform="rotate(' + s.rot + ' 50 50)">';
  if(s.ring) out += '<g fill="#fff" stroke="#fff" stroke-width="7" stroke-linejoin="round">' + partsStr(sh.parts, '', 7 + 0) + '</g>';
  out += '<g fill="' + g + '" stroke="' + g + '" stroke-width="0">' + partsStr(sh.parts, '') + '</g>';
  out += '<g clip-path="url(#c' + n + ')"><ellipse cx="34" cy="22" rx="18" ry="9" fill="url(#h' + n + ')" transform="rotate(-18 34 22)"/></g>';
  var f = sh.face;
  if(s.face >= 0){
    out += '<g transform="translate(' + f.x + ' ' + f.y + ') scale(' + f.s + ')" fill="' + INK + '">' + FACES[s.face].g + '</g>';
  }
  if(s.deco === 1) out += '<ellipse cx="' + (f.x - 27 * f.s) + '" cy="' + (f.y + 7 * f.s) + '" rx="' + 7 * f.s + '" ry="' + 4.5 * f.s + '" fill="#ff7aa5" opacity=".55"/>'
    + '<ellipse cx="' + (f.x + 27 * f.s) + '" cy="' + (f.y + 7 * f.s) + '" rx="' + 7 * f.s + '" ry="' + 4.5 * f.s + '" fill="#ff7aa5" opacity=".55"/>';
  if(s.deco === 2) out += spark(84, 16, 1.1) + spark(14, 26, 0.8) + spark(90, 62, 0.7);
  if(s.deco === 3) out += '<path transform="translate(80 26)" d="M0 -9C6 0 7 4 0 8C-7 4 -6 0 0 -9Z" fill="#8fdcff" stroke="#fff" stroke-width="1.6"/>';
  if(s.deco === 4) out += '<path transform="translate(83 20) scale(.8)" d="' + HEART_S + '" fill="#ff4d79" stroke="#fff" stroke-width="1.6"/>'
    + '<path transform="translate(16 30) scale(.55)" d="' + HEART_S + '" fill="#ff4d79" stroke="#fff" stroke-width="2"/>';
  if(s.text){
    var fs = [13, 18, 26][s.tsize], ty = [sh.text.bot, sh.text.mid, sh.text.top][s.tpos];
    var tc = s.tcolor || (isDark(s.color) ? '#ffffff' : INK);
    var halo = lum(tc) > 0.5 ? 'rgba(20,14,30,.7)' : 'rgba(255,255,255,.9)';
    var maxW = sh.text.w, tl = textWidth(s.text, fs) > maxW ? ' textLength="' + maxW + '" lengthAdjust="spacingAndGlyphs"' : '';
    out += '<text x="50" y="' + ty + '" text-anchor="middle" dominant-baseline="central" font-size="' + fs + '" font-weight="900" '
      + 'font-family="\'Zen Maru Gothic\',\'Hiragino Maru Gothic ProN\',\'Hiragino Sans\',\'Yu Gothic\',system-ui,sans-serif" '
      + 'fill="' + tc + '" stroke="' + halo + '" stroke-width="' + (fs * 0.2).toFixed(1) + '" stroke-linejoin="round" paint-order="stroke"' + tl + '>' + esc(s.text) + '</text>';
  }
  out += '</g></svg>';
  return out;
}

function render(spec, size){
  var el = document.createElement('span');
  el.className = 'stamp';
  el.style.cssText = 'width:' + size + 'px;height:' + size + 'px';
  el.innerHTML = svgString(spec, size);
  return el;
}
// 部屋のキャラクター（形・色・顔だけ）
function roomChar(g, size, bob){
  var el = render({shape:g.shape || 0, color:g.ccolor || g.color || 0, face:g.face === undefined ? 0 : g.face, deco:0, ring:0}, size);
  el.className = 'stamp rchar' + (bob ? ' bob' : '');
  return el;
}
// 部屋のカード・バナーに使う色の変数
function roomVars(g){
  var p = palOf(g.ccolor || g.color || 0);
  return '--c:' + p.c + ';--l:' + p.l + ';--d:' + p.d;
}
function roomDark(g){ return isDark(g.ccolor || g.color || 0); }

/* ---- はじめから使えるスタンプ ---- */
var BUILTIN = {
  ok:{shape:0, color:2, face:2, text:'OK'},
  thx:{shape:4, color:1, face:0, text:'ありがと', deco:1},
  lol:{shape:1, color:3, face:1, text:'うける'},
  love:{shape:2, color:6, face:7, deco:4},
  tired:{shape:5, color:0, face:4, text:'おつかれ'},
  wow:{shape:3, color:3, face:5, text:'!?', tpos:2, tsize:0},
  cry:{shape:6, color:7, face:6, text:'えーん'},
  zzz:{shape:0, color:4, face:4, text:'ねむ', deco:3},
  cool:{shape:1, color:9, face:8, text:'いいね'},
  gj:{shape:3, color:5, face:2, text:'えらい', deco:2},
  cheer:{shape:4, color:8, face:2, text:'がんばれ'},
  cong:{shape:5, color:1, face:2, text:'おめでと', deco:2},
  what:{shape:6, color:4, face:9, text:'まじ？'},
  sorry:{shape:0, color:0, face:10, text:'ごめん', deco:3},
  roger:{shape:0, color:2, face:0, text:'了解', ring:1}
};
var BUILTIN_IDS = Object.keys(BUILTIN).map(function(k){ return 'b:' + k; });
function resolve(id, map){
  if(typeof id !== 'string') return null;
  if(id.indexOf('b:') === 0) return BUILTIN[id.slice(2)] || null;
  return map && map[id] || null;
}
function random(keepText){
  function r(n){ return Math.floor(Math.random() * n); }
  return clean({shape:r(SHAPES.length), color:r(PAL.length), face:r(FACES.length), text:keepText || '', tsize:1, tpos:0,
    deco:r(DECOS.length), rot:r(17) - 8, ring:Math.random() < 0.5 ? 1 : 0});
}

window.DARAStamp = {
  PAL:PAL, SHAPES:SHAPES, FACES:FACES, DECOS:DECOS, BUILTIN_IDS:BUILTIN_IDS,
  clean:clean, render:render, roomChar:roomChar, roomVars:roomVars, roomDark:roomDark,
  palOf:palOf, isDark:isDark, resolve:resolve, random:random, hexOk:hexOk
};
})();
