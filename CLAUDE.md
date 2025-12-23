# Project Instructions

## Continuity

タスク開始時に必ず `CONTINUITY.md` を確認し、作業中・完了時に随時更新すること。

## Project Overview

Homura - Hono-like Ruby DSL web framework for Cloudflare Workers (mruby + WASI)

## Directory Structure

```
claude/
├── src/index.ts       # Main framework + Ruby DSL
├── mruby/
│   ├── Makefile       # WASI build
│   ├── build_config.rb
│   ├── src/homura_entry.c
│   └── build/mruby.wasm
└── CONTINUITY.md      # Progress tracking
```

## Development

```bash
cd claude
npm run dev  # Start dev server (wrangler dev)
```

## Key Technical Decisions

- wasm-sjlj (`-mllvm -wasm-enable-sjlj`) for setjmp/longjmp support
- JSON serialization in C (value_to_json) to avoid double-encoding
