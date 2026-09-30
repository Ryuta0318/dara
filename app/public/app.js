(function(){
'use strict';

var app = document.getElementById('app');
var overlay = document.getElementById('overlay');
var toastEl = document.getElementById('toast');

var st = { me:null, users:{}, stamps:{} };
var S = window.DARAStamp;
var cur = null;
var pending = null;      // ログイン前に開かれた招待リンク
var inviteFor = null;    // つくったばかりの部屋（招待シートを開く）

var PAL = [
  {c:'#2a3bff', l:'#7a86ff', d:'#1a26b8'}, {c:'#ff5a36', l:'#ff9a80', d:'#c23a1c'},
  {c:'#12c29a', l:'#6fe6c8', d:'#0b8a6d'}, {c:'#ffc21a', l:'#ffe08a', d:'#c78f00'},
  {c:'#8b5cff', l:'#bfa3ff', d:'#5a35c9'}, {c:'#ff5fa8', l:'#ffa6d1', d:'#c02f78'}
];

/* ---------- helpers ---------- */
function h(tag, attrs){
  var e = document.createElement(tag);
  if(attrs){
    Object.keys(attrs).forEach(function(k){
      var v = attrs[k];
      if(v === null || v === undefined || v === false) return;
      if(k === 'class') e.className = v;
      else if(k === 'text') e.textContent = v;
      else if(k === 'style') e.style.cssText = v;
      else if(k.indexOf('on') === 0) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
  }
  for(var i = 2; i < arguments.length; i++) append(e, arguments[i]);
  return e;
}
function append(e, c){
  if(c === null || c === undefined || c === false) return;
  if(Array.isArray(c)){ c.forEach(function(x){ append(e, x); }); return; }
  e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
}
var toastTimer;
function toast(m){ toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function(){ toastEl.classList.remove('show'); }, 2400); }
function ago(ts){
  var s = (Date.now() - ts) / 1000;
  if(s < 60) return 'たった今';
  if(s < 3600) return Math.floor(s/60) + '分';
  if(s < 86400) return Math.floor(s/3600) + '時間';
  if(s < 172800) return '昨日';
  var d = new Date(ts); return (d.getMonth()+1) + '/' + d.getDate();
}
function cacheStamps(m){ if(m) Object.keys(m).forEach(function(k){ st.stamps[k] = m[k]; }); }
function stampEl(id, size){
  return S.render(S.resolve(id, st.stamps) || {shape:0, color:10, face:-1, text:'?', tsize:2}, size);
}
function cacheUsers(u){ if(u) Object.keys(u).forEach(function(k){ st.users[k] = u[k]; }); }
function user(id){ return st.users[id] || {id:id, name:'ユーザー', handle:'', color:0, avatar:null}; }
function imgUrl(id){ return '/api/images/' + id; }

var ERR = {
  login:'IDまたはパスワードが違います', taken:'このIDはすでに使われています', invite:'招待コードが違います',
  handle:'IDは半角の英数字と_で3〜20文字にしてください', password:'パスワードは8文字以上にしてください', name:'名前を入力してください',
  too_many:'試行が多すぎます しばらくしてからお試しください', too_large:'画像が大きすぎます', type:'この画像は使えません', empty:'内容を入力してください',
  limit:'スタンプは100個までです', stamp:'このスタンプは使えませんでした', too_many_reacts:'1つの投稿に押せるスタンプは10個までです',
  no_room:'そのコードの部屋が見つかりません', user:'ユーザーが見つかりません', not_found:'見つかりませんでした'
};
function errMsg(e){ return (e && ERR[e.code]) || '通信できませんでした もう一度お試しください'; }

function api(path, o){
  o = o || {};
  var init = {method:o.method || 'GET', headers:{'x-sr':'1'}, credentials:'same-origin'};
  if(o.raw){ init.method = 'POST'; init.headers['content-type'] = o.type; init.body = o.raw; }
  else if(o.body !== undefined){ init.method = o.method || 'POST'; init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(o.body); }
  return fetch(path, init).then(function(r){
    return r.json().catch(function(){ return null; }).then(function(d){
      if(!r.ok){
        var e = new Error((d && d.error) || 'error'); e.status = r.status; e.code = d && d.error;
        if(r.status === 401 && st.me && path !== '/api/login'){ st.me = null; render(); }
        throw e;
      }
      return d;
    });
  });
}

/* ---------- invite: links, copy, share, QR ---------- */
var scripts = {};
function loadScript(src){
  if(!scripts[src]) scripts[src] = new Promise(function(res, rej){
    var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
  return scripts[src];
}
function fmtCode(c){ return c ? c.slice(0, 4) + '-' + c.slice(4) : ''; }
function friendLink(handle){ return location.origin + '/#/add/' + handle; }
function roomLink(code){ return location.origin + '/#/join/' + code; }
function copyText(t){
  var done = function(){ toast('コピーしました'); };
  if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(done, function(){ toast(t); }); }
  else toast(t);
}
async function shareLink(title, text, url){
  if(navigator.share){
    try{ await navigator.share({title:title, text:text, url:url}); return; }
    catch(e){ if(e && e.name === 'AbortError') return; }
  }
  copyText(url);
}
function qrSheet(title, text, caption){
  var box = h('div', {style:'text-align:center'}, h('div', {class:'hint', text:'読み込み中'}));
  openSheet(title, box);
  loadScript('/vendor/qrcode.js').then(function(){
    var q = window.qrcode(0, 'M'); q.addData(text); q.make();
    box.innerHTML = '';
    box.appendChild(h('img', {class:'qrimg', src:q.createDataURL(8, 4), alt:'QRコード'}));
    if(caption) box.appendChild(h('div', {style:'font-weight:900;font-size:17px;margin-top:6px', text:caption}));
    box.appendChild(h('div', {class:'hint', text:'相手のDARAの「QRを読み取る」で読み取ってもらってください'}));
  }).catch(function(){ box.innerHTML = ''; box.appendChild(h('div', {class:'hint', text:'QRコードを表示できませんでした'})); });
}
// QR / コードから来たものを画面の行き先に変える
function openScanned(text){
  var m = String(text).match(/#\/(add|join)\/([A-Za-z0-9_-]+)/);
  if(m){ location.hash = '#/' + m[1] + '/' + m[2]; return true; }
  var c = String(text).trim().replace(/[\s-]/g, '');
  if(/^[A-Za-z0-9]{8}$/.test(c)){ location.hash = '#/join/' + c.toUpperCase(); return true; }
  return false;
}
function scanSheet(){
  var stream = null, alive = true, video = h('video', {playsinline:true, muted:true, autoplay:true});
  var msg = h('div', {class:'hint', style:'text-align:center', text:'QRコードをカメラに映してください'});
  var box = h('div', {class:'scan'}, video, msg);
  var close = openSheet('QRを読み取る', box, function(){ alive = false; if(stream) stream.getTracks().forEach(function(t){ t.stop(); }); });
  function fail(){ msg.textContent = 'カメラを使えませんでした 友達のIDか部屋のコードを入力してください'; }
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ fail(); return; }
  Promise.all([loadScript('/vendor/jsQR.js'), navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}, audio:false})]).then(function(r){
    stream = r[1];
    if(!alive){ stream.getTracks().forEach(function(t){ t.stop(); }); return; }
    video.srcObject = stream; video.play().catch(function(){});
    var cv = document.createElement('canvas'), cx = cv.getContext('2d', {willReadFrequently:true});
    (function tick(){
      if(!alive) return;
      if(video.readyState >= 2 && video.videoWidth){
        var w = 480, k = w / video.videoWidth; cv.width = w; cv.height = Math.round(video.videoHeight * k);
        cx.drawImage(video, 0, 0, cv.width, cv.height);
        var res = window.jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
        if(res && res.data){
          if(openScanned(res.data)){ close(); return; }
          msg.textContent = 'DARAのQRコードではありません';
        }
      }
      setTimeout(tick, 140);
    })();
  }).catch(fail);
}

/* ---------- 3D pieces ---------- */
function orb(size, pal, opts){
  opts = opts || {};
  var o = h('div', {class:'orb pal' + pal + (opts.bob ? ' bob' : ''), style:'--s:' + size + 'px', 'aria-hidden':'true'});
  if(opts.face !== false){ o.appendChild(h('i', {class:'e l'})); o.appendChild(h('i', {class:'e r'})); o.appendChild(h('i', {class:'m'})); }
  if(opts.delay) o.style.animationDelay = opts.delay;
  return o;
}
function avatar(id, size){
  var u = user(id);
  if(u.avatar) return h('img', {class:'avimg', src:imgUrl(u.avatar), alt:'', style:'--s:' + size + 'px'});
  var pal = (u.color || 0) % 6;
  return h('div', {class:'orb av pal' + pal + (pal === 3 ? ' p3' : ''), style:'--s:' + size + 'px', 'aria-hidden':'true'}, (u.name || '?').trim().charAt(0).toUpperCase());
}
function tilt(el){
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.addEventListener('pointermove', function(e){
    var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--ry', ((x - .5) * 16) + 'deg'); el.style.setProperty('--rx', ((.5 - y) * 16) + 'deg');
    el.style.setProperty('--gx', (x * 100) + '%'); el.style.setProperty('--gy', (y * 100) + '%');
  });
  el.addEventListener('pointerleave', function(){
    el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); el.style.setProperty('--gx', '30%'); el.style.setProperty('--gy', '20%');
  });
}
function mountHero(box){
  var fb = h('img', {class:'fb', src:'/assets/dara-wordmark.png', alt:'DARA'});
  box.appendChild(fb);
  var handle = null, dead = false;
  function go(){
    if(dead) return;
    if(!window.DARA3D){ setTimeout(go, 150); return; }
    window.DARA3D.mount(box).then(function(hd){
      if(dead){ if(hd) hd.destroy(); return; }
      if(hd){ handle = hd; box.classList.add('ready'); }
    }).catch(function(){});
  }
  if(document.readyState === 'complete') go(); else window.addEventListener('load', go, {once:true});
  return function(){ dead = true; if(handle) handle.destroy(); };
}
function svgPhoto(){
  var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '24'); s.setAttribute('height', '24');
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2.2');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = '<rect x="3" y="4" width="18" height="16" rx="3"></rect><circle cx="9" cy="10" r="2"></circle><path d="M21 16l-5-5-9 9"></path>';
  return s;
}

