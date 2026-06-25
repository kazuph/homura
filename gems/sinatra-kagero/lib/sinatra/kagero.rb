# frozen_string_literal: true

require "json"
require "phlex"
require "sinatra/inertia"

require "sinatra/kagero/command"
require "sinatra/kagero/props"
require "sinatra/kagero/page"
require "sinatra/kagero/runtime"
require "sinatra/kagero/version"

module Sinatra
  # Ruby-way page API layered on the Inertia protocol.
  module Kagero
    def self.registered(app)
      app.register(Sinatra::Inertia)
      app.set(:kagero_root_id, "app") unless app.respond_to?(:kagero_root_id)
      app.helpers(Helpers)
    end

    module Helpers
      def page(page_class, **props)
        render_kagero_page(page_class, props)
      end

      def render_page(page_class, **props)
        render_kagero_page(page_class, props)
      end

      def redirect_page(path, page_class, **props)
        return render_kagero_page(page_class, props, url: path) if inertia_request?

        redirect(to(path), 303)
      end

      private

      def render_kagero_page(page_class, props, url: request.fullpath)
        component = page_class.kagero_component_name
        page_instance = page_class.new(**props)
        page_props = page_instance.kagero_props
        body_html = page_instance.call

        response_props = page_props.merge(
          kagero: {
            component: component,
            html: body_html,
            title: page_instance.kagero_title
          }
        )

        if inertia_request?
          render_kagero_json(component, response_props, url)
        else
          render_kagero_shell(component, response_props, url)
        end
      end

      def render_kagero_json(component, props, url)
        content_type("application/json; charset=utf-8")
        headers("X-Inertia" => "true", "Vary" => "X-Inertia")
        render_kagero_page_hash(component, props, url).to_json
      end

      def render_kagero_shell(component, props, url)
        page_hash = render_kagero_page_hash(component, props, url)
        page_json = ::Rack::Utils.escape_html(page_hash.to_json)
        html = <<~HTML
          <!doctype html>
          <html lang="ja">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width,initial-scale=1">
              <title>#{::Rack::Utils.escape_html(props.dig(:kagero, :title).to_s)}</title>
              <script type="module">#{Sinatra::Kagero::Runtime::SOURCE}</script>
            </head>
            <body>
              <main id="#{::Rack::Utils.escape_html(settings.kagero_root_id)}" data-kagero-root data-page="#{page_json}">#{props.dig(:kagero, :html)}</main>
            </body>
          </html>
        HTML

        content_type("text/html; charset=utf-8")
        html
      end

      def render_kagero_page_hash(component, props, url)
        response_obj = Sinatra::Inertia::Response.new(
          component: component,
          props: props,
          request: request,
          version: current_inertia_version,
          url: url,
          encrypt_history: false,
          clear_history: false,
          shared: current_inertia_shared,
          errors: inertia_errors_payload
        )
        page_hash = response_obj.to_h
        sweep_inertia_session!
        page_hash
      end
    end
  end

  register Kagero if respond_to?(:register)
end

::Kagero = Sinatra::Kagero unless defined?(::Kagero)
