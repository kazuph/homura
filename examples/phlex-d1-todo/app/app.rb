# frozen_string_literal: true

require "sinatra/base"
require "sequel"
require "components/ui"

class App < Sinatra::Base
  helpers do
    def db
      return nil unless d1

      Sequel.connect(adapter: :d1, d1: d1)
    end

    def require_db
      conn = db
      return conn unless conn.nil?

      status(503)
      content_type("text/plain; charset=utf-8")
      nil
    end
  end

  get "/" do
    conn = require_db
    next "D1 binding missing (configure wrangler D1)" if conn.nil?

    todos = conn[:todos].order(:id).all.__await__
    content_type "text/html; charset=utf-8"
    Components::TodoPage.new(todos: todos).call
  end

  post "/todos" do
    conn = require_db
    next "D1 binding missing (configure wrangler D1)" if conn.nil?

    title = params.fetch("title", "").to_s.strip
    redirect "/" if title.empty?

    conn[:todos].insert(title: title, done: 0, created_at: Time.now.to_i).__await__
    redirect "/"
  end

  post "/todos/:id/toggle" do
    conn = require_db
    next "D1 binding missing (configure wrangler D1)" if conn.nil?

    conn[:todos]
      .where(id: params.fetch("id").to_i)
      .update(done: Sequel.lit("1 - done"))
      .__await__
    redirect "/"
  end

  post "/todos/:id/delete" do
    conn = require_db
    next "D1 binding missing (configure wrangler D1)" if conn.nil?

    conn[:todos].where(id: params.fetch("id").to_i).delete.__await__
    redirect "/"
  end
end
