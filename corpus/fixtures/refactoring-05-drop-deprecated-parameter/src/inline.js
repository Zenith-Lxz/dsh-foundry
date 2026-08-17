import { render } from './render.js'

/** Render inline, with no indent. */
export function inline(value) {
  return render(value, false)
}
