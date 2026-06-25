# agent-workspace

A workspace example for homura Ruby using **both** Cloudflare Durable Objects
and R2 through **`@cloudflare/shell`**.

- One named Durable Object owns each workspace.
- `@cloudflare/shell` stores workspace metadata in Durable Object SQLite.
- Files larger than `2048` bytes are offloaded into the `BUCKET` R2 bucket.
- Commands run through `just-bash`, so `grep`, `cat`, `ls`, pipes, and
  redirections work inside the Worker.

## Routes

- `GET /` — browser UI
- `POST /shell` — run one shell command from the form
- `GET /api/workspaces/:name` — JSON workspace snapshot
- `POST /api/workspaces/:name/command` — JSON command runner
- `GET /workspaces/:name/files/*` — read one file body

## Commands

```text
pwd
ls /
printf 'hello from homura' > /notes.txt
grep homura /notes.txt | wc -l
cat /notes.txt
rm /notes.txt
```

Example commands:

```text
printf 'hello from homura' > /notes.txt
printf ' and R2' >> /notes.txt
grep homura /notes.txt | wc -l
cat /notes.txt
rm /notes.txt
```

Convenience helpers are also available:

```text
write /notes.txt "hello from homura"
append /notes.txt " and R2"
stat /notes.txt
```

## Local run

```bash
bundle install
npm install
bundle exec rake build
bundle exec rake dev
```

Then open the printed `*.localhost` URL. The default workspace is `demo`.

## Deploy

Create the R2 buckets first:

```bash
npx wrangler r2 bucket create agent-workspace
npx wrangler r2 bucket create agent-workspace-preview
```

Then deploy:

```bash
bundle exec rake deploy
```

`wrangler.toml` already binds:

- `WORKSPACE` — the Durable Object namespace
- `BUCKET` — the R2 bucket used for large file bodies

## Why this example exists

This is the Ruby-side equivalent of the Cloudflare support-agent pattern:
`@cloudflare/shell` mounts a DO+R2-backed workspace inside the Worker, and the
browser UI lets you exercise it before layering an AI agent on top.
