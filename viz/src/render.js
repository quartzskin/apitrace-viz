const fs = require('node:fs');
const path = require('node:path');
const { summarize } = require('./filter');

const COLORS = {
  file: '#4f9bff',
  registry: '#c678dd',
  process: '#ff9f43',
  thread: '#2ed3a5',
  memory: '#e5c07b',
  time: '#7f8c9f',
  system: '#56c2d6',
  other: '#e06c9f',
};

function read(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf8');
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// U+2028/9 are valid in JSON strings but were not valid in JS literals before ES2019; escape anyway.
function jsonForScript(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function renderHtml({ events, errors }, { title = 'apitrace-viz', source = '' } = {}) {
  const summary = summarize(events);
  const data = {
    events,
    errors,
    summary,
    categories: summary.categories,
    colors: COLORS,
    source,
  };
  const replacements = {
    '{{TITLE}}': escapeHtml(title),
    '{{DATA}}': jsonForScript(data),
    '{{FILTER_JS}}': read('filter.js'),
    '{{PAGE_JS}}': read('page.js'),
  };
  // single pass so inlined script text is never re-scanned for placeholders
  return read('template.html').replace(/\{\{(TITLE|DATA|FILTER_JS|PAGE_JS)\}\}/g, (m) => replacements[m]);
}

module.exports = { renderHtml, COLORS };
