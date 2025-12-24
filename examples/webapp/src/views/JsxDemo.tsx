import type { FC } from 'hono/jsx'
import { Layout } from './Layout'

type JsxDemoProps = {
  name: string
  items: string[]
  timestamp: string
}

export const JsxDemo: FC<JsxDemoProps> = ({ name, items, timestamp }) => (
  <Layout title="JSX Demo - Homura">
    <section class="hero">
      <p class="eyebrow">JSX Template</p>
      <h1>Hello, {name}!</h1>
      <p class="lead">
        このページは Ruby で routing → JSX で rendering しています。
      </p>
    </section>

    <section class="grid">
      <div class="card">
        <h3>Props from Ruby</h3>
        <ul class="list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div class="card">
        <h3>Timestamp</h3>
        <p>{timestamp}</p>
      </div>

      <div class="card">
        <h3>Architecture</h3>
        <p>Ruby DSL → mruby/WASM → JS/JSX → HTML</p>
      </div>
    </section>
  </Layout>
)
