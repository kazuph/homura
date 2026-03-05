const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('src/index.ts', 'utf8');

assert.ok(source.includes('class MpDecoder'), 'MpDecoder should be defined');
assert.ok(source.includes('mpDecode'), 'mpDecode helper should be defined');
assert.ok(source.includes('validateRubyResponse'), 'response schema validation should be defined');
assert.ok(source.includes('normalizeResponseControl'), 'response control normalization should be defined');
assert.ok(source.includes('executeLoopOps'), 'loop executor should be defined');
assert.ok(source.includes('MAX_LOOP_ITERATIONS'), 'loop budget constant should be defined');
assert.ok(source.includes('MAX_OPS_PER_LOOP'), 'ops budget constant should be defined');

console.log('bridge-contract test snapshot passed');
