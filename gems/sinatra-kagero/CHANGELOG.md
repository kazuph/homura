# Changelog

## 1.0.2 — 2026-06-26

- Submit regular Kagero forms as UTF-8 URL-encoded bodies, preserving
  non-ASCII text on Workers while keeping multipart for file forms.

## 1.0.1 — 2026-06-26

- Add a thin top loading bar to the browser runtime while Kagero SPA visits
  are in flight.

## 1.0.0 — 2026-06-25

- Extract Kagero from `sinatra-inertia` into its own gem.
- Provide Ruby page classes, props validation, command validation, and the hidden Kagero browser runtime.
- Keep `sinatra-inertia` as the lower-level Inertia protocol adapter.
