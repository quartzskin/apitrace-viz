const KNOWN_CATEGORIES = ['file', 'registry', 'process', 'thread', 'memory', 'time', 'system'];

function num(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function normalize(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return { error: 'not a JSON object' };
  if (!num(obj.ts)) return { error: 'missing or non-numeric "ts"' };
  if (typeof obj.api !== 'string' || obj.api === '') return { error: 'missing "api"' };
  if (!num(obj.pid)) return { error: 'missing or non-numeric "pid"' };

  const args = obj.args !== null && typeof obj.args === 'object' && !Array.isArray(obj.args) ? obj.args : {};
  return {
    event: {
      ts: obj.ts,
      pid: obj.pid,
      ppid: num(obj.ppid) ? obj.ppid : 0,
      tid: num(obj.tid) ? obj.tid : 0,
      api: obj.api,
      cat: typeof obj.cat === 'string' && obj.cat !== '' ? obj.cat : 'other',
      args,
      ret: obj.ret === undefined ? null : obj.ret,
      err: num(obj.err) ? obj.err : 0,
      dur_us: num(obj.dur_us) && obj.dur_us >= 0 ? obj.dur_us : 0,
    },
  };
}

// Bad lines are collected, not thrown; events come back sorted by ts with ids and a zero-based `t`.
function parseJsonl(text) {
  const events = [];
  const errors = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === '') return;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      errors.push({ line: i + 1, reason: 'invalid JSON', text: line.slice(0, 80) });
      return;
    }
    const res = normalize(obj);
    if (res.error) {
      errors.push({ line: i + 1, reason: res.error, text: line.slice(0, 80) });
      return;
    }
    res.event.line = i + 1;
    events.push(res.event);
  });

  events.sort((a, b) => a.ts - b.ts || a.line - b.line);
  const t0 = events.length ? events[0].ts : 0;
  events.forEach((e, idx) => {
    e.id = idx;
    e.t = e.ts - t0;
  });
  return { events, errors };
}

module.exports = { parseJsonl, KNOWN_CATEGORIES };
