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
  recovery:'ユーザーIDか復旧コードが違います', blocked:'この相手には送れません', pin_limit:'ピン留めは3つまでです', no_poll:'アンケートではありません',
  locked:'この部屋の見た目は、オーナーだけが変えられます', owner_only:'オーナーだけができる操作です', forbidden:'この操作はできません',
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

/* ---------- rich text: @mention / link ---------- */
function richText(text){
  var frag = document.createDocumentFragment();
  var re = /(https?:\/\/[^\s<>"']+)|(^|[^a-z0-9_])@([a-z0-9_]{3,20})/g, last = 0, m;
  while((m = re.exec(text))){
    if(m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    if(m[1]){
      frag.appendChild(h('a', {href:m[1], target:'_blank', rel:'noopener noreferrer', class:'lnk', text:m[1], onclick:function(e){ e.stopPropagation(); }}));
    }else{
      if(m[2]) frag.appendChild(document.createTextNode(m[2]));
      (function(handle){
        frag.appendChild(h('button', {type:'button', class:'mention', text:'@' + handle, onclick:function(e){ e.stopPropagation(); location.hash = '#/add/' + handle; }}));
      })(m[3]);
    }
    last = re.lastIndex;
  }
  if(last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
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
function openSheet(title, content, onClose, opts){
  opts = opts || {};
  var back = h('div', {class:'sheet-back'}), closed = false;
  function close(){ if(closed) return; closed = true; back.remove(); if(onClose) onClose(); }
  var head = h('div', {class:'sheet-head'}, h('div', {class:'sheet-title', text:title}), h('button', {type:'button', class:'xbtn', 'aria-label':'閉じる', text:'×', onclick:close}));
  // opts.top があるときは、見出しとその部品を上に固定して、下だけスクロールさせる
  var panel = opts.top
    ? h('div', {class:'sheet split', role:'dialog', 'aria-modal':'true', 'aria-label':title}, head, opts.top, h('div', {class:'sbody'}, content))
    : h('div', {class:'sheet', role:'dialog', 'aria-modal':'true', 'aria-label':title}, head, content);
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

window.DARAUI = {fillBanner:function(){ return fillBanner.apply(null, arguments); }, tileEl:function(){ return tileEl.apply(null, arguments); }, shrinkAs:shrinkAs, uploadRaw:uploadRaw, h:h, api:api, toast:toast, openSheet:openSheet, askConfirm:askConfirm, errMsg:errMsg, cacheStamps:cacheStamps, stampCache:function(){ return st.stamps; }};

/* ---------- images ---------- */
function shrink(file, max, q, mime){
  mime = mime || 'image/jpeg';
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
        var url = c.toDataURL(mime, q);
        c.toBlob(function(b){ if(b) res({blob:b, dataUrl:url}); else rej(new Error('blob')); }, mime, q);
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
function shrinkAs(file, max, mime){ return shrink(file, max, 0.9, mime); }
function uploadRaw(blob, type){ return api('/api/images', {raw:blob, type:type}).then(function(r){ return r.id; }); }
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
  var sugg = h('div', {class:'mbox', role:'listbox', 'aria-label':'呼びかける人'});
  var dkey = o.draft ? 'dara.draft.' + o.draft : null;
  function saveDraft(){ if(!dkey) return; try{ if(ta.value.trim()) localStorage.setItem(dkey, ta.value); else localStorage.removeItem(dkey); }catch(e){} }
  function sync(){ send.disabled = busy || (!ta.value.trim() && !imgs.length && !(o.canEmpty && o.canEmpty())); }
  function fit(){ ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; }
  if(dkey){ try{ var dv = localStorage.getItem(dkey); if(dv){ ta.value = dv; setTimeout(fit, 0); setTimeout(sync, 0); } }catch(e){} }
  function mentionCheck(){
    sugg.innerHTML = ''; sugg.style.display = 'none';
    if(!o.mentions) return;
    var pos = ta.selectionStart, before = ta.value.slice(0, pos), m = before.match(/(^|[\s　])@([a-z0-9_]*)$/);
    if(!m) return;
    var q = m[2].toLowerCase();
    var list = (o.mentions() || []).filter(function(u){ return u.id !== st.me.id && (!q || u.handle.indexOf(q) === 0 || (u.name || '').toLowerCase().indexOf(q) >= 0); }).slice(0, 5);
    if(!list.length) return;
    list.forEach(function(u){
      sugg.appendChild(h('button', {type:'button', class:'mitem', role:'option', onclick:function(){
        var start = pos - m[2].length - 1;
        ta.value = ta.value.slice(0, start) + '@' + u.handle + ' ' + ta.value.slice(pos);
        var np = start + u.handle.length + 2; ta.focus(); ta.setSelectionRange(np, np);
        sugg.style.display = 'none'; fit(); sync(); saveDraft();
      }}, avatar(u.id, 28), h('span', {class:'mn', text:u.name}), h('small', {text:'@' + u.handle})));
    });
    sugg.style.display = 'block';
  }
  ta.addEventListener('input', function(){ fit(); sync(); saveDraft(); mentionCheck(); });
  ta.addEventListener('keyup', function(e){ if(e.key === 'ArrowLeft' || e.key === 'ArrowRight') mentionCheck(); });
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
      ta.value = ''; ta.style.height = 'auto'; imgs = []; drawThumbs(); saveDraft(); sugg.style.display = 'none';
      busy = false; send.textContent = o.submitLabel; sync();
      if(o.onDone) o.onDone();
    }catch(e){
      toast(errMsg(e)); busy = false; send.textContent = o.submitLabel; sync();
    }
  }
  var el = h('div', {class:'comp'}, sugg, thumbs, h('div', {class:'crow'}, photoBtn, stampBtn, ta, send), file);
  return {el:el, focus:function(){ ta.focus(); }, sync:sync, clearDraft:function(){ ta.value = ''; saveDraft(); }};
}

/* ---------- polling ---------- */
function poll(fn, ms){
  var t = setInterval(function(){ if(!document.hidden) fn(); }, ms);
  function vis(){ if(!document.hidden) fn(); }
  document.addEventListener('visibilitychange', vis);
  return function(){ clearInterval(t); document.removeEventListener('visibilitychange', vis); };
}

/* ---------- edit / delete posts ---------- */
function editSheet(kind, id, text, done){
  var ta = h('textarea', {class:'ta', rows:5, 'aria-label':'本文', style:'width:100%'});
  ta.value = text;
  var save = h('button', {type:'button', class:'b3 block', style:'margin-top:12px', text:'保存する'});
  save.addEventListener('click', async function(){
    save.disabled = true;
    try{ await api('/api/' + (kind === 'thread' ? 'threads/' : 'comments/') + id, {method:'PATCH', body:{text:ta.value}}); close(); toast('なおしました'); if(done) done(); }
    catch(e){ toast(errMsg(e)); save.disabled = false; }
  });
  var close = openSheet('なおす', h('div', null, ta, save));
  setTimeout(function(){ ta.focus(); }, 60);
}
// 自分の投稿は編集・削除、部屋のオーナーはほかの人の投稿も削除できる。ほかの人の投稿は通報・ブロックもできる
function reportSheet(kind, tgt){
  var REASONS = ['スパム・迷惑', '不適切な内容', 'いやがらせ', 'その他'];
  var sel = 0, box = h('div'), note = h('input', {class:'field', type:'text', maxlength:'100', placeholder:'くわしく（任意）', 'aria-label':'くわしい理由'});
  var list = h('div', {class:'chips'});
  function draw(){ list.innerHTML = ''; REASONS.forEach(function(t, i){ list.appendChild(h('button', {type:'button', class:'chip' + (sel === i ? ' on' : ''), text:t, onclick:function(){ sel = i; draw(); }})); }); }
  draw();
  var go = h('button', {type:'button', class:'b3 block', style:'margin-top:14px', text:'通報する'});
  go.addEventListener('click', async function(){
    go.disabled = true;
    try{ await api('/api/report', {body:{kind:kind, tgt:tgt, reason:REASONS[sel] + (note.value.trim() ? ' / ' + note.value.trim() : '')}}); close(); toast('通報しました'); }
    catch(e){ toast(errMsg(e)); go.disabled = false; }
  });
  box.appendChild(h('div', {class:'hint', style:'margin-bottom:8px', text:'部屋のオーナーに、匿名で知らされます'}));
  box.appendChild(list); box.appendChild(note); box.appendChild(go);
  var close = openSheet('通報する', box);
}
function blockUser(id, after){
  askConfirm(user(id).name + ' さんをブロックしますか 投稿やメッセージが見えなくなり、友達も解除されます', 'ブロックする').then(async function(ok){
    if(!ok) return;
    try{ await api('/api/blocks', {body:{id:id}}); toast('ブロックしました'); if(after) after(); }catch(e){ toast(errMsg(e)); }
  });
}
function moreSheet(kind, p, done){
  var box = h('div');
  box.appendChild(h('button', {type:'button', class:'b3 soft block', text:'この投稿を通報する', onclick:function(){ close(); reportSheet(kind, p.id); }}));
  box.appendChild(h('button', {type:'button', class:'b3 soft block', style:'margin-top:8px;color:var(--danger)', text:user(p.author).name + ' さんをブロックする', onclick:function(){ close(); blockUser(p.author, done.edit); }}));
  var close = openSheet('この投稿について', box);
}
function postTools(kind, p, roomOwner, done){
  var mine = p.author === st.me.id;
  done = done || {};
  if(!mine && !roomOwner && !done.reply && kind === 'dm') return null;
  var row = h('div', {class:'ptools'});
  if(done.reply) row.appendChild(h('button', {type:'button', class:'ghost', text:'返信', onclick:function(e){ e.stopPropagation(); done.reply(p); }}));
  if(kind === 'thread' && (mine || roomOwner)) row.appendChild(h('button', {type:'button', class:'ghost', text:p.pinned ? 'ピン留めを外す' : 'ピン留め', onclick:async function(e){
    e.stopPropagation();
    try{ await api('/api/threads/' + p.id + '/pin', {body:{pinned:!p.pinned}}); if(done.edit) done.edit(); }catch(x){ toast(errMsg(x)); }
  }}));
  if(mine) row.appendChild(h('button', {type:'button', class:'ghost', text:'編集', onclick:function(e){ e.stopPropagation(); editSheet(kind, p.id, p.text || '', done.edit); }}));
  if(mine || roomOwner) row.appendChild(h('button', {type:'button', class:'ghost', text:mine ? '削除' : '削除（オーナー）', onclick:async function(e){
    e.stopPropagation();
    var ok = await askConfirm(kind === 'thread' ? 'このスレッドを削除しますか コメントも見られなくなります' : 'このコメントを削除しますか', '削除する');
    if(!ok) return;
    try{ await api('/api/' + (kind === 'thread' ? 'threads/' : 'comments/') + p.id, {method:'DELETE', body:{}}); if(done.del) done.del(); }
    catch(x){ toast(errMsg(x)); }
  }}));
  if(!mine) row.appendChild(h('button', {type:'button', class:'ghost', 'aria-label':'そのほか', text:'…', onclick:function(e){ e.stopPropagation(); moreSheet(kind, p, done); }}));
  return row.childNodes.length ? row : null;
}

/* ---------- shared post ---------- */
function reactorsSheet(r){
  var box = h('div', null, h('div', {class:'rxhead'}, stampEl(r.s, 64), h('b', {text:r.n + '人'})));
  (r.u || []).forEach(function(id){ box.appendChild(h('div', {class:'row'}, avatar(id, 40), h('div', {class:'nm', text:user(id).name}))); });
  if(r.n > (r.u || []).length) box.appendChild(h('div', {class:'hint', text:'ほか ' + (r.n - r.u.length) + '人'}));
  openSheet('スタンプを押した人', box);
}
// アンケート
function pollEl(p, changed){
  var pl = p.poll, box = h('div', {class:'poll', role:'group', 'aria-label':'アンケート'});
  pl.options.forEach(function(t, i){
    var pct = pl.total ? Math.round(pl.counts[i] * 100 / pl.total) : 0;
    var b = h('button', {type:'button', class:'popt' + (pl.mine === i ? ' me' : ''), 'aria-pressed':pl.mine === i ? 'true' : 'false'},
      h('span', {class:'pbar', style:'width:' + pct + '%'}), h('span', {class:'plabel', text:t}), h('span', {class:'pct', text:pl.counts[i] + '票  ' + pct + '%'}));
    b.addEventListener('click', function(e){
      e.stopPropagation();
      api('/api/threads/' + p.id + '/vote', {body:{opt:i}}).then(function(){ if(changed) changed(); }).catch(function(x){ toast(errMsg(x)); });
    });
    box.appendChild(b);
  });
  box.appendChild(h('div', {class:'hint', text:'全部で ' + pl.total + '票  もう一度押すと取り消せます'}));
  return box;
}
function react(tgt, stamp, done){
  api('/api/react', {body:{tgt:tgt, stamp:stamp}}).then(function(r){ cacheStamps(r.stamps); if(done) done(); }).catch(function(e){ toast(errMsg(e)); });
}
function reactBar(p, o){
  if(!o.onReact) return null;
  var bar = h('div', {class:'rxbar'});
  (p.reacts || []).forEach(function(r){
    var b = h('button', {type:'button', class:'rx' + (r.me ? ' me' : ''), 'aria-pressed':r.me ? 'true' : 'false', 'aria-label':'スタンプ ' + r.n + '人'}, stampEl(r.s, 26), h('span', {text:r.n}));
    var lp = null, longPressed = false;
    b.addEventListener('pointerdown', function(){ longPressed = false; lp = setTimeout(function(){ longPressed = true; reactorsSheet(r); }, 550); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function(ev){ b.addEventListener(ev, function(){ clearTimeout(lp); }); });
    b.addEventListener('contextmenu', function(e){ e.preventDefault(); });
    b.addEventListener('click', function(e){ e.stopPropagation(); if(longPressed){ longPressed = false; return; } react(p.id, r.s, o.onReact); });
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
    h('div', {class:'who'}, h('b', {text:user(p.author).name}), h('span', {class:'ago', text:ago(p.ts)}), p.edited ? h('span', {class:'ago', text:'編集済み'}) : null, p.pinned ? h('span', {class:'pinned', text:'ピン留め'}) : null),
    p.text ? h('div', {class:'ptxt'}, richText(p.text)) : null,
    p.poll ? pollEl(p, o.onReact) : null,
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
        if(r.recovery) setTimeout(function(){ recoverySheet(r.recovery, '復旧コードを保存してください'); }, 300);
      }catch(x){ err.textContent = errMsg(x); btn.disabled = false; }
    });
    var hb = h('div', {class:'hero3d tall'});
    box.appendChild(hb);
    if(killHero) killHero();
    killHero = mountHero(hb);
    box.appendChild(h('div', {class:'tag', text:'友達だけのスレッドをつくろう'}));
    if(pending) box.appendChild(h('div', {class:'hint', style:'text-align:center', text:'登録またはログインすると、招待の続きが開きます'}));
    box.appendChild(form);
    if(!signup) box.appendChild(h('div', {class:'swap'}, h('button', {type:'button', text:'パスワードを忘れた方', onclick:resetSheet})));
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
  var bioIn = h('textarea', {class:'ta', rows:2, maxlength:'80', placeholder:'ひとこと自己紹介', 'aria-label':'自己紹介', style:'width:100%'});
  bioIn.value = me.bio || '';
  var save = h('button', {type:'button', class:'b3 block', style:'margin-top:14px', text:'保存する', onclick:async function(){
    try{ var r = await api('/api/me', {body:{name:nameIn.value, bio:bioIn.value}}); st.me = r.me; me = r.me; cacheUsers(oneUser(me)); drawAv(); toast('保存しました'); }catch(e){ toast(errMsg(e)); }
  }});
  var box = h('div', null, av,
    h('button', {type:'button', class:'b3 soft sm', style:'margin-top:12px', text:'アイコンを選ぶ', onclick:function(){ file.click(); }}), file,
    h('div', {class:'lbl', text:'表示名'}), nameIn, h('div', {class:'lbl', text:'自己紹介'}), bioIn, save,
    h('button', {type:'button', class:'b3 soft block', style:'margin-top:10px', text:'設定（通知・既読・ブロック・パスワード）', onclick:function(){ close(); settingsSheet(); }}),
    h('button', {type:'button', class:'b3 soft block', style:'margin-top:14px;color:var(--danger)', text:'ログアウト', onclick:async function(){
      try{ await api('/api/logout', {body:{}}); }catch(e){}
      st.me = null; close(); location.hash = '#/'; render();
    }}));
  var close = openSheet('プロフィール', box);
}

/* ---------- notifications / search ---------- */
var NKIND = {comment:'がコメントしました', reply:'が返信しました', mention:'があなたを呼びました', react:'がスタンプを押しました',
  friend_req:'から友達申請が届きました', friend_ok:'と友達になりました', report:'通報がありました'};
function svgIcon(d, w){
  var e = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  e.setAttribute('viewBox', '0 0 24 24'); e.setAttribute('width', w || '22'); e.setAttribute('height', w || '22'); e.setAttribute('fill', 'none');
  e.setAttribute('stroke', 'currentColor'); e.setAttribute('stroke-width', '2.2'); e.setAttribute('stroke-linecap', 'round'); e.setAttribute('stroke-linejoin', 'round');
  e.innerHTML = d; return e;
}
function svgBell(){ return svgIcon('<path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7"></path><path d="M10 20a2 2 0 0 0 4 0"></path>'); }
function svgSearch(){ return svgIcon('<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path>'); }
function notifSheet(after){
  var box = h('div', null, h('div', {class:'hint', text:'読み込み中'}));
  var close = openSheet('通知', box, after);
  function go(n){
    api('/api/notifs/read', {body:{id:n.id}}).catch(function(){});
    close();
    if(n.tid) location.hash = '#/t/' + n.tid;
    else if(n.kind === 'mention' && n.peer) location.hash = '#/dm/' + n.peer;
    else if(n.kind === 'friend_req' || n.kind === 'friend_ok') location.hash = '#/friends';
  }
  function draw(){
    api('/api/notifs').then(function(r){
      cacheUsers(r.users); box.innerHTML = '';
      if(pushEnv().ok && Notification.permission === 'default' && !localStorage.getItem('dara.pushnudge')){
        box.appendChild(h('div', {class:'nudge'}, h('b', {text:'スマホに通知を届けますか'}), h('div', {class:'hint', text:'アプリを閉じていても、コメントやメッセージに気づけます'}),
          h('div', {class:'btnrow'},
            h('button', {type:'button', class:'b3 sm', text:'オンにする', onclick:async function(){ try{ await pushOn(); toast('通知をオンにしました'); }catch(e){ toast(e.message === 'denied' ? '通知が許可されませんでした' : errMsg(e)); } draw(); }}),
            h('button', {type:'button', class:'b3 sm soft', text:'あとで', onclick:function(){ try{ localStorage.setItem('dara.pushnudge', '1'); }catch(e){} draw(); }}))));
      }
      if(!r.items.length){ box.appendChild(h('div', {class:'empty'}, orb(72, 1, {bob:true}), h('p', {text:'通知はまだありません'}))); return; }
      if(r.unread) box.appendChild(h('button', {type:'button', class:'b3 soft sm', text:'すべて既読にする', onclick:function(){ api('/api/notifs/read', {body:{}}).then(draw); }}));
      r.items.forEach(function(n){
        var who = n.actor ? user(n.actor).name : '';
        box.appendChild(h('button', {type:'button', class:'nrow' + (n.rd ? '' : ' new'), onclick:function(){ go(n); }},
          n.actor ? avatar(n.actor, 40) : orb(40, 5, {face:false}),
          h('div', {class:'nm'}, h('b', {text:who}), (n.kind === 'report' ? '' : '') + NKIND[n.kind], h('small', {text:n.text || ''})),
          h('span', {class:'ago', text:ago(n.ts)})));
      });
    }).catch(function(){ box.innerHTML = ''; box.appendChild(h('div', {class:'hint', text:'読み込めませんでした'})); });
  }
  draw();
}
function highlight(text, q){
  var frag = document.createDocumentFragment(), i = text.toLowerCase().indexOf(q.toLowerCase());
  if(i < 0) { frag.appendChild(document.createTextNode(text.slice(0, 90))); return frag; }
  var from = Math.max(0, i - 18), to = Math.min(text.length, i + q.length + 60);
  frag.appendChild(document.createTextNode((from > 0 ? '…' : '') + text.slice(from, i)));
  frag.appendChild(h('mark', {text:text.slice(i, i + q.length)}));
  frag.appendChild(document.createTextNode(text.slice(i + q.length, to) + (to < text.length ? '…' : '')));
  return frag;
}
function searchSheet(gid){
  var inp = h('input', {class:'field', type:'search', placeholder:gid ? 'この部屋の投稿を探す' : '投稿とコメントを探す', 'aria-label':'検索', autocomplete:'off'});
  var res = h('div'), timer, last = '';
  inp.addEventListener('input', function(){
    clearTimeout(timer);
    var q = inp.value.trim();
    timer = setTimeout(async function(){
      last = q; res.innerHTML = '';
      if(!q) return;
      try{
        var r = await api('/api/find?q=' + encodeURIComponent(q) + (gid ? '&gid=' + gid : ''));
        if(q !== last) return;
        cacheUsers(r.users);
        if(!r.items.length){ res.appendChild(h('div', {class:'hint', text:'見つかりませんでした'})); return; }
        r.items.forEach(function(it){
          res.appendChild(h('button', {type:'button', class:'srow', onclick:function(){ close(); location.hash = '#/t/' + it.tid; }},
            h('div', {class:'smeta', text:it.gname + '  ' + user(it.author).name + '  ' + ago(it.ts) + (it.kind === 'comment' ? '  コメント' : '')}),
            h('div', {class:'stxt'}, highlight(it.body, q))));
        });
      }catch(e){ res.appendChild(h('div', {class:'hint', text:errMsg(e)})); }
    }, 300);
  });
  var close = openSheet(gid ? '部屋の中を探す' : '探す', h('div', null, inp, res));
  setTimeout(function(){ inp.focus(); }, 60);
}

/* ---------- push notifications ---------- */
var swReady = null;
function b64uToU8(b){ var t = b.replace(/-/g, '+').replace(/_/g, '/'); var bin = atob(t + '='.repeat((4 - t.length % 4) % 4)); return Uint8Array.from(bin, function(c){ return c.charCodeAt(0); }); }
function pushEnv(){
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  var ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if(!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return {ok:false, why:ios && !standalone ? 'ios' : 'none'};
  return {ok:true};
}
function pushReg(){ return navigator.serviceWorker.ready; }
async function pushSub(){ try{ var r = await pushReg(); return await r.pushManager.getSubscription(); }catch(e){ return null; } }
async function pushOn(){
  var perm = await Notification.requestPermission();
  if(perm !== 'granted') throw new Error('denied');
  var k = await api('/api/push/key'), reg = await pushReg();
  var sub = await reg.pushManager.getSubscription();
  if(!sub) sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:b64uToU8(k.key)});
  var j = sub.toJSON();
  await api('/api/push/subscribe', {body:{endpoint:j.endpoint, keys:j.keys}});
}
async function pushOff(){
  var sub = await pushSub();
  if(sub){ var ep = sub.endpoint; await sub.unsubscribe(); try{ await api('/api/push/unsubscribe', {body:{endpoint:ep}}); }catch(e){} }
}
// 設定の中の「プッシュ通知」
function pushSection(box){
  var wrap = h('div');
  box.appendChild(h('div', {class:'lbl', text:'スマホへのプッシュ通知'}));
  box.appendChild(wrap);
  var env = pushEnv();
  if(!env.ok){
    wrap.appendChild(h('div', {class:'hint', text:env.why === 'ios'
      ? 'iPhoneでは、Safariの共有ボタンから「ホーム画面に追加」して、そのアイコンから開くと使えます（iOS 16.4以上）'
      : 'このブラウザでは、プッシュ通知は使えません'}));
    return;
  }
  async function draw(){
    wrap.innerHTML = '';
    var sub = await pushSub(), perm = Notification.permission, prefs = null;
    try{ prefs = await api('/api/push/key'); }catch(e){}
    if(perm === 'denied'){ wrap.appendChild(h('div', {class:'hint', text:'通知がブロックされています ブラウザの設定で、このサイトの通知を「許可」にしてください'})); return; }
    if(!sub){
      wrap.appendChild(h('div', {class:'hint', text:'アプリを閉じていても、コメントやメッセージが届きます'}));
      wrap.appendChild(h('button', {type:'button', class:'b3 block', style:'margin-top:8px', text:'このスマホで通知を受け取る', onclick:async function(){
        try{ await pushOn(); toast('通知をオンにしました'); }catch(e){ toast(e.message === 'denied' ? '通知が許可されませんでした' : errMsg(e)); }
        draw();
      }}));
      return;
    }
    wrap.appendChild(h('div', {class:'hint', text:'このスマホの通知：オン' + (prefs && prefs.devices > 1 ? '（ほか ' + (prefs.devices - 1) + '台）' : '')}));
    function sw(label, key){
      var on = prefs ? prefs[key] : true;
      return h('div', {class:'row'}, h('div', {class:'nm', text:label}),
        h('button', {type:'button', class:'chip' + (on ? ' on' : ''), 'aria-pressed':on ? 'true' : 'false', text:on ? 'オン' : 'オフ', onclick:async function(){
          try{ var b = {}; b[key] = !on; await api('/api/push/settings', {body:b}); }catch(e){ toast(errMsg(e)); }
          draw();
        }}));
    }
    wrap.appendChild(sw('メッセージ（DM）', 'dm'));
    wrap.appendChild(sw('コメント・メンション・スタンプなど', 'other'));
    wrap.appendChild(h('div', {class:'btnrow'},
      h('button', {type:'button', class:'b3 sm soft', text:'テスト通知を送る', onclick:async function(){
        try{ await api('/api/push/test', {body:{}}); toast('送りました 数秒で届きます'); }catch(e){ toast(errMsg(e)); }
      }}),
      h('button', {type:'button', class:'b3 sm soft', text:'このスマホはオフにする', onclick:async function(){ await pushOff(); toast('オフにしました'); draw(); }})));
  }
  draw();
}

/* ---------- security / privacy ---------- */
function recoverySheet(code, title){
  var box = h('div', {style:'text-align:center'},
    h('div', {class:'hint', text:'パスワードを忘れたときに、これがないと戻せません 画面を閉じる前に、メモかスクリーンショットで残してください'}),
    h('div', {class:'code', text:code}),
    h('div', {class:'btnrow', style:'justify-content:center'}, h('button', {type:'button', class:'b3 sm', text:'コピー', onclick:function(){ copyText(code); }})),
    h('button', {type:'button', class:'b3 block', style:'margin-top:14px', text:'メモしました', onclick:function(){ close(); }}));
  var close = openSheet(title || '復旧コード', box);
}
function resetSheet(){
  var handle = h('input', {class:'field', type:'text', placeholder:'ユーザーID', autocapitalize:'none', 'aria-label':'ユーザーID'});
  var code = h('input', {class:'field code-in', type:'text', placeholder:'XXXX-XXXX-XXXX', autocapitalize:'characters', autocomplete:'off', 'aria-label':'復旧コード'});
  var pw = h('input', {class:'field', type:'password', placeholder:'新しいパスワード 8文字以上', autocomplete:'new-password', 'aria-label':'新しいパスワード'});
  var err = h('div', {class:'err', role:'alert'});
  var go = h('button', {type:'button', class:'b3 block', text:'パスワードを変える'});
  go.addEventListener('click', async function(){
    err.textContent = ''; go.disabled = true;
    try{
      var r = await api('/api/reset', {body:{handle:handle.value, code:code.value, pw:pw.value}});
      st.me = r.me; close(); location.hash = '#/'; render(); setTimeout(function(){ recoverySheet(r.recovery, '新しい復旧コード'); }, 250);
    }catch(e){ err.textContent = errMsg(e); go.disabled = false; }
  });
  var close = openSheet('パスワードの再設定', h('div', null,
    h('div', {class:'hint', style:'margin-bottom:8px', text:'登録したときにもらった復旧コードが必要です'}), handle, code, pw, err, go));
}
function adminSheet(){
  var box = h('div', null, h('div', {class:'hint', text:'読み込み中'}));
  openSheet('通報', box);
  function draw(){
    api('/api/admin/reports').then(function(r){
      box.innerHTML = '';
      if(!r.items.length) box.appendChild(h('div', {class:'hint', text:'未対応の通報はありません'}));
      r.items.forEach(function(it){
        box.appendChild(h('div', {class:'rep'},
          h('div', {class:'smeta', text:it.kind + '  @' + it.reporter + '  ' + ago(it.ts)}), h('div', {class:'stxt', text:it.text || '(本文なし)'}),
          h('div', {class:'hint', text:it.reason || ''}),
          h('button', {type:'button', class:'b3 sm soft', text:'対応した', onclick:function(){ api('/api/admin/reports/resolve', {body:{id:it.id}}).then(draw); }})));
      });
    }).catch(function(e){ box.innerHTML = ''; box.appendChild(h('div', {class:'hint', text:errMsg(e)})); });
  }
  draw();
}
function settingsSheet(){
  var me = st.me, box = h('div');
  function draw(){
    box.innerHTML = '';
    pushSection(box);
    box.appendChild(h('div', {class:'lbl', text:'メッセージの既読'}));
    box.appendChild(h('div', {class:'hint', text:'相手に「既読」を見せるか選べます（見せないときは、相手の既読も見えません）'}));
    box.appendChild(h('div', {class:'chips'},
      h('button', {type:'button', class:'chip' + (!me.hideRead ? ' on' : ''), text:'見せる', onclick:function(){ setRead(false); }}),
      h('button', {type:'button', class:'chip' + (me.hideRead ? ' on' : ''), text:'見せない', onclick:function(){ setRead(true); }})));
    box.appendChild(h('div', {class:'lbl', text:'ブロックしている人'}));
    var bl = h('div', null, h('div', {class:'hint', text:'読み込み中'}));
    box.appendChild(bl);
    api('/api/blocks').then(function(r){
      cacheUsers((function(){ var m = {}; r.users.forEach(function(u){ m[u.id] = u; }); return m; })());
      bl.innerHTML = '';
      if(!r.users.length) bl.appendChild(h('div', {class:'hint', text:'ブロックしている人はいません'}));
      r.users.forEach(function(u){
        bl.appendChild(h('div', {class:'row'}, avatar(u.id, 40), h('div', {class:'nm'}, u.name, h('small', {text:'@' + u.handle})),
          h('button', {type:'button', class:'b3 sm soft', text:'解除', onclick:function(){ api('/api/blocks/remove', {body:{id:u.id}}).then(draw); }})));
      });
    }).catch(function(){ bl.innerHTML = ''; });
    box.appendChild(h('div', {class:'lbl', text:'パスワード'}));
    var oldPw = h('input', {class:'field', type:'password', placeholder:'いまのパスワード', autocomplete:'current-password', 'aria-label':'いまのパスワード'});
    var newPw = h('input', {class:'field', type:'password', placeholder:'新しいパスワード 8文字以上', autocomplete:'new-password', 'aria-label':'新しいパスワード', style:'margin-top:8px'});
    box.appendChild(oldPw); box.appendChild(newPw);
    box.appendChild(h('button', {type:'button', class:'b3 block', style:'margin-top:10px', text:'パスワードを変える', onclick:async function(){
      try{ await api('/api/password', {body:{old:oldPw.value, pw:newPw.value}}); oldPw.value = ''; newPw.value = ''; toast('パスワードを変えました'); }catch(e){ toast(errMsg(e)); }
    }}));
    box.appendChild(h('div', {class:'lbl', text:'復旧コード'}));
    box.appendChild(h('div', {class:'hint', text:'パスワードを忘れたときに使います 作り直すと、古いコードは使えなくなります'}));
    var rpw = h('input', {class:'field', type:'password', placeholder:'いまのパスワード', autocomplete:'current-password', 'aria-label':'パスワード（復旧コード用）'});
    box.appendChild(rpw);
    box.appendChild(h('button', {type:'button', class:'b3 soft block', style:'margin-top:10px', text:'復旧コードをつくる', onclick:async function(){
      try{ var r = await api('/api/recovery', {body:{pw:rpw.value}}); rpw.value = ''; recoverySheet(r.recovery); }catch(e){ toast(errMsg(e)); }
    }}));
    if(me.admin) box.appendChild(h('button', {type:'button', class:'b3 soft block', style:'margin-top:18px', text:'通報を見る（管理）', onclick:adminSheet}));
  }
  async function setRead(v){
    try{ var r = await api('/api/me', {body:{hideRead:v}}); st.me = r.me; me = r.me; draw(); }catch(e){ toast(errMsg(e)); }
  }
  draw();
  openSheet('設定', box);
}

/* ---------- room banner / tile (used by the room page and the live preview) ---------- */
function svgGear(){
  return svgIcon('<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>', '22');
}
function fillBanner(banner, group, o){
  o = o || {};
  var hasImg = !!group.banner;
  banner.className = 'banner pt' + (group.pattern || 0) + (S.roomDark(group) || hasImg ? ' dk' : '') + (hasImg ? ' hasimg' : '') + (o.preview ? ' preview' : '');
  banner.style.cssText = S.roomVars(group) + (hasImg ? ';--bimg:url(/api/images/' + group.banner + ')' : '');
  banner.innerHTML = '';
  var stack = h('div', {class:'stack'});
  (group.members || []).slice(0, 5).forEach(function(id){ stack.appendChild(avatar(id, 34)); });
  banner.appendChild(o.preview ? h('span', {class:'back', text:'‹ 戻る'}) : h('button', {type:'button', class:'back', text:'‹ 戻る', onclick:o.onBack}));
  banner.appendChild(o.preview ? h('span', {class:'gear', 'aria-hidden':'true'}, svgGear())
    : h('button', {type:'button', class:'gear', 'aria-label':'部屋の設定', onclick:o.onSettings}, svgGear()));
  banner.appendChild(S.roomChar(group, 96, true));
  var dc = h('div', {class:'decos', 'aria-hidden':'true'});
  (group.decos || []).slice(0, 4).forEach(function(id){ dc.appendChild(stampEl(id, 46)); });
  banner.appendChild(dc);
  banner.appendChild(h('h1', {text:group.name, style:S.fontStyle(group.tfont)}));
  if(group.desc) banner.appendChild(h('div', {class:'bdesc', text:group.desc}));
  var n = (group.members || []).length;
  banner.appendChild(h('div', {class:'bfoot'}, stack, o.preview
    ? h('div', {class:'pills'}, h('span', {class:'pill', text:'探す'}), h('span', {class:'pill', text:'メンバー ' + n + '人'}))
    : h('div', {class:'pills'}, h('button', {type:'button', class:'pill', text:'探す', onclick:o.onSearch}), h('button', {type:'button', class:'pill', text:'メンバー ' + n + '人', onclick:o.onSettings}))));
  return banner;
}
function tileEl(g, o){
  o = o || {};
  var t = h('button', {type:'button', class:'tile' + (S.roomDark(g) || g.banner ? ' dk' : '') + (g.banner ? ' hasimg' : ''),
    style:S.roomVars(g) + (g.banner ? ';--bimg:url(/api/images/' + g.banner + ')' : ''), onclick:o.onclick || null, tabindex:o.preview ? '-1' : null, 'aria-hidden':o.preview ? 'true' : null},
    S.roomChar(g, 64, false), h('div', {class:'tname', text:g.name, style:S.fontStyle(g.tfont)}),
    h('div', {class:'tfoot', text:(g.members || []).length + '人  ' + (g.lastText ? g.lastText : 'まだ投稿がありません')}));
  if(!o.preview) tilt(t);
  return t;
}

/* ---------- home ---------- */
function homeView(tab){
  var body = h('div');
  var nav = h('nav', {class:'nav', 'aria-label':'メニュー'});
  var groups = null, fr = null, dms = null, nf = null, lastSig = '', friendsUI = null, stampsUI = null, dmUI = null, killHero = null;

  var heroBox = tab === 'groups' ? h('div', {class:'hero3d'}) : null;
  if(heroBox) killHero = mountHero(heroBox);
  var topR = h('div', {class:'topr'});
  var el = h('div', {class:'page'},
    h('header', {class:'top'}, heroBox ? h('span') : h('img', {class:'wm', src:'/assets/dara-wordmark.png', alt:'DARA'}), topR),
    heroBox, body, nav);
  function drawTop(){
    topR.innerHTML = '';
    var nu = nf ? nf.unread : 0;
    topR.appendChild(h('button', {type:'button', class:'topbtn', 'aria-label':'探す', onclick:function(){ searchSheet(); }}, svgSearch()));
    topR.appendChild(h('button', {type:'button', class:'topbtn', 'aria-label':'通知' + (nu ? ' ' + nu + '件' : ''), onclick:function(){ notifSheet(function(){ load(true); }); }}, svgBell(), nu ? h('span', {class:'dot', text:nu > 99 ? '99+' : nu}) : null));
    topR.appendChild(h('button', {type:'button', 'aria-label':'プロフィール', onclick:profileSheet}, avatar(st.me.id, 38)));
  }

  function drawNav(){
    nav.innerHTML = '';
    var n = fr ? fr.incoming.length : 0;
    var gb = h('a', {href:'#/', class:'b3 tab' + (tab === 'groups' ? ' ink' : ' soft'), text:'グループ', style:'text-decoration:none'});
    var fb = h('a', {href:'#/friends', class:'b3 tab' + (tab === 'friends' ? ' ink' : ' soft'), style:'text-decoration:none'}, '友達', n ? h('span', {class:'dot', text:n}) : null);
    var dn = dms ? dms.unread : 0;
    var db = h('a', {href:'#/dm', class:'b3 tab' + (tab === 'dm' ? ' ink' : ' soft'), style:'text-decoration:none'}, 'DM', dn ? h('span', {class:'dot', text:dn}) : null);
    var sb = h('a', {href:'#/stamps', class:'b3 tab' + (tab === 'stamps' ? ' ink' : ' soft'), text:'スタンプ', style:'text-decoration:none'});
    nav.appendChild(gb); nav.appendChild(fb); nav.appendChild(db); nav.appendChild(sb);
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
      grid.appendChild(tileEl(g, {onclick:function(){ location.hash = '#/g/' + g.id; }}));
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
          h('button', {type:'button', class:'b3 sm', text:'メッセージ', onclick:function(){ location.hash = '#/dm/' + p.id; }}),
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
  function buildDm(){
    var wrap = h('div');
    function draw(){
      wrap.innerHTML = '';
      wrap.appendChild(h('h2', {class:'sec', text:'メッセージ'}));
      if(!dms){ wrap.appendChild(h('div', {class:'hint', text:'読み込み中'})); return; }
      var have = {};
      if(!dms.convs.length) wrap.appendChild(h('div', {class:'empty'}, orb(72, 2, {bob:true}), h('p', {text:'友達と1対1でメッセージできます 下の友達から、はじめてみましょう'})));
      dms.convs.forEach(function(c){
        have[c.peer] = 1;
        var prev = c.last.stamp ? 'スタンプ' : c.last.photo ? '写真' : c.last.text;
        wrap.appendChild(h('button', {type:'button', class:'row dmrow', onclick:function(){ location.hash = '#/dm/' + c.peer; }},
          avatar(c.peer, 48), h('div', {class:'nm'}, user(c.peer).name, h('small', {text:(c.last.mine ? 'あなた: ' : '') + prev})),
          c.unread ? h('span', {class:'dot2', text:c.unread}) : h('span', {class:'ago', text:ago(c.last.ts)})));
      });
      var rest = (fr ? fr.friends : []).filter(function(p){ return !have[p.id]; });
      if(rest.length){
        wrap.appendChild(h('h2', {class:'sec', text:'友達とはじめる'}));
        rest.forEach(function(p){
          wrap.appendChild(h('button', {type:'button', class:'row dmrow', onclick:function(){ location.hash = '#/dm/' + p.id; }},
            avatar(p.id, 44), h('div', {class:'nm'}, p.name, h('small', {text:'@' + p.handle})), h('span', {class:'hint', text:'メッセージ'})));
        });
      }
      if(fr && !fr.friends.length) wrap.appendChild(h('div', {class:'hint', text:'まだ友達がいません 「友達」タブから追加しましょう'}));
    }
    return {el:wrap, update:draw};
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
    drawNav(); drawTop();
    if(tab === 'dm'){
      if(!dmUI){ dmUI = buildDm(); body.innerHTML = ''; body.appendChild(dmUI.el); }
      dmUI.update();
    }else if(tab === 'stamps'){
      if(!stampsUI){ stampsUI = buildStamps(); body.innerHTML = ''; body.appendChild(stampsUI.el); }
    }else if(tab === 'friends'){
      if(!friendsUI){ friendsUI = buildFriends(); body.innerHTML = ''; body.appendChild(friendsUI.el); }
      friendsUI.update();
    }else drawGroups();
  }
  async function load(force){
    try{
      var r = await Promise.all([api('/api/groups'), api('/api/friends'), api('/api/dms'), api('/api/notifs')]);
      cacheUsers(r[0].users); cacheStamps(r[0].stamps); cacheUsers(r[2].users); cacheUsers(r[3].users);
      var tot = r[2].unread + r[3].unread;
      document.title = (tot ? '(' + tot + ') ' : '') + 'DARA';
      [r[1].friends, r[1].incoming, r[1].sent].forEach(function(a){ cacheUsers(toMap(a)); });
      var sig = JSON.stringify(r);
      if(sig === lastSig && !force) return;
      lastSig = sig; groups = r[0].groups; fr = r[1]; dms = r[2]; nf = r[3]; draw();
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
      g = r[0]; fr = r[1]; cacheUsers(g.users); cacheStamps(g.stamps);
    }catch(e){ return; }
    var G = g.group, isOwner = G.owner === st.me.id, canStyle = !G.locked || isOwner;
    box.innerHTML = '';
    var code = G.code, gname = G.name;
    box.appendChild(h('button', {type:'button', class:'b3 soft block', disabled:!canStyle,
      text:canStyle ? '部屋の見た目を変える（名前・色・デコ）' : '見た目はオーナーだけが変えられます', onclick:function(){
      close(); window.DARAStampUI.openRoomStyle(G, function(){ if(info) info(); });
    }}));
    box.appendChild(h('div', {class:'lbl', text:'招待コード'}));
    box.appendChild(h('div', {class:'code', text:fmtCode(code)}));
    box.appendChild(h('div', {class:'hint', text:'このコードを知っている人は、友達でなくても入れます'}));
    box.appendChild(h('div', {class:'btnrow'},
      h('button', {type:'button', class:'b3 sm', text:'コードをコピー', onclick:function(){ copyText(fmtCode(code)); }}),
      h('button', {type:'button', class:'b3 sm soft', text:'リンクを共有', onclick:function(){ shareLink('DARA', '「' + gname + '」に招待されました', roomLink(code)); }}),
      h('button', {type:'button', class:'b3 sm soft', text:'QR', onclick:function(){ qrSheet('部屋のQR', roomLink(code), gname + '  ' + fmtCode(code)); }})));
    if(canStyle) box.appendChild(h('button', {type:'button', class:'ghost', text:'コードを作り直す', onclick:async function(){
      var ok = await askConfirm('新しいコードを作ります 古いコードでは入れなくなります', '作り直す');
      if(!ok) return;
      try{ await api('/api/groups/' + gid + '/code', {body:{}}); await draw(); toast('新しいコードにしました'); }catch(e){ toast(errMsg(e)); }
    }}));
    box.appendChild(h('div', {class:'lbl', text:'メンバー ' + G.members.length + '人'}));
    G.members.forEach(function(id){
      var row = h('div', {class:'row'}, avatar(id, 44),
        h('div', {class:'nm'}, user(id).name + (id === st.me.id ? '（あなた）' : ''), id === G.owner ? h('small', {text:'オーナー'}) : null));
      if(isOwner && id !== st.me.id){
        row.appendChild(h('button', {type:'button', class:'b3 sm soft', text:'ゆずる', onclick:async function(){
          var ok = await askConfirm(user(id).name + ' さんに、オーナーをゆずりますか あなたはオーナーではなくなります', 'ゆずる');
          if(!ok) return;
          try{ await api('/api/groups/' + gid + '/owner', {body:{uid:id}}); toast('オーナーをゆずりました'); await draw(); if(info) info(); }catch(e){ toast(errMsg(e)); }
        }}));
        row.appendChild(h('button', {type:'button', class:'b3 sm soft', text:'外す', onclick:async function(){
          var ok = await askConfirm(user(id).name + ' さんを、この部屋から外しますか', '外す');
          if(!ok) return;
          try{ await api('/api/groups/' + gid + '/kick', {body:{uid:id}}); toast('外しました'); await draw(); if(info) info(); }catch(e){ toast(errMsg(e)); }
        }}));
      }
      box.appendChild(row);
    });
    var addable = fr.friends.filter(function(p){ return G.members.indexOf(p.id) < 0; });
    box.appendChild(h('div', {class:'lbl', text:'友達を追加'}));
    if(!addable.length) box.appendChild(h('div', {class:'hint', text:'追加できる友達はいません'}));
    addable.forEach(function(p){
      cacheUsers({[p.id]:p});
      box.appendChild(h('div', {class:'row'}, avatar(p.id, 44), h('div', {class:'nm', text:p.name}),
        h('button', {type:'button', class:'b3 sm', text:'追加', onclick:async function(){
          try{ await api('/api/groups/' + gid + '/members', {body:{ids:[p.id]}}); await draw(); if(info) info(); }catch(e){ toast(errMsg(e)); }
        }})));
    });
    if(isOwner){
      box.appendChild(h('div', {class:'lbl', text:'オーナーの設定'}));
      box.appendChild(h('div', {class:'hint', text:'部屋の見た目とコードを変えられる人'}));
      box.appendChild(h('div', {class:'chips'},
        h('button', {type:'button', class:'chip' + (!G.locked ? ' on' : ''), text:'みんな', onclick:async function(){ await setLock(false); }}),
        h('button', {type:'button', class:'chip' + (G.locked ? ' on' : ''), text:'オーナーだけ', onclick:async function(){ await setLock(true); }})));
    }
    async function setLock(v){
      try{ await api('/api/groups/' + gid + '/lock', {body:{locked:v}}); await draw(); }catch(e){ toast(errMsg(e)); }
    }
    box.appendChild(h('button', {type:'button', class:'b3 soft block', style:'margin-top:16px;color:var(--danger)', text:'この部屋を抜ける', onclick:async function(){
      var ok = await askConfirm(isOwner && G.members.length > 1 ? 'この部屋を抜けますか オーナーは、次に入った人に移ります' : 'この部屋を抜けますか 投稿は残ります', '抜ける');
      if(!ok) return;
      try{ await api('/api/groups/' + gid + '/leave', {body:{}}); close(); location.hash = '#/'; }catch(e){ toast(errMsg(e)); }
    }}));
    if(isOwner) box.appendChild(h('button', {type:'button', class:'b3 red block', style:'margin-top:8px', text:'この部屋を削除する', onclick:async function(){
      var ok = await askConfirm('この部屋を削除しますか 投稿・コメント・メンバーがすべて消えます 元に戻せません', '削除する');
      if(!ok) return;
      try{ await api('/api/groups/' + gid, {method:'DELETE', body:{}}); close(); toast('部屋を削除しました'); location.hash = '#/'; }catch(e){ toast(errMsg(e)); }
    }}));
  }
  var close = openSheet('部屋の設定', box);
  draw();
}

function groupView(gid){
  var banner = h('div', {class:'banner'}), feed = h('div'), group = null, threads = null, lastSig = '';
  var entry = h('button', {type:'button', class:'entry', onclick:function(){ openCompose(gid, load, function(){ return group ? group.members.map(user) : []; }); }}, avatar(st.me.id, 44), h('span', {text:'いま何してる'}));
  var el = h('div', {class:'page'}, banner, entry, feed);

  function draw(){
    if(!group) return;
    fillBanner(banner, group, {onBack:function(){ location.hash = '#/'; }, onSearch:function(){ searchSheet(gid); }, onSettings:function(){ groupInfoSheet(gid, load); }});
    feed.innerHTML = '';
    if(!threads){ feed.appendChild(h('div', {class:'hint', style:'padding:16px 4px', text:'読み込み中'})); return; }
    if(!threads.length) feed.appendChild(h('div', {class:'hint', style:'padding:16px 4px', text:'最初のスレッドを立ててみましょう'}));
    threads.forEach(function(t){
      feed.appendChild(postEl(t, {count:t.count, click:function(){ location.hash = '#/t/' + t.id; }, onReact:function(){ load(true); },
        extra:postTools('thread', t, group.owner === st.me.id, {edit:function(){ load(true); }, del:function(){ load(true); }})}));
    });
  }
  async function load(force){
    try{
      var r = await Promise.all([api('/api/groups/' + gid), api('/api/groups/' + gid + '/threads')]);
      cacheUsers(r[0].users); cacheUsers(r[1].users); cacheStamps(r[0].stamps); cacheStamps(r[1].stamps);
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

function openCompose(gid, after, members){
  var close, pollOn = false, opts = ['', ''];
  var pollBox = h('div', {class:'pollmk'});
  var comp = makeComposer({
    placeholder:'いま何してる', submitLabel:'投稿', rows:4, draft:'g:' + gid,
    mentions:members, canEmpty:function(){ return pollOn && opts.filter(function(x){ return x.trim(); }).length >= 2; },
    onSubmit:function(text, ids){
      var poll = pollOn ? opts.map(function(x){ return x.trim(); }).filter(Boolean) : null;
      if(!text && !ids.length && !(poll && poll.length >= 2)) return Promise.resolve();
      return api('/api/groups/' + gid + '/threads', {body:{text:text, images:ids, poll:poll && poll.length >= 2 ? poll : undefined}});
    },
    onDone:function(){ close(); if(after) after(true); }
  });
  function drawPoll(){
    pollBox.innerHTML = '';
    pollBox.appendChild(h('button', {type:'button', class:'chip' + (pollOn ? ' on' : ''), 'aria-pressed':pollOn ? 'true' : 'false', text:pollOn ? 'アンケートをやめる' : 'アンケートをつける', onclick:function(){ pollOn = !pollOn; drawPoll(); comp.sync(); }}));
    if(!pollOn) return;
    opts.forEach(function(v, i){
      var inp = h('input', {class:'field', type:'text', maxlength:'30', placeholder:'選択肢 ' + (i + 1), value:v, 'aria-label':'選択肢 ' + (i + 1), style:'margin-top:8px'});
      inp.addEventListener('input', function(){ opts[i] = inp.value; comp.sync(); });
      pollBox.appendChild(inp);
    });
    if(opts.length < 6) pollBox.appendChild(h('button', {type:'button', class:'ghost', text:'＋ 選択肢をふやす', onclick:function(){ opts.push(''); drawPoll(); }}));
  }
  drawPoll();
  close = openSheet('新しいスレッド', h('div', null, pollBox, h('div', {style:'height:10px'}), comp.el));
  setTimeout(function(){ comp.focus(); }, 60);
}

/* ---------- thread ---------- */
function threadView(tid){
  var head = h('div', {class:'tbar'}), postBox = h('div'), list = h('div'), data = null, lastSig = '', gid = null, replyTo = null;
  var replyBar = h('div', {class:'replybar'});
  function drawReply(){
    replyBar.innerHTML = '';
    if(!replyTo){ replyBar.style.display = 'none'; return; }
    replyBar.style.display = 'flex';
    replyBar.appendChild(h('span', {text:user(replyTo.author).name + ' さんに返信'}));
    replyBar.appendChild(h('button', {type:'button', class:'xbtn', 'aria-label':'返信をやめる', text:'×', onclick:function(){ replyTo = null; drawReply(); }}));
  }
  var comp = makeComposer({
    placeholder:'コメントする', submitLabel:'送信', draft:'t:' + tid,
    mentions:function(){ return data ? data.group.members.map(user) : []; },
    onSubmit:function(text, ids){ if(!text && !ids.length) return Promise.resolve(); return api('/api/threads/' + tid + '/comments', {body:{text:text, images:ids, parent:replyTo ? replyTo.id : undefined}}); },
    onStamp:function(id){ return api('/api/threads/' + tid + '/comments', {body:{stamp:id, parent:replyTo ? replyTo.id : undefined}}); },
    onDone:function(){ replyTo = null; drawReply(); load(true); }
  });
  var dock = h('div', {class:'dock'}, replyBar, comp.el);
  var el = h('div', {class:'page'}, head, postBox, list, dock);
  drawReply();

  function draw(){
    if(!data) return;
    var t = data.thread, cs = data.comments;
    head.innerHTML = '';
    head.appendChild(h('button', {type:'button', class:'back', text:'‹ ' + data.group.name, onclick:function(){ location.hash = '#/g/' + t.gid; }}));
    postBox.innerHTML = '';
    var roomOwner = data.group.owner === st.me.id;
    postBox.appendChild(postEl(t, {big:true, onReact:function(){ load(true); },
      extra:postTools('thread', t, roomOwner, {edit:function(){ load(true); }, del:function(){ location.hash = '#/g/' + t.gid; }})}));
    list.innerHTML = '';
    list.appendChild(h('div', {class:'cdiv', text:'コメント ' + cs.length}));
    if(!cs.length) list.appendChild(h('div', {class:'hint', style:'padding:10px 4px', text:'最初のコメントを書いてみましょう'}));
    var ids = {}, kids = {};
    cs.forEach(function(c){ ids[c.id] = 1; });
    cs.forEach(function(c){ if(c.parent && ids[c.parent]){ (kids[c.parent] = kids[c.parent] || []).push(c); } });
    function row(c, isReply){
      var el2 = postEl(c, {onReact:function(){ load(true); },
        extra:postTools('comment', c, roomOwner, {edit:function(){ load(true); }, del:function(){ load(true); },
          reply:function(p){ replyTo = p; drawReply(); comp.focus(); }})});
      if(isReply) el2.classList.add('reply');
      return el2;
    }
    cs.forEach(function(c){
      if(c.parent && ids[c.parent]) return;
      list.appendChild(row(c, false));
      (kids[c.id] || []).forEach(function(r){ list.appendChild(row(r, true)); });
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
      cacheUsers(oneU(r.user)); draw(r.user, r.rel, r.blocked);
    }catch(e){ body.innerHTML = ''; body.appendChild(h('div', {class:'hint', text:errMsg(e)})); }
  }
  function oneU(u){ var m = {}; m[u.id] = u; return m; }
  function draw(u, rel, blocked){
    body.innerHTML = '';
    body.appendChild(avatar(u.id, 96));
    body.appendChild(h('div', {style:'font-weight:900;font-size:22px', text:u.name}));
    body.appendChild(h('div', {class:'hint', text:'@' + u.handle}));
    if(u.bio) body.appendChild(h('div', {style:'max-width:320px;font-size:14px;color:var(--sub);text-wrap:balance', text:u.bio}));
    var label = {none:'友達に申請', incoming:'承認して友達になる', sent:'申請しました', friend:'友達です', self:'これはあなたです'}[rel];
    var btn = h('button', {type:'button', class:'b3 block', style:'max-width:320px', text:label, disabled:blocked || rel === 'sent' || rel === 'friend' || rel === 'self'});
    btn.addEventListener('click', async function(){
      btn.disabled = true;
      try{ var r = await api('/api/friends/request', {body:{handle:u.handle}}); draw(u, r.rel, false); toast(r.rel === 'friend' ? '友達になりました' : '申請しました'); }
      catch(e){ toast(errMsg(e)); btn.disabled = false; }
    });
    body.appendChild(btn);
    if(rel === 'friend') body.appendChild(h('button', {type:'button', class:'b3 soft block', style:'max-width:320px', text:'メッセージを送る', onclick:function(){ location.hash = '#/dm/' + u.id; }}));
    if(rel !== 'self'){
      body.appendChild(h('div', {class:'ptools', style:'justify-content:center;margin-top:10px'},
        blocked ? h('button', {type:'button', class:'ghost', text:'ブロックを解除', onclick:function(){ api('/api/blocks/remove', {body:{id:u.id}}).then(function(){ toast('解除しました'); load(); }); }})
          : h('button', {type:'button', class:'ghost', text:'ブロック', onclick:function(){ blockUser(u.id, function(){ load(); }); }}),
        h('button', {type:'button', class:'ghost', text:'通報', onclick:function(){ reportSheet('user', u.id); }})));
    }
  }
  load();
  return {el:pg.el, destroy:function(){}};
}

/* ---------- DM ---------- */
function dmView(peer){
  var head = h('div', {class:'tbar'}), list = h('div', {class:'dmlist'}), data = null, lastSig = '', lastCount = -1;
  var comp = makeComposer({
    placeholder:'メッセージ', submitLabel:'送信', draft:'dm:' + peer, mentions:function(){ return [user(peer)]; },
    onSubmit:function(text, ids){ if(!text && !ids.length) return Promise.resolve(); return api('/api/dms/' + peer, {body:{text:text, images:ids}}); },
    onStamp:function(id){ return api('/api/dms/' + peer, {body:{stamp:id}}); },
    onDone:function(){ load(true); }
  });
  var dock = h('div', {class:'dock'}, comp.el);
  var el = h('div', {class:'page dmpage'}, head, list, dock);

  function draw(){
    if(!data) return;
    head.innerHTML = '';
    head.appendChild(h('button', {type:'button', class:'back', text:'‹ DM', onclick:function(){ location.hash = '#/dm'; }}));
    head.appendChild(h('div', {class:'dmhead'}, avatar(peer, 34), h('b', {text:user(peer).name})));
    var nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 140;
    list.innerHTML = '';
    if(!data.messages.length) list.appendChild(h('div', {class:'hint', style:'padding:30px 4px;text-align:center', text:'最初のメッセージを送ってみましょう'}));
    var lastRead = -1;
    data.messages.forEach(function(m, i){ if(m.author === st.me.id && data.peerRead && m.ts <= data.peerRead) lastRead = i; });
    data.messages.forEach(function(m, i){
      var mine = m.author === st.me.id;
      var col = h('div', {class:'dmcol'});
      if(m.text) col.appendChild(h('div', {class:'bub'}, richText(m.text)));
      if(m.stamp) col.appendChild(h('div', {class:'stampbig'}, stampEl(m.stamp, 104)));
      var md = media(m.images); if(md) col.appendChild(md);
      var rb = reactBar(m, {onReact:function(){ load(true); }}); if(rb) col.appendChild(rb);
      var meta = h('div', {class:'dmmeta'}, h('span', {text:ago(m.ts)}), i === lastRead ? h('span', {class:'readmk', text:'既読'}) : null);
      if(!mine) meta.appendChild(h('button', {type:'button', class:'ghost', text:'通報', onclick:function(){ reportSheet('dm', m.id); }}));
      if(mine) meta.appendChild(h('button', {type:'button', class:'ghost', text:'削除', onclick:async function(){
        var ok = await askConfirm('このメッセージを削除しますか', '削除する');
        if(!ok) return;
        try{ await api('/api/dmsg/' + m.id, {method:'DELETE', body:{}}); load(true); }catch(e){ toast(errMsg(e)); }
      }}));
      col.appendChild(meta);
      list.appendChild(h('div', {class:'dm' + (mine ? ' me' : '')}, mine ? null : avatar(m.author, 34), col));
    });
    if(lastCount < 0 || (data.messages.length > lastCount && nearBottom)) setTimeout(function(){ window.scrollTo(0, document.body.scrollHeight); }, 30);
    lastCount = data.messages.length;
  }
  async function load(force){
    try{
      var r = await api('/api/dms/' + peer);
      cacheUsers(r.users); cacheStamps(r.stamps);
      var sig = JSON.stringify(r);
      if(sig === lastSig && force !== true) return;
      lastSig = sig; data = r; draw();
    }catch(e){ if(e.status === 404){ toast('友達ではないので、メッセージできません'); location.hash = '#/dm'; } }
  }
  var stop = poll(load, 3000);
  load(true);
  return {el:el, load:load, destroy:stop};
}

function joinView(code){
  var pg = linkPage(), body = pg.body;
  api('/api/join/' + encodeURIComponent(code)).then(function(r){
    var g = r.group;
    cacheStamps(r.stamps);
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
  else if(p[0] === 'dm' && p[1]) cur = dmView(p[1]);
  else if(p[0] === 'dm') cur = homeView('dm');
  else if(p[0] === 'friends') cur = homeView('friends');
  else if(p[0] === 'stamps') cur = homeView('stamps');
  else cur = homeView('groups');
  app.appendChild(cur.el);
}
window.addEventListener('hashchange', render);
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/sw.js').catch(function(){});
  navigator.serviceWorker.addEventListener('message', function(e){
    if(e.data && e.data.type === 'go'){ try{ location.hash = new URL(e.data.url).hash || '#/'; }catch(err){} }
  });
}

api('/api/me').then(function(r){
  st.me = r.me;
  if(r.me){ var m = {}; m[r.me.id] = r.me; cacheUsers(m); }
  render();
}).catch(function(){ render(); });
})();
