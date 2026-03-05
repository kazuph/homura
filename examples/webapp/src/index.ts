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

// Homura MessagePack v2 contract: request/response/control are
// transported as a single typed envelope and all app routing is in Ruby.
// D1 API方針: A継続実行ループ（Rubyがd1_opsを要求し続行し、TSが実行して再投入）
const HOMURA_MSGPACK_VERSION = 2;
const HOMURA_LOOP_STRATEGY = 'continue-loop';

const MAX_MP_SIZE = 256 * 1024;
const MAX_MP_ARRAY = 2000;
const MAX_MP_MAP = 512;
const MAX_HEADER_COUNT = 200;
const MAX_LOOP_ITERATIONS = 16;
const MAX_OPS_PER_LOOP = 64;
const MAX_SQL_LENGTH = 5000;
const MAX_SQL_BIND_COUNT = 64;

interface RubyRequestEnvelope {
  v: number;
  request: {
    // v2必須: method/path/body/content_type
    method: string;
    path: string;
    // query は空オブジェクト可
    query: Record<string, string>;
    headers: Record<string, string>;
    body: string;
    content_type: string;
    // 既存kvプリフェッチ（将来継続実行ループと共通化）
    kv_data: Record<string, string>;
  };
  control?: {
    // 継続実行ループ時のみ true
    continue?: boolean;
    // 次回再開時に実行するops
    ops?: unknown[];
  };
}

type KvOp = { op: 'put' | 'delete'; key: string; value?: string };
type D1OpBase = { op: 'all' | 'first' | 'run' | 'exec' | 'get'; sql: string; binds?: unknown[] };
type D1BatchOp = { op: 'all' | 'first' | 'run' | 'exec' | 'get'; sql: string; binds?: unknown[] };
type D1BatchItem = { op: 'batch' | 'transaction'; statements: D1BatchOp[] };
type D1Op = D1OpBase | D1BatchItem;
type RubyLoopOp = (KvOp | D1Op) & { kind?: 'kv' | 'd1' };

interface RubyResponse {
  v: number;
  // status は 100-599 の整数のみ許可
  status: number;
  // headers は map<string,string> のみ許可
  headers: Record<string, string>;
  // body は JSON互換型を許可
  body: unknown;
  type?: string;
  template?: string;
  props?: Record<string, unknown>;
  kv_ops?: Array<{ op: string; key: string; value?: string }>;
  d1_ops?: D1Op[];
  control?: {
    continue?: boolean;
    ops?: unknown[];
  };
}

interface LoopOpResult {
  kind: 'kv' | 'd1';
  op: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  duration_ms?: number;
}

