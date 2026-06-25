# frozen_string_literal: true

module Phlex
  module Compiler
    MAP = {} unless const_defined?(:MAP, false)
    Error = Class.new(StandardError) unless const_defined?(:Error, false)

    def self.compile(_component)
      nil
    end

    def self.compile_file(_path)
      nil
    end
  end
end
