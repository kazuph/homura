class Homura
  class Model
    CALLBACK_TYPES = [
      :before_validation,
      :after_validation,
      :before_save,
      :after_save,
      :before_create,
      :after_create,
      :before_update,
      :after_update,
      :before_destroy,
      :after_destroy,
    ]

    class WhereChain
      def initialize(query)
        @query = query
      end

      def not(conditions = {})
        return @query unless conditions.is_a?(Hash)
        keys = conditions.keys
        index = 0
        while index < keys.length
          key = keys[index]
          @query.instance_variable_get(:@model).validate_column(key)
          @query.instance_variable_get(:@conditions) << "#{key} != ?"
          @query.instance_variable_get(:@binds) << conditions[key]
          index += 1
        end
        @query
      end
    end

    class Query
      def initialize(model_class)
        @model = model_class
        @conditions = []
        @binds = []
        @order_clause = nil
        @limit_value = nil
        @offset_value = nil
        @select_columns = nil
        @group_clause = nil
        @having_clause = nil
        @having_binds = []
        @distinct_flag = false
      end

      def where(conditions = nil)
        return WhereChain.new(self) if conditions.nil?
        return self unless conditions.is_a?(Hash)
        keys = conditions.keys
        index = 0
        while index < keys.length
          key = keys[index]
          @model.validate_column(key)
          @conditions << "#{key} = ?"
          @binds << conditions[key]
          index += 1
        end
        self
      end

      def order(order_clause)
        text = order_clause.to_s
        return self if text.empty?
        validate_order_clause(text)
        @order_clause = text
        self
      end

      def limit(limit_value)
        value = limit_value.to_i
        @limit_value = value > 0 ? value : nil
        self
      end

      def offset(offset_value)
        value = offset_value.to_i
        @offset_value = value > 0 ? value : nil
        self
      end

      def select(*columns)
        @select_columns = []
        index = 0
        while index < columns.length
          col = columns[index].to_s
          @model.validate_column(col) unless col == "*"
          @select_columns << col
          index += 1
        end
        self
      end

      def group(*columns)
        values = []
        index = 0
        while index < columns.length
          col = columns[index].to_s
          @model.validate_column(col)
          values << col
          index += 1
        end
        @group_clause = values.empty? ? nil : values.join(", ")
        self
      end

      def having(clause, *binds)
        text = clause.to_s
        validate_sql_fragment(text)
        @having_clause = text.empty? ? nil : text
        @having_binds = binds
        self
      end

      def distinct
        @distinct_flag = true
        self
      end

      def all(db)
        rows = db.all(select_sql, query_binds)
        return [] unless rows.is_a?(Array)
        rows.map { |row| @model.from_row(row) }
      end

      def count(db)
        sql = if @group_clause.nil? && @having_clause.nil? && !@distinct_flag && @select_columns.nil?
          count_sql
        else
          "SELECT COUNT(*) AS count FROM (#{select_sql}) homura_count_rows"
        end
        row = db.get(sql, query_binds)
        return 0 unless row.is_a?(Hash)
        value = row["count"]
        value = row[:count] if value.nil?
        value.to_i
      end

      def first(db)
        previous_limit = @limit_value
        @limit_value = 1 if @limit_value.nil? || @limit_value > 1
        row = db.get(select_sql, query_binds)
        @limit_value = previous_limit
        return nil if row.nil?
        @model.from_row(row)
      end

      def last(db)
        previous_order = @order_clause
        previous_limit = @limit_value
        @order_clause = reverse_order_clause
        @limit_value = 1
        row = db.get(select_sql, query_binds)
        @order_clause = previous_order
        @limit_value = previous_limit
        return nil if row.nil?
        @model.from_row(row)
      end

      def pluck(*columns_and_db)
        return [] if columns_and_db.empty?
        db = columns_and_db[columns_and_db.length - 1]
        columns = columns_and_db[0, columns_and_db.length - 1]
        old_select = @select_columns
        select(*columns)
        rows = db.all(select_sql, query_binds)
        @select_columns = old_select
        return [] unless rows.is_a?(Array)
        if columns.length == 1
          column = columns[0].to_s
          return rows.map do |row|
            row.is_a?(Hash) ? (row[column] || row[column.to_sym]) : nil
          end
        end
        rows.map do |row|
          columns.map do |column|
            text = column.to_s
            row.is_a?(Hash) ? (row[text] || row[text.to_sym]) : nil
          end
        end
      end

      def ids(db)
        pluck(:id, db)
      end

      def exists?(db)
        old_select = @select_columns
        old_limit = @limit_value
        @select_columns = ["1"]
        @limit_value = 1
        row = db.get(select_sql, query_binds)
        @select_columns = old_select
        @limit_value = old_limit
        !row.nil?
      end

      def or(other_query)
        return self unless other_query.is_a?(self.class)
        other_conditions = other_query.instance_variable_get(:@conditions) || []
        other_binds = other_query.instance_variable_get(:@binds) || []
        if !@conditions.empty? && !other_conditions.empty?
          @conditions = ["(#{@conditions.join(' AND ')}) OR (#{other_conditions.join(' AND ')})"]
          @binds = @binds + other_binds
        end
        self
      end

      def method_missing(method_name, *args)
        scopes = @model.scopes
        if scopes.key?(method_name.to_sym)
          scope_query = if args.empty?
            @model.send(method_name)
          else
            @model.send(method_name, *args)
          end
          if scope_query.is_a?(self.class)
            merge_query(scope_query)
            return self
          end
        end
        super
      end

      def respond_to_missing?(method_name, include_private = false)
        @model.scopes.key?(method_name.to_sym) || super
      end

      private

      def merge_query(other_query)
        other_conditions = other_query.instance_variable_get(:@conditions) || []
        other_binds = other_query.instance_variable_get(:@binds) || []
        other_order = other_query.instance_variable_get(:@order_clause)
        other_limit = other_query.instance_variable_get(:@limit_value)
        other_offset = other_query.instance_variable_get(:@offset_value)
        other_select = other_query.instance_variable_get(:@select_columns)
        other_group = other_query.instance_variable_get(:@group_clause)
        other_having = other_query.instance_variable_get(:@having_clause)
        other_having_binds = other_query.instance_variable_get(:@having_binds) || []
        other_distinct = other_query.instance_variable_get(:@distinct_flag)

        @conditions.concat(other_conditions)
        @binds.concat(other_binds)
        @order_clause = other_order unless other_order.nil?
        @limit_value = other_limit unless other_limit.nil?
        @offset_value = other_offset unless other_offset.nil?
        @select_columns = other_select unless other_select.nil?
        @group_clause = other_group unless other_group.nil?
        @having_clause = other_having unless other_having.nil?
        @having_binds = other_having_binds unless other_having_binds.empty?
        @distinct_flag = true if other_distinct
      end

      def query_binds
        @binds + @having_binds
      end

      def count_sql
        sql = "SELECT COUNT(*) AS count FROM #{@model.table_name}"
        sql << " WHERE " + @conditions.join(" AND ") unless @conditions.empty?
        sql
      end

      def reverse_order_clause
        return "id DESC" if @order_clause.nil? || @order_clause.empty?
        return @order_clause.gsub(" DESC", " ASC") if @order_clause.include?(" DESC")
        return @order_clause.gsub(" ASC", " DESC") if @order_clause.include?(" ASC")
        @order_clause + " DESC"
      end

      UNSAFE_CHARS = [";", "'", "\"", "-" + "-", "/", "\\"].freeze

      def validate_order_clause(text)
        parts = text.split(",")
        index = 0
        while index < parts.length
          part = parts[index].strip
          tokens = part.split(" ")
          col = tokens[0]
          dir = tokens[1]
          raise ArgumentError, "Invalid order clause: #{text}" if col.nil? || col.empty?
          validate_identifier(col)
          raise ArgumentError, "Invalid order direction: #{dir}" if dir && dir.upcase != "ASC" && dir.upcase != "DESC"
          raise ArgumentError, "Invalid order clause: #{text}" if tokens.length > 2
          index += 1
        end
      end

      def validate_sql_fragment(text)
        return if text.empty?
        idx = 0
        while idx < UNSAFE_CHARS.length
          raise ArgumentError, "Invalid SQL fragment: #{text}" if text.include?(UNSAFE_CHARS[idx])
          idx += 1
        end
      end

      def validate_identifier(name)
        raise ArgumentError, "Invalid identifier: #{name}" if name.empty?
        chars = name.chars
        first = chars[0]
        raise ArgumentError, "Invalid identifier: #{name}" unless (first >= "a" && first <= "z") || (first >= "A" && first <= "Z") || first == "_"
        idx = 1
        while idx < chars.length
          c = chars[idx]
          unless (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c == "_"
            raise ArgumentError, "Invalid identifier: #{name}"
          end
          idx += 1
        end
      end

      def select_sql
        columns = @select_columns.nil? ? "*" : @select_columns.join(", ")
        prefix = @distinct_flag ? "SELECT DISTINCT" : "SELECT"
        sql = "#{prefix} #{columns} FROM #{@model.table_name}"
        sql << " WHERE " + @conditions.join(" AND ") unless @conditions.empty?
        sql << " GROUP BY #{@group_clause}" unless @group_clause.nil?
        sql << " HAVING #{@having_clause}" unless @having_clause.nil?
        sql << " ORDER BY " + @order_clause unless @order_clause.nil?
        sql << " LIMIT #{@limit_value}" unless @limit_value.nil?
        sql << " OFFSET #{@offset_value}" unless @offset_value.nil?
        sql
      end
    end

    def self.inherited(subclass)
      super
      subclass.instance_variable_set(:@table_name, nil)
      subclass.instance_variable_set(:@columns_list, [])
      subclass.instance_variable_set(:@validations_list, [])
      subclass.instance_variable_set(:@associations, [])
      subclass.instance_variable_set(:@custom_validations, [])
      subclass.instance_variable_set(:@scopes, {})
      subclass.instance_variable_set(:@enums, {})
      subclass.instance_variable_set(:@before_validation_callbacks, [])
      subclass.instance_variable_set(:@after_validation_callbacks, [])
      subclass.instance_variable_set(:@before_save_callbacks, [])
      subclass.instance_variable_set(:@after_save_callbacks, [])
      subclass.instance_variable_set(:@before_create_callbacks, [])
      subclass.instance_variable_set(:@after_create_callbacks, [])
      subclass.instance_variable_set(:@before_update_callbacks, [])
      subclass.instance_variable_set(:@after_update_callbacks, [])
      subclass.instance_variable_set(:@before_destroy_callbacks, [])
      subclass.instance_variable_set(:@after_destroy_callbacks, [])
    end

    def self.table(name)
      @table_name = name.to_s
    end

    def self.table_name
      @table_name || ""
    end

    def self.columns
      @columns_list ||= []
    end

    def self.columns_list
      columns
    end

    def self.column(name, type = nil, opts = {})
      columns << { name: name.to_sym, type: type, opts: opts }
    end

    def self.column_info(name)
      target = name.to_sym
      index = 0
      while index < columns.length
        column = columns[index]
        return column if column[:name] == target
        index += 1
      end
      nil
    end

    def self.columns_list_names
      result = []
      index = 0
      while index < columns.length
        result << columns[index][:name]
        index += 1
      end
      result
    end

    def self.validate_column(name)
      names = columns_list_names
      return if names.empty?
      raise ArgumentError, "Unknown column name: #{name}" unless names.include?(name.to_sym)
    end

    def self.validations
      @validations_list ||= []
    end

    def self.validations_list
      validations
    end

    def self.validates(name, opts = {})
      validations << { name: name.to_sym, opts: opts || {} }
    end

    def self.validate(method_name)
      custom_validations << method_name.to_sym
    end

    def self.custom_validations
      @custom_validations ||= []
    end

    def self.before_validation(*method_names)
      register_callbacks(:before_validation, method_names)
    end

    def self.after_validation(*method_names)
      register_callbacks(:after_validation, method_names)
    end

    def self.before_save(*method_names)
      register_callbacks(:before_save, method_names)
    end

    def self.after_save(*method_names)
      register_callbacks(:after_save, method_names)
    end

    def self.before_create(*method_names)
      register_callbacks(:before_create, method_names)
    end

    def self.after_create(*method_names)
      register_callbacks(:after_create, method_names)
    end

    def self.before_update(*method_names)
      register_callbacks(:before_update, method_names)
    end

    def self.after_update(*method_names)
      register_callbacks(:after_update, method_names)
    end

    def self.before_destroy(*method_names)
      register_callbacks(:before_destroy, method_names)
    end

    def self.after_destroy(*method_names)
      register_callbacks(:after_destroy, method_names)
    end

    def self.has_many(name, opts = {})
      association = { type: :has_many, name: name.to_sym, opts: opts || {} }
      associations << association
      define_association_loader(association)
    end

    def self.belongs_to(name, opts = {})
      association = { type: :belongs_to, name: name.to_sym, opts: opts || {} }
      associations << association
      define_association_loader(association)
    end

    def self.has_one(name, opts = {})
      association = { type: :has_one, name: name.to_sym, opts: opts || {} }
      associations << association
      define_association_loader(association)
    end

    def self.associations
      @associations ||= []
    end

    def self.define_association_loader(association)
      define_method(association[:name]) do |db|
        case association[:type]
        when :has_many
          load_has_many(association, db)
        when :belongs_to
          load_belongs_to(association, db)
        when :has_one
          load_has_one(association, db)
        end
      end
    end

    def self.classify(name)
      parts = name.to_s.split("_")
      result = ""
      index = 0
      while index < parts.length
        word = parts[index].to_s
        if word.empty?
          index += 1
          next
        end
        result << word[0].upcase
        result << word[1, word.length - 1].to_s
        index += 1
      end
      result
    end

    def self.singularize_classify(name)
      word = name.to_s
      word = word[0, word.length - 1] if word.end_with?("s")
      classify(word.to_sym)
    end

    def self.where(conditions = nil)
      Query.new(self).where(conditions)
    end

    def self.order(order_clause)
      Query.new(self).order(order_clause)
    end

    def self.find(db, id)
      Query.new(self).where({ id: id }).first(db)
    end

    def self.find_by(db, conditions = {})
      where(conditions).first(db)
    end

    def self.find_or_create_by(db, conditions = {})
      record = find_by(db, conditions)
      return record unless record.nil?
      create(db, conditions)
    end

    def self.cast_column_value(name, value)
      enum_mapping = enums[name.to_sym]
      unless enum_mapping.nil?
        if value.is_a?(String) || value.is_a?(Symbol)
          mapped = enum_mapping[value.to_s]
          return mapped unless mapped.nil?
        end
        return value.nil? ? nil : value.to_i
      end

      column = column_info(name)
      return value if column.nil?

      case column[:type]
      when :integer
        value.nil? ? nil : value.to_i
      when :boolean
        value == true || value == 1 || value == "1" || value.to_s.downcase == "true"
      else
        value
      end
    end

    def self.from_row(row)
      obj = new
      return obj unless row.is_a?(Hash)
      keys = row.keys
      index = 0
      while index < keys.length
        key = keys[index]
        obj.attributes[key.to_sym] = cast_column_value(key, row[key])
        index += 1
      end
      obj.instance_variable_set(:@persisted, true)
      obj.snapshot_original_attributes
      obj
    end

    def self.create(db, attrs = {})
      obj = new(attrs)
      obj.create_record(db)
      obj
    end

    def self.scope(name, body)
      @scopes ||= {}
      @scopes[name.to_sym] = body
      define_singleton_method(name) do |*args|
        if args.empty?
          body.call
        else
          body.call(*args)
        end
      end
    end

    def self.scopes
      @scopes ||= {}
    end

    def self.enum(attr_name, values)
      @enums ||= {}
      mapping = {}
      if values.is_a?(Array)
        index = 0
        while index < values.length
          mapping[values[index].to_s] = index
          index += 1
        end
      elsif values.is_a?(Hash)
        keys = values.keys
        index = 0
        while index < keys.length
          key = keys[index]
          mapping[key.to_s] = values[key]
          index += 1
        end
      end
      @enums[attr_name.to_sym] = mapping
      define_enum_helpers(attr_name.to_sym, mapping)
    end

    def self.enums
      @enums ||= {}
    end

    attr_reader :attributes

    def initialize(attrs = {})
      @attributes = {}
      @persisted = false
      @errors = []
      @original_attributes = nil
      assign_attributes(attrs)
    end

    def persisted?
      @persisted
    end

    def errors
      @errors ||= []
    end

    def method_missing(method_name, *args)
      name = method_name.to_s
      if name.end_with?("_changed?")
        return super unless args.empty?
        attr_name = name[0, name.length - "_changed?".length].to_sym
        return attribute_changed?(attr_name)
      end
      if name.end_with?("_was")
        return super unless args.empty?
        attr_name = name[0, name.length - "_was".length].to_sym
        return nil if @original_attributes.nil?
        return @original_attributes[attr_name]
      end
      if name.end_with?("=")
        return super unless args.length == 1
        @attributes[name[0, name.length - 1].to_sym] = args[0]
        return args[0]
      end
      return super unless args.empty?
      @attributes[name.to_sym]
    end

    def valid?
      return false unless run_callbacks(:before_validation)
      @errors = []
      validations = self.class.validations_list
      index = 0
      while index < validations.length
        validation = validations[index]
        name = validation[:name]
        opts = validation[:opts] || {}
        if opts[:presence] && blank_value?(@attributes[name])
          @errors << "#{name} can't be blank"
        end
        if opts[:length]
          len_opts = opts[:length] || {}
          value = @attributes[name]
          if value.is_a?(String)
            if len_opts[:minimum] && value.length < len_opts[:minimum]
              @errors << "#{name} is too short (minimum is #{len_opts[:minimum]})"
            end
            if len_opts[:maximum] && value.length > len_opts[:maximum]
              @errors << "#{name} is too long (maximum is #{len_opts[:maximum]})"
            end
            if len_opts[:is] && value.length != len_opts[:is]
              @errors << "#{name} is the wrong length (should be #{len_opts[:is]})"
            end
          end
        end
        if opts[:format]
          value = @attributes[name]
          if value.is_a?(String)
            fmt = opts[:format]
            if fmt[:pattern] == :email
              # Simple email check without regex (mruby has no Regexp by default)
              valid = value.include?("@") && !value.include?(" ") && value.length >= 3
              at_pos = value.index("@")
              valid = false if at_pos.nil? || at_pos == 0 || at_pos == value.length - 1
              @errors << "#{name} is invalid" unless valid
            elsif fmt[:with]
              pattern = fmt[:with]
              if pattern && !pattern.match(value)
                @errors << "#{name} is invalid"
              end
            end
          end
        end
        if opts[:inclusion]
          list = opts[:inclusion][:in]
          value = @attributes[name]
          if list.is_a?(Array) && !value.nil? && !list.include?(value)
            @errors << "#{name} is not included in the list"
          end
        end
        if opts[:exclusion]
          list = opts[:exclusion][:in]
          value = @attributes[name]
          if list.is_a?(Array) && !value.nil? && list.include?(value)
            @errors << "#{name} is reserved"
          end
        end
        if opts[:numericality]
          numericality_opts = opts[:numericality] || {}
          value = @attributes[name]
          unless value.nil?
            numeric_value = value.to_i
            if numericality_opts[:greater_than] && !(numeric_value > numericality_opts[:greater_than])
              @errors << "#{name} must be greater than #{numericality_opts[:greater_than]}"
            end
            if numericality_opts[:greater_than_or_equal_to] && !(numeric_value >= numericality_opts[:greater_than_or_equal_to])
              @errors << "#{name} must be greater than or equal to #{numericality_opts[:greater_than_or_equal_to]}"
            end
            if numericality_opts[:less_than] && !(numeric_value < numericality_opts[:less_than])
              @errors << "#{name} must be less than #{numericality_opts[:less_than]}"
            end
            if numericality_opts[:less_than_or_equal_to] && !(numeric_value <= numericality_opts[:less_than_or_equal_to])
              @errors << "#{name} must be less than or equal to #{numericality_opts[:less_than_or_equal_to]}"
            end
            if numericality_opts[:equal_to] && !(numeric_value == numericality_opts[:equal_to])
              @errors << "#{name} must be equal to #{numericality_opts[:equal_to]}"
            end
            if numericality_opts[:only_integer] && value.to_s != value.to_i.to_s
              @errors << "#{name} must be an integer"
            end
          end
        end
        index += 1
      end
      custom_validations = self.class.custom_validations
      custom_index = 0
      while custom_index < custom_validations.length
        send(custom_validations[custom_index])
        custom_index += 1
      end
      run_callbacks(:after_validation)
      @errors.empty?
    end

    def to_h
      result = {}
      keys = @attributes.keys
      index = 0
      while index < keys.length
        key = keys[index]
        result[key] = @attributes[key]
        index += 1
      end
      result
    end

    def save(db)
      return false unless valid?
      return false unless run_callbacks(:before_save)
      if persisted?
        return false unless run_callbacks(:before_update)
        run_update(db)
        run_callbacks(:after_update)
      else
        return false unless run_callbacks(:before_create)
        create_record(db)
        run_callbacks(:after_create)
      end
      run_callbacks(:after_save)
      snapshot_original_attributes
      self
    end

    def update_attrs(db, attrs = {})
      assign_attributes(attrs)
      save(db)
    end

    def destroy(db)
      id = @attributes[:id]
      return false if id.nil?
      return false unless run_callbacks(:before_destroy)
      db.run("DELETE FROM #{self.class.table_name} WHERE id = ?", [id])
      @persisted = false
      run_callbacks(:after_destroy)
      true
    end

    def changed?
      return true if @original_attributes.nil?
      keys = @attributes.keys
      index = 0
      while index < keys.length
        key = keys[index]
        return true if @original_attributes[key] != @attributes[key]
        index += 1
      end
      false
    end

    def changes
      result = {}
      return result if @original_attributes.nil?
      keys = @attributes.keys
      index = 0
      while index < keys.length
        key = keys[index]
        if @original_attributes[key] != @attributes[key]
          result[key] = [@original_attributes[key], @attributes[key]]
        end
        index += 1
      end
      result
    end

    def changed_attributes
      changes.keys
    end

    def attribute_changed?(name)
      target = name.to_sym
      return true if @original_attributes.nil? && @attributes.key?(target)
      return false if @original_attributes.nil?
      @original_attributes[target] != @attributes[target]
    end

    def snapshot_original_attributes
      @original_attributes = {}
      keys = @attributes.keys
      index = 0
      while index < keys.length
        key = keys[index]
        @original_attributes[key] = @attributes[key]
        index += 1
      end
    end

    def load_has_many(assoc, db)
      class_name = assoc[:opts][:class_name]
      class_name = self.class.singularize_classify(assoc[:name]) if class_name.nil?
      foreign_key = assoc[:opts][:foreign_key]
      foreign_key = "#{self_class_name_snake}_id" if foreign_key.nil?
      klass = Object.const_get(class_name)
      klass.where({ foreign_key.to_sym => @attributes[:id] }).all(db)
    end

    def load_belongs_to(assoc, db)
      class_name = assoc[:opts][:class_name]
      class_name = self.class.classify(assoc[:name]) if class_name.nil?
      foreign_key = assoc[:opts][:foreign_key]
      foreign_key = "#{assoc[:name]}_id" if foreign_key.nil?
      klass = Object.const_get(class_name)
      klass.find(db, @attributes[foreign_key.to_sym])
    end

    def load_has_one(assoc, db)
      class_name = assoc[:opts][:class_name]
      class_name = self.class.classify(assoc[:name]) if class_name.nil?
      foreign_key = assoc[:opts][:foreign_key]
      foreign_key = "#{self_class_name_snake}_id" if foreign_key.nil?
      klass = Object.const_get(class_name)
      klass.where({ foreign_key.to_sym => @attributes[:id] }).first(db)
    end

    def create_record(db)
      names = writable_attribute_names
      return self if names.empty?
      columns = []
      values = []
      index = 0
      while index < names.length
        key = names[index]
        columns << key.to_s
        values << database_value_for(key, @attributes[key])
        index += 1
      end
      placeholders = []
      index = 0
      while index < values.length
        placeholders << "?"
        index += 1
      end
      sql = "INSERT INTO #{self.class.table_name} (#{columns.join(', ')}) VALUES (#{placeholders.join(', ')})"
      db.run(sql, values)
      meta = db.get("SELECT last_insert_rowid() AS id")
      inserted_id = extract_row_value(meta, "id")
      inserted_id = inserted_id.to_i unless inserted_id.nil?
      if inserted_id
        fresh = self.class.find(db, inserted_id)
        if fresh
          replace_attributes(fresh.attributes)
        else
          @attributes[:id] = inserted_id
        end
      end
      @persisted = true
      self
    end

    def run_update(db)
      return self if @attributes[:id].nil?
      keys = writable_attribute_names
      sets = []
      binds = []
      index = 0
      while index < keys.length
        key = keys[index].to_sym
        sets << "#{key} = ?"
        binds << database_value_for(key, @attributes[key])
        index += 1
      end
      return self if sets.empty?
      binds << @attributes[:id]
      sql = "UPDATE #{self.class.table_name} SET #{sets.join(', ')} WHERE id = ?"
      db.run(sql, binds)
      fresh = self.class.find(db, @attributes[:id])
      replace_attributes(fresh.attributes) if fresh
      self
    end

    private

    def self.define_enum_helpers(attr_name, mapping)
      define_method(attr_name) do
        raw_value = @attributes[attr_name]
        keys = mapping.keys
        index = 0
        while index < keys.length
          key = keys[index]
          return key.to_sym if mapping[key] == raw_value
          index += 1
        end
        raw_value
      end

      define_method("#{attr_name}=") do |value|
        @attributes[attr_name] = self.class.cast_column_value(attr_name, value)
      end

      define_method("#{attr_name}_value") do
        @attributes[attr_name]
      end

      # Use a helper method to capture loop variables correctly in closures.
      # Without this, mruby's while-loop variable `key` would be shared
      # across all closures and always reference the last loop value.
      keys = mapping.keys
      index = 0
      while index < keys.length
        _define_enum_predicate_and_bang(attr_name, keys[index], mapping)
        index += 1
      end

      plural = enum_plural_name(attr_name)
      define_singleton_method(plural) do
        enums[attr_name]
      end
      define_singleton_method("#{attr_name}_values") do
        enums[attr_name]
      end
    end

    def self._define_enum_predicate_and_bang(attr_name, key, mapping)
      val = mapping[key]
      define_method("#{key}?") do
        @attributes[attr_name] == val || @attributes[attr_name].to_s == key.to_s
      end
      define_method("#{key}!") do
        @attributes[attr_name] = val
        self
      end
    end

    def self.enum_plural_name(attr_name)
      name = attr_name.to_s
      name.end_with?("s") ? "#{name}es" : "#{name}s"
    end

    def self.register_callbacks(type, method_names)
      callbacks = instance_variable_get(:"@#{type}_callbacks")
      callbacks = [] if callbacks.nil?
      index = 0
      while index < method_names.length
        callbacks << method_names[index].to_sym
        index += 1
      end
      instance_variable_set(:"@#{type}_callbacks", callbacks)
    end

    def run_callbacks(type)
      callbacks = self.class.instance_variable_get(:"@#{type}_callbacks") || []
      index = 0
      while index < callbacks.length
        result = send(callbacks[index])
        return false if result == false && type.to_s.start_with?("before_")
        index += 1
      end
      true
    end

    def self_class_name_snake
      text = self.class.to_s
      result = ""
      index = 0
      while index < text.length
        ch = text[index]
        if ch >= "A" && ch <= "Z"
          result << "_" if index > 0
          result << ch.downcase
        else
          result << ch
        end
        index += 1
      end
      result
    end

    def assign_attributes(attrs)
      return if attrs.nil? || !attrs.is_a?(Hash)
      keys = attrs.keys
      index = 0
      while index < keys.length
        key = keys[index]
        @attributes[key.to_sym] = self.class.cast_column_value(key, attrs[key])
        index += 1
      end
    end

    def blank_value?(value)
      return true if value.nil?
      return value.strip.empty? if value.is_a?(String)
      false
    end

    def writable_attribute_names
      result = []
      keys = @attributes.keys
      index = 0
      while index < keys.length
        key = keys[index].to_sym
        result << key if key != :id
        index += 1
      end
      result
    end

    def database_value_for(name, value)
      column = self.class.column_info(name)
      return value if column.nil?

      case column[:type]
      when :boolean
        value ? 1 : 0
      else
        value
      end
    end

    def extract_row_value(row, key)
      return nil unless row.is_a?(Hash)
      value = row[key]
      value = row[key.to_sym] if value.nil?
      value
    end

    def replace_attributes(new_attributes)
      @attributes = {}
      keys = new_attributes.keys
      index = 0
      while index < keys.length
        key = keys[index]
        @attributes[key.to_sym] = new_attributes[key]
        index += 1
      end
    end
  end
end
