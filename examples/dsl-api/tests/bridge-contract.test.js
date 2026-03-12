import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/index.ts', 'utf8');
const frameworkSource = fs.readFileSync('../../lib/homura.rb', 'utf8');
const modelsSource = fs.readFileSync('app/models.rb', 'utf8');
const routesSource = fs.readFileSync('app/routes.rb', 'utf8');
const migrationSource = fs.readFileSync('migrations/0001_create_tables.sql', 'utf8');
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
assert.ok(modelsSource.includes('class Article < Homura::Model'), 'Article model should exist');
assert.ok(modelsSource.includes('class Tag < Homura::Model'), 'Tag model should exist');
assert.ok(modelsSource.includes('has_many :articles'), 'Author associations should be defined');
assert.ok(routesSource.includes('$app.get "/api/articles/scoped/published"'), 'published article endpoint should exist');
assert.ok(routesSource.includes('$app.post "/api/authors"'), 'author CRUD route should exist');
assert.ok(routesSource.includes('c.jsx("home", {})'), 'home route should render JSX');
assert.ok(routesSource.includes('$app.get "/api"'), 'JSON docs route should remain available');
assert.ok(routesSource.includes('powered_by: "Homura::Model ORM + mruby-metaprog + mruby-time"'), 'docs should describe the runtime stack');
assert.ok(!routesSource.includes('return c.'), 'route handlers should not use return inside Proc bodies');
assert.ok(migrationSource.includes('CREATE TABLE IF NOT EXISTS articles'), 'articles table migration should exist');
assert.ok(migrationSource.includes('CREATE TABLE IF NOT EXISTS tags'), 'tags table migration should exist');
assert.ok(packageSource.includes('"name": "homura-dsl-api"'), 'package name should be unique');
assert.ok(wranglerSource.includes('name = "homura-dsl-api"'), 'wrangler name should be unique');

console.log('bridge-contract test snapshot passed');
