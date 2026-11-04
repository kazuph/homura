import { test, expect } from '@playwright/test';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';

const ruby = 'ruby';
const source = execFileSync(ruby, ['-e', 'require_relative "gems/sinatra-kagero/lib/sinatra/kagero/runtime"; print Sinatra::Kagero::Runtime::SOURCE'], { encoding: 'utf8' });
let local: http.Server, external: http.Server, base: string, outside: string;
let externalRequests: { method: string; token?: string }[] = [];
let partial: http.ServerResponse | undefined;
const pageData = (component: string, url: string, extra = {}) => ({ component, url, version: '1', props: { ...extra, kagero: { html: `<h1>${component}</h1><input id="input">`, title: component } } });
const listen = (server: http.Server) => new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
const close = (server: http.Server) => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
test.beforeAll(async () => {
  external = http.createServer((req, res) => { externalRequests.push({ method: req.method!, token: req.headers['x-xsrf-token'] as string }); res.end('external'); });
  outside = `http://127.0.0.1:${await listen(external)}`;
  local = http.createServer((req, res) => {
    const url = new URL(req.url!, base);
    if (url.pathname === '/shell') {
      const page = pageData('Index', `${url.pathname}${url.search}`, { keep: 'kept' });
      res.setHeader('Set-Cookie', 'XSRF-TOKEN=test-token; Path=/');
      res.setHeader('Content-Type', 'text/html');
      return res.end(`<!doctype html><title>Index</title><main data-kagero-root data-page='${JSON.stringify(page)}'>${page.props.kagero.html}</main><script type="module">${source}</script>`);
    }
    if (url.pathname === '/redirect302' || url.pathname === '/redirect307') { res.writeHead(url.pathname === '/redirect302' ? 302 : 307, { Location: `${outside}/received` }); return res.end(); }
    if (url.pathname === '/redirect303') { res.writeHead(303, { Location: '/next' }); return res.end(); }
    if (url.pathname === '/same409' || url.pathname === '/other409') { res.writeHead(409, { 'X-Inertia-Location': url.pathname === '/same409' ? '/shell#fragment' : '/shell?other=1' }); return res.end(); }
    if (url.pathname === '/error') { res.writeHead(500); return res.end('error'); }
    if (url.pathname === '/html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<h1>not a page</h1>'); }
    if (url.pathname === '/partial') { partial = res; return; }
    if (url.pathname === '/partial-now') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(pageData('Index', '/shell', { x: 2 }))); }
    const data: any = pageData(url.pathname === '/next' ? 'Next' : 'Index', url.pathname === '/next' ? '/next' : '/shell');
    if (url.pathname === '/invalid-url') data.url = `${outside}/other`;
    if (url.pathname === '/no-kagero') delete data.props.kagero;
    if (url.pathname === '/bad-html') data.props.kagero.html = 42;
    if (url.pathname === '/no-version') delete data.version;
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Inertia': 'true' }); res.end(JSON.stringify(data));
  });
  base = `http://127.0.0.1:${await listen(local)}`;
});
test.afterAll(async () => { partial?.end(); await close(local); await close(external); });
async function state(page: import('@playwright/test').Page) { return page.evaluate(() => ({ html: document.querySelector('[data-kagero-root]')!.innerHTML, input: (document.querySelector('#input') as HTMLInputElement).value, title: document.title, data: document.querySelector('[data-kagero-root]')!.getAttribute('data-page'), state: history.state, url: location.href, length: history.length })); }

test('redirects preserve origin and invalid pages preserve state', async ({ page }) => {
  await page.goto(`${base}/shell`); await page.locator('#input').fill('保持');
  for (const target of ['/redirect302', '/redirect307', '/invalid-url', '/no-kagero', '/bad-html', '/no-version', '/html', '/error']) {
    const before = await state(page);
    await page.evaluate(async target => { await (window as any).Kagero.visit(target, { method: target.startsWith('/redirect') ? 'POST' : 'GET' }); }, target);
    await expect(page.locator('#kagero-visit-error')).toBeVisible();
    expect(await state(page), target).toEqual(before);
  }
  const before = await state(page);
  await page.evaluate(async url => { await (window as any).Kagero.visit(url, { method: 'POST', body: 'secret' }); }, `${outside}/post`);
  expect(await state(page)).toEqual(before);
  expect(externalRequests).toEqual([]);
  await page.evaluate(async () => { await (window as any).Kagero.visit('/redirect303', { method: 'POST' }); });
  await expect(page).toHaveTitle('Next');
  expect(new URL(page.url()).pathname).toBe('/next');
});

