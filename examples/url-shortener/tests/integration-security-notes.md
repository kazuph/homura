# Integration & Security Test Matrix (Phase F-26/F-27)

## Integration tests
- Ruby CRUD API
  - `GET /api/todos` returns 200 and JSON list
  - `POST /api/todos` with empty body returns 415
  - `GET /api/todos/:id` invalid id returns 400
  - `GET /api/todos/:id` missing row returns 404
  - `PUT /api/todos/:id` accepts partial update and returns 404 if not exist
  - `DELETE /api/todos/:id` not exist returns 404
- Middleware behavior
  - `/api` POST/PUT/PATCH with invalid content-type + body returns 415
- KV regression
  - `/counter`, `/counter/reset`, `/kv/users/:name` endpoints remain in Ruby routes

## Security tests
- XSS
  - Insert `<script>alert(1)</script>` in todo title and verify HTML is escaped in rendered list
- Invalid JSON
  - Send malformed JSON to POST /api/todos and expect an error response with status 400/500
- Large payload
  - Send oversized JSON body and verify MessagePack size guard returns 413 when encoded payload exceeds threshold
- MessagePack hardening
  - Validate malformed map/array types and oversized payloads are rejected by schema checks
- D1 bind/type abuse
  - Verify SQL text too long and bind count too many are rejected by bridge validation
