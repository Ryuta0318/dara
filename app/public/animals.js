/* 部屋のキャラクター：ぷっくり膨らんだ真珠のどうぶつ（SVG で組み立て、色を変えられる） */
(function(){
'use strict';
var S = window.DARAStamp;
var NAMES = ['ゴリラ', 'くま', 'うさぎ', 'ねこ', 'きつね', 'ペンギン'];
var KEYS = ['gorilla', 'bear', 'rabbit', 'cat', 'fox', 'penguin'];   // 画像は /animals/<key>.webp（無ければ SVG で代用）
var missing = {};
var PEARL = '#fff7ee';
var uid = 0;

function build(kind, tint){
  var id = 'an' + (++uid);
  var base = S.hexOk(tint) ? S.palOf(tint).l : PEARL;           // からだの色
  var hi = S.hexOk(tint) ? S.palOf(tint).l : '#ffffff';
  var base2 = S.hexOk(tint) ? S.palOf(tint).c : '#f3e6f2';
  var sh = S.hexOk(tint) ? S.palOf(tint).d : '#c9b7d6';
  var soft = S.hexOk(tint) ? S.palOf(tint).l : '#ffffff';       // ほっぺ・おなか
  var defs = '<defs>' +
    '<radialGradient id="' + id + 'b" cx=".34" cy=".26" r=".95"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="' + hi + '"/><stop offset=".72" stop-color="' + base2 + '"/><stop offset="1" stop-color="' + sh + '"/></radialGradient>' +
    '<radialGradient id="' + id + 's" cx=".34" cy=".26" r=".95"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="' + soft + '"/><stop offset="1" stop-color="' + base2 + '"/></radialGradient>' +
    '<radialGradient id="' + id + 'p" cx=".4" cy=".3" r=".9"><stop offset="0" stop-color="#ffe3ec"/><stop offset="1" stop-color="#f5a9c0"/></radialGradient>' +
    '<radialGradient id="' + id + 'o" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#ffe9a8"/><stop offset="1" stop-color="#f0a53a"/></radialGradient>' +
    '<filter id="' + id + 'd" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="5" stdDeviation="4" flood-color="#5a4570" flood-opacity=".35"/></filter>' +
    '</defs>';
  function B(x, y, rx, ry, rot, fill){
    return '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="url(#' + id + (fill || 'b') + ')"' + (rot ? ' transform="rotate(' + rot + ' ' + x + ' ' + y + ')"' : '') + '/>';
  }
  function gloss(x, y, rx, ry, rot){
    return '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="#fff" opacity=".75"' + (rot ? ' transform="rotate(' + rot + ' ' + x + ' ' + y + ')"' : '') + '/>';
  }
  function eye(x, y, r){
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="#1c1624"/><circle cx="' + (x - r * .32) + '" cy="' + (y - r * .36) + '" r="' + r * .34 + '" fill="#fff"/>';
  }
  function smile(d){ return '<path d="' + d + '" fill="none" stroke="#6b4a3a" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>'; }
  function cheek(x, y){ return '<ellipse cx="' + x + '" cy="' + y + '" rx="9" ry="6" fill="#ff9db6" opacity=".35"/>'; }
  var paws = B(58, 150, 34, 24) + B(142, 150, 34, 24) + gloss(48, 140, 10, 5, -20) + gloss(132, 140, 10, 5, -20) +
    '<path d="M50 160v-8M62 162v-8M138 162v-8M150 160v-8" stroke="' + sh + '" stroke-width="2" stroke-linecap="round" opacity=".5"/>';
  var g = '';
  if(kind === 0){        // ゴリラ
    g = B(100, 36, 30, 26) + B(100, 90, 58, 50) + B(40, 92, 14, 14) + B(160, 92, 14, 14) + B(40, 92, 7, 7, 0, 'p').replace(/fill="url\(#[^)]*\)"/, 'fill="' + base2 + '"') +
      B(100, 112, 40, 30, 0, 's') + gloss(76, 64, 20, 8, -20) +
      eye(80, 86, 6.5) + eye(120, 86, 6.5) +
      '<ellipse cx="93" cy="102" rx="4" ry="3" fill="#8a5a44"/><ellipse cx="107" cy="102" rx="4" ry="3" fill="#8a5a44"/>' + smile('M84 118Q100 130 116 118') + paws;
  }else if(kind === 1){  // くま
    g = B(50, 48, 24, 24) + B(150, 48, 24, 24) + B(50, 48, 12, 12, 0, 'p') + B(150, 48, 12, 12, 0, 'p') +
      B(100, 92, 62, 54) + B(100, 110, 28, 21, 0, 's') + gloss(72, 62, 22, 9, -20) +
      eye(74, 88, 6.5) + eye(126, 88, 6.5) + cheek(60, 108) + cheek(140, 108) +
      '<ellipse cx="100" cy="102" rx="9" ry="6.5" fill="#6b4234"/>' + smile('M100 108V114M88 118Q100 128 112 118') + paws;
  }else if(kind === 2){  // うさぎ
    g = B(72, 36, 17, 46, -8) + B(128, 36, 17, 46, 8) + B(72, 38, 8, 32, -8, 'p') + B(128, 38, 8, 32, 8, 'p') +
      B(100, 102, 56, 48) + gloss(76, 76, 20, 8, -20) +
      eye(78, 100, 6) + eye(122, 100, 6) + cheek(62, 114) + cheek(138, 114) +
      '<ellipse cx="100" cy="109" rx="5" ry="3.8" fill="#ff8fae"/>' + smile('M100 113V117M91 120Q96 126 100 118Q104 126 109 120') + paws;
  }else if(kind === 3){  // ねこ
    g = B(60, 56, 17, 28, -28) + B(140, 56, 17, 28, 28) + B(60, 58, 8, 17, -28, 'p') + B(140, 58, 8, 17, 28, 'p') +
      B(100, 102, 62, 48) + gloss(72, 78, 22, 8, -16) +
      eye(76, 100, 6.5) + eye(124, 100, 6.5) + cheek(58, 114) + cheek(142, 114) +
      '<ellipse cx="100" cy="109" rx="5" ry="3.8" fill="#ff8fae"/>' + smile('M100 113V117M90 120Q95 126 100 118Q105 126 110 120') +
      '<path d="M44 106L22 100M44 114L22 116M156 106L178 100M156 114L178 116" stroke="#7a6a86" stroke-width="2" stroke-linecap="round" opacity=".6"/>' + paws;
  }else if(kind === 4){  // きつね
    g = B(166, 124, 22, 36, 28) + B(172, 108, 10, 12, 28, 's') +
      B(58, 52, 18, 32, -26) + B(142, 52, 18, 32, 26) + B(58, 56, 8, 19, -26, 'p') + B(142, 56, 8, 19, 26, 'p') +
      B(100, 100, 50, 44) + B(54, 114, 26, 18, 14, 's') + B(146, 114, 26, 18, -14, 's') + B(100, 118, 30, 22, 0, 's') + gloss(76, 76, 20, 8, -16) +
      eye(78, 98, 6) + eye(122, 98, 6) +
      '<ellipse cx="100" cy="108" rx="6" ry="4.6" fill="#2a2030"/>' + smile('M100 113V118M90 121Q95 127 100 119Q105 127 110 121') + paws;
  }else{                 // ペンギン
    g = B(26, 124, 13, 32, 22) + B(174, 124, 13, 32, -22) + B(100, 104, 62, 62) + B(100, 126, 40, 40, 0, 's') + gloss(72, 60, 22, 9, -22) +
      eye(80, 86, 6.5) + eye(120, 86, 6.5) + cheek(64, 100) + cheek(136, 100) +
      B(100, 100, 13, 8, 0, 'o') + smile('M100 108V110') +
      B(78, 160, 18, 9, 0, 'o') + B(122, 160, 18, 9, 0, 'o');
  }
  return '<svg viewBox="0 0 200 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' + defs + '<g filter="url(#' + id + 'd)">' + g + '</g></svg>';
}
function kindOf(g){
  if(typeof g.animal === 'number' && g.animal >= 0 && g.animal < NAMES.length) return g.animal;
  var n = 0, s = String(g.id || g.name || '');
  for(var i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
  return n % NAMES.length;
}
// size = 横幅 px
function render(kind, tint, size, bob){
  var el = document.createElement('span');
  el.className = 'achar' + (bob ? ' bob' : '');
  function useSvg(){
    el.classList.remove('photo'); el.style.cssText = 'width:' + size + 'px;height:' + Math.round(size * .85) + 'px'; el.innerHTML = build(kind, tint);
  }
  if(missing[kind]){ useSvg(); return el; }
  var src = '/animals/' + KEYS[kind] + '.webp?v=1';
  el.classList.add('photo'); el.style.cssText = 'width:' + size + 'px';
  var im = document.createElement('img'); im.src = src; im.alt = ''; im.draggable = false; im.decoding = 'async';
  im.onerror = function(){ missing[kind] = true; useSvg(); };
  el.appendChild(im);
  if(S.hexOk(tint)){
    var t = document.createElement('i'); t.className = 'atint';
    t.style.cssText = 'background:' + tint + ';-webkit-mask-image:url(' + src + ');mask-image:url(' + src + ')';
    el.appendChild(t);
  }
  return el;
}
function forRoom(g, size, bob){ return render(kindOf(g), g.acolor || null, size, bob); }
window.DARAAnimal = {NAMES:NAMES, render:render, forRoom:forRoom, kindOf:kindOf};
})();
