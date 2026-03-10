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
      <main className="shell">
        {children}
      </main>
    </body>
  </html>
);

const Home = (_locals: TemplateLocals) => (
  <>
    <section className="hero panel">
      <p className="eyebrow">mruby-time + mruby-pack + mruby-bigint</p>
      <h1>Time Tracker</h1>
      <p className="lead">
        イベントを記録し、集計し、時間ベースのトークンを確認できる UI です。
        画面の操作はすべて既存 API を叩いています。
      </p>
      <div className="hero-actions">
        <a className="ghost-button" href="/api" target="_blank" rel="noreferrer">API Docs</a>
        <a className="ghost-button" href="/api/test-gems" target="_blank" rel="noreferrer">Gem Check</a>
      </div>
    </section>

    <section className="layout">
      <section className="panel stack">
        <div className="section-head">
          <h2>何ができる?</h2>
          <p>イベントの時系列記録、時間窓つき集計、トークン生成を 1 つのエッジアプリでまとめて扱えます。</p>
        </div>
      </section>
      <section className="panel stack">
        <div className="section-head">
          <h2>何がすごい?</h2>
          <p><code>mruby-time</code> で実時計、<code>mruby-pack</code> でバイナリ変換、<code>mruby-bigint</code> と <code>mruby-rational</code> で数値処理まで、全部 Workers 上の Ruby で完結します。</p>
        </div>
      </section>
    </section>

    <section className="layout">
      <section className="panel stack">
        <div className="section-head">
          <h2>New Event</h2>
          <p>POST /events</p>
        </div>
        <div className="form-row">
          <input id="event-name" className="text-input" placeholder="deploy / retro / incident-review" />
          <button id="create-event" className="primary-button">Log Event</button>
        </div>
        <p id="event-feedback" className="feedback" role="status"></p>

        <div className="section-head">
          <h2>Window</h2>
          <p>GET /events?window=...</p>
        </div>
        <div className="form-row">
          <select id="window-size" className="select-input">
            <option value="900">15 minutes</option>
            <option value="3600" selected>1 hour</option>
            <option value="21600">6 hours</option>
            <option value="86400">24 hours</option>
          </select>
          <button id="refresh-events" className="ghost-button">Refresh</button>
        </div>
      </section>

      <section className="panel stack">
        <div className="section-head">
          <h2>Token Lab</h2>
          <p>GET /token</p>
        </div>
        <div className="form-grid">
          <label>
            <span>Seed</span>
            <input id="token-seed" className="text-input" value="homura-default" />
          </label>
          <label>
            <span>Window Seconds</span>
            <input id="token-window" className="text-input" type="number" min="5" value="30" />
          </label>
        </div>
        <button id="generate-token" className="primary-button">Generate Token</button>
        <div id="token-card" className="token-card">
          <strong>------</strong>
          <span>remaining --s</span>
        </div>
      </section>
    </section>

    <section className="layout">
      <section className="panel stack">
        <div className="section-head">
          <h2>Recent Events</h2>
          <p id="events-meta">Loading...</p>
        </div>
        <ul id="events-list" className="list"></ul>
      </section>

      <section className="panel stack">
        <div className="section-head">
          <h2>Event Stats</h2>
          <p>GET /events/stats</p>
        </div>
        <ul id="stats-list" className="list"></ul>
      </section>
    </section>

    <script dangerouslySetInnerHTML={{ __html: `
      (function() {
        const eventName = document.getElementById('event-name');
        const feedback = document.getElementById('event-feedback');
        const eventsList = document.getElementById('events-list');
        const statsList = document.getElementById('stats-list');
        const eventsMeta = document.getElementById('events-meta');
        const windowSize = document.getElementById('window-size');
        const tokenSeed = document.getElementById('token-seed');
        const tokenWindow = document.getElementById('token-window');
        const tokenCard = document.getElementById('token-card');

        function escapeHtml(value) {
          const div = document.createElement('div');
          div.textContent = value == null ? '' : String(value);
          return div.innerHTML;
        }

        async function loadEvents() {
          const query = encodeURIComponent(windowSize.value || '3600');
          const res = await fetch('/events?window=' + query);
          const data = await res.json();
          if (!res.ok) {
            eventsMeta.textContent = 'Failed to load events';
            return;
          }
          eventsMeta.textContent = data.count + ' events in ' + data.window;
          eventsList.innerHTML = (data.events || []).map(function(event) {
            return '<li class="list-item">' +
              '<div><strong>' + escapeHtml(event.name) + '</strong><span>' + escapeHtml(event.created_at || '') + '</span></div>' +
              '<em>' + escapeHtml(event.elapsed || '') + '</em>' +
            '</li>';
          }).join('') || '<li class="list-empty">No events yet</li>';
        }

        async function loadStats() {
          const res = await fetch('/events/stats');
          const data = await res.json();
          if (!res.ok) {
            statsList.innerHTML = '<li class="list-empty">Failed to load stats</li>';
            return;
          }
          statsList.innerHTML = (data.stats || []).map(function(item) {
            return '<li class="list-item">' +
              '<div><strong>' + escapeHtml(item.name) + '</strong><span>' + escapeHtml(item.duration || '') + '</span></div>' +
              '<em>' + escapeHtml(item.count) + ' events</em>' +
            '</li>';
          }).join('') || '<li class="list-empty">No stats yet</li>';
        }

        async function loadToken() {
          const seed = encodeURIComponent(tokenSeed.value || 'homura-default');
          const windowValue = encodeURIComponent(tokenWindow.value || '30');
          const res = await fetch('/token?seed=' + seed + '&window=' + windowValue);
          const data = await res.json();
          if (!res.ok) {
            tokenCard.innerHTML = '<strong>error</strong><span>token generation failed</span>';
            return;
          }
          tokenCard.innerHTML = '<strong>' + escapeHtml(data.token) + '</strong>' +
            '<span>remaining ' + escapeHtml(data.remaining_seconds) + 's</span>';
        }

        async function createEvent() {
          const name = (eventName.value || '').trim();
          if (!name) {
            feedback.textContent = 'name required';
            return;
          }
          feedback.textContent = 'Saving...';
          const res = await fetch('/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
          });
          const data = await res.json();
          if (!res.ok) {
            feedback.textContent = data && data.error ? data.error : 'request failed';
            return;
          }
          eventName.value = '';
          feedback.textContent = 'Logged ' + data.name + ' at ' + data.timestamp;
          await Promise.all([loadEvents(), loadStats()]);
        }

        document.getElementById('create-event').addEventListener('click', createEvent);
        document.getElementById('refresh-events').addEventListener('click', function() {
          loadEvents();
          loadStats();
        });
        document.getElementById('generate-token').addEventListener('click', loadToken);
        eventName.addEventListener('keydown', function(event) {
          if (event.key === 'Enter' && !event.isComposing) createEvent();
        });

        loadEvents();
        loadStats();
        loadToken();
      })();
    ` }} />
  </>
);

const templates: Record<string, (locals: TemplateLocals) => string> = {
  home: (locals) => renderToString(
    <Layout title="Homura Time Tracker">
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
        <section className="panel">
          <h1>Template not found</h1>
          <p>Missing template: {name}</p>
        </section>
      </Layout>
    );
  }
  return renderer(safeLocals);
}
