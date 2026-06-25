# frozen_string_literal: true
# backtick_javascript: true
# await: true

require "json"
require "sinatra"

STORAGE_OFFLOAD_THRESHOLD = 2048
WORKSPACE_DO_CLASS = "HomuraCounterDO"
WORKSPACE_USAGE = <<~TEXT
  pwd
  ls /
  printf 'hello from homura' > /notes.txt
  grep homura /notes.txt | wc -l
  cat /notes.txt
  rm /notes.txt

  Convenience helpers:
    write /notes.txt "hello from homura"
    append /notes.txt " and R2"
    stat /notes.txt
TEXT
  .freeze

class WorkspaceShellError < StandardError
  attr_reader :status

  def initialize(message, status: 422)
    @status = status.to_i
    super(message)
  end
end

def h(text)
  Rack::Utils.escape_html(text.to_s)
end

def human_bytes(bytes)
  value = bytes.to_i
  return "#{value} B" if value < 1024

  kib = value / 1024.0
  return format("%.1f KiB", kib) if kib < 1024

  format("%.1f MiB", kib / 1024.0)
end

def normalize_workspace_name(raw)
  name = raw.to_s.strip.downcase
  name = "demo" if name.empty?
  unless /\A[a-z0-9][a-z0-9._-]{0,63}\z/.match?(name)
    raise(
      WorkspaceShellError.new(
        "Workspace names must match /[a-z0-9][a-z0-9._-]{0,63}/.",
        status: 422
      )
    )
  end

  name
end

def normalize_workspace_path(raw, allow_root: true)
  input = raw.to_s.strip
  input = "/" if input.empty?
  parts = []

  input.split("/").each do |segment|
    next if segment.empty? || segment == "."
    raise WorkspaceShellError, "Parent segments (`..`) are not allowed." if segment == ".."

    parts << segment
  end

  path = parts.empty? ? "/" : "/#{parts.join("/")}"
  if path == "/" && !allow_root
    raise WorkspaceShellError, "This command requires a non-root path."
  end

  path
end

def workspace_backend_call!(action, state:, payload:, bucket_binding:)
  backend = `globalThis.__AGENT_WORKSPACE_SHELL__ || null`
  if `(#{backend} == null || #{backend} === Opal.nil)`
    raise WorkspaceShellError.new("shell backend missing.", status: 500)
  end

  err_klass = WorkspaceShellError
  payload_json = payload.to_json
  action_name = action.to_s
  js_state = state.js_state
  js_bucket_binding = `(function(bucket_binding) { if (bucket_binding == null || bucket_binding === Opal.nil) return null; if (typeof bucket_binding.$js === 'function') return bucket_binding.$js(); return bucket_binding; })(#{bucket_binding})`
  js_promise = `(async function(backend, action_name, js_state, js_bucket_binding, payload_json, inline_threshold, Kernel, err_klass) { try { var payload = JSON.parse(payload_json); var result = await backend[action_name](js_state, js_bucket_binding, payload, inline_threshold); return JSON.stringify(result); } catch (e) { var status = e && Number.isFinite(e.status) ? e.status : 422; Kernel.$raise(err_klass.$new(e && e.message ? e.message : String(e), Opal.hash({ status: status }))); } })(#{backend}, #{action_name}, #{js_state}, #{js_bucket_binding}, #{payload_json}, #{STORAGE_OFFLOAD_THRESHOLD}, #{Kernel}, #{err_klass})`
  JSON.parse(js_promise.__await__.to_s)
end

def format_workspace_snapshot(snapshot)
  entries = snapshot["entries"] || []
  return "(empty workspace)" if entries.empty?

  entries
    .map do |entry|
      if entry["type"] == "directory"
        "dir  #{entry["path"]}"
      else
        "file #{entry["path"]} (#{human_bytes(entry["size"])}, #{entry["storage"]})"
      end
    end
    .join("\n")
end

