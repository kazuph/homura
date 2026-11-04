# Changelog

## 1.1.0

- Preserve Kagero HTML on partial reloads and synchronize title and history.
- Send the CSRF header for same-origin unsafe visits and show visit failures.
- Accept valid Inertia page JSON even when the response header is missing.
- With CSRF protection enabled, ordinary form submissions without JavaScript
  receive HTTP 403 because they cannot send the required header.
- Partial reloads replace the full HTML while retaining omitted props.

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
