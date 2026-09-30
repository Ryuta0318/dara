/* スタンプをつくる・えらぶ画面 / 部屋の見た目を変える画面 */
(function(){
'use strict';
var S = window.DARAStamp;
function ui(){ return window.DARAUI; }
function h(){ return ui().h.apply(null, arguments); }

/* ---- 小さな部品 ---- */
function chip(label, on, fn){
  return h('button', {type:'button', class:'chip' + (on ? ' on' : ''), 'aria-pressed':on ? 'true' : 'false', text:label, onclick:fn});
}
function pick(el, on, label, fn){
  return h('button', {type:'button', class:'pk' + (on ? ' on' : ''), 'aria-pressed':on ? 'true' : 'false', 'aria-label':label, onclick:fn}, el);
}
// 色えらび：12色 + 自由な色
function swatchRow(value, onChange, extra){
  var row = h('div', {class:'swrow'});
  S.PAL.forEach(function(p, i){
    row.appendChild(h('button', {type:'button', class:'sw' + (value === i ? ' on' : ''), 'aria-label':'色 ' + (i + 1), 'aria-pressed':value === i ? 'true' : 'false',
      style:'background:radial-gradient(circle at 35% 30%,' + p.l + ',' + p.c + ' 55%,' + p.d + ')', onclick:function(){ onChange(i); }}));
  });
  var isHex = S.hexOk(value);
  var inp = h('input', {type:'color', value:isHex ? value : '#9db8ff', 'aria-label':'好きな色'});
  inp.addEventListener('input', function(){ onChange(inp.value); });
  row.appendChild(h('label', {class:'sw custom' + (isHex ? ' on' : ''), 'aria-label':'好きな色', style:isHex ? 'background:' + value : ''}, inp));
  if(extra) row.appendChild(extra);
  return row;
}
function sec(title){ return h('div', {class:'lbl', text:title}); }

/* ---- スタンプのエディタ ---- */
function openEditor(init, o){
  o = o || {};
  var A = ui();
  var spec = S.clean(init || {shape:Math.floor(Math.random() * 8), color:Math.floor(Math.random() * 12), face:0, ring:1});
  var pv = h('div', {class:'pv'});
  var root = h('div', {class:'sted'});
  var shapeBox = h('div', {class:'strip'}), colorBox = h('div'), faceBox = h('div', {class:'strip'});
  var textIn = h('input', {class:'field', type:'text', maxlength:'8', placeholder:'ひとこと（8文字まで）', value:spec.text, 'aria-label':'スタンプの文字'});
  var posBox = h('div', {class:'chips'}), sizeBox = h('div', {class:'chips'}), tcBox = h('div'), decoBox = h('div', {class:'chips'}), miscBox = h('div');
  var close;

  function set(k, v){ spec[k] = v; draw(); }
  function drawPreview(){ pv.innerHTML = ''; pv.appendChild(S.render(spec, 150)); }
  function draw(){
    drawPreview();
    shapeBox.innerHTML = '';
    S.SHAPES.forEach(function(sh, i){
      shapeBox.appendChild(pick(S.render({shape:i, color:spec.color, face:-1, ring:0}, 46), spec.shape === i, sh.n, function(){ set('shape', i); }));
    });
    colorBox.innerHTML = ''; colorBox.appendChild(swatchRow(spec.color, function(v){ set('color', v); }));
    faceBox.innerHTML = '';
    faceBox.appendChild(pick(h('span', {class:'none', text:'なし'}), spec.face === -1, '顔なし', function(){ set('face', -1); }));
    S.FACES.forEach(function(f, i){
      faceBox.appendChild(pick(S.render({shape:0, color:spec.color, face:i, ring:0}, 46), spec.face === i, f.n, function(){ set('face', i); }));
    });
    posBox.innerHTML = ''; ['上', 'まんなか', '下'].forEach(function(t, i){ var v = [2, 1, 0][i]; posBox.appendChild(chip(t, spec.tpos === v, function(){ set('tpos', v); })); });
    sizeBox.innerHTML = ''; ['小', '中', '大'].forEach(function(t, i){ sizeBox.appendChild(chip(t, spec.tsize === i, function(){ set('tsize', i); })); });
    tcBox.innerHTML = '';
    var tr = h('div', {class:'swrow'});
    tr.appendChild(chip('自動', !spec.tcolor, function(){ set('tcolor', ''); }));
    ['#ffffff', '#17131f', '#ff4d79', '#3b82ff', '#ffb000'].forEach(function(c){
      tr.appendChild(h('button', {type:'button', class:'sw small' + (spec.tcolor === c ? ' on' : ''), 'aria-label':'文字の色', style:'background:' + c, onclick:function(){ set('tcolor', c); }}));
    });
    var ti = h('input', {type:'color', value:spec.tcolor || '#ffffff', 'aria-label':'文字の色を選ぶ'});
    ti.addEventListener('input', function(){ set('tcolor', ti.value); });
    tr.appendChild(h('label', {class:'sw small custom' + (spec.tcolor && ['#ffffff', '#17131f', '#ff4d79', '#3b82ff', '#ffb000'].indexOf(spec.tcolor) < 0 ? ' on' : ''), 'aria-label':'文字の色を選ぶ'}, ti));
    tcBox.appendChild(tr);
    decoBox.innerHTML = ''; S.DECOS.forEach(function(t, i){ decoBox.appendChild(chip(t, spec.deco === i, function(){ set('deco', i); })); });
    miscBox.innerHTML = '';
    var rot = h('input', {type:'range', min:'-20', max:'20', step:'1', value:String(spec.rot), 'aria-label':'かたむき'});
    rot.addEventListener('input', function(){ spec.rot = +rot.value; drawPreview(); });
    miscBox.appendChild(h('div', {class:'rotrow'}, h('span', {class:'hint', text:'かたむき'}), rot, chip('ふちどり', !!spec.ring, function(){ set('ring', spec.ring ? 0 : 1); })));
  }
  textIn.addEventListener('input', function(){ spec.text = textIn.value.slice(0, 8); drawPreview(); });

  var saveBtn = h('button', {type:'button', class:'b3 block', style:'margin-top:16px', text:o.id ? '保存する' : 'スタンプをつくる'});
  saveBtn.addEventListener('click', async function(){
    saveBtn.disabled = true;
    try{
      var body = {spec:S.clean(spec)};
      var r = o.id ? await A.api('/api/stamps/' + o.id, {method:'PUT', body:body}) : await A.api('/api/stamps', {body:body});
      A.toast(o.id ? '保存しました' : 'スタンプをつくりました');
      close();
      if(o.onSaved) o.onSaved(r.stamp);
    }catch(e){ A.toast(A.errMsg(e)); saveBtn.disabled = false; }
  });
  var rnd = h('button', {type:'button', class:'b3 soft sm', text:'おまかせでつくる'});
  rnd.addEventListener('click', function(){ spec = S.random(spec.text); draw(); });

  root.appendChild(h('div', {class:'pvwrap'}, pv, rnd));
  root.appendChild(sec('かたち')); root.appendChild(shapeBox);
  root.appendChild(sec('いろ')); root.appendChild(colorBox);
  root.appendChild(sec('かお')); root.appendChild(faceBox);
  root.appendChild(sec('もじ')); root.appendChild(textIn);
  root.appendChild(h('div', {class:'twocol'}, h('div', null, h('div', {class:'hint', text:'いち'}), posBox), h('div', null, h('div', {class:'hint', text:'おおきさ'}), sizeBox)));
  root.appendChild(h('div', {class:'hint', style:'margin-top:8px', text:'もじの色'})); root.appendChild(tcBox);
  root.appendChild(sec('かざり')); root.appendChild(decoBox);
  root.appendChild(sec('かたむき')); root.appendChild(miscBox);
  root.appendChild(saveBtn);
  if(o.id && o.canDelete !== false){
    root.appendChild(h('button', {type:'button', class:'b3 soft block', style:'margin-top:8px;color:var(--danger)', text:'このスタンプを消す', onclick:async function(){
      var ok = await A.askConfirm('このスタンプを消しますか すでに押したリアクションは残ります', '消す');
      if(!ok) return;
      try{ await A.api('/api/stamps/' + o.id, {method:'DELETE', body:{}}); A.toast('消しました'); close(); if(o.onDeleted) o.onDeleted(); }
      catch(e){ A.toast(A.errMsg(e)); }
    }}));
  }
  close = A.openSheet(o.id ? 'スタンプをなおす' : 'スタンプをつくる', root);
  draw();
}

/* ---- スタンプのえらびかた ---- */
var RK = 'dara.recent.stamps';
function recents(){ try{ return JSON.parse(localStorage.getItem(RK) || '[]').filter(function(x){ return x && x.id; }); }catch(e){ return []; } }
function remember(id, spec){
  try{
    var list = recents().filter(function(x){ return x.id !== id; });
    list.unshift({id:id, spec:id.indexOf('b:') === 0 ? null : spec});
    localStorage.setItem(RK, JSON.stringify(list.slice(0, 12)));
  }catch(e){}
}
function openPicker(onPick, opts){
  opts = opts || {};
  var A = ui(), box = h('div', {class:'picker'}), close;
  function cell(id, spec, extra){
    var b = h('button', {type:'button', class:'pcell', 'aria-label':'スタンプ', onclick:function(){ remember(id, spec); close(); onPick(id, spec); }}, S.render(spec, 58));
    if(!extra) return b;
    return h('div', {class:'pwrap'}, b, extra);
  }
  function grid(items){ var g = h('div', {class:'pgrid'}); items.forEach(function(i){ g.appendChild(i); }); return g; }
  close = A.openSheet('スタンプをえらぶ', box);
  function draw(mine){
    box.innerHTML = '';
    var cache = A.stampCache();
    var rc = recents().map(function(r){ var sp = S.resolve(r.id, cache) || r.spec; return sp ? cell(r.id, sp) : null; }).filter(Boolean);
    if(rc.length){ box.appendChild(sec('さいきん')); box.appendChild(grid(rc)); }
    box.appendChild(h('div', {class:'lbl rowlbl'}, h('span', {text:'じぶんのスタンプ'}),
      h('button', {type:'button', class:'mini', text:'＋ つくる', onclick:function(){
        close(); openEditor(null, {onSaved:function(st){ A.cacheStamps(oneMap(st)); remember(st.id, st.spec); onPick(st.id, st.spec); }});
      }})));
    if(!mine) box.appendChild(h('div', {class:'hint', text:'読み込み中'}));
    else if(!mine.length) box.appendChild(h('div', {class:'hint', text:'まだありません 「つくる」で自分だけのスタンプをつくれます'}));
    else box.appendChild(grid(mine.map(function(s){ return cell(s.id, s.spec); })));
    box.appendChild(sec('いろいろ'));
    box.appendChild(grid(S.BUILTIN_IDS.map(function(id){ return cell(id, S.resolve(id)); })));
    // この画面で使われているほかの人のスタンプ
    var own = {}; (mine || []).forEach(function(s){ own[s.id] = 1; });
    var others = Object.keys(cache).filter(function(id){ return !own[id] && id.indexOf('b:') !== 0; });
    if(others.length){
      box.appendChild(sec('みんなのスタンプ'));
      box.appendChild(h('div', {class:'hint', text:'右上の＋で、自分のスタンプに入れられます'}));
      box.appendChild(grid(others.slice(0, 30).map(function(id){
        return cell(id, cache[id], h('button', {type:'button', class:'pcopy', 'aria-label':'自分のスタンプに入れる', text:'＋', onclick:async function(e){
          e.stopPropagation();
          try{ var r = await A.api('/api/stamps/' + id + '/copy', {body:{}}); A.toast('自分のスタンプに入れました'); A.api('/api/stamps').then(function(x){ draw(x.stamps); }); }
          catch(x){ A.toast(A.errMsg(x)); }
        }}));
      })));
    }
  }
  draw(null);
  A.api('/api/stamps').then(function(r){ draw(r.stamps); }).catch(function(){ draw([]); });
}
function oneMap(st){ var m = {}; m[st.id] = st.spec; return m; }

/* ---- 部屋の見た目 ---- */
var PATTERNS = ['なし', 'みずたま', 'しましま', 'きらきら', 'チェック'];
function openRoomStyle(group, onSaved){
  var A = ui();
  var cur = {name:group.name, color:group.color, ccolor:group.ccolor || null, face:group.face || 0, shape:group.shape || 0, pattern:group.pattern || 0, desc:group.desc || ''};
  var pv = h('div', {class:'rpv'}), colorBox = h('div'), shapeBox = h('div', {class:'strip'}), faceBox = h('div', {class:'strip'}), patBox = h('div', {class:'chips'});
  var nameIn = h('input', {class:'field', type:'text', maxlength:'30', value:cur.name, 'aria-label':'部屋の名前'});
  var descIn = h('input', {class:'field', type:'text', maxlength:'60', value:cur.desc, placeholder:'この部屋のひとこと', 'aria-label':'この部屋のひとこと'});
  var close;
  function val(){ return cur.ccolor || cur.color; }
  function drawPreview(){
    pv.innerHTML = '';
    var dark = S.roomDark(cur);
    var card = h('div', {class:'rpv-card pt' + cur.pattern + (dark ? ' dk' : ''), style:S.roomVars(cur)},
      h('div', {class:'rpv-text'}, h('b', {text:nameIn.value || '部屋の名前'}), h('small', {text:descIn.value})), S.roomChar(cur, 64, true));
    pv.appendChild(card);
  }
  function draw(){
    drawPreview();
    colorBox.innerHTML = '';
    colorBox.appendChild(swatchRow(val(), function(v){ if(S.hexOk(v)){ cur.ccolor = v; } else { cur.color = v; cur.ccolor = null; } draw(); }));
    shapeBox.innerHTML = '';
    S.SHAPES.forEach(function(sh, i){ shapeBox.appendChild(pick(S.roomChar({shape:i, color:cur.color, ccolor:cur.ccolor, face:-1}, 46), cur.shape === i, sh.n, function(){ cur.shape = i; draw(); })); });
    faceBox.innerHTML = '';
    S.FACES.forEach(function(f, i){ faceBox.appendChild(pick(S.roomChar({shape:0, color:cur.color, ccolor:cur.ccolor, face:i}, 46), cur.face === i, f.n, function(){ cur.face = i; draw(); })); });
    patBox.innerHTML = '';
    PATTERNS.forEach(function(t, i){ patBox.appendChild(chip(t, cur.pattern === i, function(){ cur.pattern = i; draw(); })); });
  }
  nameIn.addEventListener('input', drawPreview); descIn.addEventListener('input', drawPreview);
  var save = h('button', {type:'button', class:'b3 block', style:'margin-top:16px', text:'保存する'});
  save.addEventListener('click', async function(){
    var name = nameIn.value.trim();
    if(!name){ A.toast('部屋の名前を入れてください'); return; }
    save.disabled = true;
    try{
      await A.api('/api/groups/' + group.id + '/style', {body:{name:name, color:cur.color, ccolor:cur.ccolor, face:cur.face, shape:cur.shape, pattern:cur.pattern, desc:descIn.value.trim()}});
      A.toast('部屋の見た目を変えました'); close(); if(onSaved) onSaved();
    }catch(e){ A.toast(A.errMsg(e)); save.disabled = false; }
  });
  var root = h('div', {class:'sted'}, pv, sec('なまえ'), nameIn, sec('ひとこと'), descIn, sec('いろ'), colorBox, sec('キャラクターのかたち'), shapeBox,
    sec('かお'), faceBox, sec('はいけいの模様'), patBox, save);
  close = A.openSheet('部屋をカスタマイズ', root);
  draw();
}

window.DARAStampUI = {openEditor:openEditor, openPicker:openPicker, openRoomStyle:openRoomStyle};
})();
