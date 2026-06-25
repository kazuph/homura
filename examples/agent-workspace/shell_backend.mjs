import { posix } from "node:path";

import { Workspace, WorkspaceFileSystem } from "@cloudflare/shell";
import { Bash, defineCommand } from "just-bash";

const WORKSPACE_NAMESPACE = "agentworkspace";
const bucketRegistry = new WeakMap();
const HISTORY_KEY = "terminal:history";
const HISTORY_LIMIT = 80;

function workspaceId(state) {
  return state?.id && typeof state.id.toString === "function"
    ? state.id.toString()
    : String(state?.id ?? "workspace");
}

function invalid(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function decodeBytes(value) {
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return String(value ?? "");
}

function normalizeTextOutput(value) {
  return String(value ?? "").replace(/\s+$/, "");
}

function formatCommandOutput(result) {
  const parts = [];
  const stdout = normalizeTextOutput(result.stdout);
  const stderr = normalizeTextOutput(result.stderr);

  if (stdout) parts.push(stdout);
  if (stderr) parts.push(stderr);
  if (result.exitCode !== 0) parts.push(`(exit ${result.exitCode})`);

  return parts.join("\n") || "(no output)";
}

async function readHistory(state) {
  const raw = await state.storage.get(HISTORY_KEY);
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function appendHistory(state, entry) {
  const history = await readHistory(state);
  history.push(entry);
  const next = history.slice(-HISTORY_LIMIT);
  await state.storage.put(HISTORY_KEY, JSON.stringify(next));
  return next;
}

function sameEntries(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function adaptStat(cfStat) {
  return {
    isFile: cfStat.type === "file",
    isDirectory: cfStat.type === "directory",
    isSymbolicLink: cfStat.type === "symlink",
    mode: cfStat.mode ?? (cfStat.type === "directory" ? 0o755 : 0o644),
    size: cfStat.size,
    mtime: cfStat.mtime,
  };
}

function adaptToJustBash(cfFs) {
  return {
    readFile: (path, _opts) => cfFs.readFile(path),
    readFileBuffer: (path) => cfFs.readFileBytes(path),
    async writeFile(path, content, _opts) {
      if (typeof content === "string") {
        await cfFs.writeFile(path, content);
      } else {
        await cfFs.writeFileBytes(path, content);
      }
    },
    appendFile: (path, content, _opts) => cfFs.appendFile(path, content),
    exists: (path) => cfFs.exists(path),
    async stat(path) {
      return adaptStat(await cfFs.stat(path));
    },
    async lstat(path) {
      return adaptStat(await cfFs.lstat(path));
    },
    mkdir: (path, opts) => cfFs.mkdir(path, opts),
    readdir: (path) => cfFs.readdir(path),
    async readdirWithFileTypes(path) {
      const entries = await cfFs.readdirWithFileTypes(path);
      return entries.map((entry) => ({
        name: entry.name,
        isFile: entry.type === "file",
        isDirectory: entry.type === "directory",
        isSymbolicLink: entry.type === "symlink",
      }));
    },
    rm: (path, opts) => cfFs.rm(path, opts),
    cp: (src, dest, opts) => cfFs.cp(src, dest, opts),
    mv: (src, dest) => cfFs.mv(src, dest),
    resolvePath: (base, path) => cfFs.resolvePath(base, path),
    getAllPaths: () => [],
    async chmod(_path, _mode) {},
    symlink: (target, linkPath) => cfFs.symlink(target, linkPath),
    async link(existingPath, newPath) {
      const content = await cfFs.readFileBytes(existingPath);
      await cfFs.writeFileBytes(newPath, content);
    },
    readlink: (path) => cfFs.readlink(path),
    realpath: (path) => cfFs.realpath(path),
    async utimes(_path, _atime, _mtime) {},
  };
}

async function ensureWorkspaceReady(workspace) {
  await workspace.exists("/");
}

function createWorkspace(state, bucketBinding, inlineThreshold) {
  const sqlSource = state?.storage?.sql;
  if (!sqlSource) {
    throw invalid("state.storage.sql missing.", 500);
  }

  const stableBucket = bucketRegistry.get(sqlSource) ?? bucketBinding;
  if (!stableBucket) {
    throw invalid("BUCKET binding missing.", 503);
  }
  if (!bucketRegistry.has(sqlSource)) {
    bucketRegistry.set(sqlSource, stableBucket);
  }

  return new Workspace({
    sql: sqlSource,
    r2: stableBucket,
    name: () => workspaceId(state),
    namespace: WORKSPACE_NAMESPACE,
    inlineThreshold,
  });
}

async function listEntries(workspace) {
  await ensureWorkspaceReady(workspace);
  return workspace.sql.query(
    `SELECT path, name, type, size, storage_backend, mime_type, modified_at
       FROM ${workspace.tableName}
      WHERE path <> '/'
      ORDER BY path`,
  );
}

async function entryForPath(workspace, path) {
  await ensureWorkspaceReady(workspace);
  return (
    await workspace.sql.query(
      `SELECT path, name, type, size, storage_backend, mime_type, modified_at
         FROM ${workspace.tableName}
        WHERE path = ?`,
      path,
    )
  )[0] ?? null;
}

function toSnapshotEntry(row) {
  return {
    path: row.path,
    name: row.name,
    type: row.type,
    size: row.type === "file" ? Number(row.size ?? 0) : undefined,
    storage: row.type === "file" ? row.storage_backend : undefined,
    content_type: row.type === "file" ? row.mime_type : undefined,
    updated_at: row.modified_at ?? null,
  };
}

async function ensureParentDirectory(fs, targetPath) {
  const parent = posix.dirname(targetPath);
  if (parent && parent !== "." && parent !== targetPath) {
    await fs.mkdir(parent, { recursive: true });
  }
}

function createCustomCommands(workspace) {
  const fs = new WorkspaceFileSystem(workspace);

  return [
    defineCommand("write", async (args, ctx) => {
      if (args.length < 2) {
        return { stdout: "", stderr: "usage: write <path> <text>\n", exitCode: 1 };
      }

      const targetPath = ctx.fs.resolvePath(ctx.cwd, args[0]);
      const text = args.slice(1).join(" ");
      await ensureParentDirectory(ctx.fs, targetPath);
      await fs.writeFile(targetPath, text);
      const row = await entryForPath(workspace, targetPath);
      return {
        stdout: `wrote ${targetPath} (${row?.size ?? Buffer.byteLength(text)}, ${row?.storage_backend ?? "inline"})\n`,
        stderr: "",
        exitCode: 0,
      };
    }),
    defineCommand("append", async (args, ctx) => {
      if (args.length < 2) {
        return { stdout: "", stderr: "usage: append <path> <text>\n", exitCode: 1 };
      }

      const targetPath = ctx.fs.resolvePath(ctx.cwd, args[0]);
      const text = args.slice(1).join(" ");
      await ensureParentDirectory(ctx.fs, targetPath);
      await fs.appendFile(targetPath, text);
      const row = await entryForPath(workspace, targetPath);
      return {
        stdout: `updated ${targetPath} (${row?.size ?? 0}, ${row?.storage_backend ?? "inline"})\n`,
        stderr: "",
        exitCode: 0,
      };
    }),
    defineCommand("stat", async (args, ctx) => {
      if (args.length !== 1) {
        return { stdout: "", stderr: "usage: stat <path>\n", exitCode: 1 };
      }

      const targetPath = ctx.fs.resolvePath(ctx.cwd, args[0]);
      const row = await entryForPath(workspace, targetPath);
      if (!row && targetPath !== "/") {
        return { stdout: "", stderr: `No such path: ${targetPath}\n`, exitCode: 1 };
      }

      if (targetPath === "/") {
        const entries = await listEntries(workspace);
        return {
          stdout: `${JSON.stringify({ path: "/", type: "directory", children: entries.length }, null, 2)}\n`,
          stderr: "",
          exitCode: 0,
        };
      }

      return {
        stdout: `${JSON.stringify(toSnapshotEntry(row), null, 2)}\n`,
        stderr: "",
        exitCode: 0,
      };
    }),
  ];
}

function createShell(workspace) {
  const fs = adaptToJustBash(new WorkspaceFileSystem(workspace));
  return new Bash({
    fs,
    cwd: "/",
    customCommands: createCustomCommands(workspace),
  });
}

async function snapshot(state, bucketBinding, _payload, inlineThreshold) {
  const workspace = createWorkspace(state, bucketBinding, inlineThreshold);
  const entries = await listEntries(workspace);
  const history = await readHistory(state);
  return {
    workspace_id: workspaceId(state),
    offload_threshold_bytes: inlineThreshold,
    entries: entries.map(toSnapshotEntry),
    history,
  };
}

async function readFile(state, bucketBinding, payload, inlineThreshold) {
  const path = String(payload?.path ?? "");
  const workspace = createWorkspace(state, bucketBinding, inlineThreshold);
  const fs = new WorkspaceFileSystem(workspace);
  const row = await entryForPath(workspace, path);

  if (!row) throw invalid(`No such path: ${path}`);
  if (row.type !== "file") throw invalid(`${path} is a directory.`);

  return {
    path,
    storage: row.storage_backend,
    content_type: row.mime_type ?? "text/plain; charset=utf-8",
    body: decodeBytes(await fs.readFileBytes(path)),
  };
}

async function executeCommand(state, bucketBinding, payload, inlineThreshold) {
  const command = String(payload?.command ?? "");
  if (command.trim() === "") throw invalid("Enter a command.");

  const workspace = createWorkspace(state, bucketBinding, inlineThreshold);
  const before = await listEntries(workspace);
  const shell = createShell(workspace);
  const result = await shell.exec(command);
  const after = await listEntries(workspace);
  const output = formatCommandOutput(result);
  const history = await appendHistory(state, {
    command,
    output,
    exit_code: result.exitCode,
  });

  return {
    command,
    changed: !sameEntries(before, after),
    exit_code: result.exitCode,
    output,
    history,
  };
}

globalThis.__AGENT_WORKSPACE_SHELL__ = {
  executeCommand,
  readFile,
  snapshot,
};
