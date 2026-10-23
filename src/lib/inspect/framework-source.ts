/**
 * Which component rendered a picked element, read in the page's own world.
 *
 * Frameworks keep that on the DOM node as a JS property — React's fiber, Vue's
 * component instance, Svelte's `__svelte_meta` — and JS properties are per
 * world: the picker in the isolated world sees the node but not them. So the
 * picker stamps the node with a one-use attribute, and this function, run in
 * the MAIN world, finds it, removes the stamp, and reads what the framework
 * recorded. Development builds record names and source positions; production
 * builds usually record neither, and the answer is then `null` rather than a
 * guess.
 *
 * Passed to `chrome.scripting.executeScript({ func, world: "MAIN" })`, which
 * serializes it: every helper lives inside the body. What it returns is the
 * page's claim, like everything else the page says.
 */
import type { FrameworkInfo } from "./element-context"

/** The attribute the picker stamps on an element for {@link mainFrameworkSource}. */
export const PROBE_ATTRIBUTE = "data-cognia-probe"

export function mainFrameworkSource(token: string): FrameworkInfo | null {
  const MAX_FRAMES = 10
  const MAX_NAME = 80
  type Location = { file: string; line?: number; column?: number; approximate?: true }
  type Frame = { name: string; source?: Location }

  const element = document.querySelector(`[data-cognia-probe="${token.replace(/["\\]/g, "")}"]`)
  if (!element) return null
  element.removeAttribute("data-cognia-probe")

  const MAX_PROPS = 1_500
  const SECRET = /pass(?:word)?|secret|token|auth|cookie|session|credential|api[-_]?key|private/i
  const clip = (value: string) => (value.length > MAX_NAME ? value.slice(0, MAX_NAME) : value)
  const record = (value: unknown): Record<string, unknown> | null =>
    value && (typeof value === "object" || typeof value === "function")
      ? (value as Record<string, unknown>)
      : null
  const positive = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined

  /**
   * A served module's path, `/src/App.tsx`, without its origin or query; a
   * path the bundler wrote (`src/App.vue`) is kept as written.
   */
  const tidyFile = (file: string) => {
    if (/^(?:https?|webpack(?:-internal)?|file):\/\//i.test(file)) {
      try {
        return decodeURIComponent(new URL(file).pathname)
      } catch {
        // Unparseable: fall through to the plain trim.
      }
    }
    return file.replace(/[?#].*$/, "")
  }

  const fromSource = (value: unknown): Location | undefined => {
    const source = record(value)
    if (!source || typeof source.fileName !== "string" || !source.fileName) return undefined
    const line = positive(source.lineNumber)
    const column = positive(source.columnNumber)
    return {
      file: tidyFile(source.fileName),
      ...(line ? { line } : {}),
      ...(column ? { column } : {}),
    }
  }

  // React 19 dropped `_debugSource` for `_debugStack`, the stack at the point
  // the element was created. Its first frame outside React and the bundler's
  // dependency cache is the JSX that wrote it — a position in the served
  // module, which is the source line for most dev servers but not all.
  const fromStack = (value: unknown): Location | undefined => {
    const stack = record(value)?.stack
    if (typeof stack !== "string") return undefined
    for (const line of stack.split("\n").slice(1)) {
      const match = line.match(
        /\(?((?:https?|webpack(?:-internal)?|file):\/\/[^\s)]+):(\d+):(\d+)\)?\s*$/
      )
      if (!match?.[1]) continue
      if (
        /node_modules|\/\.vite\/deps\/|\/@vite\/|\/@react-refresh|react-dom|react-jsx|jsx-dev-runtime|jsx-runtime|react-stack|\/chunk-/.test(
          match[1]
        )
      )
        continue
      return {
        file: tidyFile(match[1]),
        line: Number(match[2]),
        column: Number(match[3]),
        approximate: true,
      }
    }
    return undefined
  }

  const reactName = (type: unknown, depth = 0): string | null => {
    if (depth > 3) return null
    if (typeof type === "function") {
      const fn = type as { displayName?: unknown; name?: unknown }
      const name = typeof fn.displayName === "string" ? fn.displayName : fn.name
      return typeof name === "string" && name ? name : null
    }
    const object = record(type)
    if (!object) return null
    if (typeof object.displayName === "string" && object.displayName) return object.displayName
    // forwardRef keeps its function under `render`, memo under `type`.
    return reactName(object.render, depth + 1) ?? reactName(object.type, depth + 1)
  }

  /** A JSON-able sketch of a value: two levels deep, nothing callable, no secrets. */
  const sketch = (value: unknown, depth: number): unknown => {
    if (value === null || typeof value === "boolean" || typeof value === "number") return value
    if (value === undefined) return "[undefined]"
    if (typeof value === "string") return value.length > 120 ? `${value.slice(0, 119)}…` : value
    if (typeof value === "function")
      return `[function ${(value as { name?: string }).name || "anonymous"}]`
    if (typeof value !== "object") return String(value)
    const object = value as Record<string, unknown>
    if ("$$typeof" in object) {
      const type = object.type
      return `<${typeof type === "string" ? type : (reactName(type) ?? "element")}>`
    }
    if (typeof Element === "function" && value instanceof Element)
      return `[element ${value.tagName.toLowerCase()}]`
    if (Array.isArray(value)) {
      if (depth >= 2) return `[array of ${value.length}]`
      const items = value.slice(0, 5).map((item) => sketch(item, depth + 1))
      return value.length > 5 ? [...items, `… ${value.length - 5} more`] : items
    }
    if (depth >= 2) return "[object]"
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(object).slice(0, 15)) {
      out[key] = SECRET.test(key) ? "[redacted]" : sketch(object[key], depth + 1)
    }
    return out
  }
  const jsonOf = (component: string, value: unknown) => {
    let json = JSON.stringify(value, null, 2)
    if (json.length > MAX_PROPS) json = `${json.slice(0, MAX_PROPS - 1)}…`
    return { component: clip(component), json }
  }
  const propsOf = (component: string, value: unknown) => {
    const props = record(value)
    if (!props || Object.keys(props).length === 0) return undefined
    return jsonOf(component, sketch(props, 0))
  }
  /** An object's own data, without the methods a component keeps beside it. */
  const dataOf = (value: unknown) => {
    const object = record(value)
    if (!object) return null
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(object).slice(0, 15)) {
      if (key.startsWith("$") || key.startsWith("_") || typeof object[key] === "function") continue
      out[key] = SECRET.test(key) ? "[redacted]" : sketch(object[key], 1)
    }
    return Object.keys(out).length > 0 ? out : null
  }

  /**
   * A React component's state (React DevTools): a class's `state`, or a
   * function component's state hooks in call order — `useState` and
   * `useReducer` are the hooks with a dispatching queue. The hooks have no
   * names on the fiber; their order is the order they are called in.
   */
  const reactState = (component: string, fiber: Record<string, unknown>) => {
    const instance = record(fiber.stateNode)
    if (instance && record(instance.state) && typeof instance.render === "function") {
      const state = dataOf(instance.state)
      return state ? jsonOf(component, state) : undefined
    }
    const values: unknown[] = []
    for (
      let hook = record(fiber.memoizedState), count = 0;
      hook && count < 50 && values.length < 10;
      hook = record(hook.next), count++
    ) {
      const queue = record(hook.queue)
      if (queue && typeof queue.dispatch === "function") values.push(sketch(hook.memoizedState, 1))
    }
    return values.length > 0 ? jsonOf(component, values) : undefined
  }

  const react = (): FrameworkInfo | null => {
    const holder = element as unknown as Record<string, unknown>
    const key = Object.keys(holder).find(
      (name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$")
    )
    if (!key) return null
    const fiber = record(holder[key])
    if (!fiber) return null
    const components: Frame[] = []
    let props: FrameworkInfo["props"]
    let state: FrameworkInfo["state"]
    for (
      let node = record(fiber.return);
      node && components.length < MAX_FRAMES;
      node = record(node.return)
    ) {
      const name = reactName(node.type)
      if (!name) continue
      if (components.length === 0) {
        props = propsOf(name, node.memoizedProps)
        state = reactState(name, node)
      }
      const source = fromSource(node._debugSource) ?? fromStack(node._debugStack)
      const previous = components[components.length - 1]
      if (previous?.name === name) continue
      components.push({ name: clip(name), ...(source ? { source } : {}) })
    }
    const source = fromSource(fiber._debugSource) ?? fromStack(fiber._debugStack)
    return {
      framework: "react",
      components,
      ...(source ? { source } : {}),
      ...(props ? { props } : {}),
      ...(state ? { state } : {}),
    }
  }

  const vue = (): FrameworkInfo | null => {
    for (let node: Element | null = element, depth = 0; node && depth < 50; depth++) {
      const holder = node as unknown as Record<string, unknown>
      const instance = record(holder.__vueParentComponent)
      if (instance) {
        const components: Frame[] = []
        for (
          let current: Record<string, unknown> | null = instance;
          current && components.length < MAX_FRAMES;
          current = record(current.parent)
        ) {
          const type = record(current.type)
          const file = typeof type?.__file === "string" ? type.__file : undefined
          const name =
            (typeof type?.name === "string" && type.name) ||
            (typeof type?.__name === "string" && type.__name) ||
            (file ? (file.split("/").pop() ?? "").replace(/\.vue$/, "") : "")
          if (!name) continue
          components.push({
            name: clip(name),
            ...(file ? { source: { file: tidyFile(file) } } : {}),
          })
        }
        const name = components[0]?.name
        const props = name ? propsOf(name, instance.props) : undefined
        // `setupState` holds what `setup()` returned, refs already unwrapped;
        // `data` what the options API declared.
        const data = { ...dataOf(instance.data), ...dataOf(instance.setupState) }
        const state = name && Object.keys(data).length > 0 ? jsonOf(name, data) : undefined
        return {
          framework: "vue",
          components,
          ...(props ? { props } : {}),
          ...(state ? { state } : {}),
        }
      }
      const legacy = record(holder.__vue__)
      if (legacy) {
        const components: Frame[] = []
        for (
          let current: Record<string, unknown> | null = legacy;
          current && components.length < MAX_FRAMES;
          current = record(current.$parent)
        ) {
          const options = record(current.$options)
          const file = typeof options?.__file === "string" ? options.__file : undefined
          const name =
            (typeof options?.name === "string" && options.name) ||
            (typeof options?._componentTag === "string" && options._componentTag) ||
            ""
          if (!name) continue
          components.push({
            name: clip(name),
            ...(file ? { source: { file: tidyFile(file) } } : {}),
          })
        }
        const name = components[0]?.name
        const props = name ? propsOf(name, legacy.$props) : undefined
        const data = dataOf(legacy.$data)
        const state = name && data ? jsonOf(name, data) : undefined
        return {
          framework: "vue",
          components,
          ...(props ? { props } : {}),
          ...(state ? { state } : {}),
        }
      }
      node = node.parentElement
    }
    return null
  }

  const svelte = (): FrameworkInfo | null => {
    for (let node: Element | null = element, depth = 0; node && depth < 50; depth++) {
      const loc = record(record((node as unknown as Record<string, unknown>).__svelte_meta)?.loc)
      if (loc && typeof loc.file === "string") {
        const line = typeof loc.line === "number" ? loc.line : undefined
        const column = typeof loc.column === "number" ? loc.column : undefined
        // Svelte 4 counts lines from zero and Svelte 5 from one; the file is
        // certain, the line is close.
        return {
          framework: "svelte",
          components: [],
          source: {
            file: tidyFile(loc.file),
            ...(line !== undefined ? { line } : {}),
            ...(column !== undefined ? { column } : {}),
            approximate: true,
          },
        }
      }
      node = node.parentElement
    }
    return null
  }

  const angular = (): FrameworkInfo | null => {
    const ng = record((window as unknown as Record<string, unknown>).ng)
    if (!ng || typeof ng.getOwningComponent !== "function") return null
    const components: Frame[] = []
    const getComponent = typeof ng.getComponent === "function" ? ng.getComponent : null
    const own = getComponent ? record(getComponent(element)) : null
    let current: Record<string, unknown> | null = own ?? record(ng.getOwningComponent(element))
    while (current && components.length < MAX_FRAMES) {
      const name = reactName(current.constructor)
      if (name) components.push({ name: clip(name) })
      const host =
        typeof ng.getHostElement === "function" ? (ng.getHostElement(current) as Element) : null
      current = host?.parentElement ? record(ng.getOwningComponent(host.parentElement)) : null
    }
    return components.length > 0 ? { framework: "angular", components } : null
  }

  try {
    return react() ?? vue() ?? svelte() ?? angular()
  } catch {
    return null
  }
}
