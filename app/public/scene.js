/* 部屋の背景（シーン）とデコ（ソファ・植物など）。画像があればそれを使い、無ければ色とえもじで代用する */
(function(){
'use strict';
var A = window.DARAAnimal;
var SCENES = [
  {k:'room',   n:'ふわふわ部屋', bg:'linear-gradient(#ffd6e8,#ffb9d4 60%,#f59bbd)', ground:'#f7a9c6', em:'☁'},
  {k:'forest', n:'森',          bg:'linear-gradient(#cdeccb,#9fd9a6 55%,#5fb27a)', ground:'#6fbf86', em:'🌲'},
  {k:'sea',    n:'海',          bg:'linear-gradient(#bfe6ff,#8fd0f5 55%,#4aa9e0)', ground:'#f7e3b5', em:'🌊'},
  {k:'space',  n:'宇宙',        bg:'linear-gradient(#2a1f5c,#3d2f8a 60%,#6a4cc4)', ground:'#4a3a9a', em:'✦'},
  {k:'snow',   n:'雪',          bg:'linear-gradient(#e8f2ff,#cfe3fb 60%,#aecbf0)', ground:'#f4f9ff', em:'❄'},
  {k:'sky',    n:'そら',        bg:'linear-gradient(#bfe0ff,#e4f1ff 60%,#fff3e0)', ground:'#ffffff', em:'☁'},
  {k:'candy',  n:'おかし',      bg:'linear-gradient(#ffe3f3,#ffd2e8 60%,#ffbcdd)', ground:'#ffc6e2', em:'🍭'},
  {k:'night',  n:'よるの街',    bg:'linear-gradient(#1b1b3a,#2c2c5e 60%,#4a3f7a)', ground:'#34346a', em:'🌙'}
];
var DECORS = [
  {k:'sofa',     n:'ソファ',     em:'🛋'},
  {k:'plant',    n:'観葉植物',   em:'🪴'},
  {k:'lamp',     n:'ランプ',     em:'💡'},
  {k:'neon',     n:'ネオンの雲', em:'☁'},
  {k:'mushroom', n:'きのこ',     em:'🍄'},
  {k:'tree',     n:'木',         em:'🌲'},
  {k:'shell',    n:'貝がら',     em:'🐚'},
  {k:'star',     n:'おほしさま', em:'⭐'}
];
// デコを置く場所（0 から順に使う）
var SLOTS = [
  {l:'3%',  b:'7%',  w:'34%'}, {r:'3%',  b:'7%',  w:'28%'},
  {l:'30%', t:'4%',  w:'22%'}, {r:'26%', t:'8%',  w:'18%'}
];
var ok = {};   // 画像が読めたかどうか（k → true/false）
function probe(url, done){
  if(ok[url] !== undefined){ done(ok[url]); return; }
  var im = new Image();
  im.onload = function(){ ok[url] = true; done(true); };
  im.onerror = function(){ ok[url] = false; done(false); };
  im.src = url;
}
function sceneOf(g){ return typeof g.scene === 'number' && g.scene >= 0 && g.scene < SCENES.length ? SCENES[g.scene] : null; }
// 部屋の舞台：背景 + デコ + どうぶつ
function stage(g, o){
  o = o || {};
  var sc = sceneOf(g), el = document.createElement('div');
  el.className = 'stage' + (sc ? ' has' : '') + (o.compact ? ' compact' : '');
  var bg = document.createElement('div'); bg.className = 'stbg';
  if(sc){
    bg.style.background = sc.bg;
    bg.innerHTML = window.DARAArt.scene(sc.k);
    var url = '/scenes/' + sc.k + '.webp?v=1';
    probe(url, function(good){ if(good){ bg.innerHTML = ''; bg.style.background = 'url(' + url + ') center/cover'; } });
  }else bg.style.background = 'radial-gradient(circle at 30% 20%,var(--l),var(--c) 70%,var(--d))';
  el.appendChild(bg);
  (g.decor || []).slice(0, 4).forEach(function(i, n){
    var d = DECORS[i]; if(!d) return;
    var s = SLOTS[n], it = document.createElement('div'); it.className = 'stdecor';
    ['l', 'r', 't', 'b', 'w'].forEach(function(p){ if(s[p]) it.style[p === 'l' ? 'left' : p === 'r' ? 'right' : p === 't' ? 'top' : p === 'b' ? 'bottom' : 'width'] = s[p]; });
    it.innerHTML = window.DARAArt.decor(d.k);
    var url = '/decor/' + d.k + '.webp?v=1';
    probe(url, function(good){ if(good){ it.innerHTML = '<img alt="" draggable="false" src="' + url + '">'; } });
    el.appendChild(it);
  });
  var an = document.createElement('div'); an.className = 'stanimal';
  an.appendChild(A.forRoom(g, o.compact ? 96 : 128, true));
  el.appendChild(an);
  return el;
}
window.DARAScene = {SCENES:SCENES, DECORS:DECORS, stage:stage, sceneOf:sceneOf};
})();
