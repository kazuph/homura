# sinatra-kagero

Ruby-way Inertia-style application layer for Sinatra and Homura.

`sinatra-kagero` sits above `sinatra-inertia`. The lower gem owns the
Inertia v2 wire protocol; Kagero owns the Ruby authoring model:

- `Kagero::Page` classes render HTML with Phlex
- page props are declared and validated in Ruby
- form input is modeled with `Kagero::Command`
- a hidden browser runtime handles visits, forms, history, scroll, partial reloads, and asset-version hard reloads

## Install

```ruby
gem "sinatra-kagero"
```

## Usage

```ruby
require "sinatra/base"
require "sinatra/kagero"

class App < Sinatra::Base
  register Sinatra::Kagero

  get "/" do
    page(Pages::Todos::Index, todos: Todo.all, errors: {})
  end
end
```

Kagero intentionally keeps JavaScript out of the main application authoring
surface. The client runtime exists, but route handlers, pages, props, forms,
validation, and persistence remain Ruby.
