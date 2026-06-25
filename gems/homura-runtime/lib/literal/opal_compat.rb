# frozen_string_literal: true

require "zeitwerk/opal_compat"
require "literal" unless defined?(Literal)
require "literal/type"

module Literal::Types
end

class Literal::Types::AnyType
  Instance = new

  include Literal::Type

  def inspect = "_Any"

  def ===(value) = !(nil === value)

  def >=(other, context: nil) = !(other === nil)
end

class Literal::Types::BooleanType
  Instance = new

  include Literal::Type

  def inspect = "_Boolean"

  def ===(value) = true == value || false == value

  def >=(other, context: nil)
    true == other || false == other || Literal::Types::BooleanType === other
  end
end

class Literal::Types::FalsyType
  Instance = new

  include Literal::Type

  def inspect = "_Falsy"

  def ===(value) = !value

  def >=(other, context: nil)
    !other || Literal::Types::FalsyType === other
  end
end

class Literal::Types::NeverType
  Instance = new

  include Literal::Type

  def inspect = "_Never"

  def ===(_value) = false

  def >=(other, context: nil) = Literal::Types::NeverType === other

  def <=(_other, context: nil) = true
end

class Literal::Types::TruthyType
  Instance = new

  include Literal::Type

  def inspect = "_Truthy"

  def ===(value) = !!value

  def >=(other, context: nil)
    true == other || Literal::Types::TruthyType === other
  end
end

class Literal::Types::VoidType
  Instance = new

  include Literal::Type

  def inspect = "_Void"

  def ===(_value) = true

  def >=(_other, context: nil) = true
end

require "literal/types/array_type"
require "literal/types/class_type"
require "literal/types/constraint_type"
require "literal/types/deferred_type"
require "literal/types/descendant_type"
require "literal/types/enumerable_type"
require "literal/types/frozen_type"
require "literal/types/hash_type"
require "literal/types/interface_type"
require "literal/types/intersection_type"
require "literal/types/kind_type"
require "literal/types/map_type"
require "literal/types/nilable_type"
require "literal/types/not_type"
require "literal/types/predicate_type"
require "literal/types/range_type"
require "literal/types/same_object_type"
require "literal/types/set_type"
require "literal/types/tagged_union_type"
require "literal/types/tuple_type"
require "literal/types/union_type"

class Literal::Types::JSONDataType
  Instance = new

  include Literal::Type

  def inspect = "_JSONData"

  def ===(value)
    case value
    when String, Integer, Float, true, false, nil
      true
    when Hash
      value.all? { |key, item| String === key && self === item }
    when Array
      value.all?(self)
    else
      false
    end
  end
end

require "literal/types"

module Literal
  class OpalBuffer
    def initialize(value = "")
      @value = value.to_s
    end

    def <<(value)
      @value += value.to_s
      self
    end

    def to_s
      @value
    end

    alias to_str to_s

    def encoding
      @value.encoding
    end

    def force_encoding(_encoding)
      @value
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

module Literal::Properties
  def self.extended(base)
    super
    base.extend(Literal::Types)
    base.include(DocString)
    base.include(base.__send__(:__literal_extension__))
  end

  private def __define_literal_methods__(new_property)
    extension = __literal_extension__

    extension.define_method(:initialize) do |*args, **kwargs, &block|
      positional_index = 0
      properties = self.class.literal_properties

      properties.each do |property|
        value = case property.kind
        when :positional
          if positional_index < args.length
            args[positional_index]
          elsif property.default?
            Literal::Undefined
          elsif property.type === nil
            nil
          else
            Literal::Undefined
          end
            .tap { positional_index += 1 }
        when :*
          args[positional_index..] || []
        when :keyword
          if kwargs.key?(property.name)
            kwargs.delete(property.name)
          elsif property.default?
            Literal::Undefined
          elsif property.type === nil
            nil
          else
            Literal::Undefined
          end

        when :**
          kwargs
        when :&
          block
        else
          raise "You should never see this error."
        end

        value = property.default_value(self) if property.default? && Literal::Undefined == value
        value = property.coerce(value, context: self) if property.coercion
        property.check_initializer(self, value)
        instance_variable_set(:"@#{property.name}", value)
      end

      after_initialize if respond_to?(:after_initialize, true)
    rescue Literal::TypeError => error
      error.set_backtrace(caller(2))
      raise
    end

    extension.define_method(:to_h) do
      self.class.literal_properties.each.each_with_object({}) do |property, hash|
        hash[property.name] = instance_variable_get(:"@#{property.name}")
      end
    end

    extension.alias_method(:to_hash, :to_h)

    define_literal_reader(extension, new_property) if new_property.reader
    define_literal_writer(extension, new_property) if new_property.writer
    define_literal_predicate(extension, new_property) if new_property.predicate
  end

  private def define_literal_reader(extension, property)
    extension.define_method(property.name) do
      instance_variable_get(:"@#{property.name}")
    end

    extension.__send__(property.reader, property.name)
  end

  private def define_literal_writer(extension, property)
    method_name = :"#{property.name}="
    extension.define_method(method_name) do |value|
      property.check_writer(self, value)
      instance_variable_set(:"@#{property.name}", value)
    rescue Literal::TypeError => error
      error.set_backtrace(caller(1))
      raise
    end

    extension.__send__(property.writer, method_name)
  end

  private def define_literal_predicate(extension, property)
    method_name = :"#{property.name}?"
    extension.define_method(method_name) do
      !!instance_variable_get(:"@#{property.name}")
    end

    extension.__send__(property.predicate, method_name)
  end
end
