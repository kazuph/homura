class Homura
  class Model
    class Query
      def initialize(model_class)
        @model = model_class
        @conditions = []
        @binds = []
        @order_clause = nil
        @limit_value = nil
        @offset_value = nil
      end

      def where(conditions = {})
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
        @order_clause = text.empty? ? nil : text
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

      def all(db)
        rows = db.all(select_sql, @binds)
        return [] unless rows.is_a?(Array)
        rows.map { |row| @model.from_row(row) }
      end

      def count(db)
        sql = "SELECT COUNT(*) AS count FROM #{@model.table_name}"
        sql << " WHERE " + @conditions.join(" AND ") unless @conditions.empty?
        row = db.get(sql, @binds)
        return 0 unless row.is_a?(Hash)
        value = row["count"]
        value = row[:count] if value.nil?
        value.to_i
      end

      def first(db)
        row = db.get(select_sql, @binds)
        return nil if row.nil?
        @model.from_row(row)
      end

      private

      def select_sql
        sql = "SELECT * FROM #{@model.table_name}"
        sql << " WHERE " + @conditions.join(" AND ") unless @conditions.empty?
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

    def self.where(conditions = {})
      Query.new(self).where(conditions)
    end

    def self.order(order_clause)
      Query.new(self).order(order_clause)
    end

    def self.find(db, id)
      Query.new(self).where({ id: id }).first(db)
    end

    def self.cast_column_value(name, value)
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
      obj
    end

    def self.create(db, attrs = {})
      obj = new(attrs)
      obj.create_record(db)
      obj
    end

    attr_reader :attributes

    def initialize(attrs = {})
      @attributes = {}
      @persisted = false
      @errors = []
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
      if name.end_with?("=")
        return super unless args.length == 1
        @attributes[name[0, name.length - 1].to_sym] = args[0]
        return args[0]
      end
      return super unless args.empty?
      @attributes[name.to_sym]
    end

    def valid?
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
        index += 1
      end
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
      if persisted?
        run_update(db)
      else
        create_record(db)
      end
      self
    end

    def update_attrs(db, attrs = {})
      assign_attributes(attrs)
      save(db)
    end

    def destroy(db)
      id = @attributes[:id]
      return false if id.nil?
      db.run("DELETE FROM #{self.class.table_name} WHERE id = ?", [id])
      @persisted = false
      true
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
