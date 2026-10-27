#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { parseJsonl } = require('./src/importer');
const { renderHtml } = require('./src/render');

function usage() {
  console.error('usage: node viz/cli.js <trace.jsonl> [-o out.html]');
  process.exit(2);
}

const args = process.argv.slice(2);
let input = null;
let output = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-o') output = args[++i];
  else if (args[i].startsWith('-')) usage();
  else input = args[i];
}
if (!input) usage();
if (output === undefined || output === null) output = input.replace(/\.jsonl?$/i, '') + '.html';

let text;
try {
  text = fs.readFileSync(input, 'utf8');
} catch (e) {
  console.error(`cannot read ${input}: ${e.message}`);
  process.exit(1);
}

const result = parseJsonl(text);
for (const er of result.errors.slice(0, 10)) console.error(`${input}:${er.line}: skipped (${er.reason})`);
if (result.errors.length > 10) console.error(`... and ${result.errors.length - 10} more skipped lines`);
if (!result.events.length) {
  console.error('no usable events found');
  process.exit(1);
}

fs.writeFileSync(output, renderHtml(result, { title: 'apitrace-viz', source: path.basename(input) }));
console.log(`${result.events.length} events -> ${output}`);
