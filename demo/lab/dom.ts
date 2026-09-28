/**
 * Minimal element factory shared by the panels.
 *
 * The lab builds its DOM in TypeScript rather than template strings so a
 * panel file reads as one contiguous usage example: markup, wiring and API
 * calls side by side.
 */

type Attrs = Record<string, string | number | boolean>

export function h<K extends keyof HTMLElementTagNameMap> (
  tag: K,
  attrs: Attrs = {},
  ...children: ReadonlyArray<HTMLElement>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  const { text, ...rest } = attrs
  if (text !== undefined) el.textContent = String(text)
  for (const [key, value] of Object.entries(rest)) {
    if (key === 'checked') {
      const input = el as HTMLInputElement
      input.checked = Boolean(value)
    } else if (key === 'value') {
      const input = el as HTMLInputElement
      input.value = String(value)
    } else {
      el.setAttribute(key, String(value))
    }
  }
  el.append(...children)
  return el
}