def format_terminal_history(snapshot)
  history = snapshot["history"] || []
  return "$ ready" if history.empty?

  history
    .map do |entry|
      command = entry["command"].to_s
      output = entry["output"].to_s
      ["$ #{command}", output].reject(&:empty?).join("\n")
    end
    .join("\n\n")
end

Cloudflare::DurableObject.define(WORKSPACE_DO_CLASS) do |state, request|
  headers = {"content-type" => "application/json; charset=utf-8"}
  payload = request.body.to_s.empty? ? {} : JSON.parse(request.body.to_s)
  raw_cf_env = cf_env
  raw_bucket = `((#{raw_cf_env} == null || #{raw_cf_env} === Opal.nil) ? null : (#{raw_cf_env}.BUCKET || null))`
  bucket_binding = raw_bucket || bucket

  result = case [request.method, request.path]
  when ["GET", "/state"]
    workspace_backend_call!(
      "snapshot",
      state: state,
      bucket_binding: bucket_binding,
      payload: {}
    )
      .__await__
  when ["POST", "/read"]
    workspace_backend_call!(
      "readFile",
      state: state,
      bucket_binding: bucket_binding,
      payload: {
        "path" => normalize_workspace_path(payload["path"], allow_root: false)
      }
    )
      .__await__
  when ["POST", "/command"]
    command = payload["command"].to_s
    if command.strip == "help"
      {
        "command" => command,
        "changed" => false,
        "exit_code" => 0,
        "output" => WORKSPACE_USAGE
      }
    else
      workspace_backend_call!(
        "executeCommand",
        state: state,
        bucket_binding: bucket_binding,
        payload: {"command" => command}
      )
        .__await__
    end
  else
    [404, headers, {"error" => "Unknown workspace route #{request.method} #{request.path}"}.to_json]
  end

  if result.is_a?(Array)
    result
  else
    [200, headers, result.to_json]
  end

rescue JSON::ParserError
  [400, headers, {"error" => "Request body must be valid JSON."}.to_json]
rescue WorkspaceShellError => e
  [e.status, headers, {"error" => e.message}.to_json]
end

def workspace_request(name, path, method: "GET", payload: nil)
  workspace = normalize_workspace_name(name)
  stub = durable_object("workspace", workspace)
  if stub.nil?
    raise(
      WorkspaceShellError.new(
        "WORKSPACE binding missing (configure [[durable_objects.bindings]]).",
        status: 503
      )
    )
  end

  headers = payload ? {"content-type" => "application/json"} : nil
  body = payload ? payload.to_json : nil
  response = stub
    .fetch(
      "https://workspace.internal#{path}",
      method: method,
      headers: headers,
      body: body
    )
    .__await__
  parsed = response.body.to_s.empty? ? {} : JSON.parse(response.body)
  [response, parsed, workspace]
end

def workspace_request!(name, path, method: "GET", payload: nil)
  response, parsed, workspace = workspace_request(name, path, method: method, payload: payload).__await__
  return [parsed, workspace] if response.ok?

  message = parsed["error"].to_s
  message = "Workspace request failed." if message.empty?
  raise WorkspaceShellError.new(message, status: response.status)
end

