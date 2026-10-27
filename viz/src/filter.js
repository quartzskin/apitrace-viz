// Plain script: inlined into the generated page and also required by the tests.

function eventText(e) {
  return (e.api + ' ' + e.cat + ' ' + JSON.stringify(e.args) + ' ' + JSON.stringify(e.ret)).toLowerCase();
}

// opts: cats (Set of enabled categories, null = all), pid, tid (null = any), search, errorsOnly
function filterEvents(events, opts) {
  const q = (opts.search || '').trim().toLowerCase();
  return events.filter((e) => {
    if (opts.cats && !opts.cats.has(e.cat)) return false;
    if (opts.pid != null && e.pid !== opts.pid) return false;
    if (opts.tid != null && e.tid !== opts.tid) return false;
    if (opts.errorsOnly && e.err === 0) return false;
    if (q && !eventText(e).includes(q)) return false;
    return true;
  });
}

function summarize(events) {
  const procs = new Map();
  const cats = new Map();
  for (const e of events) {
    let p = procs.get(e.pid);
    if (!p) {
      p = { pid: e.pid, ppid: e.ppid, threads: new Set(), count: 0, first: e.t, last: e.t };
      procs.set(e.pid, p);
    }
    p.threads.add(e.tid);
    p.count++;
    p.last = Math.max(p.last, e.t + e.dur_us);
    cats.set(e.cat, (cats.get(e.cat) || 0) + 1);
  }
  return {
    processes: [...procs.values()]
      .map((p) => ({ ...p, threads: [...p.threads].sort((a, b) => a - b) }))
      .sort((a, b) => a.first - b.first),
    categories: [...cats.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}

function exportRecord(e) {
  return { ts: e.ts, pid: e.pid, ppid: e.ppid, tid: e.tid, api: e.api, cat: e.cat, args: e.args, ret: e.ret, err: e.err, dur_us: e.dur_us };
}

function toJsonl(events) {
  return events.map((e) => JSON.stringify(exportRecord(e))).join('\n') + (events.length ? '\n' : '');
}

function csvCell(v) {
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(events) {
  const head = ['ts', 'pid', 'ppid', 'tid', 'api', 'cat', 'args', 'ret', 'err', 'dur_us'];
  const rows = events.map((e) =>
    [e.ts, e.pid, e.ppid, e.tid, e.api, e.cat, JSON.stringify(e.args), e.ret === null ? '' : e.ret, e.err, e.dur_us]
      .map(csvCell)
      .join(',')
  );
  return [head.join(','), ...rows].join('\r\n') + '\r\n';
}

if (typeof module !== 'undefined') module.exports = { filterEvents, summarize, toJsonl, toCsv, eventText };
