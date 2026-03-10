/**
 * Homura Template Engine example
 *
 * JSX-enabled Worker bridge:
 * - sends MessagePack request envelopes into mruby.wasm
 * - executes Ruby routes defined in app/routes.rb
 * - returns JSON, HTML, and JSX responses without KV or D1 bindings
 */

import mrubyWasm from '../../../mruby/build/mruby.wasm';
import { renderTemplate } from './templates.tsx';
import { APP_CSS } from './styles-bundle';
import { HOMURA_CORE, HOMURA_MODEL, USER_ROUTES } from './ruby-bundle';

const HOMURA_MSGPACK_VERSION = 2;
const MAX_MP_SIZE = 256 * 1024;
const MAX_MP_ARRAY = 2000;
const MAX_MP_MAP = 512;
const MAX_HEADER_COUNT = 200;
const MAX_OPS_PER_LOOP = 64;
const MAX_LONGJMP_RETRIES = 64;
const DEBUG_LONGJMP = false;

interface RubyRequestEnvelope {
  v: number;
  request: {
    method: string;
    path: string;
    query: Record<string, string>;
    headers: Record<string, string>;
    body: string;
    content_type: string;
    kv_data: Record<string, string>;
  };
  control?: {
    continue?: boolean;
    ops?: unknown[];
  };
}

interface RubyResponse {
  v: number;
  status: number;
  headers: Record<string, string>;
  body: unknown;
  type?: string;
  template?: string;
  props?: Record<string, unknown>;
  control?: {
    continue?: boolean;
    ops?: unknown[];
  };
}

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
  for (let i = 0; i < bytes.length; i++) {
    parts.push(bytes[i]);
  }
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
    return;
  }
  if (value === true) {
    parts.push(0xc3);
    return;
  }
  if (value === false) {
    parts.push(0xc2);
    return;
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      mpEncodeInt(parts, value);
    } else {
      parts.push(0xcb);
      const buf = new ArrayBuffer(8);
      new DataView(buf).setFloat64(0, value, false);
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) {
        parts.push(bytes[i]);
      }
    }
    return;
  }
  if (typeof value === 'string') {
    mpEncodeStr(parts, value);
    return;
  }
  if (Array.isArray(value)) {
    const len = value.length;
    if (len <= 15) {
      parts.push(0x90 | len);
    } else if (len <= 0xffff) {
      parts.push(0xdc, (len >> 8) & 0xff, len & 0xff);
    } else {
      parts.push(0xdd, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff);
    }
    for (const item of value) {
      mpEncodeValue(parts, item);
    }
    return;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const len = entries.length;
    if (len <= 15) {
      parts.push(0x80 | len);
    } else if (len <= 0xffff) {
      parts.push(0xde, (len >> 8) & 0xff, len & 0xff);
    } else {
      parts.push(0xdf, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff);
    }
    for (const [key, item] of entries) {
      mpEncodeStr(parts, key);
      mpEncodeValue(parts, item);
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
    const value = (this.data[this.pos] << 8) | this.data[this.pos + 1];
    this.pos += 2;
    return value;
  }

  private readU32(): number {
    this.ensure(4);
    const value = (this.data[this.pos] << 24) |
      (this.data[this.pos + 1] << 16) |
      (this.data[this.pos + 2] << 8) |
      this.data[this.pos + 3];
    this.pos += 4;
    return value >>> 0;
  }

  private readStr(len: number): string {
    this.ensure(len);
    const bytes = this.data.slice(this.pos, this.pos + len);
    this.pos += len;
    return new TextDecoder().decode(bytes);
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

  decode(): unknown {
    const byte = this.readU8();

    if (byte <= 0x7f) return byte;
    if (byte >= 0xe0) return byte - 256;
    if ((byte & 0xf0) === 0x80) return this.decodeMap(byte & 0x0f);
    if ((byte & 0xf0) === 0x90) return this.decodeArray(byte & 0x0f);
    if ((byte & 0xe0) === 0xa0) return this.readStr(byte & 0x1f);

    switch (byte) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xcc: return this.readU8();
      case 0xcd: return this.readU16();
      case 0xce: return this.readU32();
      case 0xd0: {
        const value = this.readU8();
        return value > 127 ? value - 256 : value;
      }
      case 0xd1: {
        const value = this.readU16();
        return value > 32767 ? value - 65536 : value;
      }
      case 0xd2: {
        const value = this.readU32();
        return value > 2147483647 ? value - 4294967296 : value;
      }
      case 0xd9: return this.readStr(this.readU8());
      case 0xda: return this.readStr(this.readU16());
      case 0xdb: return this.readStr(this.readU32());
      case 0xc4: return this.readStr(this.readU8());
      case 0xc5: return this.readStr(this.readU16());
      case 0xc6: return this.readStr(this.readU32());
      case 0xca: {
        this.ensure(4);
        const buf = new ArrayBuffer(4);
        const view = new Uint8Array(buf);
        for (let i = 0; i < 4; i++) {
          view[i] = this.data[this.pos++];
        }
        return new DataView(buf).getFloat32(0, false);
      }
      case 0xcb: {
        this.ensure(8);
        const buf = new ArrayBuffer(8);
        const view = new Uint8Array(buf);
        for (let i = 0; i < 8; i++) {
          view[i] = this.data[this.pos++];
        }
        return new DataView(buf).getFloat64(0, false);
      }
      case 0xcf: {
        const hi = this.readU32();
        const lo = this.readU32();
        return hi * 0x100000000 + lo;
      }
      case 0xd3: {
        const hi = this.readU32();
        const lo = this.readU32();
        const value = hi * 0x100000000 + lo;
        return hi & 0x80000000 ? value - 0x10000000000000000 : value;
      }
      case 0xdc: {
        const count = this.readU16();
        if (count > MAX_MP_ARRAY) {
          throw new Error(`MessagePack decode array too large: ${count}`);
        }
        return this.decodeArray(count);
      }
      case 0xdd: {
        const count = this.readU32();
        if (count > MAX_MP_ARRAY) {
          throw new Error(`MessagePack decode array too large: ${count}`);
        }
        return this.decodeArray(count);
      }
      case 0xde: {
        const count = this.readU16();
        if (count > MAX_MP_MAP) {
          throw new Error(`MessagePack decode map too large: ${count}`);
        }
        return this.decodeMap(count);
      }
      case 0xdf: {
        const count = this.readU32();
        if (count > MAX_MP_MAP) {
          throw new Error(`MessagePack decode map too large: ${count}`);
        }
        return this.decodeMap(count);
      }
      default:
        throw new Error(`Unknown MessagePack prefix: 0x${byte.toString(16)}`);
    }
  }
}

