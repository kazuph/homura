# frozen_string_literal: true

require "phlex"

module Sinatra
  module Kagero
    class Page < Phlex::HTML
      class << self
        def inherited(subclass)
          super
          subclass.instance_variable_set(:@kagero_props_schema, kagero_props_schema.dup)
        end

        def props(&block)
          kagero_props_schema.instance_eval(&block) if block
          kagero_props_schema
        end

        def prop(name, type = nil, **options)
          kagero_props_schema.prop(name, type, **options)
        end

        def title(value = nil, &block)
          @kagero_title = block || value unless value.nil? && block.nil?
          @kagero_title
        end

        def kagero_component_name
          name.to_s.sub(/\APages::/, "").gsub("::", "/")
        end

        def kagero_props_schema
          @kagero_props_schema ||= Props::Schema.new
        end
      end

      attr_reader :kagero_props

      def initialize(**props)
        @kagero_props = self.class.kagero_props_schema.coerce(props)
        @kagero_props.each { |name, value| instance_variable_set(:"@#{name}", value) }
        super()
      end

      def kagero_title
        configured = self.class.title
        return instance_exec(&configured).to_s if configured.respond_to?(:call)
        return configured.to_s unless configured.nil?

        self.class.kagero_component_name
      end

      private

      def kagero_form(action:, method: "post", **attributes, &block)
        attributes = kagero_data(attributes, "kagero" => "true")
        attributes[:action] = action
        attributes[:method] = method
        form(**attributes, &block)
      end

      def kagero_link(href:, **attributes, &block)
        attributes = kagero_data(attributes, "kagero" => "true")
        attributes[:href] = href
        a(**attributes, &block)
      end

      def kagero_partial_button(only:, **attributes, &block)
        attributes = kagero_data(
          attributes,
          "kagero-reload" => "true",
          "kagero-only" => Array(only).join(",")
        )
        attributes[:type] ||= "button"
        button(**attributes, &block)
      end

      def kagero_data(attributes, data)
        data.each { |key, value| attributes[:"data-#{key}"] = value }
        attributes
      end
    end
  end
end
