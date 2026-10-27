(function () {
  const DATA = JSON.parse(document.getElementById('trace-data').textContent);
  const events = DATA.events;
  const COLORS = DATA.colors;
  const FALLBACK = '#8b95a5';
  const ERR_NAMES = { 2: 'file not found', 3: 'path not found', 5: 'access denied', 6: 'invalid handle', 87: 'invalid parameter', 258: 'wait timeout' };
  const LANE_H = 24;
  const LABEL_W = 170;

  const $ = (id) => document.getElementById(id);
  const color = (cat) => COLORS[cat] || FALLBACK;
  const NS = 'http://www.w3.org/2000/svg';

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const kid of kids) el.append(kid);
    return el;
  }

  function sv(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    return el;
  }

  function fmtTime(us) {
    if (us >= 1e6) return (us / 1e6).toFixed(3) + ' s';
    if (us >= 1e3) return (us / 1e3).toFixed(2) + ' ms';
    return us + ' us';
  }

  function argSummary(e) {
    return Object.entries(e.args).map(([k, v]) => k + '=' + v).join(' ');
  }

  const state = { cats: new Set(DATA.categories.map((c) => c.name)), pid: null, tid: null, search: '', errorsOnly: false, zoom: 1, selected: null };
  const span = Math.max(1, ...events.map((e) => e.t + e.dur_us));
  let shown = events;

  function buildStatic() {
    $('meta').textContent = events.length + ' events, ' + DATA.summary.processes.length + ' process(es), ' + fmtTime(span) + (DATA.source ? ' - ' + DATA.source : '');
    if (DATA.errors.length) {
      const box = $('parse-errors');
      box.hidden = false;
      box.append(h('summary', {}, DATA.errors.length + ' line(s) could not be imported'));
      for (const er of DATA.errors.slice(0, 50)) box.append(h('div', {}, 'line ' + er.line + ': ' + er.reason));
    }

    const chips = $('chips');
    for (const c of DATA.categories) {
      const cb = h('input', { type: 'checkbox', checked: '' });
      cb.addEventListener('change', () => {
        cb.checked ? state.cats.add(c.name) : state.cats.delete(c.name);
        refresh();
      });
      const sw = h('span', { class: 'sw' });
      sw.style.background = color(c.name);
      chips.append(h('label', { class: 'chip' }, cb, sw, c.name + ' (' + c.count + ')'));
    }

    const pidSel = $('pid');
    pidSel.append(h('option', { value: '' }, 'all processes'));
    for (const p of DATA.summary.processes) {
      pidSel.append(h('option', { value: p.pid }, 'pid ' + p.pid + ' (parent ' + p.ppid + ')'));
    }
    pidSel.addEventListener('change', () => {
      state.pid = pidSel.value === '' ? null : Number(pidSel.value);
      state.tid = null;
      fillThreads();
      refresh();
    });
    $('tid').addEventListener('change', (ev) => {
      state.tid = ev.target.value === '' ? null : Number(ev.target.value);
      refresh();
    });
    $('search').addEventListener('input', (ev) => {
      state.search = ev.target.value;
      refresh();
    });
    $('errs').addEventListener('change', (ev) => {
      state.errorsOnly = ev.target.checked;
      refresh();
    });
    $('zoom').addEventListener('input', (ev) => {
      state.zoom = Number(ev.target.value);
      drawTimeline();
    });
    $('exp-jsonl').addEventListener('click', () => download('filtered.jsonl', toJsonl(shown), 'application/x-ndjson'));
    $('exp-csv').addEventListener('click', () => download('filtered.csv', toCsv(shown), 'text/csv'));
    $('reset').addEventListener('click', () => location.reload());
    fillThreads();
  }

  function fillThreads() {
    const sel = $('tid');
    sel.replaceChildren(h('option', { value: '' }, 'all threads'));
    const procs = DATA.summary.processes.filter((p) => state.pid == null || p.pid === state.pid);
    for (const p of procs) for (const t of p.threads) sel.append(h('option', { value: t }, 'tid ' + t));
  }

  function download(name, text, type) {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.append(a);
    a.click();
    a.remove();
  }

  function drawProcessTree() {
    const box = $('tree');
    box.replaceChildren();
    const procs = DATA.summary.processes;
    const byPid = new Map(procs.map((p) => [p.pid, p]));
    const kids = new Map();
    const roots = [];
    for (const p of procs) {
      if (byPid.has(p.ppid) && p.ppid !== p.pid) {
        if (!kids.has(p.ppid)) kids.set(p.ppid, []);
        kids.get(p.ppid).push(p);
      } else roots.push(p);
    }
    const walk = (p, depth) => {
      const row = h('div', { class: 'proc', style: 'padding-left:' + depth * 14 + 'px' }, 'pid ' + p.pid, h('small', {}, ' ' + p.count + ' calls, ' + p.threads.length + ' thread(s)'));
      if (!byPid.has(p.ppid)) row.append(h('small', {}, ' parent ' + p.ppid + ' (not traced)'));
      row.addEventListener('click', () => {
        $('pid').value = state.pid === p.pid ? '' : p.pid;
        $('pid').dispatchEvent(new Event('change'));
      });
      box.append(row);
      for (const c of kids.get(p.pid) || []) walk(c, depth + 1);
    };
    roots.forEach((p) => walk(p, 0));
  }

  function drawTimeline() {
    const wrap = $('timeline');
    wrap.replaceChildren();
    if (!shown.length) {
      wrap.append(h('div', { class: 'empty' }, 'no events match the current filters'));
      return;
    }
    const lanes = [];
    const laneIdx = new Map();
    for (const p of DATA.summary.processes) {
      for (const t of p.threads) {
        if (!shown.some((e) => e.pid === p.pid && e.tid === t)) continue;
        laneIdx.set(p.pid + ':' + t, lanes.length);
        lanes.push({ pid: p.pid, tid: t });
      }
    }
    const viewW = Math.max(600, wrap.clientWidth - LABEL_W - 20);
    const W = Math.round(viewW * state.zoom);
    const AX = 22;
    const H = AX + lanes.length * LANE_H + 4;

    const labels = h('div', { class: 'labels', style: 'padding-top:' + AX + 'px' });
    lanes.forEach((l) => labels.append(h('div', { class: 'lane-label', style: 'height:' + LANE_H + 'px' }, 'pid ' + l.pid + ' / tid ' + l.tid)));

    const svg = sv('svg', { width: W, height: H });
    for (let i = 0; i <= 8; i++) {
      const x = (W * i) / 8;
      svg.append(sv('line', { x1: x, x2: x, y1: AX - 4, y2: H, class: 'grid' }));
      const tx = sv('text', { x: Math.min(x + 3, W - 60), y: 12, class: 'tick' });
      tx.textContent = fmtTime(Math.round((span * i) / 8));
      svg.append(tx);
    }
    lanes.forEach((_, i) => svg.append(sv('rect', { x: 0, y: AX + i * LANE_H, width: W, height: LANE_H, class: i % 2 ? 'band' : 'band alt' })));

    for (const e of shown) {
      const li = laneIdx.get(e.pid + ':' + e.tid);
      const r = sv('rect', {
        x: (e.t / span) * W,
        y: AX + li * LANE_H + 3,
        width: Math.max(3, (e.dur_us / span) * W),
        height: LANE_H - 6,
        fill: color(e.cat),
        class: 'ev' + (e.err ? ' err' : '') + (state.selected === e.id ? ' sel' : ''),
      });
      const t = sv('title');
      t.textContent = e.api + ' ' + fmtTime(e.dur_us) + (e.err ? ' (error ' + e.err + ')' : '');
      r.append(t);
      r.addEventListener('click', () => select(e.id));
      svg.append(r);
    }
    wrap.append(labels, h('div', { class: 'svgwrap' }, svg));
  }

  const MAX_ROWS = 2000;

  function drawTable() {
    const body = $('rows');
    body.replaceChildren();
    for (const e of shown.slice(0, MAX_ROWS)) {
      const badge = h('span', { class: 'badge' }, e.cat);
      badge.style.background = color(e.cat);
      const tr = h(
        'tr',
        { class: (e.err ? 'errrow ' : '') + (state.selected === e.id ? 'selrow' : ''), 'data-id': e.id },
        h('td', {}, fmtTime(e.t)),
        h('td', {}, e.pid + '/' + e.tid),
        h('td', { class: 'api' }, e.api),
        h('td', {}, badge),
        h('td', { class: 'args' }, argSummary(e)),
        h('td', {}, e.ret === null ? '' : String(e.ret)),
        h('td', {}, e.err ? String(e.err) : ''),
        h('td', {}, fmtTime(e.dur_us))
      );
      tr.addEventListener('click', () => select(e.id));
      body.append(tr);
    }
    $('count').textContent = shown.length + ' of ' + events.length + ' events' + (shown.length > MAX_ROWS ? ' (table shows first ' + MAX_ROWS + ')' : '');
  }

  function select(id) {
    state.selected = id;
    const e = events[id];
    const lines = [e.api + '  [' + e.cat + ']', 'time      +' + fmtTime(e.t) + '  (ts ' + e.ts + ' us)', 'duration  ' + fmtTime(e.dur_us), 'process   pid ' + e.pid + ', parent ' + e.ppid, 'thread    ' + e.tid, 'return    ' + (e.ret === null ? '-' : e.ret), 'error     ' + (e.err ? e.err + (ERR_NAMES[e.err] ? ' (' + ERR_NAMES[e.err] + ')' : '') : '0'), 'args      ' + JSON.stringify(e.args, null, 2).replace(/\n/g, '\n          '), 'source    line ' + e.line];
    $('detail').textContent = lines.join('\n');
    drawTimeline();
    drawTable();
  }

  function refresh() {
    shown = filterEvents(events, { cats: state.cats, pid: state.pid, tid: state.tid, search: state.search, errorsOnly: state.errorsOnly });
    drawTimeline();
    drawTable();
  }

  buildStatic();
  drawProcessTree();
  refresh();
  window.addEventListener('resize', drawTimeline);
})();
