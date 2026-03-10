import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/index.ts', 'utf8');
const frameworkSource = fs.readFileSync('../../lib/homura.rb', 'utf8');
const routesSource = fs.readFileSync('app/routes.rb', 'utf8');
const migrationSource = fs.readFileSync('migrations/0001_create_events.sql', 'utf8');
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
assert.ok(frameworkSource.includes('Unexpected D1 result order'), 'framework should guard against out-of-order D1 results');
assert.ok(routesSource.includes('class TimeUtils'), 'TimeUtils should exist');
assert.ok(routesSource.includes('$app.post "/events"'), 'event create endpoint should exist');
assert.ok(routesSource.includes('$app.get "/events/stats"'), 'stats endpoint should exist');
assert.ok(routesSource.includes('$app.get "/token"'), 'token endpoint should exist');
assert.ok(routesSource.includes('c.jsx("home", {})'), 'home route should render JSX');
assert.ok(routesSource.includes('$app.get "/api"'), 'JSON docs route should remain available');
assert.ok(routesSource.includes('mruby-time + mruby-pack'), 'docs should describe the example');
assert.ok(!routesSource.includes('return c.'), 'route handlers should not use return inside Proc bodies');
assert.ok(migrationSource.includes('CREATE TABLE IF NOT EXISTS events'), 'events table migration should exist');
assert.ok(packageSource.includes('"name": "homura-time-tracker"'), 'package name should be unique');
assert.ok(wranglerSource.includes('name = "homura-time-tracker"'), 'wrangler name should be unique');

console.log('bridge-contract test snapshot passed');
