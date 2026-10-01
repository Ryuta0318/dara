/* スタンプをつくる・えらぶ画面 / 部屋の見た目を変える画面 */
(function(){
'use strict';
var S = window.DARAStamp;
function ui(){ return window.DARAUI; }
function h(){ return ui().h.apply(null, arguments); }

/* ---- 小さな部品 ---- */
function chip(label, on, fn, style){
  return h('button', {type:'button', class:'chip' + (on ? ' on' : ''), 'aria-pressed':on ? 'true' : 'false', text:label, style:style || null, onclick:fn});
}
function pick(el, on, label, fn){
  return h('button', {type:'button', class:'pk' + (on ? ' on' : ''), 'aria-pressed':on ? 'true' : 'false', 'aria-label':label, onclick:fn}, el);
}
// 色えらび：12色 + 自由な色
function swatchRow(value, onChange){
  var row = h('div', {class:'swrow'});
  S.PAL.forEach(function(p, i){
    row.appendChild(h('button', {type:'button', class:'sw' + (value === i ? ' on' : ''), 'aria-label':'色 ' + (i + 1), 'aria-pressed':value === i ? 'true' : 'false',
      style:'background:radial-gradient(circle at 35% 30%,' + p.l + ',' + p.c + ' 55%,' + p.d + ')', onclick:function(){ onChange(i); }}));
  });
  var isHex = S.hexOk(value);
  var inp = h('input', {type:'color', value:isHex ? value : '#9db8ff', 'aria-label':'好きな色'});
  inp.addEventListener('input', function(){ onChange(inp.value); });
  row.appendChild(h('label', {class:'sw custom' + (isHex ? ' on' : ''), 'aria-label':'好きな色', style:isHex ? 'background:' + value : ''}, inp));
  return row;
}
function sec(title){ return h('div', {class:'lbl', text:title}); }
function fontChips(cur, onPick){
  var box = h('div', {class:'chips fonts'});
  S.FONTS.forEach(function(f, i){
    box.appendChild(h('button', {type:'button', class:'chip fchip' + (cur === i ? ' on' : ''), 'aria-pressed':cur === i ? 'true' : 'false', 'aria-label':f.n + 'の書体',
      style:S.fontStyle(i), onclick:function(){ onPick(i); }}, 'あア' + f.n));
  });
  return box;
}
// 写真を選んで、軽くして、アップロードする。id を返す
function pickPhoto(max, mime){
  return new Promise(function(resolve){
    var A = ui();
    var inp = h('input', {type:'file', accept:'image/*', hidden:true});
    inp.addEventListener('change', async function(){
      var f = inp.files[0]; inp.remove();
      if(!f){ resolve(null); return; }
      try{
        var im = await A.shrinkAs(f, max, mime);
        var id = await A.uploadRaw(im.blob, mime);
        resolve(id);
      }catch(e){ A.toast(A.errMsg(e)); resolve(null); }
    });
    document.body.appendChild(inp); inp.click();
  });
}

/* ---- スタンプのエディタ ---- */
var TYPES = [['stamp', 'かたち'], ['text', 'もじだけ'], ['photo', '写真']];
function typeOf(sp){ return sp.img ? 'photo' : (sp.shape === 8 ? 'text' : 'stamp'); }

function openEditor(init, o){
  o = o || {};
  var A = ui();
  var spec = S.clean(init || {shape:Math.floor(Math.random() * 8), color:Math.floor(Math.random() * 12), face:0, ring:1});
  var type = typeOf(spec);
  var pv = h('div', {class:'pv'});
  var root = h('div', {class:'sted'});
  var typeBox = h('div', {class:'chips'});
  var shapeSec = h('div'), shapeBox = h('div', {class:'strip'});
  var photoSec = h('div'), photoBox = h('div');
  var colorSec = h('div'), colorBox = h('div');
  var faceSec = h('div'), faceBox = h('div', {class:'strip'});
  var fontBox = h('div');
  var textIn = h('input', {class:'field', type:'text', maxlength:'12', placeholder:'ひとこと', value:spec.text, 'aria-label':'スタンプの文字'});
  var posBox = h('div', {class:'chips'}), sizeBox = h('div', {class:'chips'}), tcBox = h('div'), decoBox = h('div', {class:'chips'}), miscBox = h('div');
  var close;

  function set(k, v){ spec[k] = v; draw(); }
  function setType(t){
    type = t;
    if(t === 'stamp'){ spec.img = ''; if(spec.shape === 8) spec.shape = 0; if(spec.face < 0) spec.face = 0; }
    if(t === 'text'){ spec.img = ''; spec.shape = 8; spec.face = -1; if(!spec.text) spec.text = 'やばい'; textIn.value = spec.text; }
    if(t === 'photo'){ spec.face = -1; if(spec.shape === 8 && !spec.img) spec.shape = 0; }
    draw();
  }
  function drawPreview(){ pv.innerHTML = ''; pv.appendChild(S.render(spec, 150)); }
  function draw(){
    drawPreview();
    typeBox.innerHTML = '';
    TYPES.forEach(function(t){ typeBox.appendChild(chip(t[1], type === t[0], function(){ setType(t[0]); })); });
    shapeSec.hidden = type === 'text';
    shapeBox.innerHTML = '';
    S.SHAPES.forEach(function(sh, i){
      if(i === 8 && type !== 'photo') return;
      shapeBox.appendChild(pick(S.render({shape:i, color:spec.color, face:-1, ring:0, text:i === 8 ? '枠なし' : '', tsize:0, tpos:1}, 46), spec.shape === i, sh.n, function(){ set('shape', i); }));
    });
    colorSec.hidden = type === 'photo';
    colorBox.innerHTML = ''; colorBox.appendChild(swatchRow(spec.color, function(v){ set('color', v); }));
    faceSec.hidden = type !== 'stamp';
    faceBox.innerHTML = '';
    faceBox.appendChild(pick(h('span', {class:'none', text:'なし'}), spec.face === -1, '顔なし', function(){ set('face', -1); }));
    S.FACES.forEach(function(f, i){
      faceBox.appendChild(pick(S.render({shape:0, color:spec.color, face:i, ring:0}, 46), spec.face === i, f.n, function(){ set('face', i); }));
    });
    // 写真
    photoSec.hidden = type !== 'photo';
    photoBox.innerHTML = '';
    photoBox.appendChild(h('button', {type:'button', class:'b3 soft sm', text:spec.img ? '別の写真にする' : '写真をえらぶ', onclick:async function(){
      var id = await pickPhoto(384, 'image/png'); if(id){ spec.img = id; draw(); }
    }}));
    if(spec.img){
      var z = h('input', {type:'range', min:'100', max:'300', step:'5', value:String(spec.iz), 'aria-label':'大きさ'});
      var x = h('input', {type:'range', min:'-50', max:'50', step:'1', value:String(spec.ix), 'aria-label':'よこの位置'});
      var y = h('input', {type:'range', min:'-50', max:'50', step:'1', value:String(spec.iy), 'aria-label':'たての位置'});
      z.addEventListener('input', function(){ spec.iz = +z.value; drawPreview(); });
      x.addEventListener('input', function(){ spec.ix = +x.value; drawPreview(); });
      y.addEventListener('input', function(){ spec.iy = +y.value; drawPreview(); });
      photoBox.appendChild(h('div', {class:'rotrow'}, h('span', {class:'hint', text:'大きさ'}), z));
      photoBox.appendChild(h('div', {class:'rotrow'}, h('span', {class:'hint', text:'よこ'}), x));
      photoBox.appendChild(h('div', {class:'rotrow'}, h('span', {class:'hint', text:'たて'}), y));
    }else photoBox.appendChild(h('div', {class:'hint', text:'好きな写真を、スタンプにできます 文字も重ねられます'}));
    // 文字
    textIn.maxLength = type === 'text' ? 12 : 8;
    fontBox.innerHTML = ''; fontBox.appendChild(fontChips(spec.font, function(i){ set('font', i); }));
    posBox.innerHTML = ''; ['上', 'まんなか', '下'].forEach(function(t, i){ var v = [2, 1, 0][i]; posBox.appendChild(chip(t, spec.tpos === v, function(){ set('tpos', v); })); });
    sizeBox.innerHTML = ''; ['小', '中', '大'].forEach(function(t, i){ sizeBox.appendChild(chip(t, spec.tsize === i, function(){ set('tsize', i); })); });
    tcBox.innerHTML = '';
    var tr = h('div', {class:'swrow'});
    tr.appendChild(chip('自動', !spec.tcolor, function(){ set('tcolor', ''); }));
    var fixed = ['#ffffff', '#17131f', '#ff4d79', '#3b82ff', '#ffb000'];
    fixed.forEach(function(c){
      tr.appendChild(h('button', {type:'button', class:'sw small' + (spec.tcolor === c ? ' on' : ''), 'aria-label':'文字の色', style:'background:' + c, onclick:function(){ set('tcolor', c); }}));
    });
    var ti = h('input', {type:'color', value:spec.tcolor || '#ffffff', 'aria-label':'文字の色を選ぶ'});
    ti.addEventListener('input', function(){ set('tcolor', ti.value); });
    tr.appendChild(h('label', {class:'sw small custom' + (spec.tcolor && fixed.indexOf(spec.tcolor) < 0 ? ' on' : ''), 'aria-label':'文字の色を選ぶ'}, ti));
    tcBox.appendChild(tr);
    decoBox.innerHTML = ''; S.DECOS.forEach(function(t, i){ decoBox.appendChild(chip(t, spec.deco === i, function(){ set('deco', i); })); });
    miscBox.innerHTML = '';
    var rot = h('input', {type:'range', min:'-20', max:'20', step:'1', value:String(spec.rot), 'aria-label':'かたむき'});
    rot.addEventListener('input', function(){ spec.rot = +rot.value; drawPreview(); });
    miscBox.appendChild(h('div', {class:'rotrow'}, h('span', {class:'hint', text:'かたむき'}), rot, chip('ふちどり', !!spec.ring, function(){ set('ring', spec.ring ? 0 : 1); })));
  }
  textIn.addEventListener('input', function(){ spec.text = textIn.value.slice(0, type === 'text' ? 12 : 8); drawPreview(); });

  var saveBtn = h('button', {type:'button', class:'b3 block', style:'margin-top:16px', text:o.id ? '保存する' : 'スタンプをつくる'});
  saveBtn.addEventListener('click', async function(){
    if(type === 'photo' && !spec.img){ A.toast('写真をえらんでください'); return; }
    if(type === 'text' && !spec.text.trim()){ A.toast('文字を入れてください'); return; }
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
  rnd.addEventListener('click', function(){
    var keep = spec.text, font = Math.floor(Math.random() * S.FONTS.length);
    spec = S.random(keep); spec.font = font; type = 'stamp'; draw();
  });

  root.appendChild(h('div', {class:'pvwrap'}, pv, rnd));
  root.appendChild(sec('タイプ')); root.appendChild(typeBox);
  shapeSec.appendChild(sec('かたち')); shapeSec.appendChild(shapeBox); root.appendChild(shapeSec);
  photoSec.appendChild(sec('写真')); photoSec.appendChild(photoBox); root.appendChild(photoSec);
  colorSec.appendChild(sec('いろ')); colorSec.appendChild(colorBox); root.appendChild(colorSec);
  faceSec.appendChild(sec('かお')); faceSec.appendChild(faceBox); root.appendChild(faceSec);
  root.appendChild(sec('もじ')); root.appendChild(textIn);
  root.appendChild(h('div', {class:'hint', style:'margin-top:8px', text:'書体'})); root.appendChild(fontBox);
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
  close = A.openSheet(opts.title || 'スタンプをえらぶ', box);
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
    var own = {}; (mine || []).forEach(function(s){ own[s.id] = 1; });
    var others = Object.keys(cache).filter(function(id){ return !own[id] && id.indexOf('b:') !== 0; });
    if(others.length){
      box.appendChild(sec('みんなのスタンプ'));
      box.appendChild(h('div', {class:'hint', text:'右上の＋で、自分のスタンプに入れられます'}));
      box.appendChild(grid(others.slice(0, 30).map(function(id){
        return cell(id, cache[id], h('button', {type:'button', class:'pcopy', 'aria-label':'自分のスタンプに入れる', text:'＋', onclick:async function(e){
          e.stopPropagation();
          try{ await A.api('/api/stamps/' + id + '/copy', {body:{}}); A.toast('自分のスタンプに入れました'); A.api('/api/stamps').then(function(x){ draw(x.stamps); }); }
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
var ACOLORS = ['#ffffff', '#ffd1e3', '#cfe0ff', '#c9f2df', '#fff0a8', '#e2d2ff', '#ffd9bd', '#d3d3d9'];
function openRoomStyle(group, onSaved){
  var A = ui();
  var cur = {name:group.name, color:group.color, ccolor:group.ccolor || null, animal:window.DARAAnimal.kindOf(group), acolor:group.acolor || null, scene:typeof group.scene === 'number' ? group.scene : null, decor:(group.decor || []).slice(0, 4),
    desc:group.desc || '', tfont:group.tfont || 0};
  var pvStage = h('div', {class:'pvstage'}), pvModes = h('div', {class:'pvmodes'}), colorBox = h('div'), animalBox = h('div', {class:'strip'}), acolBox = h('div', {class:'swrow'});
  var fontBox = h('div');
  var nameIn = h('input', {class:'field', type:'text', maxlength:'30', value:cur.name, 'aria-label':'部屋の名前'});
  var descIn = h('input', {class:'field', type:'text', maxlength:'60', value:cur.desc, placeholder:'この部屋のひとこと', 'aria-label':'この部屋のひとこと'});
  var close;
  function val(){ return cur.ccolor || cur.color; }
  // 完成イメージ：実際の画面と同じ部品で描く。スクロールしても、ずっと上に出ている
  var PVK = 'dara.pvmode2', mode = 'stage';
  try{ var sm = localStorage.getItem(PVK); mode = sm === 'banner' || sm === 'card' ? sm : 'stage'; }catch(e){}
  function drawPreview(){
    var g = Object.assign({}, group, cur, {name:nameIn.value.trim() || '部屋の名前', desc:descIn.value.trim(), members:group.members || [], lastText:group.lastText || ''});
    pvStage.innerHTML = '';
    if(mode === 'banner'){
      var wrap = h('div', {class:'pvscale'}), b = A.fillBanner(h('div'), g, {preview:true});
      b.style.width = '390px'; wrap.appendChild(b); pvStage.appendChild(wrap);
      requestAnimationFrame(function(){
        var k = Math.min(1, pvStage.clientWidth / 390);
        b.style.transform = 'scale(' + k + ')'; wrap.style.height = Math.round(b.offsetHeight * k) + 'px';
      });
    }else if(mode === 'stage'){
      var stg = A.stage(g, {}); stg.setAttribute('style', A.roomVars(g)); pvStage.appendChild(h('div', {class:'pvcard'}, stg));
    }else pvStage.appendChild(h('div', {class:'pvcard'}, A.cardEl(g, {preview:true})));
    pvModes.innerHTML = '';
    pvModes.appendChild(h('span', {class:'pvcap', text:'完成イメージ'}));
    [['stage', '部屋'], ['card', 'ホームのカード'], ['banner', '上のバー']].forEach(function(m){
      pvModes.appendChild(chip(m[1], mode === m[0], function(){ mode = m[0]; try{ localStorage.setItem(PVK, mode); }catch(e){} drawPreview(); }));
    });
  }
  function draw(){
    drawPreview();
    colorBox.innerHTML = '';
    colorBox.appendChild(swatchRow(val(), function(v){ if(S.hexOk(v)){ cur.ccolor = v; } else { cur.color = v; cur.ccolor = null; } draw(); }));
    animalBox.innerHTML = '';
    window.DARAAnimal.NAMES.forEach(function(n, i){
      animalBox.appendChild(pick(window.DARAAnimal.render(i, cur.acolor, 56), cur.animal === i, n, function(){ cur.animal = i; draw(); }));
    });
    acolBox.innerHTML = '';
    ACOLORS.forEach(function(c, i){
      var on = (cur.acolor || null) === (i ? c : null);
      acolBox.appendChild(h('button', {type:'button', class:'sw' + (on ? ' on' : ''), 'aria-label':i ? 'キャラの色 ' + i : 'パールホワイト', style:'background:' + c, onclick:function(){ cur.acolor = i ? c : null; draw(); }}));
    });
    fontBox.innerHTML = ''; fontBox.appendChild(fontChips(cur.tfont, function(i){ cur.tfont = i; draw(); }));
  }
  nameIn.addEventListener('input', drawPreview); descIn.addEventListener('input', drawPreview);
  var save = h('button', {type:'button', class:'b3 block', style:'margin-top:16px', text:'保存する'});
  save.addEventListener('click', async function(){
    var name = nameIn.value.trim();
    if(!name){ A.toast('部屋の名前を入れてください'); return; }
    save.disabled = true;
    try{
      await A.api('/api/groups/' + group.id + '/style', {body:{name:name, color:cur.color, ccolor:cur.ccolor, animal:cur.animal, acolor:cur.acolor, scene:cur.scene, decor:cur.decor,
        desc:descIn.value.trim(), tfont:cur.tfont}});
      A.toast('部屋の見た目を変えました'); close(); if(onSaved) onSaved();
    }catch(e){ A.toast(A.errMsg(e)); save.disabled = false; }
  });
  var pvTop = h('div', {class:'pvtop'}, pvModes, pvStage);
  var tab = 'chara';
  var tabsEl = h('div', {class:'segtabs'}), pane = h('div');
  function drawTabs(){
    tabsEl.innerHTML = '';
    [['chara', 'キャラ'], ['scene', '背景'], ['decor', 'デコ'], ['color', '色'], ['text', '文字']].forEach(function(t){
      tabsEl.appendChild(h('button', {type:'button', class:'seg' + (tab === t[0] ? ' on' : ''), text:t[1], onclick:function(){ tab = t[0]; drawTabs(); }}));
    });
    pane.innerHTML = '';
    if(tab === 'chara'){ pane.appendChild(sec('キャラクターをえらぶ')); pane.appendChild(animalBox); pane.appendChild(sec('キャラクターのいろ')); pane.appendChild(acolBox); }
    else if(tab === 'scene'){
      pane.appendChild(sec('背景をえらぶ'));
      var grid = h('div', {class:'scgrid'});
      grid.appendChild(h('button', {type:'button', class:'sccell' + (cur.scene === null ? ' on' : ''), onclick:function(){ cur.scene = null; draw(); drawTabs(); }}, h('i', {class:'scth none'}), h('small', {text:'なし'})));
      window.DARAScene.SCENES.forEach(function(sc, i){
        grid.appendChild(h('button', {type:'button', class:'sccell' + (cur.scene === i ? ' on' : ''), onclick:function(){ cur.scene = i; draw(); drawTabs(); }},
          h('i', {class:'scth', style:'background:' + sc.bg}, h('span', {text:sc.em})), h('small', {text:sc.n})));
      });
      pane.appendChild(grid);
    }
    else if(tab === 'decor'){
      pane.appendChild(sec('かざるもの（4つまで）'));
      var dg = h('div', {class:'scgrid'});
      window.DARAScene.DECORS.forEach(function(d, i){
        var on = cur.decor.indexOf(i) >= 0;
        dg.appendChild(h('button', {type:'button', class:'sccell' + (on ? ' on' : ''), onclick:function(){
          if(on) cur.decor = cur.decor.filter(function(x){ return x !== i; });
          else if(cur.decor.length < 4) cur.decor = cur.decor.concat([i]);
          else { A.toast('かざりは4つまでです'); return; }
          draw(); drawTabs();
        }}, h('i', {class:'scth deco'}, h('span', {text:d.em})), h('small', {text:d.n})));
      });
      pane.appendChild(dg);
    }
    else if(tab === 'color'){ pane.appendChild(sec('部屋の色をえらぶ')); pane.appendChild(colorBox); }
    else{ pane.appendChild(sec('なまえ')); pane.appendChild(nameIn); pane.appendChild(sec('ひとこと')); pane.appendChild(descIn); pane.appendChild(sec('タイトルの書体')); pane.appendChild(fontBox); }
  }
  var root = h('div', {class:'sted'},
    tabsEl, pane, save);
  close = A.openSheet('部屋をカスタマイズ', root, null, {top:pvTop});
  draw(); drawTabs();
}

window.DARAStampUI = {openEditor:openEditor, openPicker:openPicker, openRoomStyle:openRoomStyle};
})();
