import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import worker from "../../examples/agent-workspace/worker.entrypoint.mjs";

const STORAGE_OFFLOAD_THRESHOLD = 2048;

function createFakeStorage() {
  const db = new DatabaseSync(":memory:");
  const kv = new Map();
  const sql = {
    databaseSize: 0,
    exec(query, ...params) {
      const statement = db.prepare(query);
      if (/^(SELECT|WITH|PRAGMA)\b/i.test(query.trim())) {
        return statement.all(...params);
      }

      statement.run(...params);
      return [];
    },
  };

  return {
    sql,
    get(key) {
      return Promise.resolve(kv.has(key) ? kv.get(key) : null);
    },
    put(key, value) {
      kv.set(key, value);
      return Promise.resolve();
    },
  };
}

function createFakeBucket() {
  const map = new Map();
  const decoder = new TextDecoder();

  function toBytes(body) {
    if (body instanceof Uint8Array) return body;
    return new TextEncoder().encode(body == null ? "" : String(body));
  }

  return {
    _map: map,
    get(key) {
      if (!map.has(key)) return Promise.resolve(null);
      const value = map.get(key);
      return Promise.resolve({
        key,
        size: value.body.byteLength,
        etag: `etag:${key}`,
        httpMetadata: { contentType: value.contentType },
        async text() {
          return decoder.decode(value.body);
        },
        async arrayBuffer() {
          return value.body.buffer.slice(
            value.body.byteOffset,
            value.body.byteOffset + value.body.byteLength,
          );
        },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(value.body);
            controller.close();
          },
        }),
      });
    },
    put(key, body, opts = {}) {
      const contentType =
        opts?.httpMetadata?.contentType ?? "application/octet-stream";
      map.set(key, {
        body: toBytes(body),
        contentType,
      });
      return Promise.resolve();
    },
    delete(key) {
      map.delete(key);
      return Promise.resolve();
    },
  };
}

function createFakeEnv() {
  const env = {};
  const bucket = createFakeBucket();
  const states = new Map();

  function ensureState(key) {
    if (!states.has(key)) {
      states.set(key, {
        id: {
          toString() {
            return key;
          },
        },
        storage: createFakeStorage(),
      });
    }
    return states.get(key);
  }

  env.BUCKET = bucket;
  env["cloudflare.BUCKET"] = bucket;
  env["cloudflare.env"] = env;
  env.WORKSPACE = {
    idFromName(name) {
      const key = `workspace::${String(name)}`;
      return {
        toString() {
          return key;
        },
      };
    },
    newUniqueId() {
      const key = `workspace::unique::${states.size + 1}`;
      return {
        toString() {
          return key;
        },
      };
    },
    idFromString(hex) {
      const key = String(hex);
      return {
        toString() {
          return key;
        },
      };
    },
    get(id) {
      const key = id?.toString ? id.toString() : String(id);
      return {
        fetch(url, init = {}) {
          const request = new Request(String(url), {
            method: init.method ?? "GET",
            headers: init.headers ?? {},
            body: init.body,
          });
          const body = init.body == null ? "" : String(init.body);
          return globalThis.__HOMURA_DO_DISPATCH__(
            "HomuraCounterDO",
            ensureState(key),
            env,
            request,
            body,
          );
        },
      };
    },
  };

  env.__bucket = bucket;
  return env;
}

async function callWorker(path, { method = "GET", body, headers } = {}, env) {
  const request = new Request(`https://example.test${path}`, {
    method,
    headers,
    body,
  });
  return worker.fetch(request, env, { waitUntil() {} });
}

test("GET / returns the workspace UI", async () => {
  const env = createFakeEnv();
  const response = await callWorker("/", {}, env);
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.match(text, /agent-workspace/);
  assert.match(text, /persistent scrollback over the current Worker-backed workspace/);
  assert.match(text, /demo:\/ \$</);
  assert.doesNotMatch(text, /Useful endpoints/);
});

