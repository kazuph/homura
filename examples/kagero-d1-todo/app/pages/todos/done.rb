# frozen_string_literal: true

require "sinatra/kagero"

module Pages
  module Todos
    class Done < Kagero::Page
      title "完了済み TODO"

      props { prop :todos, Array }

      def view_template
        h1 { "完了済み TODO" }
        kagero_link(href: "/") { "一覧へ" }
        ul do
          @todos.each { |todo| li { todo[:title] || todo["title"] } }
        end
      end
    end
  end
end
