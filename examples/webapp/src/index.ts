/**
 * Homura Example Webapp
 * Demonstrates the Homura Ruby DSL framework for Cloudflare Workers
 */

// Import the compiled mruby.wasm from the framework
import mrubyWasm from '../../../mruby/build/mruby.wasm';
import { renderTemplate } from './templates.tsx';
import { HOMURA_CORE, USER_ROUTES } from './ruby-bundle';

// Longjmp exception class for wasm-sjlj
class WasmLongjmpException {
  constructor(public buf: number, public value: number) {}
}

// setjmp buffer registry
const jmpBufRegistry = new Map<number, { label: number; sp: number }>();
let labelCounter = 1;

// mruby instance wrapper
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
        } catch {}
        return 0;
      },
      clock_time_get: (id: number, precision: bigint, timePtr: number) => {
        try {
          const memory = getMemory();
          const view = new DataView(memory.buffer);
          view.setBigUint64(timePtr, BigInt(Date.now()) * BigInt(1000000), true);
        } catch {}
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
        } catch {}
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
        } catch {}
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
        } catch {}
        return 0;
      },
      args_get: () => 0,
      args_sizes_get: (countPtr: number, sizePtr: number) => {
        try {
          const memory = getMemory();
          const view = new DataView(memory.buffer);
          view.setUint32(countPtr, 0, true);
          view.setUint32(sizePtr, 0, true);
        } catch {}
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
        } catch {}
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

  eval(code: string): string {
    if (!this.instance) {
      throw new Error('mruby not initialized');
    }

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

    let evalError: string | null = null;
    try {
      exports.homura_eval();
    } catch (e) {
      if (e instanceof WasmLongjmpException) {
        console.error('[homura] Ruby exception (longjmp), buf:', e.buf, 'value:', e.value);
        evalError = `Ruby exception occurred (longjmp value: ${e.value})`;
      } else {
        throw e;
      }
    }

    if (evalError) {
      return JSON.stringify({ status: 500, body: { error: evalError }, headers: { "Content-Type": "application/json" } });
    }

    const currentMemory = this.instance.exports.memory as WebAssembly.Memory;
    const resultPtr = exports.homura_get_result();
    const memoryView = new Uint8Array(currentMemory.buffer);
    let resultEnd = resultPtr;
    while (memoryView[resultEnd] !== 0 && resultEnd < resultPtr + bufferSize) {
      resultEnd++;
    }

    const result = decoder.decode(new Uint8Array(currentMemory.buffer, resultPtr, resultEnd - resultPtr));
    console.log('[homura] eval result:', result.substring(0, 200));
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

interface Env {
  HOMURA_KV: KVNamespace;
}

// KV prefetch configuration for this webapp
const KV_PREFETCH_CONFIG: Record<string, string[]> = {
  '/': ['counter'],
  '/counter': ['counter'],
};

function getKvKeysForPath(path: string): string[] {
  const keys: string[] = [];
  for (const [pattern, prefetchKeys] of Object.entries(KV_PREFETCH_CONFIG)) {
    if (path === pattern || path.startsWith(pattern + '/')) {
      keys.push(...prefetchKeys);
    }
  }
  const kvUserMatch = path.match(/^\/kv\/users\/([^/]+)$/);
  if (kvUserMatch) {
    keys.push(`user:${decodeURIComponent(kvUserMatch[1])}`);
  }
  return [...new Set(keys)];
}

let mruby: MRuby | null = null;
let coreLoaded = false;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (!mruby) {
        mruby = new MRuby();
        await mruby.init();
      }

      if (!coreLoaded) {
        mruby.eval(HOMURA_CORE);
        mruby.eval(USER_ROUTES);
        coreLoaded = true;
      }

      const kvKeys = getKvKeysForPath(url.pathname);
      const kvData: Record<string, string | null> = {};
      if (env.HOMURA_KV && kvKeys.length > 0) {
        await Promise.all(
          kvKeys.map(async (key) => {
            kvData[key] = await env.HOMURA_KV.get(key);
          })
        );
      }

      const kvDataEntries = Object.entries(kvData)
        .filter(([_, v]) => v !== null)
        .map(([k, v]) => `"${k}" => "${(v as string).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
        .join(', ');
      const kvDataRuby = `{ ${kvDataEntries} }`;

      let bodyStr = '';
      if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
        bodyStr = await request.text();
      }

      const escapedBody = bodyStr
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');

      const envCode = `
        env = { method: "${request.method}", path: "${url.pathname}", body: "${escapedBody}", kv_data: ${kvDataRuby} }
        $app.call(env)
      `;

      const resultJson = mruby.eval(envCode);

      let result: { status: number; body: string; headers: Record<string, string>; kv_ops?: Array<{ op: string; key: string; value?: string }> };
      try {
        result = JSON.parse(resultJson);
      } catch (e) {
        return new Response(
          JSON.stringify({ error: 'Parse error', raw: resultJson }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (result.kv_ops && result.kv_ops.length > 0 && env.HOMURA_KV) {
        ctx.waitUntil(
          (async () => {
            for (const op of result.kv_ops!) {
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

      const headers = result.headers || {};

      if ((result as any).type === 'jsx') {
        const templateName = (result as any).template;
        const props = (result as any).props || {};
        const html = renderTemplate(templateName, props);
        return new Response(html, {
          status: result.status,
          headers: { ...headers, 'Content-Type': 'text/html' },
        });
      }

      const responseBody = typeof result.body === 'object' ? JSON.stringify(result.body) : result.body;
      return new Response(responseBody, {
        status: result.status,
        headers,
      });
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
