import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/index.ts', 'utf8');
const frameworkSource = fs.readFileSync('../../lib/homura.rb', 'utf8');
const routesSource = fs.readFileSync('app/routes.rb', 'utf8');
const packageSource = fs.readFileSync('package.json', 'utf8');
const wranglerSource = fs.readFileSync('wrangler.toml', 'utf8');

assert.ok(source.includes('class MpDecoder'), 'MpDecoder should be defined');
assert.ok(source.includes('mpDecode'), 'mpDecode helper should be defined');
assert.ok(source.includes('validateRubyResponse'), 'response schema validation should be defined');
assert.ok(source.includes('normalizeResponseControl'), 'response control normalization should be defined');
assert.ok(source.includes('executeLoopOps'), 'loop executor should be defined');
assert.ok(source.includes('MAX_LOOP_ITERATIONS'), 'loop budget constant should be defined');
assert.ok(source.includes('MAX_OPS_PER_LOOP'), 'ops budget constant should be defined');
assert.ok(frameworkSource.includes('def json_number_string?'), 'framework should avoid Regexp-dependent JSON number parsing');
assert.ok(!frameworkSource.includes('match?(/\\A'), 'framework should not rely on Regexp for JSON number parsing');
assert.ok(routesSource.includes('def valid_redirect_url?(url)'), 'URL validation helper should exist');
assert.ok(routesSource.includes('$app.post "/shorten"'), 'shorten endpoint should exist');
assert.ok(routesSource.includes('$app.get "/s/:code"'), 'redirect endpoint should exist');
assert.ok(routesSource.includes('url must start with http:// or https://'), 'input validation error should explain allowed schemes');
assert.ok(routesSource.includes('Stored URL has invalid scheme'), 'stored URL validation should reject unsafe redirects');
assert.ok(routesSource.includes('c.kv_put("url:'), 'shortener should store destination in KV');
assert.ok(!routesSource.includes('return c.'), 'route handlers should not use return inside Proc bodies');
assert.ok(packageSource.includes('"name": "homura-url-shortener"'), 'package name should be unique');
assert.ok(wranglerSource.includes('name = "homura-url-shortener"'), 'wrangler name should stay unique');
assert.ok(wranglerSource.includes('[[kv_namespaces]]'), 'KV binding should remain configured');

console.log('bridge-contract test snapshot passed');
