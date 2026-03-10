import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/index.ts', 'utf8');
const routesSource = fs.readFileSync('app/routes.rb', 'utf8');
const wranglerSource = fs.readFileSync('wrangler.toml', 'utf8');
const packageSource = fs.readFileSync('package.json', 'utf8');

assert.ok(source.includes('class MpDecoder'), 'MpDecoder should be defined');
assert.ok(source.includes('mpDecode'), 'mpDecode helper should be defined');
assert.ok(source.includes('validateRubyResponse'), 'response schema validation should be defined');
assert.ok(source.includes('normalizeResponseControl'), 'response control normalization should be defined');
assert.ok(source.includes('homura_handle_request'), 'request bridge should use MessagePack request handling');
assert.ok(source.includes('MAX_OPS_PER_LOOP'), 'ops budget constant should be defined');
assert.ok(source.includes("control: { continue: false, ops: [] }"), 'requests should initialize without continuation');
assert.ok(source.includes('renderTemplate'), 'home page should render JSX templates');
assert.ok(source.includes('APP_CSS'), 'home page should serve bundled CSS');
assert.ok(!source.includes('HOMURA_DB'), 'API-only example should not depend on D1');
assert.ok(!source.includes('HOMURA_KV'), 'API-only example should not depend on KV');
assert.ok(routesSource.includes('c.jsx("home", {})'), 'root route should render the home template');
assert.ok(routesSource.includes('$app.post "/transform/filter"'), 'filter route should be defined in Ruby');
assert.ok(routesSource.includes('$app.post "/transform/pipeline"'), 'pipeline route should be defined in Ruby');
assert.ok(routesSource.includes('lazy_numbers = numbers.lazy'), 'lazy enumerator example should be present');
assert.ok(routesSource.includes('Set.new'), 'Set example should be present');
assert.ok(!routesSource.includes('c.db.'), 'Ruby routes should not use D1');
assert.ok(!routesSource.includes('c.kv_'), 'Ruby routes should not use KV');
assert.ok(!wranglerSource.includes('[[kv_namespaces]]'), 'wrangler config should not require KV');
assert.ok(!wranglerSource.includes('[[d1_databases]]'), 'wrangler config should not require D1');
assert.ok(packageSource.includes('"name": "homura-json-transform"'), 'package name should match example');
assert.ok(!fs.existsSync('migrations'), 'API-only example should not ship migrations');

console.log('json-transform bridge-contract test passed');
