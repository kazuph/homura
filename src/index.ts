/**
 * Homura - A Ruby DSL web framework for Cloudflare Workers
 * Powered by mruby + WASI
 */

// Import the compiled mruby.wasm
import mrubyWasm from '../mruby/build/mruby.wasm';
import { renderTemplate } from './templates.tsx';

// Longjmp exception class for wasm-sjlj
class WasmLongjmpException {
  constructor(public buf: number, public value: number) {}
}

// setjmp buffer registry - maps buffer addresses to saved state info
// wasm-sjlj stores: label (i32), sp (i32) at the jmp_buf location
const jmpBufRegistry = new Map<number, { label: number; sp: number }>();
let labelCounter = 1;

// mruby instance wrapper
class MRuby {
  private instance: WebAssembly.Instance | null = null;

  async init(): Promise<void> {
    if (this.instance) return;

    // Create WASI imports using a getter for memory
    const getMemory = (): WebAssembly.Memory => {
      return this.instance!.exports.memory as WebAssembly.Memory;
    };

    const wasiImports = {
      // Clock functions
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
      // File descriptor functions
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
          // fs_filetype: 2 (character device for stdout/stderr)
          view.setUint8(statPtr, fd <= 2 ? 2 : 4);
          // fs_flags
          view.setUint16(statPtr + 2, 0, true);
          // fs_rights_base
          view.setBigUint64(statPtr + 8, BigInt(0xffffffff), true);
          // fs_rights_inheriting
          view.setBigUint64(statPtr + 16, BigInt(0xffffffff), true);
        } catch {}
        return 0;
      },
      fd_fdstat_set_flags: () => 0,
      fd_fdstat_set_rights: () => 0,
      fd_prestat_get: () => 8, // EBADF
      fd_prestat_dir_name: () => 8, // EBADF
      path_create_directory: () => 0,
      path_filestat_get: () => 0,
      path_filestat_set_times: () => 0,
      path_link: () => 0,
      path_readlink: () => 0,
      path_remove_directory: () => 0,
      path_rename: () => 0,
      path_symlink: () => 0,
      path_unlink_file: () => 0,
      path_open: () => 44, // ENOENT
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

    // wasm-sjlj implementation for setjmp/longjmp
    // These functions are called by LLVM's wasm-sjlj lowering
    const envImports = {
      // Called to save state for setjmp
      // Returns a unique label ID (non-zero means valid)
      __wasm_setjmp: (buf: number, sp: number): void => {
        const label = labelCounter++;
        jmpBufRegistry.set(buf, { label, sp });
        // Write label to jmp_buf[0]
        const memory = this.instance!.exports.memory as WebAssembly.Memory;
        const view = new DataView(memory.buffer);
        view.setInt32(buf, label, true);
        view.setInt32(buf + 4, sp, true);
      },
      // Called to restore state for longjmp
      // Throws a JS exception to unwind the stack
      __wasm_longjmp: (buf: number, value: number): void => {
        throw new WasmLongjmpException(buf, value || 1);
      },
      // Called after setjmp returns to check if it was a longjmp return
      // buf: jmp_buf pointer, curLabel: current expected label
      // Returns: 0 if normal return, value from longjmp if jumped
      __wasm_setjmp_test: (buf: number, curLabel: number): number => {
        const memory = this.instance!.exports.memory as WebAssembly.Memory;
        const view = new DataView(memory.buffer);
        const storedLabel = view.getInt32(buf, true);
        // If labels match, it was a longjmp return; return stored value
        if (storedLabel === curLabel) {
          return view.getInt32(buf + 8, true); // value stored at buf+8
        }
        return 0;
      },
    };

    // Instantiate wasm
    this.instance = new WebAssembly.Instance(mrubyWasm, {
      wasi_snapshot_preview1: wasiImports,
      env: envImports,
    });

    // Initialize mruby VM
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

    // Get buffer pointer and size
    const bufferPtr = exports.homura_get_input_buffer();
    const bufferSize = exports.homura_get_buffer_size();

    // Write code to buffer
    const codeBytes = encoder.encode(code + '\0');
    if (codeBytes.length > bufferSize) {
      throw new Error(`Code too large: ${codeBytes.length} > ${bufferSize}`);
    }

