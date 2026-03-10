import { renderToString } from './lib/render';

type TemplateLocals = Record<string, string>;

function normalizeLocals(locals: Record<string, unknown>): TemplateLocals {
  const normalized: TemplateLocals = {};
  for (const [key, value] of Object.entries(locals || {})) {
    normalized[key] = value === null || value === undefined ? '' : String(value);
  }
  return normalized;
}

const sampleData = JSON.stringify([
  { id: 1, name: 'apple', type: 'fruit', score: 3 },
  { id: 2, name: 'broccoli', type: 'vegetable', score: 5 },
  { id: 3, name: 'banana', type: 'fruit', score: 4 },
  { id: 4, name: 'apple', type: 'fruit', score: 1 },
], null, 2);

const samplePipeline = JSON.stringify([
  { type: 'filter', field: 'type', value: 'fruit' },
  { type: 'sort', field: 'score', direction: 'desc' },
  { type: 'limit', count: 2 },
  { type: 'map', fields: ['name', 'score'] },
], null, 2);

const Layout = ({ title, children }: { title: string; children: unknown }) => (
  <html lang="ja">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>{title}</title>
      <link rel="stylesheet" href="/assets/app.css" />
    </head>
    <body>
      <main className="container">{children}</main>
    </body>
  </html>
);

const Home = (_locals: TemplateLocals) => (
  <>
    <section className="hero">
      <p className="eyebrow">Enumerable + Lazy + Set</p>
      <h1>JSON Transform Pipeline</h1>
      <p className="lead">入力JSONをその場で変換しながら、Homura の API をインタラクティブに試せます。</p>
    </section>

    <section className="panel stack">
      <h2>何ができて何がすごい?</h2>
      <p>JSON 配列に対して filter、map、group、deduplicate、pipeline を Ruby の得意なコレクション処理で実行できます。</p>
      <p>Ruby の Enumerable / Lazy / Set が WebAssembly 化された mruby の中でも自然に動くことを、このページがそのまま証明しています。</p>
      <p><strong>Powered by:</strong> <code>mruby-enumerator</code> / <code>mruby-enum-lazy</code> / <code>mruby-set</code></p>
    </section>

    <section className="grid two-up">
      <article className="panel">
        <h2>Input JSON</h2>
        <textarea id="input-json" className="code-input" rows={18}>{sampleData}</textarea>
      </article>

      <article className="panel stack">
        <div className="stack-tight">
          <h2>Controls</h2>
          <div className="row">
            <input id="field-input" className="text-input" defaultValue="type" placeholder="field" />
            <input id="value-input" className="text-input" defaultValue="fruit" placeholder="value" />
          </div>
          <input id="fields-input" className="text-input" defaultValue="name,score" placeholder="fields: comma separated" />
          <textarea id="pipeline-json" className="code-input" rows={10}>{samplePipeline}</textarea>
        </div>

        <div className="actions">
          <button id="btn-filter" className="button">Filter</button>
          <button id="btn-map" className="button secondary">Map</button>
          <button id="btn-group" className="button secondary">Group</button>
          <button id="btn-unique" className="button secondary">Unique</button>
          <button id="btn-pipeline" className="button accent">Pipeline</button>
        </div>

        <p id="status" className="status"></p>
      </article>
    </section>

    <section className="grid two-up">
      <article className="panel">
        <h2>Result</h2>
        <pre id="result-output" className="code-output"></pre>
      </article>

      <article className="panel">
        <h2>Gem Check</h2>
        <pre id="gems-output" className="code-output"></pre>
      </article>
    </section>

    <script dangerouslySetInnerHTML={{ __html: `
      (function() {
        const inputEl = document.getElementById('input-json');
        const fieldEl = document.getElementById('field-input');
        const valueEl = document.getElementById('value-input');
        const fieldsEl = document.getElementById('fields-input');
        const pipelineEl = document.getElementById('pipeline-json');
        const resultEl = document.getElementById('result-output');
        const gemsEl = document.getElementById('gems-output');
        const statusEl = document.getElementById('status');

        if (!inputEl.value) inputEl.value = ${JSON.stringify(sampleData)};
        if (!pipelineEl.value) pipelineEl.value = ${JSON.stringify(samplePipeline)};
        if (!fieldEl.value) fieldEl.value = 'type';
        if (!valueEl.value) valueEl.value = 'fruit';
        if (!fieldsEl.value) fieldsEl.value = 'name,score';

        function showStatus(message, isError) {
          statusEl.textContent = message;
          statusEl.className = isError ? 'status error' : 'status';
        }

        function parseInput() {
          return JSON.parse(inputEl.value);
        }

        function parseMaybeJson(value) {
          const trimmed = String(value || '').trim();
          if (!trimmed) return '';
          try {
            return JSON.parse(trimmed);
          } catch (_error) {
            return trimmed;
          }
        }

        async function postJson(path, body) {
          const response = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const text = await response.text();
          let payload;
          try {
            payload = JSON.parse(text);
          } catch (_error) {
            payload = text;
          }
          if (!response.ok) {
            throw new Error(typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));
          }
          return payload;
        }

        async function run(path, bodyBuilder) {
          try {
            showStatus('Running ' + path + ' ...', false);
            const payload = await postJson(path, bodyBuilder());
            resultEl.textContent = JSON.stringify(payload, null, 2);
            showStatus('Completed ' + path, false);
          } catch (error) {
            resultEl.textContent = '';
            showStatus(error.message, true);
          }
        }

        document.getElementById('btn-filter').addEventListener('click', function() {
          run('/transform/filter', function() {
            return {
              data: parseInput(),
              field: fieldEl.value.trim(),
              value: parseMaybeJson(valueEl.value),
            };
          });
        });

        document.getElementById('btn-map').addEventListener('click', function() {
          run('/transform/map', function() {
            return {
              data: parseInput(),
              fields: fieldsEl.value.split(',').map(function(value) { return value.trim(); }).filter(Boolean),
            };
          });
        });

        document.getElementById('btn-group').addEventListener('click', function() {
          run('/transform/group', function() {
            return {
              data: parseInput(),
              field: fieldEl.value.trim(),
            };
          });
        });

        document.getElementById('btn-unique').addEventListener('click', function() {
          run('/transform/unique', function() {
            return {
              data: parseInput(),
              field: fieldEl.value.trim(),
            };
          });
        });

        document.getElementById('btn-pipeline').addEventListener('click', function() {
          run('/transform/pipeline', function() {
            return {
              data: parseInput(),
              operations: JSON.parse(pipelineEl.value),
            };
          });
        });

        fetch('/api/test-gems')
          .then(function(response) { return response.json(); })
          .then(function(payload) { gemsEl.textContent = JSON.stringify(payload, null, 2); })
          .catch(function(error) { gemsEl.textContent = error.message; });
      })();
    ` }} />
  </>
);

const templates: Record<string, (locals: TemplateLocals) => string> = {
  home: (locals) => renderToString(
    <Layout title="Homura JSON Transform">
      <Home {...locals} />
    </Layout>
  ),
};

export function renderTemplate(name: string, locals: Record<string, unknown>): string {
  const renderer = templates[name];
  const safeLocals = normalizeLocals(locals);
  if (!renderer) {
    return renderToString(
      <Layout title="Template Not Found">
        <section className="panel">
          <h1>Template not found</h1>
          <p>{name}</p>
        </section>
      </Layout>
    );
  }
  return renderer(safeLocals);
}
