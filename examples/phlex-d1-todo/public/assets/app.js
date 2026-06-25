import { Application, Controller } from '@hotwired/stimulus'

const app = Application.start()

app.register('todoform', class extends Controller {
  static targets = ['input']

  connect() {
    this.inputTarget?.focus()
  }
})

app.register('confirm', class extends Controller {
  static values = {
    message: String
  }

  connect() {
    this.element.addEventListener('submit', (event) => {
      if (!window.confirm(this.messageValue || 'Are you sure?')) {
        event.preventDefault()
      }
    })
  }
})
