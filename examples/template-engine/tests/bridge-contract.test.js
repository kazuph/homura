import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/index.ts', 'utf8');
const routesSource = fs.readFileSync('app/routes.rb', 'utf8');
const packageSource = fs.readFileSync('package.json', 'utf8');
const wranglerSource = fs.readFileSync('wrangler.toml', 'utf8');

assert.ok(source.includes('class MpDecoder'), 'MpDecoder should be defined');
assert.ok(source.includes('mpDecode'), 'mpDecode helper should be defined');
assert.ok(source.includes('validateRubyResponse'), 'response schema validation should be defined');
assert.ok(source.includes('normalizeResponseControl'), 'response control normalization should be defined');
assert.ok(source.includes('renderTemplate'), 'home page should render JSX templates');
assert.ok(source.includes('APP_CSS'), 'home page should serve bundled CSS');
assert.ok(!source.includes('HOMURA_DB'), 'template-engine should not depend on D1');
assert.ok(!source.includes('HOMURA_KV'), 'template-engine should not depend on KV');
assert.ok(routesSource.includes('def escape_html(value)'), 'templates should HTML-escape values');
assert.ok(routesSource.includes('$app.post "/render"'), 'render endpoint should exist');
assert.ok(routesSource.includes('$app.post "/render/inline"'), 'inline render endpoint should exist');
assert.ok(routesSource.includes('c.jsx("home", {})'), 'root route should render the home template');
assert.ok(!routesSource.includes('instance_eval('), 'instance_eval must not be used');
assert.ok(!routesSource.includes('{{%'), 'expression evaluation syntax must not remain');
assert.ok(packageSource.includes('"name": "homura-template-engine"'), 'package name should be unique');
assert.ok(wranglerSource.includes('name = "homura-template-engine"'), 'wrangler name should be unique');

console.log('template-engine bridge-contract test passed');
