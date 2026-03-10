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
      <p className="eyebrow">Homura::Model + mruby-metaprog</p>
      <h1>DSL API Builder</h1>
      <p className="lead">
        Article / Tag の CRUD と published article 一覧を、画面から直接既存 API に対して操作できます。
      </p>
      <div className="hero-actions">
        <a className="ghost-button" href="/api" target="_blank" rel="noreferrer">API Docs</a>
        <a className="ghost-button" href="/api/test-gems" target="_blank" rel="noreferrer">Model Check</a>
      </div>
    </section>

    <section className="layout">
      <section className="panel stack">
        <div className="section-head">
          <h2>何ができる?</h2>
          <p>Ruby DSL で model を定義すると、CRUD API とバリデーションつきのデータ操作をすぐに立ち上げられます。</p>
        </div>
      </section>
      <section className="panel stack">
        <div className="section-head">
          <h2>何がすごい?</h2>
          <p><code>table</code> / <code>column</code> / <code>validates</code> から ActiveRecord 風の API を mruby on WASM 上で再現しているのが、この example のキモです。</p>
          <p><strong>Powered by:</strong> <code>mruby-metaprog</code> / <code>mruby-data</code> / <code>Homura::Model</code></p>
        </div>
      </section>
    </section>

    <section className="layout">
      <section className="panel stack">
        <div className="section-head">
          <h2>Create Article</h2>
          <p>POST /api/articles</p>
        </div>
        <input id="article-edit-id" type="hidden" />
        <div className="form-grid">
          <label>
            <span>Title</span>
            <input id="article-title" className="text-input" placeholder="Shipping notes" />
          </label>
          <label>
            <span>Author</span>
            <input id="article-author" className="text-input" placeholder="kazuph" />
          </label>
        </div>
        <label>
          <span>Body</span>
          <textarea id="article-body" className="text-area" placeholder="Write something worth versioning..."></textarea>
        </label>
        <label className="checkbox-row">
          <input id="article-published" type="checkbox" />
          <span>Published immediately</span>
        </label>
        <div className="form-row">
          <button id="save-article" className="primary-button">Save Article</button>
          <button id="reset-article" className="ghost-button" type="button">Reset</button>
        </div>
        <p id="article-feedback" className="feedback" role="status"></p>
      </section>

      <section className="panel stack">
        <div className="section-head">
          <h2>Create Tag</h2>
          <p>POST /api/tags</p>
        </div>
        <div className="form-row">
          <input id="tag-name" className="text-input" placeholder="release-notes" />
          <button id="create-tag" className="primary-button">Create Tag</button>
        </div>
        <p id="tag-feedback" className="feedback" role="status"></p>

        <div className="section-head secondary">
          <h2>Published Preview</h2>
          <p>GET /api/articles/published</p>
        </div>
        <ul id="published-list" className="list compact"></ul>
      </section>
    </section>

    <section className="layout">
      <section className="panel stack">
        <div className="section-head">
          <h2>Articles</h2>
          <p id="articles-meta">Loading...</p>
        </div>
        <div className="form-row">
          <button id="prev-page" className="ghost-button" type="button">Prev</button>
          <button id="next-page" className="ghost-button" type="button">Next</button>
        </div>
        <ul id="articles-list" className="list"></ul>
      </section>

      <section className="panel stack">
        <div className="section-head">
          <h2>Tags</h2>
          <p id="tags-meta">Loading...</p>
        </div>
        <ul id="tags-list" className="list compact"></ul>
      </section>
    </section>

    <section className="layout">
      <section className="panel stack">
        <div className="section-head">
          <h2>Model Metadata</h2>
          <p>GET /api</p>
        </div>
        <pre id="metadata-output" className="metadata-output">Loading...</pre>
      </section>
    </section>

    <script dangerouslySetInnerHTML={{ __html: `
      (function() {
        let currentPage = 1;
        const articleEditId = document.getElementById('article-edit-id');
        const articleTitle = document.getElementById('article-title');
        const articleAuthor = document.getElementById('article-author');
        const articleBody = document.getElementById('article-body');
        const articlePublished = document.getElementById('article-published');
        const articleFeedback = document.getElementById('article-feedback');
        const tagName = document.getElementById('tag-name');
        const tagFeedback = document.getElementById('tag-feedback');
        const articlesList = document.getElementById('articles-list');
        const tagsList = document.getElementById('tags-list');
        const publishedList = document.getElementById('published-list');
        const articlesMeta = document.getElementById('articles-meta');
        const tagsMeta = document.getElementById('tags-meta');
        const metadataOutput = document.getElementById('metadata-output');

        function escapeHtml(value) {
          const div = document.createElement('div');
          div.textContent = value == null ? '' : String(value);
          return div.innerHTML;
        }

        function resetArticleForm() {
          articleEditId.value = '';
          articleTitle.value = '';
          articleAuthor.value = '';
          articleBody.value = '';
          articlePublished.checked = false;
        }

        async function loadArticles(page) {
          currentPage = page;
          const res = await fetch('/api/articles?page=' + page + '&per=5');
          const data = await res.json();
          if (!res.ok) {
            articlesMeta.textContent = 'Failed to load articles';
            return;
          }
          const records = data.data || [];
          articlesMeta.textContent = 'Page ' + data.meta.page + ' / total ' + data.meta.total;
          articlesList.innerHTML = records.map(function(article) {
            return '<li class="list-item">' +
              '<div><strong>' + escapeHtml(article.title) + '</strong><span>' + escapeHtml(article.author || 'anonymous') + '</span></div>' +
              '<div class="list-item-actions">' +
                '<em>' + (article.published ? 'published' : 'draft') + '</em>' +
                '<button class="ghost-button small-button" data-action="edit" data-id="' + article.id + '">Edit</button>' +
                '<button class="ghost-button small-button" data-action="delete" data-id="' + article.id + '">Delete</button>' +
              '</div>' +
            '</li>';
          }).join('') || '<li class="list-empty">No articles yet</li>';
        }

        async function loadTags() {
          const res = await fetch('/api/tags');
          const data = await res.json();
          if (!res.ok) {
            tagsMeta.textContent = 'Failed to load tags';
            return;
          }
          const records = data.data || [];
          tagsMeta.textContent = records.length + ' loaded';
          tagsList.innerHTML = records.map(function(tag) {
            return '<li class="list-item compact"><strong>' + escapeHtml(tag.name) + '</strong></li>';
          }).join('') || '<li class="list-empty">No tags yet</li>';
        }

        async function loadPublished() {
          const res = await fetch('/api/articles/published');
          const data = await res.json();
          if (!res.ok) {
            publishedList.innerHTML = '<li class="list-empty">Failed to load published articles</li>';
            return;
          }
          const records = data.data || [];
          publishedList.innerHTML = records.map(function(article) {
            return '<li class="list-item compact"><strong>' + escapeHtml(article.title) + '</strong><span>' + escapeHtml(article.author || 'anonymous') + '</span></li>';
          }).join('') || '<li class="list-empty">No published articles yet</li>';
        }

        async function loadMetadata() {
          const res = await fetch('/api');
          const data = await res.json();
          metadataOutput.textContent = JSON.stringify(data, null, 2);
        }

        async function saveArticle() {
          const payload = {
            title: (articleTitle.value || '').trim(),
            author: (articleAuthor.value || '').trim(),
            body: (articleBody.value || '').trim(),
            published: articlePublished.checked
          };
          const editId = articleEditId.value;
          const path = editId ? '/api/articles/' + editId : '/api/articles';
          const method = editId ? 'PUT' : 'POST';
          articleFeedback.textContent = 'Saving...';
          const res = await fetch(path, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!res.ok) {
            articleFeedback.textContent = data && data.errors ? data.errors.join(', ') : (data.error || 'request failed');
            return;
          }
          resetArticleForm();
          articleFeedback.textContent = editId ? 'Updated article #' + data.id : 'Created article #' + data.id;
          await Promise.all([loadArticles(currentPage), loadPublished(), loadMetadata()]);
        }

        async function editArticle(id) {
          const res = await fetch('/api/articles/' + id);
          const data = await res.json();
          if (!res.ok) {
            articleFeedback.textContent = data.error || 'failed to load article';
            return;
          }
          articleEditId.value = String(data.id);
          articleTitle.value = data.title || '';
          articleAuthor.value = data.author || '';
          articleBody.value = data.body || '';
          articlePublished.checked = !!data.published;
          articleFeedback.textContent = 'Editing article #' + data.id;
        }

        async function deleteArticle(id) {
          const res = await fetch('/api/articles/' + id, { method: 'DELETE' });
          const data = await res.json();
          if (!res.ok) {
            articleFeedback.textContent = data.error || 'delete failed';
            return;
          }
          articleFeedback.textContent = 'Deleted article #' + id;
          await Promise.all([loadArticles(currentPage), loadPublished(), loadMetadata()]);
        }

        async function createTag() {
          const payload = { name: (tagName.value || '').trim() };
          tagFeedback.textContent = 'Saving...';
          const res = await fetch('/api/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!res.ok) {
            tagFeedback.textContent = data && data.errors ? data.errors.join(', ') : (data.error || 'request failed');
            return;
          }
          tagName.value = '';
          tagFeedback.textContent = 'Created tag #' + data.id;
          await loadTags();
        }

        document.getElementById('save-article').addEventListener('click', saveArticle);
        document.getElementById('reset-article').addEventListener('click', function() {
          resetArticleForm();
          articleFeedback.textContent = 'Form reset';
        });
        document.getElementById('create-tag').addEventListener('click', createTag);
        document.getElementById('prev-page').addEventListener('click', function() {
          if (currentPage > 1) loadArticles(currentPage - 1);
        });
        document.getElementById('next-page').addEventListener('click', function() {
          loadArticles(currentPage + 1);
        });

        articlesList.addEventListener('click', function(event) {
          const button = event.target.closest('button[data-action]');
          if (!button) return;
          const id = button.getAttribute('data-id');
          const action = button.getAttribute('data-action');
          if (action === 'edit') editArticle(id);
          if (action === 'delete') deleteArticle(id);
        });

        loadArticles(1);
        loadTags();
        loadPublished();
        loadMetadata();
      })();
    ` }} />
  </>
);

const templates: Record<string, (locals: TemplateLocals) => string> = {
  home: (locals) => renderToString(
    <Layout title="Homura DSL API Builder">
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