    new Uint8Array(memory.buffer).set(codeBytes, bufferPtr);

    // Evaluate Ruby code (wrapped to catch wasm-sjlj longjmp)
    try {
      exports.homura_eval();
    } catch (e) {
      if (e instanceof WasmLongjmpException) {
        // longjmp was called - this typically means an exception was thrown in Ruby
        // For now, just continue and try to get the result
        console.log('[homura] longjmp caught in eval, buf:', e.buf, 'value:', e.value);
      } else {
        throw e;
      }
    }

    // Re-get memory view (may have grown)
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

// Homura core Ruby code (without regex to avoid complexity)
const HOMURA_CORE = `
class Homura
  def initialize
    @routes = {}
    @not_found = nil
  end

  def get(path, &block)
    @routes[["GET", path]] = block
  end

  def post(path, &block)
    @routes[["POST", path]] = block
  end

  def put(path, &block)
    @routes[["PUT", path]] = block
  end

  def patch(path, &block)
    @routes[["PATCH", path]] = block
  end

  def delete(path, &block)
    @routes[["DELETE", path]] = block
  end

  def match_route(method, path)
    path_parts = path.split("/").reject { |p| p.empty? }
    @routes.each do |(route_method, pattern), handler|
      next unless route_method == method
      pattern_parts = pattern.split("/").reject { |p| p.empty? }
      next unless pattern_parts.length == path_parts.length

      params = {}
      matched = true
      pattern_parts.each_with_index do |part, idx|
        if part.start_with?(":")
          params[part[1..-1].to_sym] = path_parts[idx]
        elsif part != path_parts[idx]
          matched = false
          break
        end
      end

      return [handler, params] if matched
    end
    nil
  end

  def call(env)
    result = match_route(env[:method], env[:path])
    if result
      handler, params = result
      ctx = Context.new(env, params)
      handler.call(ctx)
    else
      if @not_found
        ctx = Context.new(env, {})
        @not_found.call(ctx)
      else
        { status: 404, body: "Not Found", headers: {} }
      end
    end
  end

  def not_found(&block)
    @not_found = block
  end
end

class Context
  attr_reader :params, :env

  def initialize(env, params)
    @env = env
    @params = params
  end

  def body
    @env[:body] || ""
  end

  def json_body
    body_str = body
    return {} if body_str.nil? || body_str.empty?
    # Return raw body string for now - parsing can be done in C
    body_str
  end

  def json(data, status: 200)
    # Don't call to_json here - C's value_to_json will handle it
    { status: status, body: data, headers: { "Content-Type" => "application/json" } }
  end

  def text(body, status: 200)
    { status: status, body: body, headers: { "Content-Type" => "text/plain" } }
  end

  def html(body, status: 200)
    { status: status, body: body, headers: { "Content-Type" => "text/html" } }
  end

  def render(template, locals = {}, layout = nil, status: 200)
    body = View.render(template, locals, layout)
    html(body, status: status)
  end

  def jsx(template, props = {}, status: 200)
    { status: status, type: "jsx", template: template, props: props, headers: { "Content-Type" => "text/html" } }
  end

  def asset(body, content_type:, status: 200, max_age: 0, etag: nil)
    headers = { "Content-Type" => content_type }
    headers["Cache-Control"] = "public, max-age=#{max_age}" if max_age && max_age > 0
    headers["ETag"] = etag if etag
    { status: status, body: body, headers: headers }
  end

  def css(body, status: 200, max_age: 0, etag: nil)
    asset(body, content_type: "text/css", status: status, max_age: max_age, etag: etag)
  end
end

module View
  def self.h(text)
    s = text.to_s
    out = ""
    s.each_byte do |b|
      case b
      when 38
        out << "&amp;"
      when 60
        out << "&lt;"
      when 62
        out << "&gt;"
      when 34
        out << "&quot;"
      when 39
        out << "&#39;"
      else
        out << b.chr
      end
    end
    out
  end

  def self.render(template, locals = {}, layout = nil)
    sym_locals = {}
    locals.each { |k, v| sym_locals[k.to_sym] = v }
    sym_locals[:title] = "Homura" unless sym_locals.key?(:title)
    body = format(template, sym_locals)
    if layout
      with_content = sym_locals.merge({ content: body })
      format(layout, with_content)
    else
      body
    end
  end
end

class Object
  def to_json
    case self
    when NilClass then "null"
    when TrueClass then "true"
    when FalseClass then "false"
    when Integer, Float then self.to_s
    when String then "\\"" + self.gsub("\\\\", "\\\\\\\\").gsub("\\"", "\\\\\\"") + "\\""
    when Symbol then "\\"" + self.to_s + "\\""
    when Array then "[" + self.map { |e| e.to_json }.join(",") + "]"
    when Hash then "{" + self.map { |k, v| "\\"#{k}\\":" + v.to_json }.join(",") + "}"
    else "\\"" + self.to_s + "\\""
    end
  end
end

# Simple JSON parser (basic implementation for request bodies)
# Note: mruby has limited regex support, so we use string operations
def parse_json(str)
  return {} if str.nil? || str.empty?
  str = str.strip
  return nil if str == "null"
  return true if str == "true"
  return false if str == "false"

  # Check if it's a number
  if str.length > 0 && (str[0] == "-" || (str[0] >= "0" && str[0] <= "9"))
    if str.include?(".")
      return str.to_f
    else
      return str.to_i
    end
  end

  # String value
  if str.start_with?("\\"") && str.end_with?("\\"")
    return str[1..-2]
  end

  # Object - simple key-value parsing
  if str.start_with?("{") && str.end_with?("}")
    result = {}
    content = str[1..-2].strip
    return result if content.empty?

    # Parse key-value pairs
    pairs = []
    depth = 0
    current = ""
    content.each_char do |c|
      if c == "{" || c == "["
        depth += 1
        current << c
      elsif c == "}" || c == "]"
        depth -= 1
        current << c
      elsif c == "," && depth == 0
        pairs << current.strip
        current = ""
      else
        current << c
      end
    end
    pairs << current.strip unless current.empty?

    pairs.each do |pair|
      # Find the colon separator
      colon_idx = nil
      in_string = false
      pair.each_char.with_index do |c, i|
        if c == "\\"" && (i == 0 || pair[i-1] != "\\\\")
          in_string = !in_string
        elsif c == ":" && !in_string
          colon_idx = i
          break
        end
      end

      if colon_idx
        key_part = pair[0...colon_idx].strip
        val_part = pair[(colon_idx+1)..-1].strip
        if key_part.start_with?("\\"") && key_part.end_with?("\\"")
          key = key_part[1..-2].to_sym
          result[key] = parse_json(val_part)
        end
      end
    end
    return result
  end

  str
end

$app = Homura.new
`;

// User routes
const USER_ROUTES = `
APP_CSS = <<~CSS
:root {
  color-scheme: light;
  --bg: #f6f1e7;
  --text: #1f1a14;
  --muted: #6b5f54;
  --accent: #b44d2f;
  --accent-2: #256b7e;
  --card: #ffffff;
  --shadow: rgba(31, 26, 20, 0.12);
}

* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif;
  background: linear-gradient(180deg, #f6f1e7 0%, #efe6d7 100%);
  color: var(--text);
}

a { color: inherit; text-decoration: none; }

.container { max-width: 960px; margin: 0 auto; padding: 0 24px; }

.site-header {
  padding: 20px 0;
  border-bottom: 1px solid rgba(31, 26, 20, 0.08);
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(10px);
}

.logo { font-weight: 700; font-size: 20px; letter-spacing: 0.04em; }
.nav { display: flex; gap: 16px; font-size: 14px; }
.site-header .container { display: flex; justify-content: space-between; align-items: center; }

.hero { padding: 56px 0 32px; }
.eyebrow { text-transform: uppercase; letter-spacing: 0.12em; font-size: 12px; color: var(--muted); }
.hero h1 { font-size: 40px; margin: 8px 0; }
.lead { color: var(--muted); font-size: 18px; max-width: 620px; }

.actions { display: flex; gap: 12px; margin-top: 24px; }
.button {
  padding: 10px 18px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}
.button.ghost {
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin-bottom: 40px;
}
.card {
  background: var(--card);
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 10px 30px var(--shadow);
}

.stack { padding: 40px 0; }
.list { padding-left: 20px; color: var(--muted); }

.site-footer {
  padding: 24px 0 40px;
  color: var(--muted);
  font-size: 12px;
}
CSS

$app.get "/" do |c|
  c.jsx(
    "home",
    {
      eyebrow: "mruby + WASI",
      headline: "Homuraで軽量Webサーバー",
      lead: "APIだけでなく静的ページも素早く返す、Hono風のRuby DSLです。",
      template_note: "JSXテンプレで軽量にHTMLを組み立て。",
      web_note: "CSSやHTMLを同梱して小さなWebに最適。",
      hono_note: "get/post + Context APIでHono互換の使い心地。"
    }
  )
end

$app.get "/about" do |c|
  c.jsx(
    "about",
    {
      framework: "mruby + WASI",
      template_style: "JSX"
    }
  )
end

$app.get "/users/:id" do |c|
  c.json({ user_id: c.params[:id], action: "show" })
end

$app.get "/hello/:name" do |c|
  safe_name = View.h(c.params[:name])
  c.html("<h1>Hello, " + safe_name + "!</h1><p>Homura - Ruby on the Edge</p>")
end

$app.get "/api" do |c|
  c.json({ message: "Hello from Homura!", framework: "mruby + WASI", version: "0.1.0" })
end

$app.get "/health" do |c|
  c.json({ status: "ok", runtime: "cloudflare-workers", engine: "mruby" })
end

# POST example - create user
$app.post "/users" do |c|
  c.json({ action: "create", body: c.body }, status: 201)
end

# PUT example - update user
$app.put "/users/:id" do |c|
  c.json({ action: "update", user_id: c.params[:id], body: c.body })
end

# PATCH example - partial update
$app.patch "/users/:id" do |c|
  c.json({ action: "patch", user_id: c.params[:id], body: c.body })
end

# DELETE example - delete user
$app.delete "/users/:id" do |c|
  c.json({ action: "delete", user_id: c.params[:id] })
end

$app.get "/assets/app.css" do |c|
  c.css(APP_CSS)
end
`;

interface Env {}

let mruby: MRuby | null = null;
let coreLoaded = false;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    try {
      // Initialize mruby
      if (!mruby) {
        mruby = new MRuby();
        await mruby.init();
      }

      // Load core and routes
      if (!coreLoaded) {
        mruby.eval(HOMURA_CORE);
        mruby.eval(USER_ROUTES);
        coreLoaded = true;
      }

      // Read request body for POST/PUT/PATCH
      let bodyStr = '';
      if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
        bodyStr = await request.text();
      }

