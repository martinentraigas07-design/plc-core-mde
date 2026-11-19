'use strict';
// ESP32 simulado a nivel HTTP, con las respuestas EXACTAS del firmware (PLC_CORE_MDE.ino / web_server.cpp):
//   /status {mode,nodes,wifi,io:{in,ai,out}}  /nodes {nodes:[{id,name,state,intValue,input1,input2,preset,timerRunning}]}
//   /save (POST, transaccional) -> "Saved OK" | 400 "Empty body"   /load -> JSON guardado o "{}"
//   /plc/run|stop|reload, /tags/get|save, /modbus/status|discover, /wifi/status|toggle
// Todo lo demás (p. ej. /api/memory, que el firmware NO implementa) -> 404 "Not found", como handleNotFound().
function mkEsp(opts) {
  opts = opts || {};
  const st = { program: opts.program || null, mode: 'RUN', wifi: true, ins: [0, 0], ai: [0], outs: [0, 0, 0, 0], nodes: [], tags: null, log: [], saves: 0, reloads: 0 };
  const res = (status, body, json) => {
    const txt = typeof body === 'string' ? body : JSON.stringify(body);
    return Promise.resolve({ ok: status >= 200 && status < 300, status,
      text: () => Promise.resolve(txt),
      json: () => { try { return Promise.resolve(JSON.parse(txt)); } catch (e) { return Promise.reject(new SyntaxError('JSON inválido: ' + txt.slice(0, 40))); } } });
  };
  function fetch(url, o) {
    const u = String(url).split('?')[0], m = (o && o.method) || 'GET';
    st.log.push(m + ' ' + u);
    switch (u) {
      case '/status': return res(200, { mode: st.mode, nodes: st.nodes.length, wifi: st.wifi, io: { in: st.ins.slice(), ai: st.ai.slice(), out: st.outs.slice() } });
      case '/nodes': return res(200, { nodes: st.nodes });
      case '/save': {
        if (m !== 'POST') return res(405, 'Method Not Allowed');
        const b = o && o.body; if (!b) return res(400, 'Empty body');
        st.program = String(b); st.saves++; return res(200, 'Saved OK');
      }
      case '/load': return res(200, st.program || '{}');
      case '/plc/run': st.mode = 'RUN'; return res(200, 'RUN');
      case '/plc/stop': st.mode = 'STOP'; return res(200, 'STOP');
      case '/plc/reload': st.reloads++; return res(200, 'RELOAD');
      case '/tags/get': return res(200, st.tags || { tags: [] });
      case '/tags/save': st.tags = JSON.parse(o.body); return res(200, 'OK');
      case '/modbus/status': return res(200, { modules: [], online: 0 });
      case '/modbus/discover': return res(200, 'OK');
      case '/wifi/status': return res(200, { wifi: st.wifi });
      case '/wifi/toggle': st.wifi = !st.wifi; return res(200, { wifi: st.wifi });
      default: return res(404, 'Not found');
    }
  }
  return { st, fetch };
}
module.exports = { mkEsp };
