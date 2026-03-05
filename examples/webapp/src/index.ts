/**
 * Homura Example Webapp
 * Demonstrates the Homura Ruby DSL framework for Cloudflare Workers
 *
 * Security: Request handling uses MessagePack (homura_handle_request),
 * NOT eval, to prevent code injection.
 */

// Import the compiled mruby.wasm from the framework
import mrubyWasm from '../../../mruby/build/mruby.wasm';
import { renderTemplate } from './templates.tsx';
import { HOMURA_CORE, USER_ROUTES } from './ruby-bundle';
import { APP_CSS } from './styles-bundle';

// ─── MessagePack Encoder/Decoder ───────────────────────────────────

function mpEncodeStr(parts: number[], str: string): void {
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length;
  if (len <= 31) {
    parts.push(0xa0 | len);
  } else if (len <= 0xff) {
    parts.push(0xd9, len);
  } else if (len <= 0xffff) {
    parts.push(0xda, (len >> 8) & 0xff, len & 0xff);
  } else {
    parts.push(0xdb, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff);
  }
  for (let i = 0; i < bytes.length; i++) parts.push(bytes[i]);
}

function mpEncodeInt(parts: number[], val: number): void {
  if (val >= 0 && val <= 0x7f) {
    parts.push(val);
  } else if (val >= 0 && val <= 0xff) {
    parts.push(0xcc, val);
  } else if (val >= 0 && val <= 0xffff) {
    parts.push(0xcd, (val >> 8) & 0xff, val & 0xff);
  } else if (val >= 0) {
    parts.push(0xce, (val >> 24) & 0xff, (val >> 16) & 0xff, (val >> 8) & 0xff, val & 0xff);
  } else if (val >= -32) {
    parts.push(val & 0xff);
  } else if (val >= -128) {
    parts.push(0xd0, val & 0xff);
  } else if (val >= -32768) {
    parts.push(0xd1, (val >> 8) & 0xff, val & 0xff);
  } else {
    parts.push(0xd2, (val >> 24) & 0xff, (val >> 16) & 0xff, (val >> 8) & 0xff, val & 0xff);
  }
}

function mpEncodeValue(parts: number[], value: unknown): void {
  if (value === null || value === undefined) {
    parts.push(0xc0);
  } else if (value === true) {
    parts.push(0xc3);
  } else if (value === false) {
    parts.push(0xc2);
  } else if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      mpEncodeInt(parts, value);
    } else {
      // float64
      parts.push(0xcb);
      const buf = new ArrayBuffer(8);
      new DataView(buf).setFloat64(0, value, false);
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < 8; i++) parts.push(bytes[i]);
    }
  } else if (typeof value === 'string') {
    mpEncodeStr(parts, value);
  } else if (Array.isArray(value)) {
    const len = value.length;
    if (len <= 15) {
      parts.push(0x90 | len);
    } else if (len <= 0xffff) {
      parts.push(0xdc, (len >> 8) & 0xff, len & 0xff);
    } else {
      parts.push(0xdd, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff);
    }
    for (const item of value) mpEncodeValue(parts, item);
  } else if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const len = entries.length;
    if (len <= 15) {
      parts.push(0x80 | len);
    } else if (len <= 0xffff) {
      parts.push(0xde, (len >> 8) & 0xff, len & 0xff);
    } else {
      parts.push(0xdf, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff);
    }
    for (const [k, v] of entries) {
      mpEncodeStr(parts, k);
      mpEncodeValue(parts, v);
    }
  }
}

function mpEncode(value: unknown): Uint8Array {
  const parts: number[] = [];
  mpEncodeValue(parts, value);
  return new Uint8Array(parts);
}

class MpDecoder {
  private data: Uint8Array;
  private pos: number;

  constructor(data: Uint8Array) {
    this.data = data;
    this.pos = 0;
  }

  private readU8(): number {
    return this.data[this.pos++];
  }

  private readU16(): number {
    const v = (this.data[this.pos] << 8) | this.data[this.pos + 1];
    this.pos += 2;
    return v;
  }

  private readU32(): number {
    const v = (this.data[this.pos] << 24) | (this.data[this.pos + 1] << 16) |
              (this.data[this.pos + 2] << 8) | this.data[this.pos + 3];
    this.pos += 4;
    return v >>> 0;
  }

  private readStr(len: number): string {
    const bytes = this.data.slice(this.pos, this.pos + len);
    this.pos += len;
    return new TextDecoder().decode(bytes);
  }

