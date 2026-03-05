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

### Now（現在）
- **Phase 4 完了！** 🎉
- To-Do アプリ（D1永続化）がローカルで動作中
- 開発サーバー: `http://localhost:8787`

### Next（次）
- Phase 5: 本番デプロイ
  - D1マイグレーション（リモート）
  - Cloudflare Workers デプロイ
  - E2E テスト・スクリーンショット検証

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