      // Escape body for Ruby string (handle quotes and backslashes)
      const escapedBody = bodyStr
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');

      // Call Ruby router using eval
      // Note: Don't call to_json here - let C's value_to_json handle serialization
      // to avoid double-encoding (Ruby to_json returns string, C wraps in quotes again)
      const envCode = `
        env = { method: "${request.method}", path: "${url.pathname}", body: "${escapedBody}" }
        $app.call(env)
      `;

      const resultJson = mruby.eval(envCode);
      console.log('[homura fetch] resultJson:', resultJson);

    // Parse result
    let result: { status: number; body: string; headers: Record<string, string> };
      try {
        result = JSON.parse(resultJson);
        console.log('[homura fetch] parsed result:', JSON.stringify(result));
      } catch (e) {
        console.log('[homura fetch] parse error:', e);
        return new Response(
          JSON.stringify({ error: 'Parse error', raw: resultJson }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const headers = result.headers || {};

      // JSX Template rendering (type: "jsx" response from Ruby)
      if ((result as any).type === 'jsx') {
        const templateName = (result as any).template;
        const props = (result as any).props || {};
        const html = renderTemplate(templateName, props);
        return new Response(html, {
          status: result.status,
          headers: { ...headers, 'Content-Type': 'text/html' },
        });
      }

      // If body is an object (from json()), stringify it for the response
      const responseBody = typeof result.body === 'object' ? JSON.stringify(result.body) : result.body;
      console.log('[homura fetch] returning body:', responseBody);
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
