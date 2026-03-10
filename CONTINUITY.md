# Continuity Ledger

## Goal（成功基準を含む）
- mruby + WASI + Cloudflare Workers で Hono の Ruby 代替「homura」を作成
- Ruby DSL でルーティング・ミドルウェアを記述可能にする
- Cloudflare Workers で実際に動作すること ✅

## Constraints/Assumptions（制約/前提）
- 作業ディレクトリ: `/Users/kazuph/src/github.com/kazuph/homura-claude/`
- Phase 1: JS で API 設計を検証（完了）
- Phase 2: mruby を WASI ターゲットでコンパイルして wasm を生成（完了 ✅）

## Key decisions（重要な決定）
- アーキテクチャ: mruby → wasm (WASI) + JS グルーコード
- ruby.wasm (CRuby) は Cold Start が重いため不採用
- 段階的実装: Phase 1 (JS) → Phase 2 (mruby.wasm)
- **wasm-sjlj**: setjmp/longjmp を JS 側で実装（`-mllvm -wasm-enable-sjlj`）
- **JSON シリアライズ**: Ruby で to_json せず、C の value_to_json で一括変換（二重エンコード回避）

## State（状態）

### Done（完了）
- 技術選定完了（mruby + WASI + Workers）
- package.json, wrangler.toml 作成
- Homura フレームワーク実装
- **Phase 2: mruby WASI ビルド完了 ✅**
  - wasi-sdk インストール (`~/.local/wasi-sdk`)
  - mruby ソースのクローン・ビルド（790KB wasm）
  - wasm-sjlj 対応（`__wasm_setjmp`, `__wasm_longjmp`, `__wasm_setjmp_test` を JS 実装）
  - JS から mruby.wasm を呼び出す統合
  - WASI imports 実装（fd_write, clock_time_get, random_get 等）
- **Phase 3: JSX テンプレートシステム ✅**
  - カスタム JSX ランタイム実装 (`src/lib/jsx-runtime.ts`, `src/lib/render.ts`)
  - Ruby `c.jsx("template", props)` → JS `renderTemplate()` 連携
  - To-Do アプリテンプレート + レイアウトシステム
  - CSS配信 (`/assets/app.css`)
- **Phase 4: セキュリティ + D1 + 機能拡張 ✅**
  - eval 注入をMessagePack経路に置換（Critical修正）
  - エラーハンドリング正常化（500応答、coreLoaded制御）
  - D1連携: To-Do CRUDアプリ（GET/POST/PUT/DELETE）
  - ミドルウェアチェーン（`use`/`next`パターン）
  - `json_body` を実際にJSONパースするよう修正
  - Content-Typeバリデーションミドルウェア例
  - ドキュメント整合（README/CONTINUITY更新）

- **Phase 5: Core Routing Completion**
  - `options`, `all`, `on` メソッド追加
  - ワイルドカードルート `/api/*`
  - オプショナルパラメータ `:type?`
  - サブアプリマウント `route(path, sub_app)`
  - `base_path(prefix)` ベースパス設定
- **Phase 6: Context API Completion**
  - `c.set(key, value)` / `c.get(key)` 変数ストア
  - `c.body(data, status:, headers:)` 生レスポンス
  - `c.not_found` 404応答ヘルパー
  - `req.url` フルURL
  - `req.queries(key)` 複数値クエリ
- **Phase 7: Built-in Middleware (10種)**
  - CORS, Logger, BasicAuth, BearerAuth, PoweredBy
  - PrettyJson, SecureHeaders, RequestId, ETag, BodyLimit
  - `Homura::Middleware` モジュールとして実装
- **Phase 8: Cookie & Helper Functions**
  - `c.cookie(name)`, `c.set_cookie(name, value, opts)`, `c.delete_cookie(name)`
  - `app.request(method, path, opts)` テストヘルパー
  - `View.tag(name, attrs, &block)` HTML ビルダー
- **Phase 9: Advanced Routing**
  - 正規表現ルート `:date{[0-9]+}`
  - `app.mount(path, other_app)` アプリマウント

- **Phase 10: Context API 仕上げ**
  - `c.new_response(body, status, headers)` 任意レスポンス生成
  - `c.render(content)` + `c.set_renderer(&block)` レイアウト
  - `c.header(name, value, append: true)` ヘッダ追記モード
- **Phase 11: Request API 仕上げ**
  - `req.parse_body` URLエンコードフォームデータパース
  - `req.valid(target)` + `req.add_validated_data` バリデーション連携
  - `req.route_path` マッチしたルートパターン取得
- **Phase 12: HTTPException クラス**
  - `raise HTTPException.new(401, message: "...")` パターン
  - `get_response` カスタムレスポンス生成
  - `on_error` 自動連携
- **Phase 13: 残りのミドルウェア**
  - CSRF (origin検証)
  - IP Restriction (deny/allow list)
  - Timing (Server-Timing header + startTime/endTime/setMetric)
- **Phase 14: Hono API 名前互換**
  - `app.fetch`, `app.notFound`, `app.onError` エイリアス
  - strict mode (trailing slash区別, default: true)
- **Phase 15: Deploy**
  - Cloudflare Workers デプロイ完了
  - URL: https://homura.kazu-san.workers.dev

### Now（現在）
- **Phase 15 完了！** 全63テスト、186アサーション、0 failures
- Hono完全互換APIサーフェスの実装 + デプロイ完了
- 本番URL: https://homura.kazu-san.workers.dev

## Resolved questions（解決済み）
- **mruby と JS 間の受け渡し**: MessagePack経由（homura_handle_request）
- **eval の用途**: フレームワークコア/ユーザールートのロードのみ（信頼されたコード）
- **Ruby コード配置**: JS 内に埋め込み（HOMURA_CORE, USER_ROUTES 定数）
- **setjmp/longjmp**: wasm-sjlj + JS ヘルパー関数で実装
- **D1アクセス**: JS側で直接D1 APIを呼び出し（mrubyからはKV経由のみ）

## Open questions（未解決の質問）
- Cloudflare Workers 本番デプロイ時のパフォーマンス
- mruby.wasm のサイズ最適化（現在 790KB）

## Working set（作業セット）
- /Users/kazuph/src/github.com/kazuph/homura/
  - examples/webapp/src/index.ts (Worker entry + D1 handler + mruby統合)
  - examples/webapp/src/templates.tsx (JSX テンプレート: To-Doアプリ)
  - examples/webapp/app/routes.rb (Rubyルート定義)
  - examples/webapp/app/styles.css (アプリケーションCSS)
  - examples/webapp/migrations/ (D1マイグレーション)
  - lib/homura.rb (フレームワークコア: ルーティング、Context、ミドルウェア)
  - mruby/
    - Makefile (WASI ビルド)
    - build_config.rb (mruby クロスコンパイル設定)
    - src/homura_entry.c (C API: init, eval, handle_request via MessagePack)
    - build/mruby.wasm (出力 790KB)
