import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/index.ts', 'utf8');
const frameworkSource = fs.readFileSync('../../lib/homura.rb', 'utf8');
const migrationV1 = fs.readFileSync('migrations/0001_create_todos.sql', 'utf8');
const migrationV2 = fs.readFileSync('migrations/0002_add_todo_lifecycle_columns.sql', 'utf8');

assert.ok(source.includes('class MpDecoder'), 'MpDecoder should be defined');
assert.ok(source.includes('mpDecode'), 'mpDecode helper should be defined');
assert.ok(source.includes('validateRubyResponse'), 'response schema validation should be defined');
assert.ok(source.includes('normalizeResponseControl'), 'response control normalization should be defined');
assert.ok(source.includes('executeLoopOps'), 'loop executor should be defined');
assert.ok(source.includes('MAX_LOOP_ITERATIONS'), 'loop budget constant should be defined');
assert.ok(source.includes('MAX_OPS_PER_LOOP'), 'ops budget constant should be defined');
assert.ok(source.includes('handleTodoApi'), 'direct D1 hotfix handler should be defined');
assert.ok(source.includes('renderTodoHome'), 'direct home renderer should be defined');
assert.ok(frameworkSource.includes('def json_number_string?'), 'framework should avoid Regexp-dependent JSON number parsing');
assert.ok(!frameworkSource.includes('match?(/\\A'), 'framework should not rely on Regexp for JSON number parsing');
assert.ok(!migrationV1.includes('updated_at'), '0001 migration should remain the original base schema');
assert.ok(migrationV2.includes('ALTER TABLE todos ADD COLUMN updated_at TEXT;'), '0002 migration should add updated_at');
assert.ok(migrationV2.includes('ALTER TABLE todos ADD COLUMN completed_at TEXT;'), '0002 migration should add completed_at');

console.log('bridge-contract test snapshot passed');
