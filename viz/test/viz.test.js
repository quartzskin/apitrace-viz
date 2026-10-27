const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseJsonl } = require('../src/importer');
const { filterEvents, summarize, toJsonl, toCsv } = require('../src/filter');
const { renderHtml } = require('../src/render');

const line = (o) => JSON.stringify({ ts: 1000, pid: 10, ppid: 1, tid: 11, api: 'Sleep', cat: 'time', args: {}, ret: 0, err: 0, dur_us: 5, ...o });

test('parses valid lines and sorts by ts', () => {
  const { events, errors } = parseJsonl([line({ ts: 3000, api: 'B' }), line({ ts: 1000, api: 'A' })].join('\n'));
  assert.strictEqual(errors.length, 0);
  assert.deepStrictEqual(events.map((e) => e.api), ['A', 'B']);
  assert.strictEqual(events[0].t, 0);
  assert.strictEqual(events[1].t, 2000);
  assert.deepStrictEqual(events.map((e) => e.id), [0, 1]);
});

test('malformed lines are reported with line numbers and do not stop the import', () => {
  const text = [
    line({ api: 'Good1' }),
    '{"ts": 5, "pid":',
    'not json at all',
    '[1,2,3]',
    JSON.stringify({ pid: 1, api: 'NoTs' }),
    JSON.stringify({ ts: 1, pid: 1 }),
    JSON.stringify({ ts: 1, api: 'NoPid' }),
    '',
    line({ api: 'Good2', ts: 2000 }),
  ].join('\n');
  const { events, errors } = parseJsonl(text);
  assert.deepStrictEqual(events.map((e) => e.api), ['Good1', 'Good2']);
  assert.deepStrictEqual(errors.map((e) => e.line), [2, 3, 4, 5, 6, 7]);
});

test('missing optional fields get defaults', () => {
  const { events } = parseJsonl(JSON.stringify({ ts: 1, pid: 2, api: 'X' }));
  const e = events[0];
  assert.strictEqual(e.cat, 'other');
  assert.strictEqual(e.tid, 0);
  assert.strictEqual(e.ret, null);
  assert.deepStrictEqual(e.args, {});
  assert.strictEqual(e.dur_us, 0);
});

test('handles CRLF, BOM and empty input', () => {
  const crlf = '\uFEFF' + line({ api: 'A' }) + '\r\n' + line({ api: 'B' }) + '\r\n';
  assert.strictEqual(parseJsonl(crlf).events.length, 2);
  assert.deepStrictEqual(parseJsonl(''), { events: [], errors: [] });
});

const sample = () =>
  parseJsonl(
    [
      line({ ts: 1, api: 'CreateFileA', cat: 'file', args: { path: 'C:\\temp\\Secret.txt' } }),
      line({ ts: 2, api: 'RegOpenKeyExA', cat: 'registry', args: { key: 'HKLM\\Software' }, err: 2 }),
      line({ ts: 3, api: 'WriteFile', cat: 'file', pid: 20, ppid: 10, tid: 21 }),
    ].join('\n')
  ).events;

test('filters by category, pid, tid, errors and search', () => {
  const ev = sample();
  assert.strictEqual(filterEvents(ev, {}).length, 3);
  assert.deepStrictEqual(filterEvents(ev, { cats: new Set(['registry']) }).map((e) => e.api), ['RegOpenKeyExA']);
  assert.deepStrictEqual(filterEvents(ev, { pid: 20 }).map((e) => e.api), ['WriteFile']);
  assert.strictEqual(filterEvents(ev, { tid: 11 }).length, 2);
  assert.deepStrictEqual(filterEvents(ev, { errorsOnly: true }).map((e) => e.api), ['RegOpenKeyExA']);
  assert.deepStrictEqual(filterEvents(ev, { search: 'secret' }).map((e) => e.api), ['CreateFileA']);
  assert.strictEqual(filterEvents(ev, { search: 'zzz' }).length, 0);
  assert.strictEqual(filterEvents(ev, { cats: new Set(['file']), search: 'write', pid: 20 }).length, 1);
});

test('summarize groups threads by process', () => {
  const s = summarize(sample());
  assert.deepStrictEqual(s.processes.map((p) => [p.pid, p.ppid, p.threads, p.count]), [
    [10, 1, [11], 2],
    [20, 10, [21], 1],
  ]);
  assert.strictEqual(s.categories[0].name, 'file');
});

test('JSONL export round-trips through the importer', () => {
  const ev = sample();
  const back = parseJsonl(toJsonl(ev));
  assert.strictEqual(back.errors.length, 0);
  assert.deepStrictEqual(back.events.map((e) => e.api), ev.map((e) => e.api));
  assert.strictEqual(toJsonl([]), '');
});

test('CSV export quotes cells with commas, quotes and newlines', () => {
  const ev = parseJsonl(line({ args: { note: 'a,"b"\nc' } })).events;
  const csv = toCsv(ev);
  const [head, row] = csv.split('\r\n');
  assert.strictEqual(head.split(',').length, 10);
  assert.ok(row.includes('"{""note"":""a,\\""b\\""\\nc""}"'), row);
});

test('rendered page is self-contained and its scripts parse', () => {
  const evil = parseJsonl(line({ api: '</script><b>', args: { p: '</script>' } }));
  const html = renderHtml(evil, { title: 'x<y' });
  assert.ok(!/<script[^>]*src=/i.test(html));
  assert.ok(!html.includes('{{'));
  assert.strictEqual((html.match(/<\/script>/g) || []).length, 3);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.strictEqual(scripts.length, 2);
  for (const s of scripts) new vm.Script(s);
  const data = JSON.parse(html.match(/<script id="trace-data"[^>]*>([\s\S]*?)<\/script>/)[1]);
  assert.strictEqual(data.events[0].api, '</script><b>');
  assert.ok(html.includes('<title>x&lt;y</title>'));
});

test('committed sample trace imports cleanly and shows a parent and child process', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', '..', 'samples', 'trace.jsonl'), 'utf8');
  const { events, errors } = parseJsonl(text);
  assert.strictEqual(errors.length, 0);
  assert.ok(events.length > 30);
  const procs = summarize(events).processes;
  assert.strictEqual(procs.length, 2);
  assert.strictEqual(procs[1].ppid, procs[0].pid);
  assert.ok(procs[0].threads.length >= 2);
});
