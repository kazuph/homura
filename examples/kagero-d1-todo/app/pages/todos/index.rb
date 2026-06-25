# frozen_string_literal: true

require "sinatra/kagero"

module Pages
  module Todos
    class Index < Kagero::Page
      title "Kagero D1 Todo"

      props do
        prop :todos, Array
        prop :stats, Hash, required: false, default: -> { {} }
        prop :errors, Hash, required: false, default: -> { {} }
        prop :flash, Hash, required: false, default: -> { {} }
      end

      def view_template
        style { raw(safe(css)) }

        section(class: "shell") do
          header(class: "hero") do
            p(class: "eyebrow") { "Homura::Kagero 1.0 target" }
            h1 { "Ruby-way Inertia experience on Workers" }
            p(class: "lead") do
              plain("Routes, page props, validation, forms, and D1 access stay in Ruby. ")
              plain("The hidden Kagero runtime handles navigation, history, redirects, and partial reloads.")
            end
          end

          render_flash
          render_stats
          render_form
          render_list
        end
      end

      private

      def render_flash
        notice = @flash[:notice] || @flash["notice"]
        return if notice.to_s.empty?

        div(class: "flash", role: "status") { notice.to_s }
      end

      def render_stats
        section(class: "stats", "data-testid": "stats") do
          stat("Total", stat_value(:total))
          stat("Open", stat_value(:open))
          stat("Done", stat_value(:done))
          kagero_partial_button(only: :stats, class: "stat refresh", "aria-label": "Refresh stats") do
            span { "Partial reload" }
            strong { "stats" }
          end
        end
      end

      def stat(label, value)
        div(class: "stat") do
          strong { value.to_s }
          span { label }
        end
      end

      def render_form
        section(class: "panel", "aria-label": "Create TODO") do
          kagero_form(action: "/todos", method: "post", class: "new-form", "data-kagero-preserve-scroll": "true") do
            div(class: "field") do
              label(for: "title") { "Title" }
              input(
                id: "title",
                type: "text",
                name: "title",
                placeholder: "次にやること",
                "aria-invalid": field_error?(:title).to_s,
                "aria-describedby": field_error?(:title) ? "title-error" : nil
              )
              if field_error?(:title)
                p(id: "title-error", class: "error", role: "alert") { error_for(:title) }
              end
            end
            button(type: "submit", class: "button-primary") { "追加" }
          end
        end
      end

      def render_list
        section(class: "panel", "aria-label": "TODO list") do
          if @todos.empty?
            p(class: "empty") { "まだTODOはありません。" }
          else
            ul(class: "todo-list") do
              @todos.each do |todo|
                render_item(todo)
              end
            end
          end
        end
      end

      def render_item(todo)
        done = boolean_value(todo, :done)
        id = integer_value(todo, :id)
        title = string_value(todo, :title)

        li(class: "todo-item #{done ? "done" : ""}") do
          span(class: "badge #{done ? "badge-done" : "badge-open"}") { done ? "Done" : "Open" }
          span(class: "todo-title") { title }

          kagero_form(action: "/todos/#{id}/toggle", method: "post", "data-kagero-preserve-scroll": "true") do
            button(type: "submit") { done ? "戻す" : "完了" }
          end

          kagero_form(action: "/todos/#{id}/delete", method: "post", "data-kagero-preserve-scroll": "true") do
            button(type: "submit", class: "button-danger") { "削除" }
          end
        end
      end

      def error_for(name)
        message = @errors[name] || @errors[name.to_s] || ""
        case message
        when "title_required"
          "タイトルは必須です"
        when "title_too_long"
          "80文字以内で入力してください"
        else
          message.to_s
        end
      end

      def field_error?(name)
        !error_for(name).to_s.empty?
      end

      def stat_value(name)
        @stats[name] || @stats[name.to_s] || 0
      end

      def integer_value(row, key)
        value = row[key] || row[key.to_s]
        return 1 if value == true
        return 0 if value == false

        value.to_i
      end

      def string_value(row, key)
        value = row[key] || row[key.to_s]
        value.to_s
      end

      def boolean_value(row, key)
        value = row[key] || row[key.to_s]
        return true if value == true
        return false if value == false || value.nil?

        value.to_i == 1
      end

      def css
        <<~CSS
          :root {
            color-scheme: light;
            --bg: #f7f8fb;
            --panel: #ffffff;
            --ink: #172033;
            --muted: #5f6b7a;
            --line: #d7dee8;
            --accent: #0f766e;
            --accent-dark: #115e59;
            --danger: #b42318;
            --danger-bg: #fff1f0;
            --ok: #047857;
            --ok-bg: #ecfdf5;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            min-height: 100vh;
            background: var(--bg);
            color: var(--ink);
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif;
          }
          main {
            width: min(960px, calc(100vw - 32px));
            margin: 0 auto;
            padding: 40px 0;
          }
          .shell { display: grid; gap: 18px; }
          .hero { display: grid; gap: 10px; }
          .eyebrow {
            margin: 0;
            color: var(--accent);
            font-size: 0.82rem;
            font-weight: 800;
            letter-spacing: 0;
            text-transform: uppercase;
          }
          h1 {
            margin: 0;
            font-size: clamp(2rem, 4vw, 3.4rem);
            line-height: 1.04;
            letter-spacing: 0;
          }
          .lead {
            max-width: 740px;
            margin: 0;
            color: var(--muted);
            line-height: 1.75;
          }
          .flash {
            border: 1px solid #a7f3d0;
            background: #ecfdf5;
            color: #065f46;
            border-radius: 8px;
            padding: 12px 14px;
          }
          .stats {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
          }
          .stat {
            border: 1px solid var(--line);
            background: var(--panel);
            border-radius: 8px;
            padding: 14px 16px;
          }
          .stat strong {
            display: block;
            font-size: 1.45rem;
          }
          .stat span {
            color: var(--muted);
            font-size: 0.84rem;
          }
          .refresh {
            min-height: 76px;
            text-align: left;
            cursor: pointer;
          }
          .panel {
            border: 1px solid var(--line);
            background: var(--panel);
            border-radius: 8px;
            overflow: hidden;
          }
          .new-form {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 12px;
            align-items: end;
            padding: 16px;
          }
          .field { display: grid; gap: 6px; }
          label {
            color: var(--muted);
            font-size: 0.86rem;
            font-weight: 700;
          }
          input[type="text"] {
            width: 100%;
            min-height: 42px;
            border: 1px solid var(--line);
            border-radius: 6px;
            padding: 0 12px;
            font: inherit;
          }
          input[aria-invalid="true"] { border-color: var(--danger); }
          button {
            min-height: 38px;
            border: 1px solid var(--line);
            border-radius: 6px;
            background: #fff;
            color: var(--ink);
            padding: 0 12px;
            font: inherit;
            cursor: pointer;
          }
          .button-primary {
            min-height: 42px;
            border-color: var(--accent);
            background: var(--accent);
            color: #fff;
            font-weight: 800;
          }
          .button-primary:hover { background: var(--accent-dark); }
          .button-danger {
            border-color: #fecaca;
            background: var(--danger-bg);
            color: var(--danger);
          }
          .todo-list {
            list-style: none;
            margin: 0;
            padding: 0;
          }
          .todo-item {
            display: grid;
            grid-template-columns: auto minmax(0, 1fr) auto auto;
            gap: 10px;
            align-items: center;
            padding: 14px 16px;
            border-bottom: 1px solid var(--line);
          }
          .todo-item:last-child { border-bottom: 0; }
          .todo-title { min-width: 0; overflow-wrap: anywhere; }
          .todo-item.done .todo-title {
            color: var(--muted);
            text-decoration: line-through;
          }
          .badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 70px;
            min-height: 28px;
            border-radius: 999px;
            padding: 0 10px;
            font-size: 0.8rem;
            font-weight: 800;
          }
          .badge-open { background: #ecfeff; color: #155e75; }
          .badge-done { background: var(--ok-bg); color: var(--ok); }
          .empty {
            margin: 0;
            padding: 28px 16px;
            color: var(--muted);
          }
          .error {
            margin: 0;
            color: var(--danger);
            font-size: 0.86rem;
          }
          @media (max-width: 720px) {
            main { padding: 24px 0; }
            .stats { grid-template-columns: 1fr 1fr; }
            .new-form { grid-template-columns: 1fr; }
            .todo-item { grid-template-columns: 1fr; align-items: stretch; }
          }
        CSS
      end
    end
  end
end
