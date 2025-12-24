import type { FC, PropsWithChildren } from 'hono/jsx'

type LayoutProps = PropsWithChildren<{
  title?: string
}>

export const Layout: FC<LayoutProps> = ({ title = 'Homura', children }) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>{title}</title>
      <link rel="stylesheet" href="/assets/app.css" />
    </head>
    <body>
      <header class="site-header">
        <div class="container">
          <a class="logo" href="/">Homura</a>
          <nav class="nav">
            <a href="/about">About</a>
            <a href="/jsx-demo">JSX Demo</a>
            <a href="/api">API</a>
          </nav>
        </div>
      </header>
      <main class="container">
        {children}
      </main>
      <footer class="site-footer">
        <div class="container">Homura / mruby + WASI + JSX</div>
      </footer>
    </body>
  </html>
)
