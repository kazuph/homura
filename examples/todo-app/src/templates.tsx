import { renderToString } from './lib/render';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Props = Record<string, any>;

interface TodoItem {
  id: number;
  title: string;
  description: string;
  status: number;
  priority: number;
  due_date: string;
  category_id: number | null;
  created_at: string;
  updated_at: string;
}

interface CategoryItem {
  id: number;
  name: string;
  color: string;
  created_at: string;
  todo_count?: number;
}

const STATUS_LABELS: Record<number, string> = { 0: 'Pending', 1: 'In Progress', 2: 'Done' };
const STATUS_CLASSES: Record<number, string> = { 0: 'badge-pending', 1: 'badge-in-progress', 2: 'badge-done' };
const PRIORITY_LABELS: Record<number, string> = { 1: 'Low', 2: 'Medium', 3: 'High' };
const PRIORITY_CLASSES: Record<number, string> = { 1: 'badge-priority-1', 2: 'badge-priority-2', 3: 'badge-priority-3' };

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const Layout = ({ title, children, activePage }: { title: string; children: unknown; activePage?: string }) => (
  <html lang="ja">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>{title}</title>
      <link rel="stylesheet" href="/assets/app.css" />
    </head>
    <body>
      <main className="shell">
        <nav>
          <span className="logo">Homura Todo</span>
          <a href="/" className={activePage === 'index' ? 'active' : ''}>Todos</a>
          <a href="/categories" className={activePage === 'categories' ? 'active' : ''}>Categories</a>
          <a href="/guide" className={activePage === 'guide' ? 'active' : ''}>ORM Guide</a>
          <a href="/api/stats" target="_blank" rel="noreferrer">API Stats</a>
        </nav>
        {children}
        <footer>
          Powered by Homura::Model ORM + mruby + WASI on Cloudflare Workers
        </footer>
      </main>
    </body>
  </html>
);

