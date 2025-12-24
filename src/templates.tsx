import { renderToString } from './jsx/render';

type TemplateLocals = Record<string, string>;

function normalizeLocals(locals: Record<string, unknown>): TemplateLocals {
  const normalized: TemplateLocals = {};
  for (const [key, value] of Object.entries(locals)) {
    normalized[key] = value === null || value === undefined ? '' : String(value);
  }
  return normalized;
}

const Layout = ({
  title,
  children,
}: {
  title: string;
  children: unknown;
}) => (
  <html lang="ja">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>{title}</title>
      <link rel="stylesheet" href="/assets/app.css" />
    </head>
    <body>
      <header className="site-header">
        <div className="container">
          <a className="logo" href="/">
            Homura
          </a>
          <nav className="nav">
            <a href="/about">About</a>
            <a href="/api">API</a>
            <a href="/hello/edge">Hello</a>
          </nav>
        </div>
      </header>
      <main className="container">{children}</main>
      <footer className="site-footer">
        <div className="container">Homura / mruby + WASI</div>
      </footer>
    </body>
  </html>
);

const Home = ({
  eyebrow,
  headline,
  lead,
  template_note,
  web_note,
  hono_note,
  counter,
}: TemplateLocals) => (
  <>
    <section className="hero">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{headline}</h1>
      <p className="lead">{lead}</p>
      <div className="actions">
        <a className="button" href="/about">
          About
        </a>
        <a className="button ghost" href="/api">
          API JSON
        </a>
      </div>
    </section>

    <section className="counter-section">
      <div className="counter-card">
        <h2>KV カウンター</h2>
        <p className="counter-desc">Cloudflare KV を使った永続カウンター</p>
        <div className="counter-display">
          <span id="counter-value">{counter || '0'}</span>
        </div>
        <div className="counter-actions">
          <button id="btn-increment" className="button">+1 カウント</button>
          <button id="btn-reset" className="button ghost">リセット</button>
        </div>
        <p id="counter-status" className="counter-status"></p>
      </div>
    </section>

    <section className="grid">
      <div className="card">
        <h3>テンプレート</h3>
        <p>{template_note}</p>
      </div>
      <div className="card">
        <h3>軽量Web</h3>
        <p>{web_note}</p>
      </div>
      <div className="card">
        <h3>Hono互換</h3>
        <p>{hono_note}</p>
      </div>
    </section>

    <script dangerouslySetInnerHTML={{ __html: `
      (function() {
        const counterEl = document.getElementById('counter-value');
        const statusEl = document.getElementById('counter-status');
        const btnIncrement = document.getElementById('btn-increment');
        const btnReset = document.getElementById('btn-reset');

        async function increment() {
          statusEl.textContent = '...';
          try {
            const res = await fetch('/counter');
            const data = await res.json();
            counterEl.textContent = data.count;
            statusEl.textContent = data.message;
          } catch (e) {
            statusEl.textContent = 'エラー: ' + e.message;
          }
        }

        async function reset() {
          statusEl.textContent = '...';
          try {
            const res = await fetch('/counter/reset', { method: 'POST' });
            const data = await res.json();
            counterEl.textContent = data.count;
            statusEl.textContent = data.message;
          } catch (e) {
            statusEl.textContent = 'エラー: ' + e.message;
          }
        }

        btnIncrement.addEventListener('click', increment);
        btnReset.addEventListener('click', reset);
      })();
    ` }} />
  </>
);

const About = ({ framework, template_style }: TemplateLocals) => (
  <section className="stack">
    <h1>Homuraについて</h1>
    <p>このテンプレは{framework}で動く軽量Webサーバーとして設計しています。</p>
    <ul className="list">
      <li>Hono風のルーティングとContext API</li>
      <li>テンプレは{template_style}方式</li>
      <li>必要最低限のランタイム（外部gem無し）</li>
    </ul>
  </section>
);

const templates: Record<string, (locals: TemplateLocals) => string> = {
  home: (locals) =>
    renderToString(
      <Layout title="Homura - Home">
        <Home {...locals} />
      </Layout>
    ),
  about: (locals) =>
    renderToString(
      <Layout title="Homura - About">
        <About {...locals} />
      </Layout>
    ),
};

export function renderTemplate(name: string, locals: Record<string, unknown>): string {
  const renderer = templates[name];
  const safeLocals = normalizeLocals(locals || {});
  if (!renderer) {
    return renderToString(
      <Layout title="Homura - Not Found">
        <section className="stack">
          <h1>Template not found</h1>
          <p>Missing template: {name}</p>
        </section>
      </Layout>
    );
  }
  return renderer(safeLocals);
}
