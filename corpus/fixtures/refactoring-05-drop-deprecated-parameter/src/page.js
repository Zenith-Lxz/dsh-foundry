import { render } from './render.js'

/** Render a page body. */
export function body(value) {
  return render(value, false, 2)
}
