/* PLC-CORE-MDE — Memory Panel UI v2 */
(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('/js/api/plc_api'));
  else root.MemoryPanel = factory(root.PlcApi);
}(typeof self !== 'undefined' ? self : this, function(PlcApi) {

  var CSS_DONE = false;
  function injectCSS() {
    if (CSS_DONE) return; CSS_DONE = true;
    var s = document.createElement('style');
    s.textContent = [
      '.mp{font-family:var(--font-mono,monospace);font-size:10px;display:flex;flex-direction:column;gap:6px;padding:6px;}',
      '.mp-sec{background:var(--panel,#141920);border:1px solid var(--border,#1e2a38);border-radius:3px;overflow:hidden;}',
      '.mp-hdr{display:flex;align-items:center;gap:6px;padding:5px 9px;background:var(--panel2,#1a2130);border-bottom:1px solid var(--border,#1e2a38);}',
      '.mp-hdot{width:6px;height:6px;border-radius:50%;flex-shrink:0;}',
      '.mp-htitle{letter-spacing:3px;text-transform:uppercase;font-size:8px;color:var(--text-dim,#4a6070);flex:1;}',
      '.mp-hcount{font-size:8px;color:var(--text-dim,#4a6070);}',
      '.mp-bits{display:flex;flex-wrap:wrap;gap:4px;padding:6px;}',
      '.mp-bit{width:34px;display:flex;flex-direction:column;align-items:center;gap:2px;}',
      '.mp-bit.click{cursor:pointer;}.mp-bit.click:hover .mp-led{transform:scale(1.18);}',
      '.mp-led{width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,0.08);transition:all 0.12s;}',
      '.mp-led.x{background:#00e676;box-shadow:0 0 7px #00e676;border-color:rgba(0,230,118,0.4);}',
      '.mp-led.y{background:#f5a623;box-shadow:0 0 7px #f5a623;border-color:rgba(245,166,35,0.4);}',
      '.mp-led.m{background:#3ab4f2;box-shadow:0 0 6px #3ab4f2;border-color:rgba(58,180,242,0.4);}',
      '.mp-led.t{background:#ffd740;box-shadow:0 0 6px #ffd740;border-color:rgba(255,215,64,0.4);}',
      '.mp-led.off{background:var(--border2,#263445);}',
      '.mp-lbl{font-size:7px;color:var(--text-dim,#4a6070);letter-spacing:1px;}',
      '.mp-abars{display:flex;flex-direction:column;gap:5px;padding:6px;}',
      '.mp-arow{display:flex;flex-direction:column;gap:2px;}',
      '.mp-ahdr{display:flex;justify-content:space-between;font-size:8px;}',
      '.mp-albl{color:var(--accent2,#3ab4f2);}.mp-aval{color:var(--accent2,#3ab4f2);}',
      '.mp-bar{height:5px;background:var(--bg2,#0f1318);border-radius:3px;overflow:hidden;border:1px solid var(--border,#1e2a38);}',
      '.mp-fill{height:100%;background:linear-gradient(90deg,#3ab4f2,#f5a623);border-radius:3px;transition:width 0.25s;}',
      '.mp-err{padding:8px;color:var(--red,#ff3d5a);font-size:9px;letter-spacing:1px;}',
    ].join('');
    document.head.appendChild(s);
  }

  function MemoryPanel(container, opts) {
    this.el   = container;
    this.opts = Object.assign({pollMs:250, xCount:8, yCount:8, mCount:16, tCount:8, aCount:4}, opts||{});
    this._t   = null;
    this._mem = null;
    this._busy = false;
  }

  MemoryPanel.prototype.start = function() {
    injectCSS();
    this.el.innerHTML = '';
    var d = document.createElement('div'); d.className = 'mp';
    this.el.appendChild(d); this._root = d;
    var self = this;
    this._poll();
    this._t = setInterval(function(){self._poll();}, this.opts.pollMs);
  };

  MemoryPanel.prototype.stop = function() {
    if (this._t) { clearInterval(this._t); this._t = null; }
  };

  MemoryPanel.prototype._poll = function() {
    var self = this;
    PlcApi.getMemory().then(function(m) {
      self._mem = m; self._render(m);
    }).catch(function() {
      if (self._root) self._root.innerHTML = '<div class="mp-err">⚠ Sin conexión</div>';
    });
  };

  MemoryPanel.prototype._render = function(m) {
    var el = this._root; if (!el) return;
    el.innerHTML = '';
    var o = this.opts;
    el.appendChild(this._bits('ENTRADAS', 'X', m.X||[], o.xCount, 'x', '#00e676', true));
    el.appendChild(this._bits('SALIDAS',  'Y', m.Y||[], o.yCount, 'y', '#f5a623', false));
    el.appendChild(this._bits('BITS M',   'M', m.M||[], o.mCount, 'm', '#3ab4f2', false));
    el.appendChild(this._bits('TIMERS T', 'T', m.T||[], o.tCount, 't', '#ffd740', false));
    el.appendChild(this._analog(m.A||[], o.aCount));
  };

  MemoryPanel.prototype._bits = function(title, prefix, arr, count, cls, color, clickable) {
    var self = this, on = 0;
    for (var i=0;i<Math.min(count,arr.length);i++) if(arr[i]) on++;
    var sec = document.createElement('div'); sec.className='mp-sec';
    var hdr = document.createElement('div'); hdr.className='mp-hdr';
    hdr.innerHTML='<div class="mp-hdot" style="background:'+color+'"></div>'+
      '<span class="mp-htitle">'+title+'</span>'+
      '<span class="mp-hcount">'+on+'/'+count+'</span>';
    sec.appendChild(hdr);
    var grid = document.createElement('div'); grid.className='mp-bits';
    for (var j=0;j<count;j++) {
      var v = arr[j]?1:0;
      var bit = document.createElement('div');
      bit.className='mp-bit'+(clickable?' click':'');
      bit.title=(clickable?'Toggle ':'') + prefix+j;
      var led = document.createElement('div');
      led.className='mp-led '+(v?cls:'off');
      var lbl = document.createElement('div');
      lbl.className='mp-lbl'; lbl.textContent=prefix+j;
      bit.appendChild(led); bit.appendChild(lbl);
      if (clickable) {
        (function(idx){
          bit.addEventListener('click', function(){
            if (self._busy) return; self._busy = true;
            var x = self._mem ? (self._mem.X||[]).slice() : [];
            x[idx] = x[idx] ? 0 : 1;
            PlcApi.patchMemory({X:x}).then(function(){
              self._busy=false; self._poll();
            }).catch(function(){self._busy=false;});
          });
        })(j);
      }
      grid.appendChild(bit);
    }
    sec.appendChild(grid);
    return sec;
  };

  MemoryPanel.prototype._analog = function(arr, count) {
    var sec = document.createElement('div'); sec.className='mp-sec';
    var hdr = document.createElement('div'); hdr.className='mp-hdr';
    hdr.innerHTML='<div class="mp-hdot" style="background:#c882e0"></div>'+
      '<span class="mp-htitle">ANALÓGICAS A</span>';
    sec.appendChild(hdr);
    var list = document.createElement('div'); list.className='mp-abars';
    for (var i=0;i<count;i++) {
      var v = arr[i]||0, pct = Math.round(Math.min(v,4095)/4095*100);
      var row = document.createElement('div'); row.className='mp-arow';
      var ah = document.createElement('div'); ah.className='mp-ahdr';
      ah.innerHTML='<span class="mp-albl">A'+i+(i===0?' · GPIO36':' · Modbus')+'</span>'+
        '<span class="mp-aval">'+v+' · '+pct+'%</span>';
      var bar = document.createElement('div'); bar.className='mp-bar';
      var fill = document.createElement('div'); fill.className='mp-fill';
      fill.style.width=pct+'%';
      bar.appendChild(fill); row.appendChild(ah); row.appendChild(bar);
      list.appendChild(row);
    }
    sec.appendChild(list);
    return sec;
  };

  return MemoryPanel;
}));