  decode(): unknown {
    const b = this.readU8();

    // positive fixint
    if (b <= 0x7f) return b;
    // negative fixint
    if (b >= 0xe0) return b - 256;
    // fixmap
    if ((b & 0xf0) === 0x80) return this.decodeMap(b & 0x0f);
    // fixarray
    if ((b & 0xf0) === 0x90) return this.decodeArray(b & 0x0f);
    // fixstr
    if ((b & 0xe0) === 0xa0) return this.readStr(b & 0x1f);

    switch (b) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xcc: return this.readU8();
      case 0xcd: return this.readU16();
      case 0xce: return this.readU32();
      case 0xd0: { const v = this.readU8(); return v > 127 ? v - 256 : v; }
      case 0xd1: { const v = this.readU16(); return v > 32767 ? v - 65536 : v; }
      case 0xd2: { const v = this.readU32(); return v > 2147483647 ? v - 4294967296 : v; }
      case 0xd9: return this.readStr(this.readU8());
      case 0xda: return this.readStr(this.readU16());
      case 0xdb: return this.readStr(this.readU32());
      // bin8/16/32 - treat as string
      case 0xc4: return this.readStr(this.readU8());
      case 0xc5: return this.readStr(this.readU16());
      case 0xc6: return this.readStr(this.readU32());
      case 0xcb: {
        const buf = new ArrayBuffer(8);
        const view = new Uint8Array(buf);
        for (let i = 0; i < 8; i++) view[i] = this.data[this.pos++];
        return new DataView(buf).getFloat64(0, false);
      }
      case 0xcf: {
        // uint64 - read as number (may lose precision for very large values)
        const hi = this.readU32();
        const lo = this.readU32();
        return hi * 0x100000000 + lo;
      }
      case 0xd3: {
        // int64
        const hi = this.readU32();
        const lo = this.readU32();
        const val = hi * 0x100000000 + lo;
        return hi & 0x80000000 ? val - 0x10000000000000000 : val;
      }
      case 0xdc: return this.decodeArray(this.readU16());
      case 0xdd: return this.decodeArray(this.readU32());
      case 0xde: return this.decodeMap(this.readU16());
      case 0xdf: return this.decodeMap(this.readU32());
      default: return null;
    }
  }

  private decodeMap(count: number): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (let i = 0; i < count; i++) {
      const key = String(this.decode());
      result[key] = this.decode();
    }
    return result;
  }

  private decodeArray(count: number): unknown[] {
    const result: unknown[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.decode());
    }
    return result;
  }
}

function mpDecode(data: Uint8Array): unknown {
  try {
    return new MpDecoder(data).decode();
  } catch (e) {
    throw new Error(`MessagePack decode failed (${data.length} bytes): ${e instanceof Error ? e.message : String(e)}`);
  }
}

interface RubyResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  type?: string;
  template?: string;
  props?: Record<string, unknown>;
  kv_ops?: Array<{ op: string; key: string; value?: string }>;
}

