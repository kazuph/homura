# frozen_string_literal: true

require "erb"

unless 
ERB.const_defined?(:Escape, false)
  module ERB
    module Escape
      def self.html_escape(value)
        ERB::Util.html_escape(value)
      end
    end
  end
end
