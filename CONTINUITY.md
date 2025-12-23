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
- claude/ ディレクトリ作成
- package.json, wrangler.toml 作成
- Homura フレームワーク（JS版）実装
- **Phase 2: mruby WASI ビルド完了 ✅**
  - wasi-sdk インストール (`~/.local/wasi-sdk`)
  - mruby ソースのクローン・ビルド（905KB wasm）
  - wasm-sjlj 対応（`__wasm_setjmp`, `__wasm_longjmp`, `__wasm_setjmp_test` を JS 実装）
  - JS から mruby.wasm を呼び出す統合
  - WASI imports 実装（fd_write, clock_time_get, random_get 等）
- **Ruby DSL ルーティング動作確認 ✅**
  - `GET /` → JSON レスポンス
  - `GET /about` → テキストレスポンス
  - `GET /users/:id` → パスパラメータ付き JSON
  - `GET /hello/:name` → HTML レスポンス
  - `GET /health` → ヘルスチェック JSON
  - 404 ハンドリング
- **Phase 3: JSX テンプレートシステム ✅**
  - カスタム JSX ランタイム実装 (`src/jsx/jsx-runtime.ts`, `src/jsx/render.ts`)
  - Ruby `c.jsx("template", props)` → JS `renderTemplate()` 連携
  - Home/About テンプレート + レイアウトシステム
  - CSS エンドポイント (`/assets/app.css`)

### Now（現在）
- **Phase 3 完了！** 🎉
- 開発サーバー: `http://localhost:55126`
- JSX テンプレートシステム動作中

### Next（次）
- Phase 4: 機能拡張（必要に応じて）
  - POST/PUT/DELETE サポート
  - ミドルウェアチェーン
  - リクエストボディパース
  - Cloudflare デプロイ

## Resolved questions（解決済み）
- **mruby と JS 間の受け渡し**: 共有バッファ経由（input_buffer → eval → output_buffer）
- **Ruby コード配置**: JS 内に埋め込み（HOMURA_CORE, USER_ROUTES 定数）
- **setjmp/longjmp**: wasm-sjlj + JS ヘルパー関数で実装

## Open questions（未解決の質問）
- Cloudflare Workers 本番デプロイ時のパフォーマンス
- mruby.wasm のサイズ最適化（現在 905KB）

## Working set（作業セット）
- /Users/kazuph/src/github.com/kazuph/homura-claude/
  - src/index.ts (メインフレームワーク + Ruby DSL)
  - src/templates.tsx (JSX テンプレート定義)
  - src/jsx/
    - jsx-runtime.ts (カスタム JSX ファクトリ)
    - render.ts (renderToString 実装)
  - mruby/
    - Makefile (WASI ビルド)
    - build_config.rb (mruby クロスコンパイル設定)
    - src/homura_entry.c (C API: init, eval, handle_request)
    - build/mruby.wasm (出力)