test('partial request accepts a full page for another component', async ({ page }) => {
  await page.goto(`${base}/shell`);
  await page.evaluate(async () => { await (window as any).Kagero.visit('/next', { headers: { 'X-Inertia-Partial-Component': 'Index', 'X-Inertia-Partial-Data': 'x' } }); });
  await expect(page).toHaveTitle('Next');
  await expect(page.locator('h1')).toHaveText('Next');
  expect(new URL(page.url()).pathname).toBe('/next');
  const saved = await state(page);
  const data = JSON.parse(saved.data!);
  expect(data.component).toBe('Next');
  expect(data.props.keep).toBeUndefined();
  expect(saved.state.page).toEqual(data);
});

test('late partial is discarded after component navigation', async ({ page }) => {
  await page.goto(`${base}/shell`);
  await page.evaluate(() => { (window as any).pendingPartial = (window as any).Kagero.visit('/partial', { headers: { 'X-Inertia-Partial-Component': 'Index', 'X-Inertia-Partial-Data': 'x' } }); });
  await expect.poll(() => !!partial).toBe(true);
  await page.evaluate(async () => { await (window as any).Kagero.visit('/next'); });
  await expect(page).toHaveTitle('Next');
  const before = await state(page);
  const response = page.waitForResponse(r => r.url().endsWith('/partial'));
  partial!.writeHead(200, { 'Content-Type': 'application/json' }); partial!.end(JSON.stringify(pageData('Index', '/shell', { x: 1 }))); partial = undefined;
  await response;
  await page.evaluate(async () => { await (window as any).pendingPartial; });
  expect(await state(page)).toEqual(before);
});

test('409 reloads the same document and navigates to another URL', async ({ page }) => {
  await page.goto(`${base}/shell`);
  const reload = page.waitForNavigation();
  await page.evaluate(() => { void (window as any).Kagero.visit('/same409'); });
  await reload; expect(page.url()).toBe(`${base}/shell`);
  const navigation = page.waitForNavigation();
  await page.evaluate(() => { void (window as any).Kagero.visit('/other409'); });
  await navigation; expect(page.url()).toBe(`${base}/shell?other=1`);
});

test('partial merge retains props, navigation replaces them and history restores them', async ({ page }) => {
  await page.goto(`${base}/shell`);
  await page.evaluate(async () => { await (window as any).Kagero.visit('/partial-now', { headers: { 'X-Inertia-Partial-Component': 'Index', 'X-Inertia-Partial-Data': 'x' } }); });
  let saved = await state(page);
  expect(JSON.parse(saved.data!).props).toMatchObject({ keep: 'kept', x: 2 });
  expect(saved.state.page).toEqual(JSON.parse(saved.data!));
  await page.evaluate(async () => { await (window as any).Kagero.visit('/next'); });
  saved = await state(page);
  expect(saved.state.page.props.keep).toBeUndefined();
  await page.goBack();
  saved = await state(page);
  expect(JSON.parse(saved.data!).props.keep).toBe('kept');
  expect(saved.state.page).toEqual(JSON.parse(saved.data!));
  await page.goForward();
  await expect(page).toHaveTitle('Next');
  saved = await state(page);
  expect(saved.state.page).toEqual(JSON.parse(saved.data!));
});

test('direct external GET navigates as a GET', async ({ page }) => {
  externalRequests = [];
  await page.goto(`${base}/shell`);
  const navigation = page.waitForURL(`${outside}/get`);
  await page.evaluate(url => { void (window as any).Kagero.visit(url); }, `${outside}/get`);
  await navigation;
  expect(externalRequests).toEqual([{ method: 'GET', token: undefined }]);
});