function validateRubyResponse(raw: unknown): RubyResponse {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Invalid Ruby response: expected object, got ${typeof raw}`);
  }
  const obj = raw as Record<string, unknown>;
  const status = typeof obj.status === 'number' ? obj.status : 200;
  const headers = (typeof obj.headers === 'object' && obj.headers !== null)
    ? obj.headers as Record<string, string>
    : {};
  return {
    status,
    headers,
    body: obj.body,
    type: typeof obj.type === 'string' ? obj.type : undefined,
    template: typeof obj.template === 'string' ? obj.template : undefined,
    props: (typeof obj.props === 'object' && obj.props !== null) ? obj.props as Record<string, unknown> : undefined,
    kv_ops: Array.isArray(obj.kv_ops) ? obj.kv_ops : undefined,
  };
}

// ─── Longjmp support for wasm-sjlj ────────────────────────────────

class WasmLongjmpException {
  constructor(public buf: number, public value: number) {}
}

const jmpBufRegistry = new Map<number, { label: number; sp: number }>();
let labelCounter = 1;

// ─── mruby instance wrapper ───────────────────────────────────────

class MRuby {
  private instance: WebAssembly.Instance | null = null;

  async init(): Promise<void> {
    if (this.instance) return;

    const getMemory = (): WebAssembly.Memory => {
      return this.instance!.exports.memory as WebAssembly.Memory;
    };

    const wasiImports = {
      clock_res_get: (id: number, resPtr: number) => {
        try {
          const memory = getMemory();
          const view = new DataView(memory.buffer);
          view.setBigUint64(resPtr, BigInt(1000000), true);
        } catch (e) { console.warn('[wasi] clock_res_get error:', e); }
        return 0;
      },
      clock_time_get: (id: number, precision: bigint, timePtr: number) => {
        try {
          const memory = getMemory();
          const view = new DataView(memory.buffer);
          view.setBigUint64(timePtr, BigInt(Date.now()) * BigInt(1000000), true);
        } catch (e) { console.warn('[wasi] clock_time_get error:', e); }
        return 0;
      },
      fd_write: (fd: number, iovs: number, iovsLen: number, nwritten: number) => {
        try {
          const memory = getMemory();
          const view = new DataView(memory.buffer);
          const decoder = new TextDecoder();
          let written = 0;
          for (let i = 0; i < iovsLen; i++) {
            const ptr = view.getUint32(iovs + i * 8, true);
            const len = view.getUint32(iovs + i * 8 + 4, true);
            const bytes = new Uint8Array(memory.buffer, ptr, len);
            const str = decoder.decode(bytes);
            if (fd === 1) console.log('[mruby]', str);
            if (fd === 2) console.error('[mruby]', str);
            written += len;
          }
          view.setUint32(nwritten, written, true);
        } catch (e) { console.warn('[wasi] fd_write error:', e); }
        return 0;
      },
      fd_read: () => 0,
      fd_close: () => 0,
      fd_seek: () => 0,
      fd_advise: () => 0,
      fd_allocate: () => 0,
      fd_datasync: () => 0,
      fd_sync: () => 0,
      fd_pread: () => 0,
      fd_pwrite: () => 0,
      fd_readdir: () => 0,
      fd_renumber: () => 0,
      fd_tell: () => 0,
      fd_filestat_get: () => 0,
      fd_filestat_set_size: () => 0,
      fd_filestat_set_times: () => 0,
      fd_fdstat_get: (fd: number, statPtr: number) => {
        try {
          const memory = getMemory();
          const view = new DataView(memory.buffer);
          view.setUint8(statPtr, fd <= 2 ? 2 : 4);
          view.setUint16(statPtr + 2, 0, true);
          view.setBigUint64(statPtr + 8, BigInt(0xffffffff), true);
          view.setBigUint64(statPtr + 16, BigInt(0xffffffff), true);
        } catch (e) { console.warn('[wasi] fd_fdstat_get error:', e); }
        return 0;
      },
      fd_fdstat_set_flags: () => 0,
      fd_fdstat_set_rights: () => 0,
      fd_prestat_get: () => 8,
      fd_prestat_dir_name: () => 8,
      path_create_directory: () => 0,
      path_filestat_get: () => 0,
      path_filestat_set_times: () => 0,
      path_link: () => 0,
      path_readlink: () => 0,
      path_remove_directory: () => 0,
      path_rename: () => 0,
      path_symlink: () => 0,
      path_unlink_file: () => 0,
      path_open: () => 44,
      environ_get: () => 0,
      environ_sizes_get: (countPtr: number, sizePtr: number) => {
        try {
          const memory = getMemory();
          const view = new DataView(memory.buffer);
          view.setUint32(countPtr, 0, true);
          view.setUint32(sizePtr, 0, true);
        } catch (e) { console.warn('[wasi] environ_sizes_get error:', e); }
        return 0;
      },
      args_get: () => 0,
      args_sizes_get: (countPtr: number, sizePtr: number) => {
        try {
          const memory = getMemory();
          const view = new DataView(memory.buffer);
          view.setUint32(countPtr, 0, true);
          view.setUint32(sizePtr, 0, true);
        } catch (e) { console.warn('[wasi] args_sizes_get error:', e); }
        return 0;
      },
      proc_exit: (code: number) => {
        console.error('[mruby] proc_exit:', code);
        throw new Error(`mruby proc_exit: ${code}`);
      },
      random_get: (buf: number, bufLen: number) => {
        try {
          const memory = getMemory();
          const bytes = new Uint8Array(memory.buffer, buf, bufLen);
          crypto.getRandomValues(bytes);
        } catch (e) { console.warn('[wasi] random_get error:', e); }
        return 0;
      },
      poll_oneoff: () => 0,
      sched_yield: () => 0,
      sock_accept: () => 0,
      sock_recv: () => 0,
      sock_send: () => 0,
      sock_shutdown: () => 0,
    };

    const envImports = {
      __wasm_setjmp: (buf: number, sp: number): void => {
        const label = labelCounter++;
        jmpBufRegistry.set(buf, { label, sp });
        const memory = this.instance!.exports.memory as WebAssembly.Memory;
        const view = new DataView(memory.buffer);
        view.setInt32(buf, label, true);
        view.setInt32(buf + 4, sp, true);
      },
      __wasm_longjmp: (buf: number, value: number): void => {
        throw new WasmLongjmpException(buf, value || 1);
      },
      __wasm_setjmp_test: (buf: number, curLabel: number): number => {
        const memory = this.instance!.exports.memory as WebAssembly.Memory;
        const view = new DataView(memory.buffer);
        const storedLabel = view.getInt32(buf, true);
        if (storedLabel === curLabel) {
          return view.getInt32(buf + 8, true);
        }
        return 0;
      },
    };

    this.instance = new WebAssembly.Instance(mrubyWasm, {
      wasi_snapshot_preview1: wasiImports,
      env: envImports,
    });

    const exports = this.instance.exports as any;
    const result = exports.homura_init();
    if (!result) {
      throw new Error('Failed to initialize mruby VM');
    }
  }

  /**
   * Evaluate Ruby code string. Used ONLY for loading framework core
   * and user routes (trusted code). NEVER for user input.
   */
  eval(code: string): string {
    if (!this.instance) throw new Error('mruby not initialized');

    const exports = this.instance.exports as any;
    const memory = this.instance.exports.memory as WebAssembly.Memory;
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const bufferPtr = exports.homura_get_input_buffer();
    const bufferSize = exports.homura_get_buffer_size();

    const codeBytes = encoder.encode(code + '\0');
    if (codeBytes.length > bufferSize) {
      throw new Error(`Code too large: ${codeBytes.length} > ${bufferSize}`);
    }

    new Uint8Array(memory.buffer).set(codeBytes, bufferPtr);

    try {
      exports.homura_eval();
    } catch (e) {
      if (e instanceof WasmLongjmpException) {
        console.error('[homura] Ruby exception (longjmp) during eval');
        return JSON.stringify({ error: 'Ruby exception during code loading' });
      }
      throw e;
    }

    const currentMemory = this.instance.exports.memory as WebAssembly.Memory;
    const resultPtr = exports.homura_get_result();
    const memoryView = new Uint8Array(currentMemory.buffer);
    let resultEnd = resultPtr;
    while (memoryView[resultEnd] !== 0 && resultEnd < resultPtr + bufferSize) {
      resultEnd++;
    }

    return decoder.decode(new Uint8Array(currentMemory.buffer, resultPtr, resultEnd - resultPtr));
  }

  /**
   * Handle a request via MessagePack serialization (safe from injection).
   * Sends env as MessagePack → homura_handle_request → returns decoded response.
   */
  handleRequest(env: Record<string, unknown>): Record<string, unknown> {
    if (!this.instance) throw new Error('mruby not initialized');

    const exports = this.instance.exports as any;
    const memory = this.instance.exports.memory as WebAssembly.Memory;

    const encoded = mpEncode(env);
    const bufferPtr = exports.homura_get_input_buffer();
    const bufferSize = exports.homura_get_buffer_size();

    if (encoded.length > bufferSize) {
      return { status: 413, body: 'Request too large', headers: { 'Content-Type': 'text/plain' } };
    }

    new Uint8Array(memory.buffer).set(encoded, bufferPtr);

    let success: number;
    try {
      success = exports.homura_handle_request(encoded.length);
    } catch (e) {
      if (e instanceof WasmLongjmpException) {
        console.error('[homura] Ruby exception (longjmp) during request handling');
        return { status: 500, body: 'Ruby exception occurred', headers: { 'Content-Type': 'text/plain' } };
      }
      throw e;
    }

    const outputPtr = exports.homura_get_output_buffer();
    const outputLen = exports.homura_get_output_length();

    if (!success || outputLen <= 0) {
      return { status: 500, body: 'Internal Server Error', headers: { 'Content-Type': 'text/plain' } };
    }

    const outputData = new Uint8Array(memory.buffer, outputPtr, outputLen);
    const result = mpDecode(outputData) as Record<string, unknown>;
    return result;
  }

  close(): void {
    if (this.instance) {
      const exports = this.instance.exports as any;
      exports.homura_close();
      this.instance = null;
    }
  }
}

// ─── Worker Entry ─────────────────────────────────────────────────

interface Env {
  HOMURA_KV: KVNamespace;
  HOMURA_DB?: D1Database;
}

// ─── D1 To-Do API Handler ─────────────────────────────────────────

function requireJsonContentType(request: Request): Response | null {
  const ct = request.headers.get('Content-Type') || '';
  if (!ct.includes('application/json')) {
    return new Response(JSON.stringify({ error: 'Content-Type must be application/json' }), {
      status: 415, headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleTodoApi(request: Request, url: URL, env: Env): Promise<Response> {
  const jsonHeaders = { 'Content-Type': 'application/json' };

  if (!env.HOMURA_DB) {
    return new Response(JSON.stringify({ error: 'D1 database not configured' }), {
      status: 500, headers: jsonHeaders,
    });
  }

  const db = env.HOMURA_DB;
  const method = request.method;
  const idMatch = url.pathname.match(/^\/api\/todos\/(\d+)$/);
  const todoId = idMatch ? parseInt(idMatch[1], 10) : null;

  // Fix 3: Content-Type validation for write methods
  if (method === 'POST' || method === 'PUT') {
    const ctError = requireJsonContentType(request);
    if (ctError) return ctError;
  }

  try {
    // GET /api/todos - List all todos
    if (method === 'GET' && url.pathname === '/api/todos') {
      const result = await db.prepare('SELECT * FROM todos ORDER BY created_at DESC').all();
      return new Response(JSON.stringify(result.results), { headers: jsonHeaders });
    }

    // POST /api/todos - Create a todo
    if (method === 'POST' && url.pathname === '/api/todos') {
      // Fix 5: JSON parse failure → 400
      const bodyOrError = await parseJsonBody(request);
      if (bodyOrError instanceof Response) return bodyOrError;
      const body = bodyOrError as { title?: string };
      if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
        return new Response(JSON.stringify({ error: 'title is required' }), {
          status: 400, headers: jsonHeaders,
        });
      }
      const result = await db.prepare('INSERT INTO todos (title) VALUES (?)').bind(body.title.trim()).run();
      const todo = await db.prepare('SELECT * FROM todos WHERE id = ?').bind(result.meta.last_row_id).first();
      return new Response(JSON.stringify(todo), { status: 201, headers: jsonHeaders });
    }

    // PUT /api/todos/:id - Toggle completed
    if (method === 'PUT' && todoId !== null) {
      const existing = await db.prepare('SELECT * FROM todos WHERE id = ?').bind(todoId).first();
      if (!existing) {
        return new Response(JSON.stringify({ error: 'Todo not found' }), {
          status: 404, headers: jsonHeaders,
        });
      }
      // Fix 2: JSON parse failure → 400 (not silent catch)
      const bodyOrError = await parseJsonBody(request);
      if (bodyOrError instanceof Response) return bodyOrError;
      const body = bodyOrError as { completed?: boolean; title?: string };
      // Fix 6: title validation
      if (body.title !== undefined) {
        if (typeof body.title !== 'string' || body.title.trim() === '') {
          return new Response(JSON.stringify({ error: 'title must be a non-empty string' }), {
            status: 400, headers: jsonHeaders,
          });
        }
      }
      const newCompleted = body.completed !== undefined ? (body.completed ? 1 : 0) : (existing.completed ? 0 : 1);
      const newTitle = body.title !== undefined ? body.title.trim() : existing.title;
      await db.prepare('UPDATE todos SET completed = ?, title = ? WHERE id = ?').bind(newCompleted, newTitle, todoId).run();
      const updated = await db.prepare('SELECT * FROM todos WHERE id = ?').bind(todoId).first();
      return new Response(JSON.stringify(updated), { headers: jsonHeaders });
    }

    // DELETE /api/todos/:id - Delete a todo
    if (method === 'DELETE' && todoId !== null) {
      const existing = await db.prepare('SELECT * FROM todos WHERE id = ?').bind(todoId).first();
      if (!existing) {
        return new Response(JSON.stringify({ error: 'Todo not found' }), {
          status: 404, headers: jsonHeaders,
        });
      }
      await db.prepare('DELETE FROM todos WHERE id = ?').bind(todoId).run();
      return new Response(JSON.stringify({ deleted: true, id: todoId }), { headers: jsonHeaders });
    }

    return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: jsonHeaders });
  } catch (e) {
    console.error('[homura d1] error:', e);
    // Fix 5: Don't expose internal error details in 5xx responses
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500, headers: jsonHeaders,
    });
  }
}

let mruby: MRuby | null = null;
let coreLoaded = false;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Serve static assets directly (CSS)
    if (url.pathname === '/assets/app.css') {
      return new Response(APP_CSS, {
        headers: { 'Content-Type': 'text/css' },
      });
    }

    // ─── D1 To-Do API (handled directly in JS) ───────────────────
    if (url.pathname.startsWith('/api/todos')) {
      return handleTodoApi(request, url, env);
    }

    // ─── Home page: To-Do app (D1 + JSX) ───────────────────────
    if (url.pathname === '/' && request.method === 'GET') {
      let todos: unknown[] = [];
      if (env.HOMURA_DB) {
        try {
          const result = await env.HOMURA_DB.prepare('SELECT * FROM todos ORDER BY created_at DESC').all();
          todos = result.results;
        } catch (e) {
          console.error('[homura d1] home page query error:', e);
        }
      }
      const html = renderTemplate('home', { todos: JSON.stringify(todos) });
      return new Response(html, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    try {
      // Initialize mruby VM
      if (!mruby) {
        mruby = new MRuby();
        await mruby.init();
      }

      // Load framework core and user routes (trusted code, eval is safe here)
      if (!coreLoaded) {
        const coreResult = mruby.eval(HOMURA_CORE);
        if (coreResult.includes('"error"')) {
          console.error('[homura] Failed to load core:', coreResult);
          mruby = null;
          return new Response('Framework initialization failed', { status: 500 });
        }
        const routeResult = mruby.eval(USER_ROUTES);
        if (routeResult.includes('"error"')) {
          console.error('[homura] Failed to load routes:', routeResult);
          mruby = null;
          return new Response('Route loading failed', { status: 500 });
        }
        coreLoaded = true;
      }

      // Read request body for write methods
      let bodyStr = '';
      if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
        bodyStr = await request.text();
      }

      // Fix 7: Pre-fetch KV data for routes that need it
      const kvData: Record<string, string> = {};
      if (env.HOMURA_KV) {
        // /counter needs "counter" key
        if (url.pathname === '/counter') {
          const val = await env.HOMURA_KV.get('counter');
          if (val !== null) kvData['counter'] = val;
        }
        // /kv/users/:name needs "user:NAME" key
        const kvUserMatch = url.pathname.match(/^\/kv\/users\/([^/]+)$/);
        if (kvUserMatch && request.method === 'GET') {
          const key = `user:${decodeURIComponent(kvUserMatch[1])}`;
          const val = await env.HOMURA_KV.get(key);
          if (val !== null) kvData[key] = val;
        }
      }

      // Build env as structured data (NO string interpolation / eval)
      const rubyEnv: Record<string, unknown> = {
        method: request.method,
        path: url.pathname,
        body: bodyStr,
        content_type: request.headers.get('Content-Type') || '',
        kv_data: kvData,
      };

      // Handle request via MessagePack (safe from injection)
      const rawResult = mruby.handleRequest(rubyEnv);
      const result = validateRubyResponse(rawResult);

      const { status, headers } = result;

      // Handle KV operations from Ruby side
      const kvOps = result.kv_ops;
      if (kvOps && kvOps.length > 0 && env.HOMURA_KV) {
        ctx.waitUntil(
          (async () => {
            for (const op of kvOps) {
              try {
                if (op.op === 'put' && op.value !== undefined) {
                  await env.HOMURA_KV.put(op.key, op.value);
                } else if (op.op === 'delete') {
                  await env.HOMURA_KV.delete(op.key);
                }
              } catch (e) {
                console.error('[homura kv] error:', op, e);
              }
            }
          })()
        );
      }

      // Handle JSX template rendering
      if (result.type === 'jsx') {
        const templateName = result.template as string;
        const props = (result.props as Record<string, unknown>) || {};
        const html = renderTemplate(templateName, props);
        return new Response(html, {
          status,
          headers: { ...headers, 'Content-Type': 'text/html' },
        });
      }

      const responseBody = typeof result.body === 'object'
        ? JSON.stringify(result.body)
        : String(result.body ?? '');

      return new Response(responseBody, { status, headers });

    } catch (error) {
      console.error('Homura error:', error);
      return new Response(
        JSON.stringify({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : String(error),
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  },
};
