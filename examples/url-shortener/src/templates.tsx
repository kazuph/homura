import { renderToString } from './lib/render';

type TemplateLocals = Record<string, string>;

function normalizeLocals(locals: Record<string, unknown>): TemplateLocals {
  const normalized: TemplateLocals = {};
  for (const [key, value] of Object.entries(locals)) {
    normalized[key] = value === null || value === undefined ? '' : String(value);
  }
  return normalized;
}

function safeJsonForScript(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('</', '<\\/')
    .replaceAll('<', '\\u003c');
}

const Layout = ({
  title,
  children,
}: {
  title: string;
  children: unknown;
}) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>{title}</title>
      <link rel="stylesheet" href="/assets/app.css" />
    </head>
    <body>
      <main className="container">
        <section className="hero">
          <p className="eyebrow">mruby + WASI + KV</p>
          <h1>Homura URL Shortener</h1>
          <p className="lead">短いコードに変換してリダイレクトを返すデモです。</p>
        </section>
        {children}
      </main>
    </body>
  </html>
);

const Home = (_: TemplateLocals) => (
  <>
    <section className="panel">
      <h2>このサイトでできること</h2>
      <p>長い URL を Base62 の短いコードに変換し、クリック数つきで共有できます。</p>
      <p>Ruby がルーティングとコード生成を担当し、Workers KV が URL とカウンタをエッジで保持します。</p>
      <p><strong>Powered by:</strong> <code>mruby-random</code> / <code>mruby-pack</code> / Workers KV</p>
    </section>

    <section className="panel">
      <label htmlFor="url-input">Long URL</label>
      <div className="form-row">
        <input id="url-input" className="url-input" placeholder="https://example.com/very/long/url" />
        <button id="btn-shorten" className="button">Shorten</button>
      </div>
      <p id="error" className="error" role="alert"></p>
      <p id="result"></p>
      <p id="stats"></p>
    </section>

    <script dangerouslySetInnerHTML={{ __html: `
      (function() {
        const input = document.getElementById('url-input');
        const button = document.getElementById('btn-shorten');
        const resultEl = document.getElementById('result');
        const statsEl = document.getElementById('stats');
        const errorEl = document.getElementById('error');

        button.addEventListener('click', async function() {
          const url = (input.value || '').trim();
          if (!url) {
            errorEl.textContent = 'url is required';
            return;
          }

          errorEl.textContent = '';
          try {
            const res = await fetch('/shorten', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url }),
            });
            const data = await res.json();
            if (!res.ok) {
              errorEl.textContent = data && data.error ? data.error : 'Failed';
              return;
            }
            const shortUrl = location.origin + data.short_url;
            resultEl.innerHTML = 'Short URL: <a href="' + data.short_url + '">' + shortUrl + '</a>';

            const stats = await fetch('/api/stats/' + encodeURIComponent(data.code));
            if (stats.ok) {
              const s = await stats.json();
              statsEl.textContent = 'Current clicks: ' + s.clicks;
            }
          } catch (_error) {
            errorEl.textContent = 'Request failed';
          }
        });
      })();
    ` }} />
  </>
);

const templates: Record<string, (locals: TemplateLocals) => string> = {
  home: (locals) => renderToString(
    <Layout title="Homura URL Shortener">
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
        <p>Template not found: {name}</p>
      </Layout>
    );
  }
  return renderer(safeLocals);
}
