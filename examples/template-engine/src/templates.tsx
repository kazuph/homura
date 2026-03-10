import { renderToString } from './lib/render';

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
      <main className="page-shell">{children}</main>
    </body>
  </html>
);

const Home = (_: TemplateLocals) => (
  <>
    <section className="hero">
      <p className="eyebrow">Safe HTML Escaping</p>
      <h1>Micro Template Engine Studio</h1>
      <p className="lead">
        mruby 側の `MicroTemplate` をそのまま触りながら、登録済みテンプレートと inline template の両方を
        ブラウザから試せるデモ。返ってきた HTML は iframe で隔離して表示する。
      </p>
    </section>

    <section className="result-grid">
      <article className="preview-card">
        <h2 className="section-title">このサイトでできること</h2>
        <p className="muted"><code>{'{{variable}}'}</code> 形式のテンプレートを Ruby 側で展開し、登録テンプレートと inline template を比較できます。</p>
      </article>
      <article className="preview-card">
        <h2 className="section-title">何がすごい?</h2>
        <p className="muted">mruby on Workers の中でテンプレート補間と HTML escape が完結し、XSS 防止を保ったまま軽量なテンプレートエンジンが動きます。</p>
        <p className="muted"><strong>Powered by:</strong> <code>mruby-metaprog</code> / Homura Ruby DSL</p>
      </article>
    </section>

    <section className="workspace">
      <div className="panel">
        <h2 className="section-title">Registered Template</h2>
        <div className="field">
          <label htmlFor="template-select">Template Name</label>
          <select id="template-select">
            <option value="page">page</option>
            <option value="list">list</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="render-data">Data JSON</label>
          <textarea id="render-data" spellCheck="false">{`{
  "title": "Homura Template",
  "body": "Hello from mruby",
  "items": ["ruby", "wasi", "workers"]
}`}</textarea>
        </div>
        <div className="actions">
          <button id="btn-render" className="button">POST /render</button>
          <button id="btn-templates" className="button ghost">GET /templates</button>
        </div>
      </div>

      <div className="panel">
        <h2 className="section-title">Inline Template</h2>
        <div className="field">
          <label htmlFor="inline-template">Template String</label>
          <textarea id="inline-template" spellCheck="false">{`<section>
  <h1>{{title}}</h1>
  <p>{{body}}</p>
  <small>{{generated_at}}</small>
</section>`}</textarea>
        </div>
        <div className="field">
          <label htmlFor="inline-data">Inline Data JSON</label>
          <textarea id="inline-data" spellCheck="false">{`{
  "title": "Inline Template",
  "body": "<script>alert(\\"escaped\\")</script>"
}`}</textarea>
        </div>
        <div className="actions">
          <button id="btn-inline" className="button secondary">POST /render/inline</button>
          <button id="btn-gems" className="button ghost">GET /api/test-gems</button>
        </div>
      </div>
    </section>

    <section className="result-grid">
      <article className="preview-card">
        <span id="status-pill" className="status-pill">Ready</span>
        <p className="muted">Rendered HTML Preview</p>
        <div className="iframe-wrap">
          <iframe id="preview-frame" title="Rendered HTML preview"></iframe>
        </div>
      </article>

      <article className="preview-card">
        <p className="muted">Response / metadata</p>
        <pre id="response-output">{`{
  "status": 0,
  "body": ""
}`}</pre>
      </article>
    </section>

    <section className="result-grid">
      <article className="preview-card">
        <div className="stack">
          <h2 className="section-title">What this example proves</h2>
          <div className="mini-list">
            <div className="mini-item">
              <strong>Escaping in Ruby</strong>
              <span><code>{'{{variable}}'}</code> は必ず HTML escape される。</span>
            </div>
            <div className="mini-item">
              <strong>Registry + Inline</strong>
              <span>登録テンプレートと単発テンプレートを同じ UI から比較できる。</span>
            </div>
            <div className="mini-item">
              <strong>Workers Friendly</strong>
              <span>ブラウザ側は単なる fetch、レンダリングは全部 mruby 側で完結する。</span>
            </div>
          </div>
        </div>
      </article>

      <article className="preview-card">
        <p className="muted">Template API snapshot</p>
        <pre id="meta-output">{`{
  "templates": []
}`}</pre>
      </article>
    </section>

    <script dangerouslySetInnerHTML={{ __html: `
      (function() {
        const templateSelect = document.getElementById('template-select');
        const renderData = document.getElementById('render-data');
        const inlineTemplate = document.getElementById('inline-template');
        const inlineData = document.getElementById('inline-data');
        const previewFrame = document.getElementById('preview-frame');
        const responseOutput = document.getElementById('response-output');
        const metaOutput = document.getElementById('meta-output');
        const statusPill = document.getElementById('status-pill');

        function setStatus(ok, text) {
          statusPill.textContent = text;
          statusPill.className = ok ? 'status-pill' : 'status-pill error';
        }

        async function renderRequest(path, body) {
          try {
            const response = await fetch(path, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            const html = await response.text();
            previewFrame.srcdoc = html;
            responseOutput.textContent = JSON.stringify({ status: response.status, body: html }, null, 2);
            setStatus(response.ok, response.ok ? 'Rendered' : 'Error ' + response.status);
          } catch (error) {
            responseOutput.textContent = JSON.stringify({ error: String(error) }, null, 2);
            previewFrame.srcdoc = '<p>Request failed</p>';
            setStatus(false, 'Request failed');
          }
        }

        async function loadTemplates() {
          const response = await fetch('/templates');
          const json = await response.json();
          metaOutput.textContent = JSON.stringify(json, null, 2);
          if (Array.isArray(json.templates)) {
            templateSelect.innerHTML = json.templates.map(function(name) {
              return '<option value="' + name + '">' + name + '</option>';
            }).join('');
          }
        }

        document.getElementById('btn-render').addEventListener('click', function() {
          renderRequest('/render', {
            template: templateSelect.value,
            data: JSON.parse(renderData.value),
          });
        });

        document.getElementById('btn-inline').addEventListener('click', function() {
          renderRequest('/render/inline', {
            template: inlineTemplate.value,
            data: JSON.parse(inlineData.value),
          });
        });

        document.getElementById('btn-templates').addEventListener('click', function() {
          loadTemplates().catch(function(error) {
            metaOutput.textContent = JSON.stringify({ error: String(error) }, null, 2);
          });
        });

        document.getElementById('btn-gems').addEventListener('click', async function() {
          const response = await fetch('/api/test-gems');
          const json = await response.json();
          metaOutput.textContent = JSON.stringify(json, null, 2);
        });

        loadTemplates().catch(function(error) {
          metaOutput.textContent = JSON.stringify({ error: String(error) }, null, 2);
        });
      })();
    ` }} />
  </>
);

const templates: Record<string, (locals: TemplateLocals) => string> = {
  home: (locals) => renderToString(
    <Layout title="Homura Template Engine">
      <Home {...locals} />
    </Layout>,
  ),
};

export function renderTemplate(name: string, locals: Record<string, unknown>): string {
  const renderer = templates[name];
  const safeLocals = normalizeLocals(locals || {});
  if (!renderer) {
    return renderToString(
      <Layout title="Homura Template Engine">
        <section className="panel">
          <h1>Template not found</h1>
          <p>{name}</p>
        </section>
      </Layout>,
    );
  }
  return renderer(safeLocals);
}
