# frozen_string_literal: true

require "sinatra/kagero"

module Commands
  class CreateTodo < Kagero::Command
    attribute :title, String, default: ""

    validates_presence_of :title, message: "title_required"
    validates_length_of :title, maximum: 80, message: "title_too_long"

    def title
      @title.to_s.strip
    end
  end
end
