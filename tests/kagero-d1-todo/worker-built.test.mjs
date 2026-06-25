import assert from "node:assert/strict";
import test from "node:test";

import worker from "../../examples/kagero-d1-todo/build/worker.entrypoint.mjs";

function createFakeD1() {
  const rows = [
    { id: 1, title: "Ship Kagero Page", done: 0, created_at: 1 },
    { id: 2, title: "Keep JavaScript hidden", done: 1, created_at: 2 },
  ];

  function unquoteSql(value) {
    if (value == null) return "";
    return String(value).replace(/^'/, "").replace(/'$/, "").replace(/''/g, "'");
  }

  function valuesFromInsert(sql) {
    const match = sql.match(/VALUES\s*\((.*)\)\s*$/i);
    if (!match) return [];
    const values = [];
    let current = "";
    let quoted = false;

    for (let i = 0; i < match[1].length; i += 1) {
      const char = match[1][i];
      const next = match[1][i + 1];
      if (char === "'" && quoted && next === "'") {
        current += "''";
        i += 1;
      } else if (char === "'") {
        quoted = !quoted;
        current += char;
      } else if (char === "," && !quoted) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    if (current.length > 0) values.push(current.trim());
    return values;
  }

  function idFromWhere(sql, bindings) {
    if (bindings.length > 0) return Number(bindings[0]);
    const match = sql.match(/WHERE\s+\(?`?id`?\s*=\s*(\d+)/i);
    return match ? Number(match[1]) : Number.NaN;
  }

  return {
    rows,
    prepare(sql) {
      const statement = {
        _sql: sql,
        _bindings: [],
        bind(...args) {
          this._bindings = args;
          return this;
        },
        all() {
          if (/PRAGMA\s+table_xinfo/i.test(this._sql)) {
            return Promise.resolve({
              results: [
                { name: "id", type: "integer", notnull: 1, dflt_value: null, pk: 1 },
                { name: "title", type: "text", notnull: 1, dflt_value: null, pk: 0 },
                { name: "done", type: "boolean", notnull: 1, dflt_value: "0", pk: 0 },
                { name: "created_at", type: "integer", notnull: 1, dflt_value: null, pk: 0 },
              ],
            });
          }

          return Promise.resolve({
            results: rows.slice().sort((a, b) => b.id - a.id),
          });
        },
        run() {
          if (/INSERT\s+INTO/i.test(this._sql)) {
            const values = valuesFromInsert(this._sql);
            const id = Math.max(0, ...rows.map((row) => row.id)) + 1;
            rows.push({
              id,
              title: this._bindings.length > 0 ? String(this._bindings[0] ?? "") : unquoteSql(values[0]),
              done: this._bindings.length > 1 ? Number(this._bindings[1] ?? 0) : Number(values[1] ?? 0),
              created_at: this._bindings.length > 2 ? Number(this._bindings[2] ?? 0) : Number(values[2] ?? 0),
            });
            return Promise.resolve({ success: true, meta: { changes: 1, last_row_id: id } });
          }

          if (/UPDATE/i.test(this._sql)) {
            const id = idFromWhere(this._sql, this._bindings);
            const row = rows.find((item) => item.id === id);
            if (row) row.done = row.done === 1 ? 0 : 1;
            return Promise.resolve({ success: true, meta: { changes: row ? 1 : 0 } });
          }

          if (/DELETE/i.test(this._sql)) {
            const id = idFromWhere(this._sql, this._bindings);
            const index = rows.findIndex((item) => item.id === id);
            if (index >= 0) rows.splice(index, 1);
            return Promise.resolve({ success: true, meta: { changes: index >= 0 ? 1 : 0 } });
          }

          return Promise.resolve({ success: true, meta: { changes: 0 } });
        },
      };

      return statement;
    },
  };
}

function createEnv() {
  const db = createFakeD1();
  return {
    DB: db,
    "cloudflare.DB": db,
    "cloudflare.env": {},
  };
}

async function callWorker(path, { method = "GET", body, headers } = {}, env) {
  const request = new Request(`https://example.test${path}`, {
    method,
    headers,
    body,
  });

  return worker.fetch(request, env, { waitUntil() {} });
}

test("GET / renders Kagero shell with Ruby Page HTML and hidden runtime", async () => {
  const env = createEnv();
  const response = await callWorker("/", {}, env);
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(text.startsWith("<!doctype html>"), true);
  assert.match(text, /data-kagero-root/);
  assert.match(text, /window\.Kagero/);
  assert.match(text, /Ruby-way Inertia experience on Workers/);
  assert.match(text, /Ship Kagero Page/);
  assert.match(text, /data-kagero="true"/);
  assert.match(text, /data-kagero-reload="true"/);
});

test("X-Inertia GET returns a page object with Kagero html props", async () => {
  const env = createEnv();
  const response = await callWorker(
    "/",
    {
      headers: {
        "X-Inertia": "true",
        "X-Inertia-Version": "kagero-1",
      },
    },
    env,
  );
  const page = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Inertia"), "true");
  assert.equal(page.component, "Todos/Index");
  assert.equal(page.version, "kagero-1");
  assert.equal(page.props.todos.length, 2);
  assert.equal(page.props.stats.total, 2);
  assert.match(page.props.kagero.html, /Keep JavaScript hidden/);
});

test("POST routes mutate fake D1 and return the next Kagero page object", async () => {
  const env = createEnv();

  const createResponse = await callWorker(
    "/todos",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "X-Inertia": "true",
        "X-Inertia-Version": "kagero-1",
      },
      body: new URLSearchParams({ title: "No userland JavaScript" }),
    },
    env,
  );

  const createPage = await createResponse.json();
  assert.equal(createResponse.status, 200);
  assert.equal(createResponse.headers.get("X-Inertia"), "true");
  assert.equal(env.DB.rows.at(-1).title, "No userland JavaScript");
  assert.equal(createPage.url, "/");
  assert.match(createPage.props.kagero.html, /No userland JavaScript/);

  const toggleResponse = await callWorker(
    "/todos/1/toggle",
    {
      method: "POST",
      headers: { "X-Inertia": "true", "X-Inertia-Version": "kagero-1" },
    },
    env,
  );
  assert.equal(toggleResponse.status, 200);
  assert.equal(toggleResponse.headers.get("X-Inertia"), "true");
  assert.equal(env.DB.rows.find((row) => row.id === 1).done, 1);

  const deleteResponse = await callWorker(
    "/todos/2/delete",
    {
      method: "POST",
      headers: { "X-Inertia": "true", "X-Inertia-Version": "kagero-1" },
    },
    env,
  );
  assert.equal(deleteResponse.status, 200);
  assert.equal(deleteResponse.headers.get("X-Inertia"), "true");
  assert.equal(env.DB.rows.some((row) => row.id === 2), false);
});

test("version mismatch returns Inertia 409 hard-reload signal", async () => {
  const env = createEnv();
  const response = await callWorker(
    "/",
    {
      headers: {
        "X-Inertia": "true",
        "X-Inertia-Version": "old-version",
      },
    },
    env,
  );

  assert.equal(response.status, 409);
  assert.equal(response.headers.get("X-Inertia-Location"), "https://example.test/");
});
