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
            <a href="/api">API</a>
            <a href="https://github.com/kazuph/homura-claude" target="_blank">GitHub</a>
          </nav>
        </div>
      </header>
      <main className="container">{children}</main>
      <footer className="site-footer">
        <div className="container">Homura - Ruby DSL for Cloudflare Workers</div>
      </footer>
    </body>
  </html>
);

const Home = ({ counter }: TemplateLocals) => (
  <>
    <section className="hero">
      <p className="eyebrow">mruby + WASI on Cloudflare Workers</p>
      <h1>Homura</h1>
      <p className="lead">
        RubyでCloudflare Workersアプリを書くためのDSLフレームワーク。
        このページ自体がHomuraで動いています。
      </p>
      <div className="actions">
        <a className="button" href="/api">
          API Demo
        </a>
        <a className="button ghost" href="https://github.com/kazuph/homura-claude" target="_blank">
          GitHub
        </a>
      </div>
    </section>

    <section className="grid">
      <div className="card">
        <h3>Ruby DSL</h3>
        <p>Hono風のシンプルなルーティングAPI。get/postとContext APIで直感的にルートを定義。</p>
      </div>
      <div className="card">
        <h3>mruby + WASI</h3>
        <p>mrubyをWebAssemblyにコンパイル。エッジでRubyコードが実行される。</p>
      </div>
      <div className="card">
        <h3>JSXテンプレート</h3>
        <p>TypeScript/JSXでHTMLテンプレートを構築。型安全なビュー層。</p>
      </div>
      <div className="card">
        <h3>KVバインディング</h3>
        <p>Cloudflare KVと連携。Rubyから直接データを読み書き。</p>
      </div>
    </section>

    <section className="stack">
      <h2>アーキテクチャ</h2>
      <div className="card">
        <pre style={{ fontSize: '14px', overflow: 'auto', margin: 0, lineHeight: 1.5 }}>{`
┌─────────────────────────────────────────────────────┐
│  Cloudflare Workers                                 │
│  ┌───────────────────────────────────────────────┐  │
│  │  TypeScript (index.ts)                        │  │
│  │  - リクエスト受信                              │  │
│  │  - mruby WASM 初期化                          │  │
│  │  - KV prefetch / post-process                 │  │
│  │  - JSX → HTML レンダリング                    │  │
│  └───────────────┬───────────────────────────────┘  │
│                  │ eval()                           │
│  ┌───────────────▼───────────────────────────────┐  │
│  │  mruby (lib/homura.rb + app/routes.rb)        │  │
│  │  - $app.get/post でルート定義                 │  │
│  │  - c.json / c.html / c.jsx でレスポンス       │  │
│  │  - c.kv_get / c.kv_put でKV操作               │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
        `}</pre>
      </div>
    </section>

    <section className="stack">
      <h2>ルート定義例</h2>
      <div className="card">
        <pre style={{ fontSize: '14px', overflow: 'auto', margin: 0 }}>{`# app/routes.rb
$app.get "/" do |c|
  c.jsx("home", { title: "Welcome" })
end

$app.get "/api" do |c|
  c.json({ message: "Hello!", version: "0.1.0" })
end

$app.get "/hello/:name" do |c|
  c.html("<h1>Hello, \#{c.params[:name]}!</h1>")
end`}</pre>
      </div>
    </section>

    <section className="counter-section">
      <div className="counter-card">
        <h2>KV Demo</h2>
        <p className="counter-desc">Cloudflare KV を使った永続カウンター</p>
        <div className="counter-display">
          <span id="counter-value">{counter || '0'}</span>
        </div>
        <div className="counter-actions">
          <button id="btn-increment" className="button">+1</button>
          <button id="btn-reset" className="button ghost">Reset</button>
        </div>
        <p id="counter-status" className="counter-status"></p>
      </div>
    </section>

    <script dangerouslySetInnerHTML={{ __html: `
      (function() {
        const counterEl = document.getElementById('counter-value');
        const statusEl = document.getElementById('counter-status');
        document.getElementById('btn-increment').addEventListener('click', async () => {
          statusEl.textContent = '...';
          const res = await fetch('/counter');
          const data = await res.json();
          counterEl.textContent = data.count;
          statusEl.textContent = data.message;
        });
        document.getElementById('btn-reset').addEventListener('click', async () => {
          statusEl.textContent = '...';
          const res = await fetch('/counter/reset', { method: 'POST' });
          const data = await res.json();
          counterEl.textContent = data.count;
          statusEl.textContent = data.message;
        });
      })();
    ` }} />
  </>
);

const templates: Record<string, (locals: TemplateLocals) => string> = {
  home: (locals) =>
    renderToString(
      <Layout title="Homura - Ruby DSL for Cloudflare Workers">
        <Home {...locals} />
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
