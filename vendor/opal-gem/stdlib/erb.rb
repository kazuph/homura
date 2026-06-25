# backtick_javascript: true

require 'template'

class ERB
  module Util
    `var escapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};`
    `var escape_regexp = /[&<>"']/g;`

    def html_escape(str)
      `("" + str).replace(escape_regexp, function (m) { return escapes[m] })`
    end

    def json_escape(str)
      str.to_s
        .gsub(">", "\\u003e")
        .gsub("<", "\\u003c")
        .gsub("&", "\\u0026")
    end

    alias h html_escape

    module_function :h
    module_function :html_escape
    module_function :json_escape
  end

  module Escape
    extend self

    def html_escape(str)
      ERB::Util.html_escape(str)
    end

    def json_escape(str)
      ERB::Util.json_escape(str)
    end

    alias h html_escape
  end
end