function svgSmile(){
  var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '24'); s.setAttribute('height', '24');
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2.2');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = '<circle cx="12" cy="12" r="9"></circle><path d="M8 14c1.2 2 6.8 2 8 0"></path><circle cx="9" cy="10" r=".6"></circle><circle cx="15" cy="10" r=".6"></circle>';
  return s;
}

/* ---------- sheet / confirm / lightbox ---------- */
function openSheet(title, content, onClose){
  var back = h('div', {class:'sheet-back'}), closed = false;
  function close(){ if(closed) return; closed = true; back.remove(); if(onClose) onClose(); }
  var panel = h('div', {class:'sheet', role:'dialog', 'aria-modal':'true', 'aria-label':title},
    h('div', {class:'sheet-head'}, h('div', {class:'sheet-title', text:title}), h('button', {type:'button', class:'xbtn', 'aria-label':'閉じる', text:'×', onclick:close})),
    content);
  back.addEventListener('click', function(e){ if(e.target === back) close(); });
  back.appendChild(panel); overlay.appendChild(back);
  return close;
}
function askConfirm(msg, okLabel){
  return new Promise(function(resolve){
    var done = false, close;
    function fin(v){ if(done) return; done = true; resolve(v); if(close) close(); }
    var box = h('div', null,
      h('p', {text:msg, style:'margin:0 0 14px;font-size:15px'}),
      h('button', {type:'button', class:'b3 red block', text:okLabel || '削除する', onclick:function(){ fin(true); }}),
      h('button', {type:'button', class:'b3 soft block', style:'margin-top:8px', text:'やめる', onclick:function(){ fin(false); }}));
    close = openSheet('確認', box, function(){ if(!done){ done = true; resolve(false); } });
  });
}
function lightbox(src){
  var lb = h('div', {class:'lightbox', role:'dialog', 'aria-label':'写真', onclick:function(){ lb.remove(); }}, h('img', {src:src, alt:'写真'}));
  overlay.appendChild(lb);
}

window.DARAUI = {h:h, api:api, toast:toast, openSheet:openSheet, askConfirm:askConfirm, errMsg:errMsg, cacheStamps:cacheStamps, stampCache:function(){ return st.stamps; }};

