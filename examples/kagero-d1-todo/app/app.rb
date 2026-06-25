# frozen_string_literal: true

require "sinatra/base"
require "sinatra/kagero"
require "sequel"
require "commands/create_todo"
require "pages/todos/index"

class App < Sinatra::Base
  set :inertia_csrf_protection, false
  register Sinatra::Kagero

  set :page_version, ENV.fetch("ASSETS_VERSION", "kagero-1")
  set :logging, false
  set :public_folder, File.expand_path("../public", __dir__)
  enable :sessions
  set :session_secret, ENV.fetch("SESSION_SECRET", "a" * 64)

  share_props { {flash: flash_payload} }

  helpers do
    def db
      raise "D1 binding missing" unless d1

      Sequel.connect(adapter: :d1, d1: d1)
    end

    def todos
      db[:todos].order(Sequel.desc(:id)).all.map do |row|
        {
          id: row[:id],
          title: row[:title],
          done: done_value(row[:done]),
          created_at: row[:created_at]
        }
      end
    end

    def todo_stats
      rows = db[:todos].all
      done = rows.count { |row| done_value(row[:done]) }
      {
        total: rows.length,
        open: rows.length - done,
        done: done
      }
    end

    def flash_payload
      payload = session[:_kagero_flash] || {}
      session[:_kagero_flash] = nil
      payload
    end

    def set_flash(payload)
      session[:_kagero_flash] = payload
    end

    def done_value(value)
      return true if value == true
      return false if value == false || value.nil?

      value.to_i == 1
    end

    def index_page(errors: {}, flash: {})
      redirect_page(
        "/",
        Pages::Todos::Index,
        todos: todos,
        stats: todo_stats,
        errors: errors,
        flash: flash
      )
    end
  end

  get "/" do
    page(
      Pages::Todos::Index,
      todos: todos,
      stats: todo_stats,
      errors: page_errors || {},
      flash: flash_payload
    )
  end

  post "/todos" do
    command = Commands::CreateTodo.new(params)
    if command.valid?
      db[:todos].insert(title: command.title, done: 0, created_at: Time.now.to_i)
      if page_request?
        index_page(flash: {notice: "Todo added"})
      else
        set_flash(notice: "Todo added")
        redirect to("/"), 303
      end
    elsif page_request?
      index_page(errors: command.errors)
    else
      page_errors(command.errors)
      redirect to("/"), 303
    end
  end

  post "/todos/:id/toggle" do
    db[:todos]
      .where(id: params.fetch("id").to_i)
      .update(done: Sequel.lit("1 - done"))
    if page_request?
      index_page
    else
      redirect to("/"), 303
    end
  end

  post "/todos/:id/delete" do
    db[:todos].where(id: params.fetch("id").to_i).delete
    if page_request?
      index_page(flash: {notice: "Todo deleted"})
    else
      set_flash(notice: "Todo deleted")
      redirect to("/"), 303
    end
  end
end