def page(workspace:, command: "", snapshot: nil, error: nil)
  snapshot_block = if snapshot
    <<~HTML
      <section class="terminal-panel">
        <div class="terminal-title">files</div>
        <pre class="terminal-output">#{h(format_workspace_snapshot(snapshot))}</pre>
      </section>
    HTML
  else
    ""
  end

  error_block = error ? "<p class=\"error\" role=\"alert\">#{h(error)}</p>" : ""
  prompt = "#{workspace}:/ $"

  <<~HTML
    <!doctype html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>agent-workspace</title>
      <style>
        :root { color-scheme: dark; }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          min-height: 100vh;
          background: radial-gradient(circle at top, #16201c, #0b0f10 42rem);
          color: #d7e3d2;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          padding: 2rem 1rem 4rem;
        }
        .terminal-shell {
          max-width: 64rem;
          margin: 0 auto;
          border: 1px solid #1f2a21;
          border-radius: 16px;
          overflow: hidden;
          background: #111716;
          box-shadow: 0 28px 80px rgba(0, 0, 0, .45);
        }
        .terminal-bar {
          display: flex;
          align-items: center;
          gap: .5rem;
          padding: .9rem 1rem;
          background: #161d1b;
          border-bottom: 1px solid #1f2a21;
        }
        .dot {
          width: .8rem;
          height: .8rem;
          border-radius: 999px;
          display: inline-block;
        }
        .dot.red { background: #ff5f57; }
        .dot.yellow { background: #febc2e; }
        .dot.green { background: #28c840; }
        .terminal-name {
          margin-left: .5rem;
          color: #8fa093;
          font-size: .95rem;
        }
        .terminal-body {
          padding: 1rem;
        }
        .terminal-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 1rem;
          color: #8fa093;
          font-size: .92rem;
        }
        .workspace-chip {
          display: inline-flex;
          align-items: center;
          gap: .6rem;
          padding: .45rem .7rem;
          border: 1px solid #26312a;
          border-radius: 999px;
          background: #0a100f;
        }
        .workspace-chip input {
          width: 11rem;
          padding: 0;
          border: 0;
          background: transparent;
          color: #d7e3d2;
          font: inherit;
        }
        .workspace-chip input:focus {
          outline: none;
        }
        .terminal-panel {
          margin-top: 1rem;
          border: 1px solid #1f2a21;
          border-radius: 12px;
          background: #0d1312;
          overflow: hidden;
        }
        .terminal-title {
          padding: .65rem .9rem;
          color: #8fa093;
          background: #141b19;
          border-bottom: 1px solid #1f2a21;
          text-transform: lowercase;
        }
        pre {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
        }
        button {
          width: auto;
          margin-left: .75rem;
          padding: .7rem .95rem;
          border: 1px solid #2e5932;
          border-radius: 10px;
          background: #17331b;
          color: #b8f7ba;
          font: inherit;
          cursor: pointer;
          flex: 0 0 auto;
        }
        button:hover {
          background: #1b3d20;
        }
        .terminal-output {
          padding: .9rem 1rem 1rem;
        }
        .terminal-history {
          min-height: 18rem;
          max-height: 28rem;
          overflow: auto;
        }
        .prompt-form {
          margin: 0;
          padding: .95rem 1rem 1rem;
          border-top: 1px solid #1f2a21;
          display: flex;
          align-items: flex-start;
          gap: .75rem;
          background: #0f1514;
        }
        .prompt-label {
          color: #8fd18f;
          white-space: nowrap;
          padding-top: .05rem;
        }
        .prompt-input {
          flex: 1 1 auto;
        }
        textarea {
          width: 100%;
          min-height: 1.6rem;
          resize: none;
          padding: 0;
          border: 0;
          background: transparent;
          color: #e8f3e5;
          font: inherit;
        }
        textarea:focus {
          outline: none;
        }
        .hint {
          margin-top: .5rem;
          color: #6f8373;
          font-size: .82rem;
        }
        .error {
          margin: 0 0 1rem;
          padding: .9rem 1rem;
          border: 1px solid #6b2f2f;
          border-radius: 12px;
          background: #241414;
          color: #ffb3b3;
        }
      </style>
    </head>
    <body>
      <div class="terminal-shell">
        <div class="terminal-bar">
          <span class="dot red"></span>
          <span class="dot yellow"></span>
          <span class="dot green"></span>
          <span class="terminal-name">agent-workspace</span>
        </div>
        <div class="terminal-body">
          <div class="terminal-meta">
            <span>persistent scrollback over the current Worker-backed workspace</span>
            <label class="workspace-chip">
              <span>workspace</span>
              <input id="workspace" name="workspace" form="shell-form" value="#{h(workspace)}" maxlength="64" pattern="[A-Za-z0-9](?:[A-Za-z0-9._]|-){0,63}" required>
            </label>
          </div>
          #{error_block}
          <section class="terminal-panel">
            <div class="terminal-title">terminal</div>
            <pre class="terminal-output terminal-history" id="terminal-history">#{h(format_terminal_history(snapshot || {}))}</pre>
            <form id="shell-form" class="prompt-form" action="/shell" method="post">
              <span class="prompt-label">#{h(prompt)}</span>
              <div class="prompt-input">
                <textarea id="command" name="command" placeholder="printf 'hello from homura' > /notes.txt" required>#{h(command)}</textarea>
                <div class="hint">Enter to run, Shift+Enter for a newline</div>
              </div>
              <button type="submit">run</button>
            </form>
          </section>
          #{snapshot_block}
        </div>
      </div>
      <script>
        const history = document.getElementById("terminal-history");
        if (history) history.scrollTop = history.scrollHeight;
        const command = document.getElementById("command");
        if (command) {
          const resize = () => {
            command.style.height = "auto";
            command.style.height = Math.min(command.scrollHeight, 220) + "px";
          };
          resize();
          command.addEventListener("input", resize);
          command.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              command.form?.requestSubmit();
            }
          });
          command.focus();
          command.setSelectionRange(command.value.length, command.value.length);
        }
      </script>
    </body>
    </html>
  HTML
