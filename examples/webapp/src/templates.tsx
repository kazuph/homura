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
            <a href="/admin">Admin</a>
            <a href="https://github.com/kazuph/homura" target="_blank" rel="noopener noreferrer">GitHub</a>
          </nav>
        </div>
      </header>
      <main className="container">{children}</main>
      <footer className="site-footer">
        <div className="container">Homura - Ruby DSL for Cloudflare Workers (mruby + WASI + D1)</div>
      </footer>
    </body>
  </html>
);

const Home = ({ todos }: TemplateLocals) => (
  <>
    <section className="hero">
      <p className="eyebrow">mruby + WASI + D1 on Cloudflare Workers</p>
      <h1>Homura To-Do</h1>
      <p className="lead">
        D1データベースで永続化されたTo-Doアプリ。
        Ruby DSL + JSXテンプレート + Cloudflare D1で動いています。
      </p>
    </section>

    <section className="todo-section">
      <div className="todo-card">
        <div className="todo-input-row">
          <input
            type="text"
            id="todo-input"
            className="todo-input"
            placeholder="新しいタスクを入力..."
          />
          <button id="btn-add" className="button">追加</button>
        </div>

        <ul id="todo-list" className="todo-list">
        </ul>

        <div className="todo-footer">
          <span id="todo-count">0 件</span>
          <div className="todo-filters">
            <button className="filter-btn active" data-filter="all">すべて</button>
            <button className="filter-btn" data-filter="active">未完了</button>
            <button className="filter-btn" data-filter="completed">完了</button>
          </div>
        </div>
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
        <h3>D1 Database</h3>
        <p>Cloudflare D1でデータを永続化。SQLiteベースのサーバーレスDB。</p>
      </div>
      <div className="card">
        <h3>JSXテンプレート</h3>
        <p>TypeScript/JSXでHTMLテンプレートを構築。型安全なビュー層。</p>
      </div>
    </section>

    <script
      type="application/json"
      id="initial-todos"
      dangerouslySetInnerHTML={{ __html: safeJsonForScript(todos || '[]') }}
    />
    <script dangerouslySetInnerHTML={{ __html: `
      (function() {
        let currentFilter = 'all';
        var initialTodos = JSON.parse(document.getElementById('initial-todos').textContent);
        let todos = initialTodos;

        const listEl = document.getElementById('todo-list');
        const inputEl = document.getElementById('todo-input');
        const countEl = document.getElementById('todo-count');

        async function refreshTodos() {
          var res = await fetch('/api/todos');
          if (!res.ok) return false;
          todos = await res.json();
          renderTodos();
          return true;
        }

        function renderTodos() {
          const filtered = todos.filter(function(t) {
            if (currentFilter === 'active') return !t.completed;
            if (currentFilter === 'completed') return !!t.completed;
            return true;
          });

          listEl.innerHTML = filtered.map(function(t) {
            return '<li class="todo-item' + (t.completed ? ' completed' : '') + '" data-id="' + t.id + '">' +
              '<label class="todo-checkbox">' +
                '<input type="checkbox"' + (t.completed ? ' checked' : '') + '>' +
                '<span class="todo-text">' + window.__safeTodoText(t.title) + '</span>' +
              '</label>' +
              '<button class="todo-delete" title="削除">&times;</button>' +
            '</li>';
          }).join('');

          var active = todos.filter(function(t) { return !t.completed; }).length;
          countEl.textContent = active + ' 件の未完了タスク';
        }

        window.__safeTodoText = function(value) {
          var div = document.createElement('div');
          div.textContent = value == null ? '' : String(value);
          return div.innerHTML;
        };

        document.getElementById('btn-add').addEventListener('click', addTodo);
        inputEl.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' && !e.isComposing) addTodo();
        });

        async function addTodo() {
          var title = inputEl.value.trim();
          if (!title) return;
          inputEl.value = '';
          var res = await fetch('/api/todos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: title })
          });
          if (res.ok) {
            await refreshTodos();
          }
        }

        listEl.addEventListener('change', async function(e) {
          if (e.target.type !== 'checkbox') return;
          var li = e.target.closest('.todo-item');
          var id = li.dataset.id;
          var res = await fetch('/api/todos/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ completed: e.target.checked })
          });
          if (res.ok) {
            await refreshTodos();
          }
        });

        listEl.addEventListener('click', async function(e) {
          if (!e.target.classList.contains('todo-delete')) return;
          var li = e.target.closest('.todo-item');
          var id = li.dataset.id;
          var res = await fetch('/api/todos/' + id, { method: 'DELETE' });
          if (res.ok) {
            await refreshTodos();
          }
        });

        document.querySelectorAll('.filter-btn').forEach(function(btn) {
          btn.addEventListener('click', function() {
            document.querySelector('.filter-btn.active').classList.remove('active');
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderTodos();
          });
        });

        renderTodos();
      })();
    ` }} />
  </>
);

const templates: Record<string, (locals: TemplateLocals) => string> = {
  home: (locals) =>
    renderToString(
      <Layout title="Homura To-Do - Ruby DSL for Cloudflare Workers">
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