/* ---------- images ---------- */
function shrink(file, max, q){
  return new Promise(function(res, rej){
    var fr = new FileReader();
    fr.onerror = rej;
    fr.onload = function(){
      var img = new Image();
      img.onerror = rej;
      img.onload = function(){
        var s = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var url = c.toDataURL('image/jpeg', q);
        c.toBlob(function(b){ if(b) res({blob:b, dataUrl:url}); else rej(new Error('blob')); }, 'image/jpeg', q);
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
function uploadAll(imgs){
  var ids = [];
  return imgs.reduce(function(p, im){
    return p.then(function(){ return api('/api/images', {raw:im.blob, type:'image/jpeg'}).then(function(r){ ids.push(r.id); }); });
  }, Promise.resolve()).then(function(){ return ids; });
}
function media(ids){
  if(!ids || !ids.length) return null;
  var w = h('div', {class:'media n' + Math.min(ids.length, 4)});
  ids.slice(0, 4).forEach(function(id){
    var im = h('img', {src:imgUrl(id), alt:'投稿の写真', loading:'lazy'});
    im.addEventListener('click', function(e){ e.stopPropagation(); lightbox(imgUrl(id)); });
    w.appendChild(im);
  });
  return w;
}

/* ---------- composer ---------- */
function makeComposer(o){
  var imgs = [], busy = false;
  var ta = h('textarea', {class:'ta', rows:o.rows || 1, placeholder:o.placeholder, 'aria-label':o.placeholder});
  var thumbs = h('div', {class:'thumbs'});
  var file = h('input', {type:'file', accept:'image/*', multiple:true, hidden:true});
  var photoBtn = h('button', {type:'button', class:'icobtn', 'aria-label':'写真を追加', onclick:function(){ file.click(); }}, svgPhoto());
  var stampBtn = o.onStamp ? h('button', {type:'button', class:'icobtn', 'aria-label':'スタンプを送る', onclick:function(){
    window.DARAStampUI.openPicker(function(id, spec){
      if(spec) { var m = {}; m[id] = spec; cacheStamps(m); }
      Promise.resolve(o.onStamp(id)).then(function(){ if(o.onDone) o.onDone(); }).catch(function(e){ toast(errMsg(e)); });
    });
  }}, svgSmile()) : null;
  var send = h('button', {type:'button', class:'b3 sm', text:o.submitLabel, disabled:true, onclick:submit});
  function sync(){ send.disabled = busy || (!ta.value.trim() && !imgs.length); }
  ta.addEventListener('input', function(){ ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; sync(); });
  ta.addEventListener('keydown', function(e){ if((e.metaKey || e.ctrlKey) && e.key === 'Enter'){ e.preventDefault(); submit(); } });
  file.addEventListener('change', async function(){
    var files = Array.prototype.slice.call(file.files).slice(0, 4 - imgs.length);
    file.value = '';
    for(var i = 0; i < files.length; i++){
      try{ imgs.push(await shrink(files[i], 1600, 0.85)); }catch(e){ toast('画像を読み込めませんでした'); }
    }
    drawThumbs(); sync();
  });
  function drawThumbs(){
    thumbs.innerHTML = '';
    imgs.forEach(function(im, i){
      thumbs.appendChild(h('div', {class:'th'}, h('img', {src:im.dataUrl, alt:'添付する写真'}),
        h('button', {type:'button', class:'thx', 'aria-label':'写真を外す', text:'×', onclick:function(){ imgs.splice(i, 1); drawThumbs(); sync(); }})));
    });
    thumbs.style.display = imgs.length ? 'flex' : 'none';
  }
  async function submit(){
    if(send.disabled) return;
    busy = true; send.textContent = '送信中'; sync();
    try{
      var ids = imgs.length ? await uploadAll(imgs) : [];
      await o.onSubmit(ta.value.trim(), ids);
      ta.value = ''; ta.style.height = 'auto'; imgs = []; drawThumbs();
      busy = false; send.textContent = o.submitLabel; sync();
      if(o.onDone) o.onDone();
    }catch(e){
      toast(errMsg(e)); busy = false; send.textContent = o.submitLabel; sync();
    }
  }
  var el = h('div', {class:'comp'}, thumbs, h('div', {class:'crow'}, photoBtn, stampBtn, ta, send), file);
  return {el:el, focus:function(){ ta.focus(); }};
}

/* ---------- polling ---------- */
function poll(fn, ms){
  var t = setInterval(function(){ if(!document.hidden) fn(); }, ms);
  function vis(){ if(!document.hidden) fn(); }
  document.addEventListener('visibilitychange', vis);
  return function(){ clearInterval(t); document.removeEventListener('visibilitychange', vis); };
}

/* ---------- shared post ---------- */
function react(tgt, stamp, done){
  api('/api/react', {body:{tgt:tgt, stamp:stamp}}).then(function(r){ cacheStamps(r.stamps); if(done) done(); }).catch(function(e){ toast(errMsg(e)); });
}
function reactBar(p, o){
  if(!o.onReact) return null;
  var bar = h('div', {class:'rxbar'});
  (p.reacts || []).forEach(function(r){
    var b = h('button', {type:'button', class:'rx' + (r.me ? ' me' : ''), 'aria-pressed':r.me ? 'true' : 'false', 'aria-label':'スタンプ ' + r.n + '人'}, stampEl(r.s, 26), h('span', {text:r.n}));
    b.addEventListener('click', function(e){ e.stopPropagation(); react(p.id, r.s, o.onReact); });
    bar.appendChild(b);
  });
  var add = h('button', {type:'button', class:'rx add', 'aria-label':'スタンプをおす'}, svgSmile(), h('span', {text:'＋'}));
  add.addEventListener('click', function(e){
    e.stopPropagation();
    window.DARAStampUI.openPicker(function(id, spec){
      if(spec){ var m = {}; m[id] = spec; cacheStamps(m); }
      react(p.id, id, o.onReact);
    });
  });
  bar.appendChild(add);
  return bar;
}
function postEl(p, o){
  o = o || {};
  var body = h('div', null,
    h('div', {class:'who'}, h('b', {text:user(p.author).name}), h('span', {class:'ago', text:ago(p.ts)})),
    p.text ? h('div', {class:'ptxt', text:p.text}) : null,
    p.stamp ? h('div', {class:'stampbig'}, stampEl(p.stamp, 104)) : null,
    media(p.images),
    o.count !== undefined ? h('div', {class:'meta', text:'コメント ' + o.count}) : null,
    reactBar(p, o),
    o.extra || null);
  var el = h('article', {class:'post' + (o.click ? ' tap' : '') + (o.big ? ' big' : '')}, avatar(p.author, 44), body);
  if(o.click){
    el.setAttribute('tabindex', '0'); el.setAttribute('role', 'button');
    el.addEventListener('click', o.click);
    el.addEventListener('keydown', function(e){ if(e.key === 'Enter') o.click(); });
  }
  return el;
}

/* ---------- auth ---------- */
function authView(){
  var mode = 'login', killHero = null;
  var box = h('div', {class:'auth'});
  function draw(){
    box.innerHTML = '';
    var signup = mode === 'signup';
    var handle = h('input', {class:'field', type:'text', placeholder:'ユーザーID 半角英数字', autocomplete:'username', autocapitalize:'none', 'aria-label':'ユーザーID', maxlength:'20'});
    var name = signup ? h('input', {class:'field', type:'text', placeholder:'表示名', 'aria-label':'表示名', maxlength:'20'}) : null;
    var pw = h('input', {class:'field', type:'password', placeholder:'パスワード 8文字以上', autocomplete:signup ? 'new-password' : 'current-password', 'aria-label':'パスワード'});
    var err = h('div', {class:'err', role:'alert'});
    var btn = h('button', {type:'submit', class:'b3 block', text:signup ? 'はじめる' : 'ログイン'});
    var form = h('form', {novalidate:true}, handle, name, pw, err, btn);
    form.addEventListener('submit', async function(e){
      e.preventDefault(); err.textContent = ''; btn.disabled = true;
      try{
        var r = await api(signup ? '/api/signup' : '/api/login', {body:{handle:handle.value, name:name && name.value, password:pw.value}});
        st.me = r.me; cacheUsers(o(r.me)); location.hash = pending || '#/'; pending = null; render();
      }catch(x){ err.textContent = errMsg(x); btn.disabled = false; }
    });
    var hb = h('div', {class:'hero3d tall'});
    box.appendChild(hb);
    if(killHero) killHero();
    killHero = mountHero(hb);
    box.appendChild(h('div', {class:'tag', text:'友達だけのスレッドをつくろう'}));
    if(pending) box.appendChild(h('div', {class:'hint', style:'text-align:center', text:'登録またはログインすると、招待の続きが開きます'}));
    box.appendChild(form);
    box.appendChild(h('div', {class:'swap'}, signup ? 'アカウントをお持ちの方は ' : 'はじめての方は ',
      h('button', {type:'button', text:signup ? 'ログイン' : '新規登録', onclick:function(){ mode = signup ? 'login' : 'signup'; draw(); }})));
  }
  function o(u){ var m = {}; m[u.id] = u; return m; }
  draw();
  return {el:box, destroy:function(){ if(killHero) killHero(); }};
}

/* ---------- profile ---------- */
function profileSheet(){
  var me = st.me;
  var nameIn = h('input', {class:'field', type:'text', value:me.name, maxlength:'20', 'aria-label':'表示名'});
  var av = h('div', {style:'display:flex;align-items:center;gap:14px'});
  var file = h('input', {type:'file', accept:'image/*', hidden:true});
  function drawAv(){
    av.innerHTML = '';
    av.appendChild(avatar(me.id, 64));
    av.appendChild(h('div', null, h('div', {style:'font-weight:900', text:me.name}), h('div', {class:'hint', text:'@' + me.handle})));
  }
  drawAv();
  file.addEventListener('change', async function(){
    var f = file.files[0]; file.value = ''; if(!f) return;
    try{
      var im = await shrink(f, 400, 0.85);
      var ids = await uploadAll([im]);
      var r = await api('/api/me', {body:{avatar:ids[0]}});
      st.me = r.me; me = r.me; cacheUsers(oneUser(me)); drawAv(); toast('アイコンを変えました');
    }catch(e){ toast(errMsg(e)); }
  });
  function oneUser(u){ var m = {}; m[u.id] = u; return m; }
  var save = h('button', {type:'button', class:'b3 block', style:'margin-top:14px', text:'名前を保存', onclick:async function(){
    try{ var r = await api('/api/me', {body:{name:nameIn.value}}); st.me = r.me; me = r.me; cacheUsers(oneUser(me)); drawAv(); toast('保存しました'); }catch(e){ toast(errMsg(e)); }
  }});
  var box = h('div', null, av,
    h('button', {type:'button', class:'b3 soft sm', style:'margin-top:12px', text:'アイコンを選ぶ', onclick:function(){ file.click(); }}), file,
    h('div', {class:'lbl', text:'表示名'}), nameIn, save,
    h('button', {type:'button', class:'b3 soft block', style:'margin-top:14px;color:var(--danger)', text:'ログアウト', onclick:async function(){
      try{ await api('/api/logout', {body:{}}); }catch(e){}
      st.me = null; close(); location.hash = '#/'; render();
    }}));
  var close = openSheet('プロフィール', box);
}

/* ---------- home ---------- */
function homeView(tab){
  var body = h('div');
  var nav = h('nav', {class:'nav', 'aria-label':'メニュー'});
  var groups = null, fr = null, lastSig = '', friendsUI = null, stampsUI = null, killHero = null;

  var heroBox = tab === 'groups' ? h('div', {class:'hero3d'}) : null;
  if(heroBox) killHero = mountHero(heroBox);
  var el = h('div', {class:'page'},
    h('header', {class:'top'}, heroBox ? h('span') : h('img', {class:'wm', src:'/assets/dara-wordmark.png', alt:'DARA'}),
      h('button', {type:'button', 'aria-label':'プロフィール', onclick:profileSheet}, avatar(st.me.id, 38))),
    heroBox, body, nav);

  function drawNav(){
    nav.innerHTML = '';
    var n = fr ? fr.incoming.length : 0;
    var gb = h('a', {href:'#/', class:'b3 tab' + (tab === 'groups' ? ' ink' : ' soft'), text:'グループ', style:'text-decoration:none'});
    var fb = h('a', {href:'#/friends', class:'b3 tab' + (tab === 'friends' ? ' ink' : ' soft'), style:'text-decoration:none'}, '友達', n ? h('span', {class:'dot', text:n}) : null);
    var sb = h('a', {href:'#/stamps', class:'b3 tab' + (tab === 'stamps' ? ' ink' : ' soft'), text:'スタンプ', style:'text-decoration:none'});
    nav.appendChild(gb); nav.appendChild(fb); nav.appendChild(sb);
  }
  function drawGroups(){
    body.innerHTML = '';
    body.appendChild(h('h2', {class:'sec', text:'グループ'}));
    if(!groups){ body.appendChild(h('div', {class:'hint', text:'読み込み中'})); return; }
    if(!groups.length){
      body.appendChild(h('div', {class:'empty'}, orb(96, 0, {bob:true}),
        h('p', {text:'部屋をつくるか、もらったコードで入りましょう'})));
    }
    var grid = h('div', {class:'grid'});
    groups.forEach(function(g){
      var t = h('button', {type:'button', class:'tile' + (S.roomDark(g) ? ' dk' : ''), style:S.roomVars(g), onclick:function(){ location.hash = '#/g/' + g.id; }},
        S.roomChar(g, 64, false), h('div', {class:'tname', text:g.name}),
        h('div', {class:'tfoot', text:g.members.length + '人  ' + (g.lastText ? g.lastText : 'まだ投稿がありません')}));
      tilt(t); grid.appendChild(t);
    });
    grid.appendChild(h('button', {type:'button', class:'tile new', onclick:createGroupSheet}, '＋ 部屋をつくる'));
    grid.appendChild(h('button', {type:'button', class:'tile new', onclick:joinSheet}, 'コードで入る'));
    body.appendChild(grid);
  }
  function buildFriends(){
    var found = [], lastQ = null, timer;
    var input = h('input', {type:'search', class:'field', placeholder:'IDか名前で探す', 'aria-label':'友達を探す', autocomplete:'off', autocapitalize:'none'});
    var results = h('div'), lists = h('div');
    function reload(){ load(true); }
    function act(fn){ return async function(){ try{ await fn(); reload(); }catch(e){ toast(errMsg(e)); } }; }
    function rel(id){
      if(!fr) return 'none';
      if(fr.friends.some(function(u){ return u.id === id; })) return 'friend';
      if(fr.sent.some(function(u){ return u.id === id; })) return 'sent';
      if(fr.incoming.some(function(u){ return u.id === id; })) return 'incoming';
      return 'none';
    }
    input.addEventListener('input', function(){
      clearTimeout(timer);
      var q = input.value.trim();
      timer = setTimeout(async function(){
        lastQ = q;
        if(q.length < 2){ found = []; drawRes(); return; }
        try{ var r = await api('/api/search?q=' + encodeURIComponent(q)); if(q !== lastQ) return; found = r.users; cacheUsers(toMap(found)); }catch(e){ found = []; }
        drawRes();
      }, 300);
    });
    function drawRes(){
      results.innerHTML = '';
      if(!found.length){ if(lastQ && lastQ.length >= 2) results.appendChild(h('div', {class:'hint', text:'見つかりませんでした'})); return; }
      results.appendChild(h('h2', {class:'sec', text:'さがす'}));
      found.forEach(function(p){
        var r = rel(p.id), btn;
        if(r === 'none') btn = h('button', {type:'button', class:'b3 sm', text:'申請', onclick:act(function(){ return api('/api/friends/request', {body:{id:p.id}}); })});
        else if(r === 'incoming') btn = h('button', {type:'button', class:'b3 sm', text:'承認', onclick:act(function(){ return api('/api/friends/accept', {body:{id:p.id}}); })});
        else btn = h('span', {class:'hint', text:r === 'sent' ? '申請中' : '友達'});
        results.appendChild(h('div', {class:'row'}, avatar(p.id, 44), h('div', {class:'nm'}, p.name, h('small', {text:'@' + p.handle})), btn));
      });
    }
    function drawLists(){
      lists.innerHTML = '';
      if(!fr){ lists.appendChild(h('div', {class:'hint', text:'読み込み中'})); return; }
      if(fr.incoming.length){
        lists.appendChild(h('h2', {class:'sec', text:'リクエスト'}));
        fr.incoming.forEach(function(p){
          lists.appendChild(h('div', {class:'row'}, avatar(p.id, 44), h('div', {class:'nm'}, p.name, h('small', {text:'@' + p.handle})),
            h('button', {type:'button', class:'b3 sm', text:'承認', onclick:act(function(){ return api('/api/friends/accept', {body:{id:p.id}}); })}),
            h('button', {type:'button', class:'b3 sm soft', text:'削除', onclick:act(function(){ return api('/api/friends/remove', {body:{id:p.id}}); })})));
        });
      }
      lists.appendChild(h('h2', {class:'sec', text:'友達'}));
      if(!fr.friends.length) lists.appendChild(h('div', {class:'hint', text:'まだ友達がいません QR・リンク・IDで申請しましょう'}));
      fr.friends.forEach(function(p){
        lists.appendChild(h('div', {class:'row'}, avatar(p.id, 44), h('div', {class:'nm'}, p.name, h('small', {text:'@' + p.handle})),
          h('button', {type:'button', class:'b3 sm soft', text:'解除', onclick:async function(){
            var ok = await askConfirm(p.name + ' さんを友達から外しますか', '解除する');
            if(ok) act(function(){ return api('/api/friends/remove', {body:{id:p.id}}); })();
          }})));
      });
      if(fr.sent.length){
        lists.appendChild(h('h2', {class:'sec', text:'申請中'}));
        fr.sent.forEach(function(p){
          lists.appendChild(h('div', {class:'row'}, avatar(p.id, 44), h('div', {class:'nm'}, p.name, h('small', {text:'@' + p.handle})),
            h('button', {type:'button', class:'b3 sm soft', text:'取り消し', onclick:act(function(){ return api('/api/friends/remove', {body:{id:p.id}}); })})));
        });
      }
    }
    var link = friendLink(st.me.handle);
    var addCard = h('div', {class:'addcard'},
      h('div', {class:'lbl', style:'margin-top:0', text:'あなたのID'}),
      h('div', {class:'myid', text:'@' + st.me.handle}),
      h('div', {class:'btnrow'},
        h('button', {type:'button', class:'b3 sm', text:'QRを見せる', onclick:function(){ qrSheet('友達追加のQR', link, '@' + st.me.handle); }}),
        h('button', {type:'button', class:'b3 sm soft', text:'QRを読み取る', onclick:scanSheet}),
        h('button', {type:'button', class:'b3 sm soft', text:'リンクを共有', onclick:function(){ shareLink('DARA', 'DARAで友達になろう', link); }})));
    return {el:h('div', null, h('h2', {class:'sec', text:'友達'}), addCard, input, results, lists), update:function(){ drawRes(); drawLists(); }};
  }
  function buildStamps(){
    var wrap = h('div'), grid = h('div', {class:'sgrid'}), mine = null;
    function load(){
      api('/api/stamps').then(function(r){
        mine = r.stamps; var m = {}; mine.forEach(function(x){ m[x.id] = x.spec; }); cacheStamps(m); draw();
      }).catch(function(){});
    }
    function draw(){
      grid.innerHTML = '';
      grid.appendChild(h('button', {type:'button', class:'scell new', onclick:function(){ window.DARAStampUI.openEditor(null, {onSaved:load}); }}, h('span', {class:'plus', text:'＋'}), h('small', {text:'つくる'})));
      (mine || []).forEach(function(x){
        grid.appendChild(h('button', {type:'button', class:'scell', 'aria-label':'スタンプをなおす', onclick:function(){
          window.DARAStampUI.openEditor(x.spec, {id:x.id, onSaved:load, onDeleted:load});
        }}, S.render(x.spec, 72)));
      });
    }
    var bi = h('div', {class:'sgrid'});
    S.BUILTIN_IDS.forEach(function(id){ bi.appendChild(h('div', {class:'scell still'}, S.render(S.resolve(id), 72))); });
    wrap.appendChild(h('h2', {class:'sec', text:'じぶんのスタンプ'}));
    wrap.appendChild(h('div', {class:'hint', text:'形・色・顔・文字を組み合わせて、いくつでもつくれます（100個まで）'}));
    wrap.appendChild(grid);
    wrap.appendChild(h('h2', {class:'sec', text:'はじめからあるスタンプ'}));
    wrap.appendChild(bi);
    load(); draw();
    return {el:wrap};
  }
  function toMap(arr){ var m = {}; arr.forEach(function(u){ m[u.id] = u; }); return m; }
  function draw(){
    drawNav();
    if(tab === 'stamps'){
      if(!stampsUI){ stampsUI = buildStamps(); body.innerHTML = ''; body.appendChild(stampsUI.el); }
    }else if(tab === 'friends'){
      if(!friendsUI){ friendsUI = buildFriends(); body.innerHTML = ''; body.appendChild(friendsUI.el); }
      friendsUI.update();
    }else drawGroups();
  }
  async function load(force){
    try{
      var r = await Promise.all([api('/api/groups'), api('/api/friends')]);
      cacheUsers(r[0].users);
      [r[1].friends, r[1].incoming, r[1].sent].forEach(function(a){ cacheUsers(toMap(a)); });
      var sig = JSON.stringify(r);
      if(sig === lastSig && !force) return;
      lastSig = sig; groups = r[0].groups; fr = r[1]; draw();
    }catch(e){}
  }
  var stop = poll(load, 10000);
  draw(); load(true);
  return {el:el, load:load, destroy:function(){ stop(); if(killHero) killHero(); }};
}

function createGroupSheet(){
  var sel = {};
  var nameIn = h('input', {class:'field', type:'text', placeholder:'部屋の名前', maxlength:'30', 'aria-label':'部屋の名前'});
  var create = h('button', {type:'button', class:'b3 block', style:'margin-top:16px', text:'つくる', disabled:true});
  var list = h('div', null, h('div', {class:'hint', text:'読み込み中'}));
  api('/api/friends').then(function(r){
    list.innerHTML = '';
    if(!r.friends.length) list.appendChild(h('div', {class:'hint', text:'友達がいなくても大丈夫 つくったあとに、コードで招待できます'}));
    r.friends.forEach(function(p){
      cacheUsers({[p.id]:p});
      var row = h('button', {type:'button', class:'pickrow', 'aria-pressed':'false'}, avatar(p.id, 40), h('span', {style:'flex:1;font-weight:800', text:p.name}), h('span', {class:'chk', text:'✓'}));
      row.addEventListener('click', function(){ sel[p.id] = !sel[p.id]; row.classList.toggle('on', !!sel[p.id]); row.setAttribute('aria-pressed', sel[p.id] ? 'true' : 'false'); });
      list.appendChild(row);
    });
  }).catch(function(){ list.innerHTML = ''; });
  nameIn.addEventListener('input', function(){ create.disabled = !nameIn.value.trim(); });
  create.addEventListener('click', async function(){
    create.disabled = true;
    try{
      var r = await api('/api/groups', {body:{name:nameIn.value, members:Object.keys(sel).filter(function(k){ return sel[k]; })}});
      inviteFor = r.id; close(); location.hash = '#/g/' + r.id;
    }catch(e){ toast(errMsg(e)); create.disabled = false; }
  });
  var close = openSheet('新しい部屋', h('div', null, nameIn, h('div', {class:'lbl', text:'メンバーにする友達'}), list, create));
  setTimeout(function(){ nameIn.focus(); }, 60);
}

function joinSheet(){
  var inp = h('input', {class:'field code-in', type:'text', placeholder:'ABCD-EFGH', autocapitalize:'characters', autocomplete:'off', spellcheck:false, 'aria-label':'部屋のコード', maxlength:'12'});
  var go = h('button', {type:'button', class:'b3 block', style:'margin-top:14px', text:'この部屋に入る', disabled:true});
  inp.addEventListener('input', function(){ go.disabled = inp.value.replace(/[\s-]/g, '').length < 8; });
  function submit(){ if(go.disabled) return; var c = inp.value.replace(/[\s-]/g, '').toUpperCase(); close(); location.hash = '#/join/' + c; }
  go.addEventListener('click', submit);
  inp.addEventListener('keydown', function(e){ if(e.key === 'Enter') submit(); });
  var close = openSheet('コードで入る', h('div', null,
    h('div', {class:'hint', style:'margin-bottom:8px', text:'友達からもらった部屋のコードを入れてください'}), inp, go,
    h('button', {type:'button', class:'b3 soft block', style:'margin-top:10px', text:'QRを読み取る', onclick:function(){ close(); setTimeout(scanSheet, 50); }})));
  setTimeout(function(){ inp.focus(); }, 60);
}

/* ---------- group ---------- */
function groupInfoSheet(gid, info){
  var box = h('div', null, h('div', {class:'hint', text:'読み込み中'}));
  async function draw(){
    var g, fr;
    try{
      var r = await Promise.all([api('/api/groups/' + gid), api('/api/friends')]);
      g = r[0]; fr = r[1]; cacheUsers(g.users);
    }catch(e){ return; }
    box.innerHTML = '';
    var code = g.group.code, gname = g.group.name;
    box.appendChild(h('button', {type:'button', class:'b3 soft block', text:'部屋の名前・色・キャラクターを変える', onclick:function(){
      close(); window.DARAStampUI.openRoomStyle(g.group, function(){ if(info) info(); });
    }}));
    box.appendChild(h('div', {class:'lbl', text:'招待コード'}));
    box.appendChild(h('div', {class:'code', text:fmtCode(code)}));
    box.appendChild(h('div', {class:'hint', text:'このコードを知っている人は、友達でなくても入れます'}));
    box.appendChild(h('div', {class:'btnrow'},
      h('button', {type:'button', class:'b3 sm', text:'コードをコピー', onclick:function(){ copyText(fmtCode(code)); }}),
      h('button', {type:'button', class:'b3 sm soft', text:'リンクを共有', onclick:function(){ shareLink('DARA', '「' + gname + '」に招待されました', roomLink(code)); }}),
      h('button', {type:'button', class:'b3 sm soft', text:'QR', onclick:function(){ qrSheet('部屋のQR', roomLink(code), gname + '  ' + fmtCode(code)); }})));
    box.appendChild(h('button', {type:'button', class:'ghost', text:'コードを作り直す', onclick:async function(){
      var ok = await askConfirm('新しいコードを作ります 古いコードでは入れなくなります', '作り直す');
      if(!ok) return;
      try{ await api('/api/groups/' + gid + '/code', {body:{}}); await draw(); toast('新しいコードにしました'); }catch(e){ toast(errMsg(e)); }
    }}));
    box.appendChild(h('div', {class:'lbl', text:'メンバー ' + g.group.members.length + '人'}));
    g.group.members.forEach(function(id){
      box.appendChild(h('div', {class:'row'}, avatar(id, 44), h('div', {class:'nm', text:user(id).name + (id === st.me.id ? '（あなた）' : '')})));
    });
    var addable = fr.friends.filter(function(p){ return g.group.members.indexOf(p.id) < 0; });
    box.appendChild(h('div', {class:'lbl', text:'友達を追加'}));
    if(!addable.length) box.appendChild(h('div', {class:'hint', text:'追加できる友達はいません'}));
    addable.forEach(function(p){
      cacheUsers({[p.id]:p});
      box.appendChild(h('div', {class:'row'}, avatar(p.id, 44), h('div', {class:'nm', text:p.name}),
        h('button', {type:'button', class:'b3 sm', text:'追加', onclick:async function(){
          try{ await api('/api/groups/' + gid + '/members', {body:{ids:[p.id]}}); await draw(); if(info) info(); }catch(e){ toast(errMsg(e)); }
        }})));
    });
    box.appendChild(h('button', {type:'button', class:'b3 soft block', style:'margin-top:16px;color:var(--danger)', text:'この部屋を抜ける', onclick:async function(){
      var ok = await askConfirm('この部屋を抜けますか 投稿は残ります', '抜ける');
      if(!ok) return;
      try{ await api('/api/groups/' + gid + '/leave', {body:{}}); close(); location.hash = '#/'; }catch(e){ toast(errMsg(e)); }
    }}));
  }
  var close = openSheet('部屋', box);
  draw();
}

function groupView(gid){
  var banner = h('div', {class:'banner'}), feed = h('div'), group = null, threads = null, lastSig = '';
  var entry = h('button', {type:'button', class:'entry', onclick:function(){ openCompose(gid, load); }}, avatar(st.me.id, 44), h('span', {text:'いま何してる'}));
  var el = h('div', {class:'page'}, banner, entry, feed);

  function draw(){
    if(!group) return;
    banner.className = 'banner pt' + (group.pattern || 0) + (S.roomDark(group) ? ' dk' : '');
    banner.style.cssText = S.roomVars(group);
    banner.innerHTML = '';
    var stack = h('div', {class:'stack'});
    group.members.slice(0, 5).forEach(function(id){ stack.appendChild(avatar(id, 34)); });
    banner.appendChild(h('button', {type:'button', class:'back', text:'‹ 戻る', onclick:function(){ location.hash = '#/'; }}));
    banner.appendChild(S.roomChar(group, 96, true));
    banner.appendChild(h('h1', {text:group.name}));
    if(group.desc) banner.appendChild(h('div', {class:'bdesc', text:group.desc}));
    banner.appendChild(h('div', {class:'bfoot'}, stack, h('button', {type:'button', class:'pill', text:'メンバー ' + group.members.length + '人', onclick:function(){ groupInfoSheet(gid, load); }})));
    feed.innerHTML = '';
    if(!threads){ feed.appendChild(h('div', {class:'hint', style:'padding:16px 4px', text:'読み込み中'})); return; }
    if(!threads.length) feed.appendChild(h('div', {class:'hint', style:'padding:16px 4px', text:'最初のスレッドを立ててみましょう'}));
    threads.forEach(function(t){
      feed.appendChild(postEl(t, {count:t.count, click:function(){ location.hash = '#/t/' + t.id; }, onReact:function(){ load(true); }}));
    });
  }
  async function load(force){
    try{
      var r = await Promise.all([api('/api/groups/' + gid), api('/api/groups/' + gid + '/threads')]);
      cacheUsers(r[0].users); cacheUsers(r[1].users); cacheStamps(r[1].stamps);
      var sig = JSON.stringify(r);
      if(sig === lastSig && force !== true) return;
      lastSig = sig; group = r[0].group; threads = r[1].threads; draw();
      if(inviteFor === gid){ inviteFor = null; groupInfoSheet(gid, load); }
    }catch(e){ if(e.status === 404){ location.hash = '#/'; } }
  }
  var stop = poll(load, 6000);
  load(true);
  return {el:el, load:load, destroy:stop};
}

function openCompose(gid, after){
  var close;
  var comp = makeComposer({
    placeholder:'いま何してる', submitLabel:'投稿', rows:4,
    onSubmit:function(text, ids){ if(!text && !ids.length) return Promise.resolve(); return api('/api/groups/' + gid + '/threads', {body:{text:text, images:ids}}); },
    onDone:function(){ close(); if(after) after(true); }
  });
  close = openSheet('新しいスレッド', comp.el);
  setTimeout(function(){ comp.focus(); }, 60);
}

/* ---------- thread ---------- */
function threadView(tid){
  var head = h('div', {class:'tbar'}), postBox = h('div'), list = h('div'), data = null, lastSig = '', gid = null;
  var comp = makeComposer({
    placeholder:'コメントする', submitLabel:'送信',
    onSubmit:function(text, ids){ if(!text && !ids.length) return Promise.resolve(); return api('/api/threads/' + tid + '/comments', {body:{text:text, images:ids}}); },
    onStamp:function(id){ return api('/api/threads/' + tid + '/comments', {body:{stamp:id}}); },
    onDone:function(){ load(true); }
  });
  var dock = h('div', {class:'dock'}, comp.el);
  var el = h('div', {class:'page'}, head, postBox, list, dock);

  function draw(){
    if(!data) return;
    var t = data.thread, cs = data.comments;
    head.innerHTML = '';
    head.appendChild(h('button', {type:'button', class:'back', text:'‹ ' + data.group.name, onclick:function(){ location.hash = '#/g/' + t.gid; }}));
    postBox.innerHTML = '';
    var extra = null;
    if(t.author === st.me.id){
      extra = h('div', null, h('button', {type:'button', class:'ghost', text:'削除', onclick:async function(){
        var ok = await askConfirm('このスレッドを削除しますか コメントも見られなくなります', '削除する');
        if(!ok) return;
        try{ await api('/api/threads/' + tid, {method:'DELETE', body:{}}); location.hash = '#/g/' + t.gid; }catch(e){ toast(errMsg(e)); }
      }}));
    }
    postBox.appendChild(postEl(t, {big:true, extra:extra, onReact:function(){ load(true); }}));
    list.innerHTML = '';
    list.appendChild(h('div', {class:'cdiv', text:'コメント ' + cs.length}));
    if(!cs.length) list.appendChild(h('div', {class:'hint', style:'padding:10px 4px', text:'最初のコメントを書いてみましょう'}));
    cs.forEach(function(c){
      var ex = null;
      if(c.author === st.me.id){
        ex = h('div', null, h('button', {type:'button', class:'ghost', text:'削除', onclick:async function(){
          var ok = await askConfirm('このコメントを削除しますか', '削除する');
          if(!ok) return;
          try{ await api('/api/comments/' + c.id, {method:'DELETE', body:{}}); load(true); }catch(e){ toast(errMsg(e)); }
        }}));
      }
      list.appendChild(postEl(c, {extra:ex, onReact:function(){ load(true); }}));
    });
  }
  async function load(force){
    try{
      var r = await api('/api/threads/' + tid);
      cacheUsers(r.users); cacheStamps(r.stamps);
      var sig = JSON.stringify(r);
      if(sig === lastSig && force !== true) return;
      lastSig = sig; data = r; gid = r.thread.gid; draw();
    }catch(e){ if(e.status === 404){ location.hash = '#/'; } }
  }
  var stop = poll(load, 4000);
  load(true);
  return {el:el, load:load, destroy:stop};
}

/* ---------- friend link / room link ---------- */
function linkPage(){
  var body = h('div', {class:'pcard'}, h('div', {class:'hint', text:'読み込み中'}));
  var el = h('div', {class:'page'},
    h('header', {class:'top'}, h('button', {type:'button', class:'back2', text:'‹ ホーム', onclick:function(){ location.hash = '#/'; }}), h('span')), body);
  return {el:el, body:body};
}
function addView(handle){
  var pg = linkPage(), body = pg.body;
  async function load(){
    try{
      var r = await api('/api/u/' + encodeURIComponent(handle));
      cacheUsers(oneU(r.user)); draw(r.user, r.rel);
    }catch(e){ body.innerHTML = ''; body.appendChild(h('div', {class:'hint', text:errMsg(e)})); }
  }
  function oneU(u){ var m = {}; m[u.id] = u; return m; }
  function draw(u, rel){
    body.innerHTML = '';
    body.appendChild(avatar(u.id, 96));
    body.appendChild(h('div', {style:'font-weight:900;font-size:22px', text:u.name}));
    body.appendChild(h('div', {class:'hint', text:'@' + u.handle}));
    var label = {none:'友達に申請', incoming:'承認して友達になる', sent:'申請しました', friend:'友達です', self:'これはあなたです'}[rel];
    var btn = h('button', {type:'button', class:'b3 block', style:'max-width:320px', text:label, disabled:rel === 'sent' || rel === 'friend' || rel === 'self'});
    btn.addEventListener('click', async function(){
      btn.disabled = true;
      try{ var r = await api('/api/friends/request', {body:{handle:u.handle}}); draw(u, r.rel); toast(r.rel === 'friend' ? '友達になりました' : '申請しました'); }
      catch(e){ toast(errMsg(e)); btn.disabled = false; }
    });
    body.appendChild(btn);
  }
  load();
  return {el:pg.el, destroy:function(){}};
}
function joinView(code){
  var pg = linkPage(), body = pg.body;
  api('/api/join/' + encodeURIComponent(code)).then(function(r){
    var g = r.group;
    body.innerHTML = '';
    body.appendChild(S.roomChar(g, 128, true));
    body.appendChild(h('div', {class:'hint', text:'この部屋に招待されています'}));
    body.appendChild(h('div', {style:'font-weight:900;font-size:24px', text:g.name}));
    body.appendChild(h('div', {class:'hint', text:g.count + '人がいます'}));
    var btn = h('button', {type:'button', class:'b3 block', style:'max-width:320px', text:r.already ? '部屋をひらく' : '参加する'});
    btn.addEventListener('click', async function(){
      btn.disabled = true;
      try{ if(!r.already) await api('/api/groups/join', {body:{code:code}}); location.hash = '#/g/' + g.id; }
      catch(e){ toast(errMsg(e)); btn.disabled = false; }
    });
    body.appendChild(btn);
  }).catch(function(e){ body.innerHTML = ''; body.appendChild(h('div', {class:'hint', text:errMsg(e)})); });
  return {el:pg.el, destroy:function(){}};
}

/* ---------- router ---------- */
function render(){
  if(cur && cur.destroy) cur.destroy();
  overlay.innerHTML = '';
  app.innerHTML = '';
  window.scrollTo(0, 0);
  if(!st.me){
    if(/^#\/(add|join)\//.test(location.hash)) pending = location.hash;
    cur = authView(); app.appendChild(cur.el); return;
  }
  var p = (location.hash.replace(/^#/, '') || '/').split('/').filter(Boolean);
  if(p[0] === 'g' && p[1]) cur = groupView(p[1]);
  else if(p[0] === 't' && p[1]) cur = threadView(p[1]);
  else if(p[0] === 'add' && p[1]) cur = addView(p[1]);
  else if(p[0] === 'join' && p[1]) cur = joinView(p[1]);
  else if(p[0] === 'friends') cur = homeView('friends');
  else if(p[0] === 'stamps') cur = homeView('stamps');
  else cur = homeView('groups');
  app.appendChild(cur.el);
}
window.addEventListener('hashchange', render);

api('/api/me').then(function(r){
  st.me = r.me;
  if(r.me){ var m = {}; m[r.me.id] = r.me; cacheUsers(m); }
  render();
}).catch(function(){ render(); });
})();
