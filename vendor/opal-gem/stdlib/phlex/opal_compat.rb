# frozen_string_literal: true

require "corelib/pattern_matching"
require "zeitwerk/opal_compat"
require "phlex" unless defined?(Phlex)

Phlex::SGML
Phlex::SGML::State
Phlex::SGML::Attributes
Phlex::SGML::Elements

module Phlex
  class OpalBuffer
    def initialize(value = "")
      @value = value.to_s
    end

    def <<(value)
      @value += value.to_s
      self
    end

    def bytesize
      @value.bytesize
    end

    def byteslice(offset, length = nil)
      length ? @value.byteslice(offset, length) : @value.byteslice(offset)
    end

    def clear
      @value = ""
      self
    end

    def dup
      self.class.new(@value)
    end

    def empty?
      @value.empty?
    end

    def gsub(...)
      @value.gsub(...)
    end

    def encoding
      @value.encoding
    end

    def force_encoding(_encoding)
      @value
    end

    def valid_encoding?
      true
    end

    def length
      @value.length
    end

    alias size length

    def to_s
      @value
    end

    alias to_str to_s

    def inspect
      @value.inspect
    end

    def ==(other)
      @value == other.to_s
    end

    def eql?(other)
      self == other
    end

    def hash
      @value.hash
    end

    def method_missing(name, ...)
      if @value.respond_to?(name)
        @value.public_send(name, ...)
      else
        super
      end
    end

    def respond_to_missing?(name, include_private = false)
      @value.respond_to?(name, include_private) || super
    end
  end
end