function mpDecode(data: Uint8Array): unknown {
  if (data.length > MAX_MP_SIZE) {
    throw new Error(`MessagePack payload exceeds maximum ${MAX_MP_SIZE} bytes`);
  }
  const decoder = new MpDecoder(data);
  const value = decoder.decode();
  if (decoder.getPos() !== data.length) {
    throw new Error(`MessagePack trailing bytes: ${data.length - decoder.getPos()}`);
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createRequestId(request: Request): string {
  const forwarded = request.headers.get('x-request-id');
  if (forwarded && forwarded.trim()) {
    return forwarded;
  }
  if ('randomUUID' in crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `json-transform-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function validateStringRecord(value: unknown, label: string): Record<string, string> {
  if (!isPlainObject(value)) {
    throw new Error(`Invalid ${label}: expected object`);
  }
  const result: Record<string, string> = {};
  let count = 0;
  for (const [key, item] of Object.entries(value)) {
    count += 1;
    if (count > MAX_HEADER_COUNT) {
      throw new Error(`Invalid ${label}: too many entries`);
    }
    if (typeof item !== 'string') {
      throw new Error(`Invalid ${label} value for "${key}": expected string`);
    }
    result[key] = item;
  }
  return result;
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
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = validateResponseBody(item, `${path}.${key}`);
    }
    return result;
  }
  throw new Error(`Invalid response body at ${path}: ${typeof value}`);
}

function normalizeResponseControl(raw: unknown): RubyRequestEnvelope['control'] {
  if (raw === undefined) {
    return { continue: false, ops: [] };
  }
  if (!isPlainObject(raw)) {
    throw new Error('Invalid response.control: expected object');
  }
  const continueValue = raw.continue;
  if (continueValue !== undefined && typeof continueValue !== 'boolean') {
    throw new Error('Invalid response.control.continue: expected boolean');
  }
  const continueOps = raw.ops === undefined ? [] : raw.ops;
  if (!Array.isArray(continueOps)) {
    throw new Error('Invalid response.control.ops: expected array');
  }
  if (continueOps.length > MAX_OPS_PER_LOOP) {
    throw new Error(`Too many control operations: ${continueOps.length}`);
  }
  return {
    continue: continueValue === true,
    ops: continueOps,
  };
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
    'control',
  ]);
  for (const key of Object.keys(obj)) {
    if (!allowedTopLevel.has(key)) {
      throw new Error(`Invalid Ruby response key: ${key}`);
    }
  }

  const type = obj.type === undefined
    ? undefined
    : (typeof obj.type === 'string' ? obj.type : (() => { throw new Error('Invalid response.type: expected string'); })());
  const template = obj.template === undefined
    ? undefined
    : (typeof obj.template === 'string' ? obj.template : (() => { throw new Error('Invalid response.template: expected string'); })());
  const props = obj.props === undefined
    ? undefined
    : (isPlainObject(obj.props) ? obj.props as Record<string, unknown> : (() => { throw new Error('Invalid response.props: expected object'); })());

  return {
    v: HOMURA_MSGPACK_VERSION,
    status: obj.status,
    headers: validateStringRecord(obj.headers, 'response.headers'),
    body: 'body' in obj ? validateResponseBody(obj.body, 'response.body') : '',
    type,
    template,
    props,
    control: normalizeResponseControl(obj.control),
  };
}

class WasmLongjmpException {
  constructor(public buf: number, public value: number) {}
}

const jmpBufRegistry = new Map<number, { label: number; sp: number }>();
let labelCounter = 1;

class MRuby {
  private instance: WebAssembly.Instance | null = null;

  private getMemory(): WebAssembly.Memory {
    if (!this.instance) {
      throw new Error('mruby not initialized');
    }
    return this.instance.exports.memory as WebAssembly.Memory;
  }

  private invokeWithLongjmpRetry<T>(label: string, fn: () => T): T {
    let attempts = 0;
    while (true) {
      try {
        return fn();
      } catch (error) {
        if (!(error instanceof WasmLongjmpException)) {
          throw error;
        }
        if (!jmpBufRegistry.has(error.buf)) {
          throw new Error(`[homura] unknown longjmp buffer during ${label}: ${error.buf}`);
        }
        attempts += 1;
        if (DEBUG_LONGJMP) {
          console.warn('[homura][longjmp]', {
            phase: 'retry',
            label,
            attempt: attempts,
            buf: error.buf,
            value: error.value,
            registry: jmpBufRegistry.get(error.buf),
          });
        }
        if (attempts > MAX_LONGJMP_RETRIES) {
          throw new Error(`[homura] exceeded longjmp retry budget during ${label}`);
        }
      }
    }
  }

  async init(): Promise<void> {
    if (this.instance) {
      return;
    }

    const wasiImports = {
      clock_res_get: (_id: number, resPtr: number) => {
        try {
          const view = new DataView(this.getMemory().buffer);
          view.setBigUint64(resPtr, BigInt(1000000), true);
        } catch (error) {
          console.warn('[wasi] clock_res_get error:', error);
        }
        return 0;
      },
      clock_time_get: (_id: number, _precision: bigint, timePtr: number) => {
        try {
          const view = new DataView(this.getMemory().buffer);
          view.setBigUint64(timePtr, BigInt(Date.now()) * BigInt(1000000), true);
        } catch (error) {
          console.warn('[wasi] clock_time_get error:', error);
        }
        return 0;
      },
      fd_write: (fd: number, iovs: number, iovsLen: number, nwritten: number) => {
        try {
          const memory = this.getMemory();
          const view = new DataView(memory.buffer);
          const decoder = new TextDecoder();
          let written = 0;
          for (let i = 0; i < iovsLen; i++) {
            const ptr = view.getUint32(iovs + i * 8, true);
            const len = view.getUint32(iovs + i * 8 + 4, true);
            const text = decoder.decode(new Uint8Array(memory.buffer, ptr, len));
            if (fd === 1) console.log('[mruby]', text);
            if (fd === 2) console.error('[mruby]', text);
            written += len;
          }
          view.setUint32(nwritten, written, true);
        } catch (error) {
          console.warn('[wasi] fd_write error:', error);
        }
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
          const view = new DataView(this.getMemory().buffer);
          view.setUint8(statPtr, fd <= 2 ? 2 : 4);
          view.setUint16(statPtr + 2, 0, true);
          view.setBigUint64(statPtr + 8, BigInt(0xffffffff), true);
          view.setBigUint64(statPtr + 16, BigInt(0xffffffff), true);
        } catch (error) {
          console.warn('[wasi] fd_fdstat_get error:', error);
        }
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
          const view = new DataView(this.getMemory().buffer);
          view.setUint32(countPtr, 0, true);
          view.setUint32(sizePtr, 0, true);
        } catch (error) {
          console.warn('[wasi] environ_sizes_get error:', error);
        }
        return 0;
      },
      args_get: () => 0,
      args_sizes_get: (countPtr: number, sizePtr: number) => {
        try {
          const view = new DataView(this.getMemory().buffer);
          view.setUint32(countPtr, 0, true);
          view.setUint32(sizePtr, 0, true);
        } catch (error) {
          console.warn('[wasi] args_sizes_get error:', error);
        }
        return 0;
      },
      proc_exit: (code: number) => {
        console.error('[mruby] proc_exit:', code);
        throw new Error(`mruby proc_exit: ${code}`);
      },
      random_get: (buf: number, bufLen: number) => {
        try {
          crypto.getRandomValues(new Uint8Array(this.getMemory().buffer, buf, bufLen));
        } catch (error) {
          console.warn('[wasi] random_get error:', error);
        }
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
        const memory = this.instance!.exports.memory as WebAssembly.Memory;
        const view = new DataView(memory.buffer);
        const label = labelCounter++;
        jmpBufRegistry.set(buf, { label, sp });
        view.setInt32(buf, label, true);
        view.setInt32(buf + 4, sp, true);
        view.setInt32(buf + 8, 0, true);
      },
      __wasm_longjmp: (buf: number, value: number): void => {
        const memory = this.instance!.exports.memory as WebAssembly.Memory;
        const view = new DataView(memory.buffer);
        view.setInt32(buf + 8, value || 1, true);
        throw new WasmLongjmpException(buf, value || 1);
      },
      __wasm_setjmp_test: (buf: number, curLabel: number): number => {
        const memory = this.instance!.exports.memory as WebAssembly.Memory;
        const view = new DataView(memory.buffer);
        const storedLabel = view.getInt32(buf, true);
        if (storedLabel === curLabel) {
          const value = view.getInt32(buf + 8, true);
          view.setInt32(buf + 8, 0, true);
          return value;
        }
        return 0;
      },
    };

    this.instance = new WebAssembly.Instance(mrubyWasm, {
      wasi_snapshot_preview1: wasiImports,
      env: envImports,
    });

    const exports = this.instance.exports as Record<string, (...args: unknown[]) => unknown>;
    const ok = exports.homura_init();
    if (!ok) {
      throw new Error('Failed to initialize mruby VM');
    }
  }

  eval(code: string): string {
    if (!this.instance) {
      throw new Error('mruby not initialized');
    }

    const exports = this.instance.exports as Record<string, (...args: unknown[]) => unknown>;
    const memory = this.getMemory();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const bufferPtr = exports.homura_get_input_buffer() as number;
    const bufferSize = exports.homura_get_buffer_size() as number;
    const codeBytes = encoder.encode(code + '\0');

    if (codeBytes.length > bufferSize) {
      throw new Error(`Code too large: ${codeBytes.length} > ${bufferSize}`);
    }

    new Uint8Array(memory.buffer).set(codeBytes, bufferPtr);
    this.invokeWithLongjmpRetry('eval', () => {
      exports.homura_eval();
      return 0;
    });

    const resultPtr = exports.homura_get_result() as number;
    const bytes = new Uint8Array(this.getMemory().buffer);
    let end = resultPtr;
    while (bytes[end] !== 0 && end < resultPtr + bufferSize) {
      end += 1;
    }
    return decoder.decode(new Uint8Array(this.getMemory().buffer, resultPtr, end - resultPtr));
  }

  parseEvalFailure(result: string): string | null {
    const trimmed = result.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof parsed.status === 'number' && parsed.status >= 400) {
        if (typeof parsed.body === 'string') {
          return parsed.body;
        }
        if (isPlainObject(parsed.body) && typeof parsed.body.error === 'string') {
          return parsed.body.error;
        }
      }
      if (typeof parsed.error === 'string') {
        return parsed.error;
      }
    } catch (_error) {
      return null;
    }
    return null;
  }

  handleRequest(env: RubyRequestEnvelope): RubyResponse {
    if (!this.instance) {
      throw new Error('mruby not initialized');
    }

    const exports = this.instance.exports as Record<string, (...args: unknown[]) => unknown>;
    const memory = this.getMemory();
    const encoded = mpEncode(env);
    const bufferPtr = exports.homura_get_input_buffer() as number;
    const bufferSize = exports.homura_get_buffer_size() as number;

    if (encoded.length > bufferSize || encoded.length > MAX_MP_SIZE) {
      return {
        v: HOMURA_MSGPACK_VERSION,
        status: 413,
        headers: { 'Content-Type': 'text/plain' },
        body: 'Request too large',
      };
    }

    new Uint8Array(memory.buffer).set(encoded, bufferPtr);

    const success = this.invokeWithLongjmpRetry('handle_request', () => (
      exports.homura_handle_request(encoded.length) as number
    ));
    const outputLen = exports.homura_get_output_length() as number;
    const outputPtr = exports.homura_get_output_buffer() as number;
    const output = new Uint8Array(memory.buffer, outputPtr, outputLen);

    if (!success || outputLen <= 0) {
      const body = outputLen > 0 ? new TextDecoder().decode(output) : 'Internal Server Error';
      return {
        v: HOMURA_MSGPACK_VERSION,
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
        body,
      };
    }

    return validateRubyResponse(mpDecode(output));
  }

  gc(): void {
    if (!this.instance) {
      return;
    }
    const exports = this.instance.exports as Record<string, (...args: unknown[]) => unknown>;
    if (typeof exports.homura_gc === 'function') {
      exports.homura_gc();
    }
  }

  close(): void {
    if (!this.instance) {
      return;
    }
    const exports = this.instance.exports as Record<string, (...args: unknown[]) => unknown>;
    exports.homura_close();
    this.instance = null;
  }
}

interface Env {}

let mruby: MRuby | null = null;
let coreLoaded = false;
let mrubyLock: Promise<void> = Promise.resolve();

function withMrubyLock<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const wait = mrubyLock;
  mrubyLock = next;
  return wait.then(fn).finally(() => release!());
}

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }
    if (request.method === 'GET' && url.pathname === '/assets/app.css') {
      return new Response(APP_CSS, {
        status: 200,
        headers: {
          'Content-Type': 'text/css; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    const requestId = createRequestId(request);
    const method = request.method;
    let bodyStr = '';
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      bodyStr = await request.text();
    }

    try {
      return await withMrubyLock(async () => {
        if (!mruby) {
          mruby = new MRuby();
          await mruby.init();
        }

        if (!coreLoaded) {
          const coreResult = mruby.eval(HOMURA_CORE);
          const coreError = mruby.parseEvalFailure(coreResult);
          if (coreError) {
            mruby = null;
            throw new Error(`Framework initialization failed: ${coreError}`);
          }

          const modelResult = mruby.eval(HOMURA_MODEL);
          const modelError = mruby.parseEvalFailure(modelResult);
          if (modelError) {
            mruby = null;
            throw new Error(`Model loading failed: ${modelError}`);
          }

          const routeResult = mruby.eval(USER_ROUTES);
          const routeError = mruby.parseEvalFailure(routeResult);
          if (routeError) {
            mruby = null;
            throw new Error(`Route loading failed: ${routeError}`);
          }

          coreLoaded = true;
        }

        let result: RubyResponse;
        try {
          result = mruby.handleRequest({
            v: HOMURA_MSGPACK_VERSION,
            request: {
              method,
              path: url.pathname,
              query: Object.fromEntries(url.searchParams.entries()),
              headers: Object.fromEntries(request.headers.entries()),
              body: bodyStr,
              content_type: request.headers.get('Content-Type') || '',
              kv_data: {},
            },
            control: { continue: false, ops: [] },
          });
        } catch (error) {
          console.error('[homura] request bridge failed, resetting mruby instance:', error);
          try {
            mruby.close();
          } catch (_closeError) {
            // Ignore close errors while resetting the instance.
          }
          mruby = null;
          coreLoaded = false;
          throw error;
        }

        if (result.control?.continue) {
          throw new Error('this example does not support continuation operations');
        }

        let responseBody = typeof result.body === 'object'
          ? JSON.stringify(result.body)
          : String(result.body ?? '');
        let headers = result.headers;
        if (result.type === 'jsx') {
          const templateName = result.template || 'home';
          const props = result.props || {};
          responseBody = renderTemplate(templateName, props);
          headers = { ...headers, 'Content-Type': 'text/html' };
        }

        console.info(JSON.stringify({
          event: 'homura_request_complete',
          request_id: requestId,
          method,
          path: url.pathname,
          status: result.status,
        }));

        mruby.gc();
        return new Response(responseBody, {
          status: result.status,
          headers,
        });
      });
    } catch (error) {
      console.error(JSON.stringify({
        event: 'homura_request_error',
        request_id: requestId,
        method,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return new Response(
        JSON.stringify({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  },
};