interface LoopExecutionSummary {
  kind: 'kv' | 'd1';
  status: 'ok' | 'error';
  count: number;
  duration_ms: number;
  errors: string[];
}

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

  public getPos(): number {
    return this.pos;
  }

  private ensure(n: number): void {
    if (this.pos + n > this.data.length) {
      throw new Error(`MessagePack decode truncated at ${this.pos}, need ${n} bytes`);
    }
  }

  private readU8(): number {
    this.ensure(1);
    return this.data[this.pos++];
  }

  private readU16(): number {
    this.ensure(2);
    const v = (this.data[this.pos] << 8) | this.data[this.pos + 1];
    this.pos += 2;
    return v;
  }

  private readU32(): number {
    this.ensure(4);
    const v = (this.data[this.pos] << 24) | (this.data[this.pos + 1] << 16) |
              (this.data[this.pos + 2] << 8) | this.data[this.pos + 3];
    this.pos += 4;
    return v >>> 0;
  }

  private readStr(len: number): string {
    this.ensure(len);
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
      case 0xca: {
        this.ensure(4);
        const buf = new ArrayBuffer(4);
        const view = new Uint8Array(buf);
        for (let i = 0; i < 4; i++) view[i] = this.data[this.pos++];
        return new DataView(buf).getFloat32(0, false);
      }
      case 0xcb: {
        this.ensure(8);
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
      case 0xdc: {
        const count = this.readU16();
        if (count > MAX_MP_ARRAY) throw new Error(`MessagePack decode array too large: ${count}`);
        return this.decodeArray(count);
      }
      case 0xdd: {
        const count = this.readU32();
        if (count > MAX_MP_ARRAY) throw new Error(`MessagePack decode array too large: ${count}`);
        return this.decodeArray(count);
      }
      case 0xde: {
        const count = this.readU16();
        if (count > MAX_MP_MAP) throw new Error(`MessagePack decode map too large: ${count}`);
        return this.decodeMap(count);
      }
      case 0xdf: {
        const count = this.readU32();
        if (count > MAX_MP_MAP) throw new Error(`MessagePack decode map too large: ${count}`);
        return this.decodeMap(count);
      }
      default:
        throw new Error(`Unknown MessagePack prefix: 0x${b.toString(16)}`);
    }
  }

  private decodeMap(count: number): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (let i = 0; i < count; i++) {
      const key = this.decode();
      if (typeof key !== 'string') {
        throw new Error(`MessagePack decode map key is not string: ${typeof key}`);
      }
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
    if (data.length > MAX_MP_SIZE) {
      throw new Error(`MessagePack payload exceeds maximum ${MAX_MP_SIZE} bytes`);
    }
    const decoder = new MpDecoder(data);
    const value = decoder.decode();
    if (decoder.getPos() !== data.length) {
      throw new Error(`MessagePack trailing bytes: ${data.length - decoder.getPos()}`);
    }
    return value;
  } catch (e) {
    throw new Error(`MessagePack decode failed (${data.length} bytes): ${e instanceof Error ? e.message : String(e)}`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createRequestId(request: Request): string {
  const xRequestId = request.headers.get('x-request-id');
  if (xRequestId && xRequestId.trim()) {
    return xRequestId;
  }
  if ('randomUUID' in crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `homura-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseKvPrefetchKeys(path: string): string[] {
  const keys = new Set<string>();

  if (path === '/counter' || path === '/counter/reset') {
    keys.add('counter');
  }

  const userMatch = path.match(/^\/kv\/users\/([^/?#]+)$/);
  if (userMatch && userMatch[1]) {
    try {
      keys.add(`user:${decodeURIComponent(userMatch[1])}`);
    } catch (e) {
      keys.add(`user:${userMatch[1]}`);
    }
  }

  return Array.from(keys);
}

async function prefetchKvData(env: Env, path: string): Promise<Record<string, string>> {
  const kvData: Record<string, string> = {};
  if (!env.HOMURA_KV) {
    return kvData;
  }

  const keys = parseKvPrefetchKeys(path);
  for (const key of keys) {
    const value = await env.HOMURA_KV.get(key);
    if (value !== null && value !== undefined) {
      kvData[key] = value;
    }
  }
  return kvData;
}

function summarizeLoopResults(results: LoopOpResult[]): LoopExecutionSummary[] {
  const summary = new Map<string, LoopExecutionSummary>();
  for (const result of results) {
    const key = `${result.kind}:${result.op}`;
    const current = summary.get(key) || {
      kind: result.kind,
      status: 'ok',
      count: 0,
      duration_ms: 0,
      errors: [],
    };

    current.count += 1;
    current.duration_ms += result.duration_ms || 0;
    if (!result.ok) {
      current.status = 'error';
      current.errors.push(result.error || 'unknown error');
    }
    summary.set(key, current);
  }
  return Array.from(summary.values());
}

function validateStringRecord(value: unknown, label: string): Record<string, string> {
  if (!isPlainObject(value)) {
    throw new Error(`Invalid ${label}: expected object`);
  }
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, v] of Object.entries(value)) {
    count++;
    if (count > MAX_HEADER_COUNT) {
      throw new Error(`Invalid ${label}: too many entries`);
    }
    if (typeof key !== 'string') {
      throw new Error(`Invalid ${label} key: ${String(key)}`);
    }
    if (typeof v !== 'string') {
      throw new Error(`Invalid ${label} value for "${key}": expected string`);
    }
    out[key] = v;
  }
  return out;
}

function validateResponseBody(value: unknown, path: string): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => validateResponseBody(item, `${path}[${index}]`));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof key !== 'string') {
        throw new Error(`Invalid response body key at ${path}: ${String(key)}`);
      }
      out[key] = validateResponseBody(item, `${path}.${key}`);
    }
    return out;
  }
  throw new Error(`Invalid response body at ${path}: ${typeof value}`);
}

function validateBindings(raw: unknown, path: string): unknown[] {
  if (!Array.isArray(raw)) {
    throw new Error(`Invalid ${path}: expected array`);
  }
  if (raw.length > MAX_SQL_BIND_COUNT) {
    throw new Error(`Invalid ${path}: bind count too large`);
  }
  return raw;
}

function validateKvOp(raw: unknown, path: string): KvOp {
  if (!isPlainObject(raw)) {
    throw new Error(`Invalid ${path}: expected object`);
  }
  const op = typeof raw.op === 'string' ? raw.op : undefined;
  const key = typeof raw.key === 'string' ? raw.key : undefined;
  const value = raw.value;
  if (op !== 'put' && op !== 'delete') {
    throw new Error(`Invalid ${path}.op: ${String(op)}`);
  }
  if (!key) {
    throw new Error(`Invalid ${path}.key`);
  }
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`Invalid ${path}.value`);
  }
  return { op, key, value: typeof value === 'string' ? value : undefined };
}

function validateD1Op(raw: unknown, path: string): D1Op {
  if (!isPlainObject(raw)) {
    throw new Error(`Invalid ${path}: expected object`);
  }
  const op = typeof raw.op === 'string' ? raw.op : undefined;
  if (!op || !['all', 'first', 'get', 'run', 'exec', 'batch', 'transaction'].includes(op)) {
    throw new Error(`Invalid ${path}.op: ${String(op)}`);
  }

  if (op === 'batch' || op === 'transaction') {
    const statements = Array.isArray((raw as Record<string, unknown>).statements)
      ? (raw as Record<string, unknown>).statements
      : undefined;
    if (!Array.isArray(statements)) {
      throw new Error(`Invalid ${path}.statements: expected array`);
    }
    if (statements.length > MAX_OPS_PER_LOOP) {
      throw new Error(`Invalid ${path}.statements: too many statements`);
    }
    const normalizedStatements = statements.map((stmt, idx) => {
      const normalized = validateD1Op(stmt, `${path}.statements[${idx}]`);
      if (!normalized || normalized.op === 'batch' || normalized.op === 'transaction') {
        throw new Error(`Invalid ${path}.statements[${idx}].op`);
      }
      return normalized;
    });
    return { op, statements: normalizedStatements };
  }

  const sql = typeof raw.sql === 'string' ? raw.sql : undefined;
  if (!sql) {
    throw new Error(`Invalid ${path}.sql`);
  }
  if (sql.length > MAX_SQL_LENGTH) {
    throw new Error(`Invalid ${path}.sql: too long`);
  }
  const binds = raw.binds === undefined ? [] : validateBindings(raw.binds, `${path}.binds`);
  return { op, sql, binds };
}

function normalizeResponseControl(raw: unknown): RubyRequestEnvelope['control'] {
  if (raw === undefined) return { continue: false, ops: [] };
  if (!isPlainObject(raw)) {
    throw new Error('Invalid response.control: expected object');
  }
  const continueValue = raw.continue;
  if (continueValue !== undefined && typeof continueValue !== 'boolean') {
    throw new Error('Invalid response.control.continue: expected boolean');
  }
  const continueRequested = continueValue === true;
  const continueOps = raw.ops === undefined ? [] : raw.ops;
  if (!Array.isArray(continueOps)) {
    throw new Error('Invalid response.control.ops: expected array');
  }
  if ((raw as Record<string, unknown>).ops !== undefined && !Array.isArray(raw.ops)) {
    throw new Error('Invalid response.control.ops: expected array');
  }
  if (continueOps.length > MAX_OPS_PER_LOOP) {
    throw new Error(`Too many control operations: ${continueOps.length}`);
  }
  return { continue: continueRequested, ops: continueOps };
}

function validateRubyResponse(raw: unknown): RubyResponse {
  if (!isPlainObject(raw)) {
    throw new Error(`Invalid Ruby response: expected object, got ${typeof raw}`);
  }
  const obj = raw as Record<string, unknown>;
  if (obj.v !== HOMURA_MSGPACK_VERSION) {
    throw new Error(`Invalid Ruby response version: expected ${HOMURA_MSGPACK_VERSION}, got ${String(obj.v)}`);
  }
  if (typeof obj.status !== 'number' || !Number.isInteger(obj.status) || obj.status < 100 || obj.status > 599) {
    throw new Error(`Invalid Ruby response status: ${String(obj.status)}`);
  }
  const allowedTopLevel = new Set([
    'v',
    'status',
    'headers',
    'body',
    'type',
    'template',
    'props',
    'kv_ops',
    'd1_ops',
    'control',
  ]);
  for (const key of Object.keys(obj)) {
    if (!allowedTopLevel.has(key)) {
      throw new Error(`Invalid Ruby response key: ${key}`);
    }
  }
  const headers = validateStringRecord(obj.headers, 'response.headers');
  const body = 'body' in obj ? validateResponseBody(obj.body, 'response.body') : '';
  const type = obj.type === undefined ? undefined : (typeof obj.type === 'string'
    ? obj.type
    : (() => { throw new Error('Invalid response.type: expected string'); })());
  const template = obj.template === undefined ? undefined : (typeof obj.template === 'string'
    ? obj.template
    : (() => { throw new Error('Invalid response.template: expected string'); })());
  const props = obj.props === undefined ? undefined : (isPlainObject(obj.props)
    ? obj.props as Record<string, unknown>
    : (() => { throw new Error('Invalid response.props: expected object'); })());
  const kvOps = obj.kv_ops === undefined
    ? undefined
    : Array.isArray(obj.kv_ops)
      ? obj.kv_ops.map((op, idx) => {
          if (!isPlainObject(op)) {
            throw new Error(`Invalid kv_op[${idx}]`);
          }
          if (typeof op.op !== 'string' || typeof op.key !== 'string') {
            throw new Error(`Invalid kv_op[${idx}]`);
          }
          if (op.value !== undefined && typeof op.value !== 'string') {
            throw new Error(`Invalid kv_op[${idx}].value`);
          }
          return {
            op: op.op,
            key: op.key,
            value: typeof op.value === 'string' ? op.value : undefined,
          };
        })
      : undefined;
  const d1Ops = obj.d1_ops === undefined
    ? undefined
    : Array.isArray(obj.d1_ops)
      ? obj.d1_ops.map((op, idx) => validateD1Op(op, `response.d1_ops[${idx}]`))
      : undefined;
  const control = obj.control === undefined
    ? undefined
    : {
        continue: normalizeResponseControl(obj.control).continue,
        ops: normalizeResponseControl(obj.control).ops,
      };

  return {
    v: HOMURA_MSGPACK_VERSION,
    status: obj.status,
    headers,
    body,
    type,
    template,
    props,
    kv_ops: kvOps,
    d1_ops: d1Ops,
    control,
  };
}

function normalizeLoopOps(rawOps: unknown[]): RubyLoopOp[] {
  const out: RubyLoopOp[] = [];
  for (let i = 0; i < rawOps.length; i++) {
    const raw = rawOps[i];
    if (!isPlainObject(raw)) {
      throw new Error(`Invalid control operation at index ${i}: expected object`);
    }

    const explicitKind = typeof raw.kind === 'string' ? raw.kind : undefined;
    const rawOp = typeof raw.op === 'string' ? raw.op : undefined;
    const opName = rawOp || '';

    if (explicitKind === 'kv' || opName === 'put' || opName === 'delete') {
      out.push({
        kind: 'kv',
        ...validateKvOp(raw, `control.ops[${i}]`),
      });
      continue;
    }

    if (explicitKind === 'd1') {
      const d1Op = validateD1Op(raw, `control.ops[${i}]`);
      out.push({ kind: 'd1', ...d1Op });
      continue;
    }

    if (opName.startsWith('d1_')) {
      const normalized = validateD1Op(
        {
          ...raw,
          op: opName.replace(/^d1_/, ''),
          sql: raw.sql,
          binds: raw.binds,
        },
        `control.ops[${i}]`,
      );
      out.push({ kind: 'd1', ...normalized });
      continue;
    }

    throw new Error(`Invalid control.ops[${i}].kind/op: unsupported operation`);
  }
  return out;
}

async function executeKvOps(env: Env, ops: Array<KvOp | D1Op>): Promise<LoopOpResult[]> {
  const out: LoopOpResult[] = [];
  if (!ops || ops.length === 0) return out;
  for (const rawOp of ops) {
    const start = performance.now();
    if (rawOp.op !== 'put' && rawOp.op !== 'delete') {
      out.push({
        kind: 'kv',
        op: rawOp.op,
        ok: false,
        error: `Invalid kv op: ${rawOp.op}`,
        duration_ms: Math.round((performance.now() - start) * 100) / 100,
      });
      continue;
    }
    if (!env.HOMURA_KV) {
      throw new Error('HOMURA_KV binding missing for kv operation');
    }
    try {
      if (rawOp.op === 'put') {
        await env.HOMURA_KV.put(rawOp.key, rawOp.value ?? '');
      } else if (rawOp.op === 'delete') {
        await env.HOMURA_KV.delete(rawOp.key);
      }
      out.push({
        kind: 'kv',
        op: rawOp.op,
        ok: true,
        duration_ms: Math.round((performance.now() - start) * 100) / 100,
      });
    } catch (e) {
      out.push({
        kind: 'kv',
        op: rawOp.op,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        duration_ms: Math.round((performance.now() - start) * 100) / 100,
      });
    }
  }
  return out;
}

async function executeD1Ops(env: Env, ops: D1Op[]): Promise<LoopOpResult[]> {
  const out: LoopOpResult[] = [];
  if (!ops || ops.length === 0) return out;
  if (!env.HOMURA_DB) {
    throw new Error('HOMURA_DB binding missing for D1 operation');
  }

  const normalizeRunResult = (result: unknown): { [key: string]: unknown } | null => {
    if (!result || typeof result !== 'object') {
      return null;
    }
    const runResult = result as Record<string, unknown>;
    const meta = isPlainObject(runResult.meta) ? (runResult.meta as Record<string, unknown>) : {};
    const affectedRows = typeof meta.changes === 'number' ? meta.changes : undefined;
    const lastRowId = typeof meta.last_row_id === 'number' ? meta.last_row_id : undefined;
    return {
      ...runResult,
      affected_rows: affectedRows,
      last_row_id: lastRowId,
    };
  };

  const executeSingle = async (rawOp: D1Op): Promise<{ ok: boolean; result?: unknown; error?: string }> => {
    if (rawOp.op !== 'batch' && rawOp.op !== 'transaction') {
      if (typeof rawOp.sql !== 'string' || rawOp.sql.length > MAX_SQL_LENGTH) {
        throw new Error('D1 SQL exceeds limit');
      }
      if (rawOp.binds && rawOp.binds.length > MAX_SQL_BIND_COUNT) {
        throw new Error('D1 bind count exceeds limit');
      }
    }

    try {
      if (rawOp.op === 'batch' || rawOp.op === 'transaction') {
        const statements = rawOp.statements || [];
        if (rawOp.op === 'transaction') {
          await env.HOMURA_DB.prepare('BEGIN').run();
        }
        const statementResults: Array<{ op: string; ok: boolean; result?: unknown; error?: string }> = [];
        for (const stmt of statements) {
          if (typeof stmt.sql !== 'string' || stmt.sql.length > MAX_SQL_LENGTH) {
            throw new Error('D1 SQL exceeds limit');
          }
          if (stmt.binds && stmt.binds.length > MAX_SQL_BIND_COUNT) {
            throw new Error('D1 bind count exceeds limit');
          }

          const statement = env.HOMURA_DB.prepare(stmt.sql).bind(...(stmt.binds ?? []));
          if (stmt.op === 'all') {
            const result = await statement.all();
            statementResults.push({ op: stmt.op, ok: true, result });
          } else if (stmt.op === 'first' || stmt.op === 'get') {
            const result = await statement.first();
            statementResults.push({ op: stmt.op, ok: true, result });
          } else if (stmt.op === 'run') {
            const result = await statement.run();
            statementResults.push({ op: stmt.op, ok: true, result: normalizeRunResult(result) ?? result });
          } else if (stmt.op === 'exec') {
            const result = await env.HOMURA_DB.exec(stmt.sql);
            statementResults.push({ op: stmt.op, ok: true, result });
          } else {
            throw new Error(`Unsupported D1 statement op: ${stmt.op}`);
          }
        }

        if (rawOp.op === 'transaction') {
          await env.HOMURA_DB.prepare('COMMIT').run();
        }

        return { ok: true, result: statementResults };
      }

      const statement = env.HOMURA_DB.prepare(rawOp.sql).bind(...(rawOp.binds ?? []));
      if (rawOp.op === 'all') {
        const result = await statement.all();
        return { ok: true, result };
      }
      if (rawOp.op === 'get' || rawOp.op === 'first') {
        const result = await statement.first();
        return { ok: true, result };
      }
      if (rawOp.op === 'run') {
        const result = await statement.run();
        return { ok: true, result: normalizeRunResult(result) ?? result };
      }
      if (rawOp.op === 'exec') {
        const result = await env.HOMURA_DB.exec(rawOp.sql);
        return { ok: true, result };
      }
      return { ok: false, error: `Unsupported D1 op: ${rawOp.op}` };
    } catch (e) {
      if (rawOp.op === 'transaction') {
        try { await env.HOMURA_DB.prepare('ROLLBACK').run(); } catch {}
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  for (const op of ops) {
    const start = performance.now();
    try {
      const outcome = await executeSingle(op);
      if (outcome.ok && op.op === 'run') {
        if (outcome.result && typeof outcome.result === 'object' && outcome.result !== null) {
          const runResult = outcome.result as Record<string, unknown>;
          const meta = isPlainObject(runResult.meta) ? (runResult.meta as Record<string, unknown>) : {};
          const affectedRows = typeof meta.changes === 'number' ? meta.changes : undefined;
          const lastRowId = typeof meta.last_row_id === 'number' ? meta.last_row_id : undefined;
          outcome.result = {
            ...runResult,
            affected_rows: affectedRows,
            last_row_id: lastRowId,
          };
        }
      }
      out.push({ kind: 'd1', op: op.op, ...outcome, duration_ms: Math.round((performance.now() - start) * 100) / 100 });
    } catch (e) {
      out.push({
        kind: 'd1',
        op: op.op,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        duration_ms: Math.round((performance.now() - start) * 100) / 100,
      });
    }
  }
  return out;
}

async function executeLoopOps(env: Env, result: RubyResponse): Promise<LoopOpResult[]> {
  const kvOps: KvOp[] = (result.kv_ops ?? []).map((op) => ({ ...op, kind: 'kv' as const })) as KvOp[];
  const d1Ops: D1Op[] = result.d1_ops ?? [];
  const controlOps = result.control?.ops ? normalizeLoopOps(result.control.ops) : [];

  const mergedOps = [
    ...kvOps.map((op): RubyLoopOp => ({ kind: 'kv', ...op })),
    ...d1Ops.map((op): RubyLoopOp => ({ kind: 'd1', ...op })),
    ...controlOps,
  ];
  if (mergedOps.length > MAX_OPS_PER_LOOP) {
    throw new Error(`Too many operations in one loop: ${mergedOps.length}`);
  }

  const kvOnly = mergedOps.filter((op): op is RubyLoopOp & KvOp => op.kind === 'kv');
  const d1Only = mergedOps.filter((op): op is RubyLoopOp & D1Op => op.kind === 'd1');

  const kvResults = await executeKvOps(env, kvOnly as KvOp[]);
  const d1Results = await executeD1Ops(env, d1Only as D1Op[]);
  return [...kvResults, ...d1Results];
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
  handleRequest(env: RubyRequestEnvelope): RubyResponse {
    if (!this.instance) throw new Error('mruby not initialized');

    const exports = this.instance.exports as any;
    const memory = this.instance.exports.memory as WebAssembly.Memory;

    const encoded = mpEncode(env);
    const bufferPtr = exports.homura_get_input_buffer();
    const bufferSize = exports.homura_get_buffer_size();

    if (encoded.length > bufferSize || encoded.length > MAX_MP_SIZE) {
      return {
        v: HOMURA_MSGPACK_VERSION,
        status: 413,
        headers: { 'Content-Type': 'text/plain' },
        body: 'Request too large',
      };
    }

    new Uint8Array(memory.buffer).set(encoded, bufferPtr);

    let success: number;
    try {
      success = exports.homura_handle_request(encoded.length);
    } catch (e) {
      if (e instanceof WasmLongjmpException) {
        console.error('[homura] Ruby exception (longjmp) during request handling');
        return {
          v: HOMURA_MSGPACK_VERSION,
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
          body: 'Ruby exception occurred',
        };
      }
      throw e;
    }

    const outputPtr = exports.homura_get_output_buffer();
    const outputLen = exports.homura_get_output_length();

    if (!success || outputLen <= 0) {
      return {
        v: HOMURA_MSGPACK_VERSION,
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
        body: 'Internal Server Error',
      };
    }

    const outputData = new Uint8Array(memory.buffer, outputPtr, outputLen);
    const result = mpDecode(outputData);
    return validateRubyResponse(result);
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

let mruby: MRuby | null = null;
let coreLoaded = false;

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const requestId = createRequestId(request);
    const requestLogBase = {
      event: 'homura_request_start',
      request_id: requestId,
      method: request.method,
      path: url.pathname,
      strategy: HOMURA_LOOP_STRATEGY,
    };

    console.info(JSON.stringify(requestLogBase));

    try {
      const method = request.method;
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
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        bodyStr = await request.text();
      }

      const kvData = await prefetchKvData(env, url.pathname);

      // Build env as structured data (NO string interpolation / eval)
      const rubyEnv: RubyRequestEnvelope = {
        v: HOMURA_MSGPACK_VERSION,
        request: {
          method,
          path: url.pathname,
          query: Object.fromEntries(url.searchParams.entries()),
          headers: Object.fromEntries(request.headers.entries()),
          body: bodyStr,
          content_type: request.headers.get('Content-Type') || '',
          kv_data: kvData,
        },
        control: { continue: false },
      };

      let loopCount = 0;
      let currentResult: RubyResponse | null = null;
      const rubyRequest = rubyEnv;
      let requestEnvelope: RubyRequestEnvelope = { ...rubyRequest, control: { continue: false } };
      let totalOperations = 0;
      let totalLoopMs = 0;
      const totalFailures: string[] = [];

      while (true) {
        const rawResult = mruby.handleRequest(requestEnvelope);
        currentResult = validateRubyResponse(rawResult);
        const loopOps = await executeLoopOps(env, currentResult);
        const summary = summarizeLoopResults(loopOps);
        const loopMs = loopOps.reduce((acc, item) => acc + (item.duration_ms || 0), 0);
        const requestErrors = summary.flatMap((entry) => entry.errors);
        totalOperations += loopOps.length;
        totalLoopMs += loopMs;
        totalFailures.push(...requestErrors);

        console.info(
          JSON.stringify({
            event: 'homura_loop_exec',
            request_id: requestId,
            loop: loopCount + 1,
            d1_enabled: !!env.HOMURA_DB,
            operation_count: loopOps.length,
            d1_operation_count: summary.filter((entry) => entry.kind === 'd1').reduce((acc, entry) => acc + entry.count, 0),
            d1_ms: summary.filter((entry) => entry.kind === 'd1').reduce((acc, entry) => acc + entry.duration_ms, 0),
            kv_operation_count: summary.filter((entry) => entry.kind === 'kv').reduce((acc, entry) => acc + entry.count, 0),
            loop_ms: loopMs,
            failure_reasons: requestErrors,
          })
        );

        // continue loop のために操作は必ず実行。失敗時は全体500へ倒す。
        if (currentResult.control?.continue && loopOps.length === 0) {
          throw new Error('Continue requested but no operations returned');
        }
        if (loopCount >= MAX_LOOP_ITERATIONS) {
          throw new Error('Maximum loop iterations exceeded');
        }
        loopCount++;

        if (!currentResult.control?.continue) {
          break;
        }
        if (loopOps.length === 0) {
          throw new Error('Continue requested but no executable operations');
        }
        requestEnvelope = {
          ...rubyRequest,
          control: {
            continue: true,
            // Ruby側再実行時に、実行結果を渡す
            ops: loopOps,
          },
        };
      }

      if (!currentResult) {
        throw new Error('No response from Ruby runtime');
      }
      const result = currentResult;
      const { status, headers } = result;
      let response: Response;

      // Handle JSX template rendering
      if (result.type === 'jsx') {
        const templateName = result.template as string;
        const props = (result.props as Record<string, unknown>) || {};
        const html = renderTemplate(templateName, props);
        response = new Response(html, {
          status,
          headers: { ...headers, 'Content-Type': 'text/html' },
        });
      } else {
        const responseBody = typeof result.body === 'object'
          ? JSON.stringify(result.body)
          : String(result.body ?? '');
        response = new Response(responseBody, { status, headers });
      }
      console.info(JSON.stringify({
        event: 'homura_request_complete',
        request_id: requestId,
        path: url.pathname,
        status,
        loop_count: loopCount,
        total_op_count: totalOperations,
        total_loop_ms: totalLoopMs,
        failure_reasons: totalFailures,
      }));
      return response;

    } catch (error) {
      console.error(JSON.stringify({
        event: 'homura_request_error',
        request_id: requestId,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
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
