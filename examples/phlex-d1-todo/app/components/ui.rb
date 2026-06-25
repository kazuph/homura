# frozen_string_literal: true

require "cgi"
require "phlex"
require "literal"

module Components
  class Base < Phlex::HTML
    private

    def css
      <<~CSS
        :root {
          color-scheme: light;
          --bg: #f7f8fb;
          --panel: #ffffff;
          --ink: #1f2937;
          --muted: #6b7280;
          --line: #d8dee8;
          --accent: #2563eb;
          --accent-dark: #1d4ed8;
          --danger: #b91c1c;
          --danger-bg: #fff1f2;
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
          width: min(920px, calc(100vw - 32px));
          margin: 0 auto;
          padding: 40px 0;
        }
        .shell {
          display: grid;
          gap: 20px;
        }
        .hero {
          display: grid;
          gap: 10px;
        }
        .eyebrow {
          margin: 0;
          color: var(--accent);
          font-size: 0.82rem;
          font-weight: 700;
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
          max-width: 680px;
          margin: 0;
          color: var(--muted);
          font-size: 1rem;
          line-height: 1.75;
        }
        .stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
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
          font-size: 1.5rem;
        }
        .stat span {
          color: var(--muted);
          font-size: 0.84rem;
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
          gap: 10px;
          padding: 16px;
          border-bottom: 1px solid var(--line);
        }
        input[type="text"] {
          width: 100%;
          min-height: 42px;
          border: 1px solid var(--line);
          border-radius: 6px;
          padding: 0 12px;
          font: inherit;
        }
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
          border-color: var(--accent);
          background: var(--accent);
          color: #fff;
          font-weight: 700;
        }
        .button-primary:hover { background: var(--accent-dark); }
        .button-danger {
          border-color: #fecdd3;
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
        .todo-title {
          min-width: 0;
          overflow-wrap: anywhere;
        }
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
          font-weight: 700;
        }
        .badge-open {
          background: #eff6ff;
          color: var(--accent-dark);
        }
        .badge-done {
          background: var(--ok-bg);
          color: var(--ok);
        }
        .empty {
          margin: 0;
          padding: 28px 16px;
          color: var(--muted);
        }
        .note {
          margin: 0;
          color: var(--muted);
          font-size: 0.86rem;
        }
        @media (max-width: 680px) {
          main { padding: 24px 0; }
          .stats { grid-template-columns: 1fr; }
          .new-form { grid-template-columns: 1fr; }
          .todo-item {
            grid-template-columns: 1fr;
            align-items: stretch;
          }
          .todo-item form { margin: 0; }
        }
      CSS
    end
  end

  class StatCard < Base
    extend Literal::Properties

    prop :label, _String(length: 1..)
    prop :value, _Integer

    def view_template
      div(class: "stat") do
        strong { @value.to_s }
        span { @label }
      end
    end
  end

  class Button < Base
    extend Literal::Properties

    prop :label, _String(length: 1..)
    prop :variant, _Symbol

    def view_template
      button(type: "submit", class: button_class) { @label }
    end

    private

    def button_class
      case @variant
      when :primary
        "button-primary"
      when :danger
        "button-danger"
      else
        ""
      end
    end
  end

  class TodoItem < Base
    extend Literal::Properties

    prop :id, _Integer
    prop :title, _String(length: 1..)
    prop :done, _Boolean

    def view_template
      li(class: "todo-item #{done_class}") do
        span(class: "badge #{badge_class}") { @done ? "Done" : "Open" }
        span(class: "todo-title") { @title }
        form(method: "post", action: "/todos/#{@id}/toggle") do
          render(Button.new(label: @done ? "戻す" : "完了", variant: :default))
        end

        form(
          :method => "post",
          :action => "/todos/#{@id}/delete",
          "data-controller" => "confirm",
          "data-confirm-message-value" => "このTODOを削除しますか?"
        ) do
          render(Button.new(label: "削除", variant: :danger))
        end
      end
    end

    private

    def done_class
      @done ? "done" : ""
    end

    def badge_class
      @done ? "badge-done" : "badge-open"
    end
  end

  class TodoPage < Base
    extend Literal::Properties

    prop :todos, _Array

    def view_template
      doctype
      html(lang: "ja") do
        head do
          meta(charset: "utf-8")
          meta(name: "viewport", content: "width=device-width,initial-scale=1")
          title { "phlex-d1-todo" }
          script(type: "importmap") do
            raw(safe("{\"imports\":{\"@hotwired/stimulus\":\"https://esm.sh/@hotwired/stimulus@3.2.2\"}}"))
          end

          script(type: "module", src: "/assets/app.js")
          style { raw(safe(css)) }
        end

        body do
          main do
            div(class: "shell") do
              header(class: "hero") do
                p(class: "eyebrow") { "homura + Phlex + Literal + D1" }
                h1 { "Ruby classes render this TODO app on Cloudflare Workers" }
                p(class: "lead") do
                  plain("Phlex builds the HTML, Literal validates component props, ")
                  plain("Sequel talks to Cloudflare D1, and Stimulus stays tiny.")
                end
              end

              section(class: "stats") do
                render(StatCard.new(label: "Total", value: total_count))
                render(StatCard.new(label: "Open", value: open_count))
                render(StatCard.new(label: "Done", value: done_count))
              end

              section(:class => "panel", "aria-label" => "TODO list") do
                form(
                  :class => "new-form",
                  :method => "post",
                  :action => "/todos",
                  "data-controller" => "todoform"
                ) do
                  input(
                    :type => "text",
                    :name => "title",
                    :placeholder => "次にやること",
                    :required => true,
                    :autofocus => true,
                    "data-todoform-target" => "input"
                  )
                  render(Button.new(label: "追加", variant: :primary))
                end

                if @todos.empty?
                  p(class: "empty") { "まだTODOはありません。" }
                else
                  ul(class: "todo-list") do
                    @todos.each do |todo|
                      render(
                        TodoItem.new(
                          id: integer_value(todo, :id),
                          title: string_value(todo, :title),
                          done: boolean_value(todo, :done)
                        )
                      )
                    end
                  end
                end
              end

              p(class: "note") do
                plain("RubyUI itself is Rails-generator oriented, so this example keeps the same idea ")
                plain("as small Phlex components that run inside homura's Sinatra/Workers runtime.")
              end
            end
          end
        end
      end
    end

    private

    def total_count
      @todos.length
    end

    def done_count
      @todos.count { |todo| integer_value(todo, :done) == 1 }
    end

    def open_count
      total_count - done_count
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
  end
end
