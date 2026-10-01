/* ぷっくり膨らんだ3D風のイラスト（背景・デコ）を SVG で描く。画像が無いときの代わりで、画像があればそちらを使う */
(function(){
'use strict';
var S = window.DARAStamp;
var seq = 0;

function Art(vw, vh){
  var id = 'ar' + (++seq), gs = {}, body = '';
  function g(hex){
    if(gs[hex]) return gs[hex].ref;
    var k = id + 'g' + Object.keys(gs).length;
    var l = S.palOf(hex).l, m = hex, d = S.palOf(hex).d;
    gs[hex] = {ref:'url(#' + k + ')', def:'<radialGradient id="' + k + '" cx=".34" cy=".26" r=".95"><stop offset="0" stop-color="#fff"/><stop offset=".25" stop-color="' + l + '"/><stop offset=".7" stop-color="' + m + '"/><stop offset="1" stop-color="' + d + '"/></radialGradient>'};
    return gs[hex].ref;
  }
  var api = {
    raw:function(s){ body += s; return api; },
    ball:function(x, y, rx, ry, hex, o){
      o = o || {};
      body += '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="' + g(hex) + '"' + (o.rot ? ' transform="rotate(' + o.rot + ' ' + x + ' ' + y + ')"' : '') + '/>';
      if(o.gloss !== false) body += '<ellipse cx="' + (x - rx * .33) + '" cy="' + (y - ry * .5) + '" rx="' + rx * .34 + '" ry="' + ry * .17 + '" fill="#fff" opacity=".7" transform="rotate(-18 ' + (x - rx * .33) + ' ' + (y - ry * .5) + ')"/>';
      return api;
    },
    pill:function(x, y, w, h, r, hex){
      body += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + r + '" fill="' + g(hex) + '"/>';
      body += '<rect x="' + (x + w * .12) + '" y="' + (y + h * .08) + '" width="' + w * .4 + '" height="' + Math.max(3, h * .13) + '" rx="' + Math.max(2, h * .07) + '" fill="#fff" opacity=".6"/>';
      return api;
    },
    plain:function(hex, d){ body += '<path d="' + d + '" fill="' + g(hex) + '"/>'; return api; },
    lin:function(a, b, x, y, w, h, extra){
      var k = id + 'l' + (seq++);
      body += '<defs><linearGradient id="' + k + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="url(#' + k + ')" ' + (extra || '') + '/>';
      return api;
    },
    out:function(shadow){
      var defs = Object.keys(gs).map(function(k){ return gs[k].def; }).join('');
      var f = shadow ? '<filter id="' + id + 'd" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="4" stdDeviation="3" flood-color="#3a2a52" flood-opacity=".35"/></filter>' : '';
      return '<svg viewBox="0 0 ' + vw + ' ' + vh + '" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="' + (shadow ? 'xMidYMid meet' : 'xMidYMid slice') + '" aria-hidden="true"><defs>' + defs + f + '</defs>' + (shadow ? '<g filter="url(#' + id + 'd)">' + body + '</g>' : body) + '</svg>';
    }
  };
  return api;
}
function star(cx, cy, R, r, rot){
  var pts = [];
  for(var i = 0; i < 10; i++){ var a = -Math.PI / 2 + i * Math.PI / 5 + (rot || 0), rr = i % 2 ? r : R; pts.push((cx + Math.cos(a) * rr).toFixed(1) + ',' + (cy + Math.sin(a) * rr).toFixed(1)); }
  return 'M' + pts.join('L') + 'Z';
}
function tree(a, x, y, s, col, trunk){
  a.pill(x - 4 * s, y - 6 * s, 8 * s, 24 * s, 4 * s, trunk || '#c99a6b');
  a.ball(x, y - 6 * s, 24 * s, 20 * s, col).ball(x, y - 26 * s, 19 * s, 17 * s, col).ball(x, y - 42 * s, 13 * s, 13 * s, col);
}
function cloud(a, x, y, s, col){ a.ball(x, y, 22 * s, 11 * s, col || '#ffffff').ball(x - 16 * s, y + 3 * s, 14 * s, 9 * s, col || '#ffffff').ball(x + 17 * s, y + 3 * s, 15 * s, 9 * s, col || '#ffffff'); }

/* ---- 背景（320 x 200）---- */
var SCENE = {
  room:function(){ var a = Art(320, 200);
    a.lin('#ffe0ee', '#ffb3d1', 0, 0, 320, 200).ball(160, 215, 260, 60, '#ffc4dc', {gloss:false});
    a.ball(78, 70, 46, 42, '#bfe3ff').ball(78, 70, 36, 32, '#e6f4ff', {gloss:false}); cloud(a, 74, 74, .8, '#ffffff');
    a.ball(250, 60, 30, 18, '#ffffff'); a.raw('<path d="M232 62q10-24 20-6q10-18 20 6" fill="none" stroke="#ff7fb5" stroke-width="5" stroke-linecap="round" opacity=".85"/>');
    a.ball(160, 190, 120, 22, '#fff0f7'); a.ball(40, 170, 16, 16, '#ff9ec6').ball(290, 175, 14, 14, '#c9b3ff');
    return a.out(); },
  forest:function(){ var a = Art(320, 200);
    a.lin('#d6f2d9', '#a9e0b0', 0, 0, 320, 200).ball(160, 220, 280, 62, '#78c78a', {gloss:false});
    cloud(a, 70, 34, .8); cloud(a, 250, 44, .7);
    tree(a, 50, 150, .95, '#5fb77a'); tree(a, 270, 154, 1, '#6cc58a'); tree(a, 112, 140, .62, '#4fa86c'); tree(a, 214, 144, .66, '#58b274');
    a.ball(160, 186, 26, 12, '#8ed59f').ball(22, 188, 16, 10, '#8ed59f').ball(304, 190, 16, 10, '#8ed59f');
    a.pill(180, 164, 7, 14, 3, '#fff7e6'); a.ball(183, 162, 14, 10, '#ff8fa8'); a.raw('<circle cx="178" cy="160" r="2" fill="#fff"/><circle cx="188" cy="163" r="2" fill="#fff"/>');
    return a.out(); },
  sea:function(){ var a = Art(320, 200);
    a.lin('#c9ecff', '#8fd3f7', 0, 0, 320, 130).ball(268, 40, 22, 22, '#ffe07a'); cloud(a, 80, 38, .85); cloud(a, 190, 26, .6);
    a.lin('#6cc3f0', '#3aa0dc', 0, 96, 320, 70);
    for(var i = 0; i < 6; i++) a.ball(i * 60 + 14, 102 + (i % 2) * 6, 34, 11, '#9fdcff');
    a.ball(160, 206, 300, 66, '#f8e6b8', {gloss:false}); a.raw('<path d="' + star(60, 168, 13, 6, .3) + '" fill="#ff9a8a"/>');
    a.ball(258, 172, 15, 11, '#ffc2d6'); a.ball(130, 182, 11, 8, '#fff3d6');
    return a.out(); },
  space:function(){ var a = Art(320, 200);
    a.lin('#2b1f63', '#5a3fb5', 0, 0, 320, 200);
    for(var i = 0; i < 16; i++) a.raw('<path d="' + star((i * 83) % 310 + 6, (i * 47) % 150 + 8, 4 + i % 3, 1.8, 0) + '" fill="#fff6c9" opacity=".85"/>');
    a.ball(240, 100, 44, 44, '#ff9ec6'); a.raw('<ellipse cx="240" cy="104" rx="70" ry="13" fill="none" stroke="#ffe07a" stroke-width="7" transform="rotate(-16 240 104)" opacity=".92"/>');
    a.ball(70, 60, 28, 28, '#8fd0ff').ball(60, 150, 18, 18, '#c9b3ff').ball(150, 170, 52, 16, '#6a52c9', {gloss:false});
    return a.out(); },
  snow:function(){ var a = Art(320, 200);
    a.lin('#eaf3ff', '#c9ddf7', 0, 0, 320, 200).ball(160, 220, 290, 62, '#ffffff', {gloss:false});
    for(var i = 0; i < 12; i++) a.raw('<circle cx="' + ((i * 71) % 310 + 6) + '" cy="' + ((i * 37) % 130 + 8) + '" r="' + (2 + i % 3) + '" fill="#fff"/>');
    tree(a, 54, 150, .9, '#6fc3a0'); tree(a, 268, 152, 1, '#62b896');
    a.ball(52, 126, 22, 8, '#ffffff', {gloss:false}); a.ball(268, 122, 24, 8, '#ffffff', {gloss:false});
    a.ball(160, 168, 30, 28, '#ffffff').ball(160, 138, 22, 20, '#ffffff'); a.raw('<circle cx="153" cy="135" r="2.5" fill="#2a2030"/><circle cx="167" cy="135" r="2.5" fill="#2a2030"/><path d="M160 140l12 3-12 3z" fill="#ff9a4a"/>');
    return a.out(); },
  sky:function(){ var a = Art(320, 200);
    a.lin('#b9deff', '#f2f8ff', 0, 0, 320, 200);
    ['#ff8fa8', '#ffd27a', '#9fe0b0', '#8fcaff'].forEach(function(c, i){ a.raw('<path d="M40 190A120 120 0 0 1 280 190" fill="none" stroke="' + c + '" stroke-width="12" transform="translate(0,' + (-i * 11) + ')" opacity=".9" stroke-linecap="round"/>'); });
    cloud(a, 60, 150, 1.2); cloud(a, 260, 156, 1.3); cloud(a, 160, 60, .9); cloud(a, 280, 40, .55);
    return a.out(); },
  candy:function(){ var a = Art(320, 200);
    a.lin('#ffe6f4', '#ffc4e2', 0, 0, 320, 200).ball(160, 218, 290, 58, '#ffa6d2', {gloss:false});
    [[56, 120, '#ff7fb5'], [250, 112, '#8fcaff'], [160, 96, '#ffd27a']].forEach(function(p){ a.pill(p[0] - 3, p[1], 6, 56, 3, '#fff3dd'); a.ball(p[0], p[1], 24, 24, p[2]); a.raw('<circle cx="' + p[0] + '" cy="' + p[1] + '" r="11" fill="none" stroke="#fff" stroke-width="4" opacity=".7"/>'); });
    a.ball(110, 178, 20, 14, '#ffe3a8').ball(110, 178, 6, 4, '#ffc4e2', {gloss:false}).ball(215, 180, 18, 13, '#c9b3ff');
    return a.out(); },
  night:function(){ var a = Art(320, 200);
    a.lin('#1c1c3f', '#4a3f80', 0, 0, 320, 200).ball(262, 40, 20, 20, '#fff2b0');
    for(var i = 0; i < 12; i++) a.raw('<path d="' + star((i * 59) % 300 + 10, (i * 31) % 90 + 8, 3, 1.4, 0) + '" fill="#fff" opacity=".8"/>');
    [[10, 90, 56, 110, '#7a6bd0'], [70, 60, 50, 140, '#9a86e6'], [128, 100, 56, 100, '#6c5cc4'], [188, 70, 52, 130, '#8c78dc'], [246, 96, 66, 104, '#7566c8']].forEach(function(b){
      a.pill(b[0], b[1], b[2], b[3], 14, b[4]);
      for(var r = 0; r < 4; r++) for(var c = 0; c < 2; c++) a.raw('<rect x="' + (b[0] + 12 + c * 20) + '" y="' + (b[1] + 16 + r * 20) + '" width="11" height="11" rx="3" fill="#ffe9a0" opacity=".9"/>'); });
    a.ball(160, 214, 300, 30, '#3a3470', {gloss:false});
    return a.out(); }
};

/* ---- デコ（100 x 100）---- */
var DECOR = {
  sofa:function(){ var a = Art(100, 90);
    a.ball(50, 38, 38, 26, '#ff9ec6').ball(18, 62, 15, 22, '#ff86b8').ball(82, 62, 15, 22, '#ff86b8').ball(50, 66, 34, 18, '#ffb3d1').ball(50, 80, 36, 6, '#d96a9c', {gloss:false});
    a.ball(30, 56, 12, 11, '#fff0f7').ball(72, 56, 12, 11, '#c9b3ff'); a.ball(22, 84, 5, 4, '#c98a6b', {gloss:false}).ball(78, 84, 5, 4, '#c98a6b', {gloss:false});
    return a.out(true); },
  plant:function(){ var a = Art(100, 100);
    a.ball(50, 38, 11, 28, '#6cc58a', {rot:-28}).ball(50, 34, 11, 30, '#58b274').ball(50, 38, 11, 28, '#7fd29a', {rot:28});
    a.pill(30, 62, 40, 34, 14, '#ffb3d1'); a.ball(50, 63, 22, 6, '#c98a6b', {gloss:false});
    return a.out(true); },
  lamp:function(){ var a = Art(100, 100);
    a.ball(50, 88, 22, 7, '#e9d9f6').pill(46, 40, 8, 48, 4, '#e9d9f6').ball(50, 34, 28, 26, '#ffe07a');
    a.raw('<ellipse cx="50" cy="34" rx="40" ry="36" fill="#fff3b0" opacity=".28"/>');
    return a.out(true); },
  neon:function(){ var a = Art(100, 80);
    a.raw('<g fill="none" stroke="#ff9ed0" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M24 58a14 14 0 0 1 2-28a20 20 0 0 1 38-4a16 16 0 0 1 10 32z" opacity=".9"/></g><g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M24 58a14 14 0 0 1 2-28a20 20 0 0 1 38-4a16 16 0 0 1 10 32z"/></g>');
    return a.out(true); },
  mushroom:function(){ var a = Art(100, 100);
    a.pill(40, 52, 20, 36, 10, '#fff3dd').ball(50, 46, 40, 30, '#ff7f9c'); a.raw('<circle cx="34" cy="42" r="6" fill="#fff"/><circle cx="56" cy="32" r="5" fill="#fff"/><circle cx="70" cy="50" r="5" fill="#fff"/>');
    return a.out(true); },
  tree:function(){ var a = Art(100, 100); tree(a, 50, 70, 1.1, '#5fb77a'); return a.out(true); },
  shell:function(){ var a = Art(100, 90);
    a.ball(50, 56, 38, 32, '#ffc2d6'); for(var i = 0; i < 5; i++) a.raw('<path d="M50 84L' + (18 + i * 16) + ' 38" stroke="#f08fb0" stroke-width="3" stroke-linecap="round" opacity=".7"/>');
    a.pill(36, 78, 28, 10, 5, '#fff0f7'); return a.out(true); },
  star:function(){ var a = Art(100, 100);
    a.plain('#ffd54a', star(50, 54, 40, 19, 0)); a.raw('<path d="' + star(50, 54, 40, 19, 0) + '" fill="none" stroke="#ffe99a" stroke-width="6" stroke-linejoin="round" opacity=".9"/>'); a.ball(40, 38, 10, 5, '#ffffff', {gloss:false, rot:-30});
    return a.out(true); }
};
function scene(k){ return SCENE[k] ? SCENE[k]() : ''; }
function decor(k){ return DECOR[k] ? DECOR[k]() : ''; }
window.DARAArt = {scene:scene, decor:decor};
})();
