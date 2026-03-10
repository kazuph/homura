# JSON Transform integration notes

- `GET /` returns 200 and endpoint documentation as JSON
- `POST /transform/filter` rejects non-array `data` with 400
- `POST /transform/map` requires `data` and `fields`
- `POST /transform/group` groups rows by the selected field
- `POST /transform/unique` deduplicates rows via `Set`
- `POST /transform/pipeline` can chain `filter`, `sort`, `limit`, `map`
- `GET /api/test-gems` returns lazy enumerator, set, and enumerator examples