// ===== Index Page =====
const IndexPage = (props: Props) => {
  const todos: TodoItem[] = props.todos || [];
  const categories: CategoryItem[] = props.categories || [];
  const stats = props.stats || { total: 0, pending: 0, in_progress: 0, done: 0 };
  const currentStatus: string = props.current_status || '';
  const currentCategory: string = props.current_category || '';

  const catMap: Record<number, CategoryItem> = {};
  for (const cat of categories) {
    catMap[cat.id] = cat;
  }

  return (
    <>
      <div className="page-header">
        <h1>Todos</h1>
        <a href="/todos/new" className="btn btn-primary">+ New Todo</a>
      </div>

      <div className="stats-bar">
        <a href="/" className={'stat-badge' + (currentStatus === '' ? ' active' : '')}>
          All <span className="count">{stats.total}</span>
        </a>
        <a href="/?status=pending" className={'stat-badge' + (currentStatus === 'pending' ? ' active' : '')}>
          Pending <span className="count">{stats.pending}</span>
        </a>
        <a href="/?status=in_progress" className={'stat-badge' + (currentStatus === 'in_progress' ? ' active' : '')}>
          In Progress <span className="count">{stats.in_progress}</span>
        </a>
        <a href="/?status=done" className={'stat-badge' + (currentStatus === 'done' ? ' active' : '')}>
          Done <span className="count">{stats.done}</span>
        </a>
      </div>

      {categories.length > 0 && (
        <div className="filter-bar">
          <span style="color: var(--text-muted); font-size: 0.85rem;">Category:</span>
          <a href={'/' + (currentStatus ? '?status=' + currentStatus : '')}
             className={'btn btn-sm' + (currentCategory === '' ? ' btn-primary' : '')}>
            All
          </a>
          {categories.map((cat: CategoryItem) => (
            <a href={'/?category=' + cat.id + (currentStatus ? '&status=' + currentStatus : '')}
               className={'btn btn-sm' + (String(currentCategory) === String(cat.id) ? ' btn-primary' : '')}>
              {escapeHtml(cat.name)}
            </a>
          ))}
        </div>
      )}

      {todos.length === 0 ? (
        <div className="empty-state">
          <h3>No todos yet</h3>
          <p>Create your first todo to get started!</p>
          <a href="/todos/new" className="btn btn-primary" style="margin-top: 1rem;">+ New Todo</a>
        </div>
      ) : (
        <div className="panel">
          <ul className="todo-list">
            {todos.map((todo: TodoItem) => {
              const cat = todo.category_id ? catMap[todo.category_id] : null;
              return (
                <li className={'todo-item' + (todo.status === 2 ? ' done' : '')}>
                  <form method="post" action={'/todos/' + todo.id + '/toggle'}>
                    <button type="submit" className="btn btn-toggle" title="Toggle status">
                      {todo.status === 2 ? '\u2705' : todo.status === 1 ? '\u{1f504}' : '\u2b55'}
                    </button>
                  </form>
                  <span className="todo-title">{escapeHtml(todo.title)}</span>
                  <div className="todo-meta">
                    {cat && (
                      <span className="cat-badge" style={'background:' + (cat.color || '#6366f1') + '22; color:' + (cat.color || '#6366f1')}>
                        {escapeHtml(cat.name)}
                      </span>
                    )}
                    <span className={'badge ' + PRIORITY_CLASSES[todo.priority || 2]}>
                      {PRIORITY_LABELS[todo.priority || 2]}
                    </span>
                    <span className={'badge ' + STATUS_CLASSES[todo.status || 0]}>
                      {STATUS_LABELS[todo.status || 0]}
                    </span>
                    {todo.due_date && (
                      <span style="color: var(--text-muted); font-size: 0.75rem;">{escapeHtml(todo.due_date)}</span>
                    )}
                    <a href={'/todos/' + todo.id + '/edit'} className="btn btn-sm">Edit</a>
                    <form method="post" action={'/todos/' + todo.id + '/delete'} style="display:inline;">
                      <button type="submit" className="btn btn-sm btn-danger">Del</button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
};

// ===== New Todo Form =====
const NewPage = (props: Props) => {
  const categories: CategoryItem[] = props.categories || [];
  const errors: string[] = props.errors || [];
  const values: Record<string, string> = props.values || {};

  return (
    <>
      <div className="page-header">
        <h1>New Todo</h1>
        <a href="/" className="btn">Back</a>
      </div>

      {errors.length > 0 && (
        <ul className="error-list">
          {errors.map((err: string) => <li>{escapeHtml(err)}</li>)}
        </ul>
      )}

      <div className="panel">
        <form method="post" action="/todos">
          <div className="form-group">
            <label>Title *</label>
            <input type="text" name="title" className="form-control"
                   value={escapeHtml(values.title || '')} required />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea name="description" className="form-control">{escapeHtml(values.description || '')}</textarea>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Status</label>
              <select name="status" className="form-control">
                <option value="0" selected={!values.status || values.status === '0'}>Pending</option>
                <option value="1" selected={values.status === '1'}>In Progress</option>
                <option value="2" selected={values.status === '2'}>Done</option>
              </select>
            </div>
            <div className="form-group">
              <label>Priority</label>
              <select name="priority" className="form-control">
                <option value="1" selected={values.priority === '1'}>Low</option>
                <option value="2" selected={!values.priority || values.priority === '2'}>Medium</option>
                <option value="3" selected={values.priority === '3'}>High</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Due Date</label>
              <input type="date" name="due_date" className="form-control"
                     value={escapeHtml(values.due_date || '')} />
            </div>
            <div className="form-group">
              <label>Category</label>
              <select name="category_id" className="form-control">
                <option value="">None</option>
                {categories.map((cat: CategoryItem) => (
                  <option value={String(cat.id)}
                          selected={values.category_id === String(cat.id)}>
                    {escapeHtml(cat.name)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">Create Todo</button>
            <a href="/" className="btn">Cancel</a>
          </div>
        </form>
      </div>
    </>
  );
};

// ===== Edit Todo Form =====
const EditPage = (props: Props) => {
  const todo: TodoItem = props.todo || {};
  const categories: CategoryItem[] = props.categories || [];
  const errors: string[] = props.errors || [];

  return (
    <>
      <div className="page-header">
        <h1>Edit Todo</h1>
        <a href="/" className="btn">Back</a>
      </div>

      {errors.length > 0 && (
        <ul className="error-list">
          {errors.map((err: string) => <li>{escapeHtml(err)}</li>)}
        </ul>
      )}

      <div className="panel">
        <form method="post" action={'/todos/' + todo.id}>
          <div className="form-group">
            <label>Title *</label>
            <input type="text" name="title" className="form-control"
                   value={escapeHtml(todo.title || '')} required />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea name="description" className="form-control">{escapeHtml(todo.description || '')}</textarea>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Status</label>
              <select name="status" className="form-control">
                <option value="0" selected={todo.status === 0}>Pending</option>
                <option value="1" selected={todo.status === 1}>In Progress</option>
                <option value="2" selected={todo.status === 2}>Done</option>
              </select>
            </div>
            <div className="form-group">
              <label>Priority</label>
              <select name="priority" className="form-control">
                <option value="1" selected={todo.priority === 1}>Low</option>
                <option value="2" selected={todo.priority === 2}>Medium</option>
                <option value="3" selected={todo.priority === 3}>High</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Due Date</label>
              <input type="date" name="due_date" className="form-control"
                     value={escapeHtml(todo.due_date || '')} />
            </div>
            <div className="form-group">
              <label>Category</label>
              <select name="category_id" className="form-control">
                <option value="">None</option>
                {categories.map((cat: CategoryItem) => (
                  <option value={String(cat.id)}
                          selected={todo.category_id === cat.id}>
                    {escapeHtml(cat.name)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">Update Todo</button>
            <a href="/" className="btn">Cancel</a>
          </div>
        </form>
      </div>
    </>
  );
};

// ===== Categories Page =====
const CategoriesPage = (props: Props) => {
  const categories: (CategoryItem & { todo_count?: number })[] = props.categories || [];
  const errors: string[] = props.errors || [];

  return (
    <>
      <div className="page-header">
        <h1>Categories</h1>
        <a href="/" className="btn">Back to Todos</a>
      </div>

      {errors.length > 0 && (
        <ul className="error-list">
          {errors.map((err: string) => <li>{escapeHtml(err)}</li>)}
        </ul>
      )}

      <div className="panel">
        <h2 style="font-size: 1.1rem; margin-bottom: 1rem;">Add Category</h2>
        <form method="post" action="/categories">
          <div className="form-row">
            <div className="form-group">
              <label>Name *</label>
              <input type="text" name="name" className="form-control" required />
            </div>
            <div className="form-group">
              <label>Color</label>
              <input type="color" name="color" className="form-control" value="#6366f1"
                     style="height: 38px; padding: 2px;" />
            </div>
            <div className="form-group" style="flex: 0;">
              <label>&nbsp;</label>
              <button type="submit" className="btn btn-primary">Add</button>
            </div>
          </div>
        </form>
      </div>

      {categories.length === 0 ? (
        <div className="empty-state">
          <h3>No categories yet</h3>
          <p>Create a category above to organize your todos.</p>
        </div>
      ) : (
        <div className="panel">
          <ul className="cat-list">
            {categories.map((cat) => (
              <li className="cat-item">
                <span className="cat-color" style={'background:' + (cat.color || '#6366f1')}></span>
                <span className="cat-name">{escapeHtml(cat.name)}</span>
                <span className="cat-count">{cat.todo_count || 0} todos</span>
                <form method="post" action={'/categories/' + cat.id + '/delete'} style="display:inline;">
                  <button type="submit" className="btn btn-sm btn-danger">Delete</button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
};

// ===== ORM Guide Page =====
const GuidePage = (_props: Props) => (
  <>
    <div className="page-header">
      <h1>Homura ORM Guide</h1>
    </div>

    <div className="guide">
      <section className="panel guide-section">
        <h2>Getting Started</h2>
        <p>Homura::Model is an ActiveRecord-inspired ORM for mruby on Cloudflare Workers. Define models, run queries, and manage data with a familiar Ruby DSL.</p>
        <pre><code>{`class Todo < Homura::Model
  table :todos
  column :id, :integer
  column :title, :string
  column :status, :integer
end`}</code></pre>
      </section>

      <section className="panel guide-section">
        <h2>CRUD Operations</h2>
        <pre><code>{`# Create
todo = Todo.new({ title: "Buy coffee" })
todo.save(c.db)

# Read
todo = Todo.find(c.db, 1)
todos = Todo.all(c.db)

# Update
todo.title = "Buy Ethiopian coffee"
todo.save(c.db)

# Delete
todo.destroy(c.db)`}</code></pre>
      </section>

      <section className="panel guide-section">
        <h2>Validations</h2>
        <p>Validate data before saving. Supports <code>presence</code>, <code>length</code>, <code>numericality</code>, <code>format</code>, <code>inclusion</code>, <code>exclusion</code>, and custom validators.</p>
        <pre><code>{`validates :title, presence: true
validates :title, length: { minimum: 1, maximum: 100 }
validates :priority, numericality: { greater_than: 0 }
validates :status, inclusion: { in: ["draft", "published"] }
validate :custom_check_method`}</code></pre>
        <p>Check validity:</p>
        <pre><code>{`todo = Todo.new({ title: "" })
todo.valid?    #=> false
todo.errors    #=> ["title can't be blank"]`}</code></pre>
      </section>

      <section className="panel guide-section">
        <h2>Enum</h2>
        <p>Map integer columns to named values with predicate and bang methods.</p>
        <pre><code>{`enum :status, [:pending, :in_progress, :done]

todo.status        #=> :pending (symbol)
todo.status_value  #=> 0 (integer)
todo.pending?      #=> true
todo.done!         # sets status to 2
Todo.statuses      #=> { "pending"=>0, "in_progress"=>1, "done"=>2 }`}</code></pre>
      </section>

      <section className="panel guide-section">
        <h2>Scopes</h2>
        <p>Define reusable, chainable query fragments.</p>
        <pre><code>{`scope :pending, -> { where(status: 0) }
scope :high_priority, -> { where(priority: 3) }
scope :by_category, ->(id) { where(category_id: id) }

Todo.pending.order("id DESC").all(c.db)
Todo.high_priority.by_category(1).all(c.db)`}</code></pre>
      </section>

      <section className="panel guide-section">
        <h2>Associations</h2>
        <p>Define relationships between models.</p>
        <pre><code>{`class Category < Homura::Model
  has_many :todos
end

class Todo < Homura::Model
  belongs_to :category
end

category.todos(c.db)    # SELECT * FROM todos WHERE category_id = ?
todo.category(c.db)     # SELECT * FROM categories WHERE id = ?`}</code></pre>
      </section>

      <section className="panel guide-section">
        <h2>Callbacks</h2>
        <p>Hook into the model lifecycle. Supports <code>before/after</code> for <code>validation</code>, <code>save</code>, <code>create</code>, <code>update</code>, <code>destroy</code>.</p>
        <pre><code>{`before_save :update_timestamp

def update_timestamp
  @attributes[:updated_at] = Time.now.to_i.to_s
end`}</code></pre>
      </section>

      <section className="panel guide-section">
        <h2>Query Extensions</h2>
        <pre><code>{`# where.not
Todo.where.not(status: 2).all(c.db)

# pluck (returns flat array)
Todo.pluck(:title, c.db)  #=> ["Buy coffee", "Write tests"]

# ids
Todo.ids(c.db)  #=> [1, 2, 3]

# exists?
Todo.where(title: "X").exists?(c.db)  #=> true/false

# find_by
Todo.find_by(c.db, title: "X")  # first match or nil

# find_or_create_by
Todo.find_or_create_by(c.db, title: "X")

# count / order / limit / offset
Todo.where(status: 0).count(c.db)
Todo.order("id DESC").limit(10).offset(20).all(c.db)`}</code></pre>
      </section>

      <section className="panel guide-section">
        <h2>Dirty Tracking</h2>
        <p>Track attribute changes before saving.</p>
        <pre><code>{`todo = Todo.find(c.db, 1)
todo.title = "New title"

todo.changed?           #=> true
todo.title_changed?     #=> true
todo.title_was          #=> "Old title"
todo.changes            #=> { title: ["Old title", "New title"] }
todo.changed_attributes #=> [:title]`}</code></pre>
      </section>

      <section className="panel guide-section">
        <h2>This App's Models</h2>
        <p>The Todo app you're using right now demonstrates all these features:</p>
        <pre><code>{`class Category < Homura::Model
  table :categories
  validates :name, presence: true, length: { minimum: 1, maximum: 50 }
  has_many :todos
  before_save :strip_name
end

class Todo < Homura::Model
  table :todos
  validates :title, presence: true, length: { minimum: 1, maximum: 100 }
  belongs_to :category
  enum :status, [:pending, :in_progress, :done]
  scope :pending, -> { where(status: 0) }
  scope :done, -> { where(status: 2) }
  scope :high_priority, -> { where(priority: 3) }
  before_save :update_timestamp
end`}</code></pre>
      </section>

      <section className="panel guide-section">
        <h2>JSON API Endpoints</h2>
        <p>This app also exposes JSON APIs demonstrating ORM features:</p>
        <ul style="list-style: none; padding: 0;">
          <li><code>GET /api/stats</code> - count + scopes</li>
          <li><code>GET /api/todos</code> - JSON list</li>
          <li><code>GET /api/todos/pluck-titles</code> - pluck demo</li>
          <li><code>GET /api/todos/ids</code> - ids demo</li>
          <li><code>GET /api/todos/query/exists?title=...</code> - exists? demo</li>
          <li><code>POST /api/todos/find-or-create</code> - find_or_create_by demo</li>
          <li><code>GET /api/todos/not-done</code> - where.not demo</li>
          <li><code>PUT /api/todos/:id/track-changes</code> - dirty tracking demo</li>
        </ul>
      </section>
    </div>
  </>
);

// ===== Template registry =====
const templates: Record<string, (props: Props) => string> = {
  index: (props) => renderToString(
    <Layout title="Homura Todo" activePage="index">
      <IndexPage {...props} />
    </Layout>
  ),
  new: (props) => renderToString(
    <Layout title="New Todo - Homura Todo" activePage="index">
      <NewPage {...props} />
    </Layout>
  ),
  edit: (props) => renderToString(
    <Layout title="Edit Todo - Homura Todo" activePage="index">
      <EditPage {...props} />
    </Layout>
  ),
  categories: (props) => renderToString(
    <Layout title="Categories - Homura Todo" activePage="categories">
      <CategoriesPage {...props} />
    </Layout>
  ),
  guide: (props) => renderToString(
    <Layout title="ORM Guide - Homura Todo" activePage="guide">
      <GuidePage {...props} />
    </Layout>
  ),
};

export function renderTemplate(name: string, locals: Record<string, unknown>): string {
  const renderer = templates[name];
  if (!renderer) {
    return renderToString(
      <Layout title="Homura Todo - Not Found">
        <div className="empty-state">
          <h3>Template not found</h3>
          <p>Missing template: {name}</p>
        </div>
      </Layout>
    );
  }
  return renderer(locals as Props);
}
