# frozen_string_literal: true

require "ruby_lsp/addon"

module RubyLsp
  module Phlex
    class Addon < ::RubyLsp::Addon
      def activate(_global_state, _message_queue)
      end

      def deactivate
      end

      def name
        "Phlex"
      end

      def version
        "0.1.0"
      end
    end
  end
end
