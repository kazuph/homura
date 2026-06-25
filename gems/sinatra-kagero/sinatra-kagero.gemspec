# frozen_string_literal: true

require_relative "lib/sinatra/kagero/version"

Gem::Specification.new do |spec|
  spec.name = "sinatra-kagero"
  spec.version = Sinatra::Kagero::VERSION
  spec.authors = ["Kazuhiro Homma"]
  spec.summary = "Ruby-way Inertia experience for Sinatra and Homura"
  spec.description = <<~DESC
    Kagero is a Ruby-first application layer on top of sinatra-inertia:
    Phlex page classes, Literal-style props schemas, Ruby form/command
    validation, and a hidden browser runtime for SPA-like navigation without
    exposing JavaScript as the primary userland authoring model.
  DESC
  spec.homepage = "https://github.com/kazuph/homura"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.1.0"

  gem_path = "gems/sinatra-kagero"
  spec.metadata["homepage_uri"] = spec.homepage
  spec.metadata["source_code_uri"] = "#{spec.homepage}/tree/main/#{gem_path}"
  spec.metadata["bug_tracker_uri"] = "#{spec.homepage}/issues"
  spec.metadata[
    "changelog_uri"
  ] = "#{spec.homepage}/blob/main/#{gem_path}/CHANGELOG.md"
  spec.metadata[
    "readme_uri"
  ] = "#{spec.homepage}/blob/main/#{gem_path}/README.md"

  spec.metadata["homura.auto_await"] = "true"

  spec.files = Dir.chdir(__dir__) do
    Dir["lib/**/*", "runtime/**/*", "README.md", "CHANGELOG.md", "LICENSE"].select do |f|
      File.file?(f)
    end
  end
  spec.require_paths = ["lib"]

  spec.add_runtime_dependency("sinatra-inertia", ">= 0.1", "< 2.0")
  spec.add_runtime_dependency("phlex", ">= 2.4", "< 3.0")
  spec.add_runtime_dependency("literal", ">= 1.0", "< 2.0")
end
