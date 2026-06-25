# frozen_string_literal: true

module Sinatra
  module Kagero
    class Command
      class << self
        def inherited(subclass)
          super
          subclass.instance_variable_set(:@kagero_attributes, kagero_attributes.dup)
          subclass.instance_variable_set(:@kagero_validations, kagero_validations.dup)
        end

        def attribute(name, type = String, required: false, default: nil)
          kagero_attributes <<
            {
              name: name.to_sym,
              type: type,
              required: required,
              default: default
            }
          attr_reader(name)
        end

        def validates_presence_of(*names, message: "is required")
          names.each do |name|
            kagero_validations <<
              {
                kind: :presence,
                name: name.to_sym,
                message: message
              }
          end
        end

        def validates_length_of(name, maximum:, message: nil)
          kagero_validations <<
            {
              kind: :length,
              name: name.to_sym,
              maximum: maximum,
              message: message || "must be #{maximum} characters or less"
            }
        end

        def kagero_attributes
          @kagero_attributes ||= []
        end

        def kagero_validations
          @kagero_validations ||= []
        end
      end

      attr_reader :errors

      def initialize(input = {})
        @errors = {}
        self.class.kagero_attributes.each do |attribute|
          name = attribute.fetch(:name)
          value = fetch_value(input, name)
          value = default_value(attribute.fetch(:default)) if missing?(value)
          value = coerce_value(value, attribute.fetch(:type))
          instance_variable_set(:"@#{name}", value)
        end
      end

      def valid?
        @errors = {}
        self.class.kagero_validations.each { |validation| apply_validation(validation) }
        @errors.empty?
      end

      def invalid?
        !valid?
      end

      def to_h
        self
          .class
          .kagero_attributes
          .map do |attribute|
            name = attribute.fetch(:name)
            [name, instance_variable_get(:"@#{name}")]
          end
          .to_h
      end

      private

      def fetch_value(input, name)
        return input[name] if input.respond_to?(:key?) && input.key?(name)

        string_name = name.to_s
        return input[string_name] if input.respond_to?(:key?) && input.key?(string_name)

        nil
      end

      def missing?(value)
        value.nil?
      end

      def default_value(default)
        default.respond_to?(:call) ? default.call : default
      end

      def coerce_value(value, type)
        return value if value.nil?
        return value.to_s if type == String
        return value.to_i if type == Integer
        return value == true || value.to_s == "true" || value.to_s == "1" if type == :boolean

        value
      end

      def apply_validation(validation)
        name = validation.fetch(:name)
        value = instance_variable_get(:"@#{name}")
        case validation.fetch(:kind)
        when :presence
          add_error(name, validation.fetch(:message)) if value.nil? || value.to_s.strip.empty?
        when :length
          maximum = validation.fetch(:maximum)
          add_error(name, validation.fetch(:message)) if value && value.to_s.length > maximum
        end
      end

      def add_error(name, message)
        @errors[name] ||= message
      end
    end
  end
end