test("POST /shell shows stacked terminal history before the snapshot without help cards", async () => {
  const env = createFakeEnv();
  const body = new URLSearchParams({
    workspace: "demo",
    command: 'write /notes.txt "hello from homura"',
  });

  const response = await callWorker(
    "/shell",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    },
    env,
  );
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /<div class="terminal-title">terminal<\/div>/);
  assert.match(text, /\$ write \/notes\.txt &quot;hello from homura&quot;/);
  assert.match(text, /wrote \/notes\.txt/);
  assert.ok(text.indexOf('<div class="terminal-title">terminal</div>') < text.indexOf('<div class="terminal-title">files</div>'));
  assert.doesNotMatch(text, /<h2>Commands<\/h2>/);
  assert.doesNotMatch(text, /Useful endpoints/);
});

test("terminal history accumulates across commands", async () => {
  const env = createFakeEnv();

  await callWorker(
    "/api/workspaces/demo/command",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: 'write /notes.txt "hello from homura"' }),
    },
    env,
  );

  await callWorker(
    "/api/workspaces/demo/command",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "cat /notes.txt" }),
    },
    env,
  );

  const response = await callWorker("/", {}, env);
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /\$ write \/notes\.txt &quot;hello from homura&quot;/);
  assert.match(text, /\$ cat \/notes\.txt/);
  assert.ok(text.indexOf("$ write /notes.txt") < text.indexOf("$ cat /notes.txt"));
});

test("the shell backend supports pipes over workspace files", async () => {
  const env = createFakeEnv();

  await callWorker(
    "/api/workspaces/demo/command",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: 'write /notes.txt "hello from homura"' }),
    },
    env,
  );

  const response = await callWorker(
    "/api/workspaces/demo/command",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "grep homura /notes.txt | wc -l" }),
    },
    env,
  );
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.equal(json.exit_code, 0);
  assert.match(json.output, /\b1\b/);
});

test("small writes stay inline in the Durable Object snapshot", async () => {
  const env = createFakeEnv();

  const commandResponse = await callWorker(
    "/api/workspaces/demo/command",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: 'write /notes.txt "hello from homura"' }),
    },
    env,
  );
  const commandJson = await commandResponse.json();

  const snapshotResponse = await callWorker("/api/workspaces/demo", {}, env);
  const snapshotJson = await snapshotResponse.json();
  const entry = snapshotJson.entries.find((row) => row.path === "/notes.txt");

  assert.equal(commandResponse.status, 200);
  assert.match(commandJson.output, /inline/);
  assert.equal(snapshotResponse.status, 200);
  assert.equal(entry?.storage, "inline");
  assert.equal(env.__bucket._map.size, 0);
});

test("large writes spill into R2 and can be read back", async () => {
  const env = createFakeEnv();
  const large = "x".repeat(STORAGE_OFFLOAD_THRESHOLD + 64);

  const commandResponse = await callWorker(
    "/api/workspaces/demo/command",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: `write /large.txt "${large}"` }),
    },
    env,
  );
  const commandJson = await commandResponse.json();

  const snapshotResponse = await callWorker("/api/workspaces/demo", {}, env);
  const snapshotJson = await snapshotResponse.json();
  const entry = snapshotJson.entries.find((row) => row.path === "/large.txt");

  const readResponse = await callWorker(
    "/workspaces/demo/files/large.txt",
    {},
    env,
  );
  const readBody = await readResponse.text();

  assert.equal(commandResponse.status, 200);
  assert.match(commandJson.output, /r2/i);
  assert.equal(entry?.storage, "r2");
  assert.equal(env.__bucket._map.size, 1);
  assert.equal(readResponse.status, 200);
  assert.match(readResponse.headers.get("content-type") ?? "", /text\/plain/);
  assert.equal(readBody, large);
});

test("rm deletes the file and clears the R2 object", async () => {
  const env = createFakeEnv();
  const large = "y".repeat(STORAGE_OFFLOAD_THRESHOLD + 64);

  await callWorker(
    "/api/workspaces/demo/command",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: `write /trash.txt "${large}"` }),
    },
    env,
  );

  const deleteResponse = await callWorker(
    "/api/workspaces/demo/command",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "rm /trash.txt" }),
    },
    env,
  );
  const deleteJson = await deleteResponse.json();

  const snapshotResponse = await callWorker("/api/workspaces/demo", {}, env);
  const snapshotJson = await snapshotResponse.json();

  assert.equal(deleteResponse.status, 200);
  assert.equal(deleteJson.exit_code, 0);
  assert.equal(
    snapshotJson.entries.some((row) => row.path === "/trash.txt"),
    false,
  );
  assert.equal(env.__bucket._map.size, 0);
});
