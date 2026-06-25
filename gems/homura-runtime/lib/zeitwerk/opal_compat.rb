# frozen_string_literal: true

require "zeitwerk"

module Zeitwerk
  class HomuraOpalLoader
    Inflector = Struct.new(:rules) do
      def inflect(overrides)
        rules.merge!(overrides)
      end
    end

    attr_reader :inflector

    def initialize
      @inflector = Inflector.new({})
    end

    def ignore(*)
    end

    def collapse(*)
    end

    def setup
      self
    end
  end

  class << self
    attr_accessor :__homura_next_gem_root

    def __homura_next_loader_tag
      @__homura_loader_tag_sequence ||= 0
      @__homura_loader_tag_sequence += 1
      "homura-#{@__homura_loader_tag_sequence}"
    end
  end

  class Inflector
    def camelize(basename, _abspath)
      overrides[basename] || basename.split("_").map(&:capitalize).join
    end
  end

  class Loader
    class << self
      alias __homura_original_for_gem__ for_gem

      def for_gem(warn_on_extra_files: true)
        if (root_file = Zeitwerk.__homura_next_gem_root)
          Zeitwerk.__homura_next_gem_root = nil
          return Zeitwerk::HomuraOpalLoader.new if RUBY_ENGINE == "opal"

          Registry.loader_for_gem(
            root_file,
            namespace: Object,
            warn_on_extra_files: false
          )
        else
          __homura_original_for_gem__(warn_on_extra_files: warn_on_extra_files)
        end
      end
    end

    module Config
      def initialize
        @inflector = Zeitwerk::Inflector.new
        @logger = self.class.default_logger
        @tag = Zeitwerk.__homura_next_loader_tag
        @initialized_at = Time.now
        @roots = {}
        @nsfile = nil
        @ignored_glob_patterns = Set.new
        @ignored_paths = Set.new
        @collapse_glob_patterns = Set.new
        @collapse_dirs = Set.new
        @collapse_parents = Set.new
        @eager_load_exclusions = Set.new
        @reloading_enabled = false
        @on_setup_callbacks = []
        @on_load_callbacks = {}
        @on_unload_callbacks = {}
      end
    end

    private def define_autoloads_for_dir(dir, mod, external:)
      @fs.ls(dir) do |basename, abspath, ftype|
        if ftype == :file
          if basename == @nsfile
            if external
              cpath = real_mod_name(mod)
              location = Object.const_source_location(cpath)&.join(":")
              location = nil if location&.empty?
              raise(
                Zeitwerk::ConflictingNamespaceDefinitionError.new(
                  cpath,
                  location: location,
                  conflicting_file: abspath
                )
              )
            end

            next
          end

          basename = basename.delete_suffix(".rb")
          cref = Cref.new(mod, cname_for(basename, abspath))
          visit_file(cref, abspath)
        else
          cref = Cref.new(mod, cname_for(basename, abspath))
          visit_subdir(cref, abspath, external: external)
        end
      end
    end
  end
end
