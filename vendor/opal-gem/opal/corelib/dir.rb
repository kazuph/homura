# backtick_javascript: true

class ::Dir
  class << self
    def chdir(dir)
      prev_cwd = `Opal.current_dir`
      `Opal.current_dir = #{dir}`
      yield
    ensure
      `Opal.current_dir = #{prev_cwd}`
    end

    def pwd
      `Opal.current_dir || '.'`
    end

    def home
      ::ENV['HOME'] || '.'
    end

    alias getwd pwd

    def each_child(path)
      return enum_for(:each_child, path) unless block_given?

      virtual_entries(path).each { |entry| yield entry }
    end

    def glob(pattern)
      pattern = pattern.to_s
      entries = virtual_paths

      unless pattern.include?("*")
        return entries.any? { |entry| entry == pattern || entry.start_with?("#{pattern}/") } ? [pattern] : []
      end

      escaped = pattern.split("**").map do |part|
        part.split("*").map { |segment| Regexp.escape(segment) }.join("[^/]*")
      end.join(".*")
      regexp = Regexp.new("\\A#{escaped}\\z")
      entries.select { |entry| entry.match?(regexp) }
    end

    private

    def virtual_paths
      keys = []
      %x{
        for (var key in Opal.modules) {
          #{keys}.push(key)
        }
      }

      paths = []
      keys.each do |key|
        paths << key
        parts = key.split("/")
        while parts.length > 1
          parts.pop
          paths << parts.join("/")
        end
      end
      paths.uniq
    end

    def virtual_entries(path)
      path = path.to_s.gsub(%r{/+$}, "")
      prefix = path.empty? ? "" : "#{path}/"
      entries = []

      virtual_paths.each do |entry|
        next unless entry.start_with?(prefix)

        rest = entry.delete_prefix(prefix)
        next if rest.empty?

        first, remaining = rest.split("/", 2)
        entries << (remaining ? first : "#{first}.rb")
      end

      entries.uniq
    end
  end
end