end

get("/") do
  content_type("text/html; charset=utf-8")
  workspace = normalize_workspace_name(params["workspace"] || "demo")
  snapshot, = workspace_request!(workspace, "/state").__await__
  page(workspace: workspace, snapshot: snapshot)
rescue WorkspaceShellError => e
  status(e.status)
  page(workspace: params["workspace"] || "demo", error: e.message)
end

post("/shell") do
  content_type("text/html; charset=utf-8")
  workspace = normalize_workspace_name(params["workspace"])
  command = params["command"].to_s
  response, payload, = workspace_request(workspace, "/command", method: "POST", payload: {"command" => command})
    .__await__
  status(response.status)
  snapshot = nil
  begin
    snapshot, = workspace_request!(workspace, "/state").__await__
  rescue WorkspaceShellError
    snapshot = nil
  end

  page(
    workspace: workspace,
    command: "",
    snapshot: snapshot,
    error: payload["error"]
  )
rescue WorkspaceShellError => e
  status(e.status)
  page(
    workspace: params["workspace"] || "demo",
    command: params["command"].to_s,
    error: e.message
  )
end

get("/api/workspaces/:name") do
  content_type("application/json; charset=utf-8")
  response, payload, = workspace_request(params["name"], "/state").__await__
  status(response.status)
  payload.to_json
rescue WorkspaceShellError => e
  status(e.status)
  {"error" => e.message}.to_json
end

post("/api/workspaces/:name/command") do
  content_type("application/json; charset=utf-8")
  request.body.rewind if request.body.respond_to?(:rewind)
  raw = request.body.read.to_s
  body = raw.empty? ? {} : JSON.parse(raw)
  command = body["command"] || params["command"]
  response, payload, = workspace_request(
    params["name"],
    "/command",
    method: "POST",
    payload: {"command" => command}
  )
    .__await__
  status(response.status)
  payload.to_json
rescue JSON::ParserError
  status(400)
  {"error" => "Request body must be valid JSON."}.to_json
rescue WorkspaceShellError => e
  status(e.status)
  {"error" => e.message}.to_json
end

get("/workspaces/:name/files/*") do
  path = params["splat"].is_a?(Array) ? params["splat"][0].to_s : ""
  response, payload, = workspace_request(
    params["name"],
    "/read",
    method: "POST",
    payload: {"path" => "/#{path}"}
  )
    .__await__
  status(response.status)
  if response.ok?
    content_type(payload["content_type"] || "text/plain; charset=utf-8")
    payload["body"].to_s
  else
    content_type("application/json; charset=utf-8")
    payload.to_json
  end

rescue WorkspaceShellError => e
  status(e.status)
  content_type("application/json; charset=utf-8")
  {"error" => e.message}.to_json
end