if defined?(Phlex::SGML)
  class Phlex::SGML
    def call(buffer = Phlex::OpalBuffer.new, context: {}, fragments: nil, &)
      buffer = Phlex::OpalBuffer.new(buffer) if buffer.is_a?(String)
      state = Phlex::SGML::State.new(
        user_context: context,
        output_buffer: buffer,
        fragments: fragments&.to_set
      )

      internal_call(parent: nil, state:, &)

      state.output_buffer << state.buffer
    end

    private def __homura_normalize_comma_separated_tokens__(method_name, attributes)
      case method_name
      when :img
        if Array === (srcset_attribute = attributes[:srcset])
          attributes[:srcset] = Phlex::SGML::Attributes.generate_nested_tokens(
            srcset_attribute,
            ", ",
            ",",
            "%2C"
          )
        end
      when :input
        if Array === (accept_attribute = attributes[:accept])
          type_attribute = attributes[:type] || attributes["type"]
          if "file" == type_attribute || :file == type_attribute
            attributes[:accept] = Phlex::SGML::Attributes.generate_nested_tokens(
              accept_attribute,
              ", ",
              ",",
              "%2C"
            )
          end
        end
      when :link
        if Array === (media_attribute = attributes[:media])
          attributes[:media] = Phlex::SGML::Attributes.generate_nested_tokens(
            media_attribute,
            ", ",
            ",",
            "%2C"
          )
        end

        if Array === (sizes_attribute = attributes[:sizes])
          attributes[:sizes] = Phlex::SGML::Attributes.generate_nested_tokens(
            sizes_attribute,
            ", ",
            ",",
            "%2C"
          )
        end

        if Array === (imagesrcset_attribute = attributes[:imagesrcset])
          rel_attribute = attributes[:rel] || attributes["rel"]
          as_attribute = attributes[:as] || attributes["as"]
          if ("preload" == rel_attribute || :preload == rel_attribute) &&
              ("image" == as_attribute || :image == as_attribute)
            attributes[:imagesrcset] = Phlex::SGML::Attributes.generate_nested_tokens(
              imagesrcset_attribute,
              ", ",
              ",",
              "%2C"
            )
          end
        end
      end
    end
  end

  class Phlex::SGML::State
    def initialize(user_context: {}, output_buffer:, fragments:)
      @buffer = Phlex::OpalBuffer.new
      @capturing = false
      @user_context = user_context
      @fragments = fragments
      @fragment_depth = 0
      @cache_stack = []
      @halt_signal = nil
      @output_buffer = output_buffer
    end

    def capture
      new_buffer = Phlex::OpalBuffer.new
      original_buffer = @buffer
      original_capturing = @capturing
      original_fragments = @fragments

      begin
        @buffer = new_buffer
        @capturing = true
        @fragments = nil
        yield
      ensure
        @buffer = original_buffer
        @capturing = original_capturing
        @fragments = original_fragments
      end

      new_buffer
    end
  end

  module Phlex::SGML::Elements
    def register_element(method_name, tag: method_name.name.tr("_", "-"))
      define_method(method_name) do |**attributes, &content|
        state = @_state
        buffer = state.buffer
        has_content = !content.nil?

        unless state.should_render?
          content.call(self) if has_content
          return nil
        end

        if attributes.length > 0
          buffer << "<#{tag}"
          begin
            __homura_normalize_comma_separated_tokens__(method_name, attributes)
            buffer << (Phlex::ATTRIBUTE_CACHE[attributes] ||= Phlex::SGML::Attributes.generate_attributes(attributes))
          ensure
            buffer << ">"
          end

          if has_content
            begin
              original_length = buffer.bytesize
              rendered_content = content.call(self)
              __implicit_output__(rendered_content) if original_length == buffer.bytesize
            ensure
              buffer << "</#{tag}>"
            end
          else
            buffer << "</#{tag}>"
          end
        elsif has_content
          buffer << "<#{tag}>"
          begin
            original_length = buffer.bytesize
            rendered_content = content.call(self)
            __implicit_output__(rendered_content) if original_length == buffer.bytesize
          ensure
            buffer << "</#{tag}>"
          end
        else
          buffer << "<#{tag}></#{tag}>"
        end

        flush if tag == "head"
        nil
      end

      __registered_elements__[method_name] = tag
      method_name
    end

    def __register_void_element__(method_name, tag: method_name.name.tr("_", "-"))
      define_method(method_name) do |**attributes|
        state = @_state
        return unless state.should_render?

        buffer = state.buffer

        if attributes.length > 0
          buffer << "<#{tag}"
          begin
            __homura_normalize_comma_separated_tokens__(method_name, attributes)
            buffer << (Phlex::ATTRIBUTE_CACHE[attributes] ||= Phlex::SGML::Attributes.generate_attributes(attributes))
          ensure
            buffer << ">"
          end
        else
          buffer << "<#{tag}>"
        end

        nil
      end

      __registered_elements__[method_name] = tag
      method_name
    end
  end

  module Phlex::SGML::Attributes
    class << self
      alias __homura_generate_attributes__ generate_attributes
      alias __homura_generate_nested_attributes__ generate_nested_attributes

      def generate_attributes(attributes, buffer = Phlex::OpalBuffer.new)
        __homura_generate_attributes__(attributes, buffer)
      end

      def generate_nested_attributes(attributes, base_name, buffer = Phlex::OpalBuffer.new)
        __homura_generate_nested_attributes__(attributes, base_name, buffer)
      end

      def generate_nested_tokens(tokens, sep = " ", gsub_from = nil, gsub_to = "")
        buffer = Phlex::OpalBuffer.new

        i, length = 0, tokens.length

        while i < length
          token = tokens[i]

          case token
          when String
            token = token.gsub(gsub_from, gsub_to) if gsub_from
            i > 0 ? buffer << sep << token : buffer << token
          when Symbol
            value = token.name.tr("_", "-")
            i > 0 ? buffer << sep << value : buffer << value
          when Integer, Float, Phlex::SGML::SafeObject
            i > 0 ? buffer << sep << token.to_s : buffer << token.to_s
          when Array
            if token.length > 0 && (value = generate_nested_tokens(token, sep, gsub_from, gsub_to))
              i > 0 ? buffer << sep << value : buffer << value
            end
          when Set
            if token.length > 0 && (value = generate_nested_tokens(token.to_a, sep, gsub_from, gsub_to))
              i > 0 ? buffer << sep << value : buffer << value
            end
          when nil
            nil
          else
            raise Phlex::ArgumentError.new("Invalid token type: #{token.class}.")
          end

          i += 1
        end

        return if buffer.empty?

        buffer.gsub('"', "&quot;")
      end

      def generate_styles(styles)
        case styles
        when Array, Set
          styles.filter_map do |s|
            case s
            when String
              s == "" || s.end_with?(";") ? s : "#{s};"
            when Phlex::SGML::SafeObject
              value = s.to_s
              value.end_with?(";") ? value : "#{value};"
            when Hash
              next generate_styles(s)
            when nil
              next nil
            else
              raise Phlex::ArgumentError.new("Invalid style: #{s.inspect}.")
            end
          end.join(" ")
        when Hash
          buffer = Phlex::OpalBuffer.new
          i = 0
          styles.each do |k, v|
            prop = case k
            when String
              k
            when Symbol
              k.name.tr("_", "-")
            else
              raise Phlex::ArgumentError.new("Style keys should be Strings or Symbols.")
            end

            value = case v
            when String
              v
            when Symbol
              v.name.tr("_", "-")
            when Integer, Float, Phlex::SGML::SafeObject
              v.to_s
            when nil
              nil
            else
              raise Phlex::ArgumentError.new("Invalid style value: #{v.inspect}")
            end

            if value
              i == 0 ? buffer << prop << ": " << value << ";" : buffer << " " << prop << ": " << value << ";"
            end

            i += 1
          end

          buffer
        end
      end
    end
  end
end
