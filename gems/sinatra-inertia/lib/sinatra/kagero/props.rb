# frozen_string_literal: true

module Sinatra
  module Kagero
    module Props
      MISSING = Object.new

      class ValidationError < ArgumentError
        attr_reader :errors

        def initialize(errors)
          @errors = errors
          super(errors.map { |name, message| "#{name}: #{message}" }.join(", "))
        end
      end

      class Field
        attr_reader :name, :type, :default

        def initialize(name, type, required:, default:)
          @name = name.to_sym
          @type = type
          @required = required
          @default = default
        end

        def required?
          @required
        end

        def coerce(input, errors)
          value = fetch_value(input)
          if value.equal?(MISSING)
            return default_value unless default.equal?(MISSING)
            errors[name] = "is required" if required?
            return nil
          end

          unless valid_type?(value)
            errors[name] = "must be #{type_name}"
            return value
          end

          value
        end

        private

        def fetch_value(input)
          return input[name] if input.key?(name)
          string_name = name.to_s
          return input[string_name] if input.key?(string_name)

          MISSING
        end

        def default_value
          default.respond_to?(:call) ? default.call : default
        end

        def valid_type?(value)
          return true if type.nil?
          return value == true || value == false if type == :bool || type == :boolean
          return value.is_a?(Array) if type == :array
          return value.is_a?(Hash) if type == :hash

          type === value
        end

        def type_name
          case type
          when :bool, :boolean
            "Boolean"
          when :array
            "Array"
          when :hash
            "Hash"
          else
            type.to_s
          end
        end
      end

      class Schema
        def initialize(fields = [])
          @fields = fields
        end

        def dup
          self.class.new(@fields.dup)
        end

        def prop(name, type = nil, required: true, default: MISSING)
          @fields << Field.new(name, type, required: required, default: default)
        end

        def coerce(input)
          errors = {}
          output = {}
          @fields.each do |field|
            output[field.name] = field.coerce(input, errors)
          end
          raise ValidationError, errors unless errors.empty?

          output
        end

        def to_h
          @fields.map { |field| [field.name, field.type] }.to_h
        end
      end
    end
  end
end
