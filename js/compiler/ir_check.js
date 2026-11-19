/* =============================================================
   PLC-CORE-MDE — IrCheck  (verificador diferencial de IR)
   /js/compiler/ir_check.js
   =============================================================
   NO es un motor de ejecución. Los programas siguen ejecutándose
   únicamente en plc_runtime.cpp (ESP32) y en el simulador. Este
   módulo es un ORÁCULO DE VERIFICACIÓN: reproduce, nodo por nodo,
   la semántica de un scan de plc_runtime.cpp para comparar dos IR
   (p. ej. el IR de un FBD y el IR que sale de recompilar el Ladder
   obtenido al convertirlo) con las mismas secuencias de entradas
   y de tiempo, y exigir salidas idénticas scan a scan.

   Su fidelidad con el firmware y con el simulador se comprueba en
   tests/t_irchk.js (mismas secuencias en los tres).

   API
     IrCheck.simulate(ir, steps) -> [{y:[4], pwm:[4]}, ...]
        steps: [{x:[b,b], a:int, dt:ms}]   (dt = ms antes del scan)
     IrCheck.equivalent(irA, irB, opts) -> {ok, steps, diff}
   ============================================================= */
(function (root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.IrCheck = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function _id(v) { return (v === null || v === undefined || v < 0) ? -1 : v; }

  function _prepare(ir) {
    var src = ir.program.nodes;
    var nodes = src.map(function (nd) {
      return {
        id: nd.id, type: nd.type, i1: _id(nd.in1), i2: _id(nd.in2),
        preset: nd.preset | 0, value: nd.value | 0, op: nd.op || '>',
        out: nd.outIdx | 0,
        inMin: nd.scaleInMin !== undefined ? nd.scaleInMin : (nd.inMin !== undefined ? nd.inMin : 0),
        inMax: nd.scaleInMax !== undefined ? nd.scaleInMax : (nd.inMax !== undefined ? nd.inMax : 4095),
        outMin: nd.scaleOutMin !== undefined ? nd.scaleOutMin : (nd.outMin !== undefined ? nd.outMin : 0),
        outMax: nd.scaleOutMax !== undefined ? nd.scaleOutMax : (nd.outMax !== undefined ? nd.outMax : 100),
        state: false, iv: 0, run: false, done: false, start: 0, prevIn: false,
        prevCU: false, prevCD: false, trigPrev: false, blinkLast: 0, blinkState: false
      };
    });
    // Idioma heredado SR(S=X, R=NOT X): el firmware lo convierte en NT_PREV
    nodes.forEach(function (n) {
      if (n.type !== 'sr') return;
      var a = n.i1, b = n.i2;
      if (a < 0 || b < 0) return;
      if (nodes[b].type === 'not' && nodes[b].i1 === a && nodes[b].i2 < 0) n.type = 'prev';
    });
    var order = (ir.order && ir.order.length) ? ir.order.slice() : null;
    if (!order) throw new Error('IrCheck: el IR no trae "order"');
    return { nodes: nodes, order: order };
  }

  function _numeric(t) { return t === 'analog1' || t === 'scale'; }

  function Machine(ir) {
    var p = _prepare(ir);
    this.nodes = p.nodes; this.order = p.order; this.now = 1000;
  }

  Machine.prototype.scan = function (st) {
    var nodes = this.nodes, now = this.now;
    function ins(n, k) { var s = k === 0 ? n.i1 : n.i2; return s >= 0 ? nodes[s].state : false; }
    function ival(ix) { if (ix < 0) return 0; return _numeric(nodes[ix].type) ? nodes[ix].iv : (nodes[ix].state ? 1 : 0); }
    var i;
    for (i = 0; i < nodes.length; i++) {
      var n0 = nodes[i];
      if (n0.type === 'input1') n0.state = !!st.x[0];
      else if (n0.type === 'input2') n0.state = !!st.x[1];
      else if (n0.type === 'analog1') { n0.iv = st.a | 0; n0.state = n0.iv > 2048; }
    }
    for (var e = 0; e < this.order.length; e++) {
      var n = nodes[this.order[e]];
      switch (n.type) {
        case 'and': n.state = ins(n, 0) && ins(n, 1); break;
        case 'or':  n.state = ins(n, 0) || ins(n, 1); break;
        case 'not': n.state = !ins(n, 0); break;
        case 'xor': n.state = ins(n, 0) !== ins(n, 1); break;
        case 'cmp': {
          var v1 = ival(n.i1), v2 = n.i2 >= 0 ? ival(n.i2) : n.value;
          switch (n.op) {
            case '>': n.state = v1 > v2; break;   case '<': n.state = v1 < v2; break;
            case '>=': n.state = v1 >= v2; break; case '<=': n.state = v1 <= v2; break;
            case '==': n.state = v1 === v2; break; case '!=': n.state = v1 !== v2; break;
            default: n.state = false;
          }
          break;
        }
        case 'ton': {
          var IN = ins(n, 0);
          if (IN) {
            if (!n.run) { n.run = true; n.done = false; n.start = now; n.state = false; }
            else if ((now - n.start) >= n.preset) { n.state = true; n.done = true; }
          } else { n.run = false; n.done = false; n.state = false; }
          break;
        }
        case 'tof': {
          var I2 = ins(n, 0), re = I2 && !n.prevIn, fe = !I2 && n.prevIn;
          if (re) { n.state = true; n.run = false; n.done = false; }
          else if (fe) { n.run = true; n.done = false; n.start = now; n.state = true; }
          else if (!I2 && n.run) { if ((now - n.start) >= n.preset) { n.state = false; n.run = false; n.done = true; } }
          else if (!I2 && n.done) n.state = false;
          else if (I2) n.state = true;
          n.prevIn = I2;
          break;
        }
        case 'tp': {
          var I3 = ins(n, 0), re3 = I3 && !n.prevIn;
          if (re3 && !n.run) { n.run = true; n.done = false; n.start = now; n.state = true; }
          else if (n.run) { if ((now - n.start) >= n.preset) { n.run = false; n.done = true; n.state = false; } }
          else if (n.done && !I3) n.done = false;
          n.prevIn = I3;
          break;
        }
        case 'blink': {
          var EN = n.i1 >= 0 ? nodes[n.i1].state : true;
          if (!EN) { n.state = false; n.blinkLast = now; }
          else {
            if ((now - n.blinkLast) >= n.preset) { n.blinkState = !n.blinkState; n.blinkLast = now; }
            n.state = n.blinkState;
          }
          break;
        }
        case 'ctu': {
          var CU = ins(n, 0), R = ins(n, 1);
          if (R) n.iv = 0; else if (CU && !n.prevCU) n.iv++;
          n.state = n.iv >= n.value; n.prevCU = CU;
          break;
        }
        case 'ctd': {
          var CD = ins(n, 0), LD = ins(n, 1);
          if (LD) n.iv = n.value; else if (CD && !n.prevCD) { if (n.iv > 0) n.iv--; }
          n.state = n.iv <= 0; n.prevCD = CD;
          break;
        }
        case 'sr': { var S = ins(n, 0), R1 = ins(n, 1); if (S) n.state = true; else if (R1) n.state = false; break; }
        case 'rs': { var S2 = ins(n, 0), R2 = ins(n, 1); if (R2) n.state = false; else if (S2) n.state = true; break; }
        case 'r_trig': { var A = ins(n, 0); n.state = A && !n.trigPrev; n.trigPrev = A; break; }
        case 'f_trig': { var B = ins(n, 0); n.state = !B && n.trigPrev; n.trigPrev = B; break; }
        case 'scale': {
          var raw = n.i1 >= 0 ? nodes[n.i1].iv : 0;
          if (n.inMax === n.inMin) n.iv = n.outMin;
          else {
            var sc = Math.trunc((raw - n.inMin) * (n.outMax - n.outMin) / (n.inMax - n.inMin)) + n.outMin;
            var lo = Math.min(n.outMin, n.outMax), hi = Math.max(n.outMin, n.outMax);
            if (sc < lo) sc = lo; if (sc > hi) sc = hi;
            n.iv = sc;
          }
          n.state = n.iv > 0;
          break;
        }
        case 'pwm': {
          var val = n.value;
          if (n.i1 >= 0) { var s = nodes[n.i1]; val = _numeric(s.type) ? s.iv : (s.state ? 4095 : 0); }
          n.iv = val;
          break;
        }
        case 'output1': case 'output2': case 'output3': case 'output4':
          n.state = ins(n, 0); break;
        default: break;
      }
    }
    for (i = 0; i < nodes.length; i++) if (nodes[i].type === 'prev') nodes[i].state = ins(nodes[i], 0);
    var y = [false, false, false, false], pwm = [0, 0, 0, 0];
    for (i = 0; i < nodes.length; i++) {
      var t = nodes[i].type;
      if (t === 'output1') y[0] = nodes[i].state; else if (t === 'output2') y[1] = nodes[i].state;
      else if (t === 'output3') y[2] = nodes[i].state; else if (t === 'output4') y[3] = nodes[i].state;
      else if (t === 'pwm' && nodes[i].out >= 0 && nodes[i].out < 4) pwm[nodes[i].out] = nodes[i].iv;
    }
    return { y: y, pwm: pwm };
  };

  function simulate(ir, steps) {
    var m = new Machine(ir), out = [];
    steps.forEach(function (s) { m.now += (s.dt === undefined ? 10 : s.dt); out.push(m.scan(s)); });
    return out;
  }

  function _pwmPins(ir) {
    var p = {};
    ir.program.nodes.forEach(function (n) { if (n.type === 'pwm') p[n.outIdx | 0] = true; });
    return p;
  }

  function _maxPreset(ir) {
    var m = 0;
    ir.program.nodes.forEach(function (n) { if ((n.preset | 0) > m) m = n.preset | 0; });
    return m;
  }

  function _rng(seed) { var s = seed >>> 0; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

  /* Secuencias deterministas: conmutación de entradas/analógica con saltos de
     tiempo cortos y largos (para vencer los presets). */
  function genSteps(maxPreset, seed, n) {
    var r = _rng(seed), steps = [], x = [false, false], a = 0;
    var dts = [10, 10, 10, 20, 50, 100, 250, 1000];
    if (maxPreset > 0) { dts.push(maxPreset + 1); dts.push(Math.max(10, maxPreset >> 1)); }
    var pX = 0.05 + r() * 0.3;
    for (var i = 0; i < n; i++) {
      if (r() < pX) x[0] = !x[0];
      if (r() < pX) x[1] = !x[1];
      if (r() < 0.04) { var q = r(); a = q < 0.2 ? 0 : q < 0.4 ? 4095 : Math.floor(r() * 4096); }
      steps.push({ x: [x[0], x[1]], a: a, dt: dts[Math.floor(r() * dts.length)] });
    }
    return steps;
  }

  function equivalent(irA, irB, opts) {
    opts = opts || {};
    var seqs = opts.sequences || 12, len = opts.length || 1500;
    var mp = Math.max(_maxPreset(irA), _maxPreset(irB));
    var pa = _pwmPins(irA), pb = _pwmPins(irB), total = 0;
    for (var s = 0; s < seqs; s++) {
      var steps = genSteps(mp, 7919 * (s + 1), len);
      var A = simulate(irA, steps), B = simulate(irB, steps);
      for (var k = 0; k < steps.length; k++) {
        total++;
        for (var j = 0; j < 4; j++) {
          if (A[k].pwm[j] !== B[k].pwm[j])
            return { ok: false, steps: total, diff: { seq: s, step: k, what: 'PWM' + (j + 1), a: A[k].pwm[j], b: B[k].pwm[j] } };
          if (!pa[j] && !pb[j] && A[k].y[j] !== B[k].y[j])
            return { ok: false, steps: total, diff: { seq: s, step: k, what: 'Y' + j, a: A[k].y[j], b: B[k].y[j] } };
          if ((pa[j] !== pb[j])) return { ok: false, steps: total, diff: { what: 'PWM pin ' + j + ' en un solo IR' } };
        }
      }
    }
    return { ok: true, steps: total, diff: null };
  }

  return { simulate: simulate, equivalent: equivalent, genSteps: genSteps, Machine: Machine };
}));
