/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { PROBE_ATTRIBUTE, mainFrameworkSource } from "./framework-source"

function stamped(token = "tok"): HTMLElement {
  document.body.innerHTML = `<section><div><button>Save</button></div></section>`
  const button = document.querySelector("button")!
  button.setAttribute(PROBE_ATTRIBUTE, token)
  return button
}

afterEach(() => {
  document.body.innerHTML = ""
  delete (window as unknown as { ng?: unknown }).ng
})

describe("mainFrameworkSource", () => {
  it("answers null, and touches nothing, when no element carries the stamp", () => {
    document.body.innerHTML = "<p>plain</p>"
    expect(mainFrameworkSource("missing")).toBeNull()
  })

  it("removes its stamp, and answers null for a page with no framework", () => {
    const button = stamped()
    expect(mainFrameworkSource("tok")).toBeNull()
    expect(button.hasAttribute(PROBE_ATTRIBUTE)).toBe(false)
  })

  it("reads a React fiber's component chain and where the element was written", () => {
    const button = stamped()
    function SettingsForm() {}
    const SaveButton = Object.assign(() => null, { displayName: "SaveButton" })
    const memoised = { type: { render: function Inner() {} } }
    const root = {
      type: SettingsForm,
      return: null,
      _debugSource: { fileName: "/app/src/Form.tsx", lineNumber: 3 },
    }
    const memo = { type: memoised, return: root }
    const component = {
      type: SaveButton,
      return: memo,
      _debugSource: {
        fileName: "http://localhost:5173/src/Form.tsx?t=1",
        lineNumber: 9,
        columnNumber: 7,
      },
    }
    const host = {
      type: "button",
      return: { type: "div", return: component },
      _debugSource: { fileName: "/app/src/SaveButton.tsx", lineNumber: 12, columnNumber: 5 },
    }
    ;(button as unknown as Record<string, unknown>)["__reactFiber$abc"] = host
    expect(mainFrameworkSource("tok")).toEqual({
      framework: "react",
      components: [
        { name: "SaveButton", source: { file: "/src/Form.tsx", line: 9, column: 7 } },
        { name: "Inner" },
        { name: "SettingsForm", source: { file: "/app/src/Form.tsx", line: 3 } },
      ],
      source: { file: "/app/src/SaveButton.tsx", line: 12, column: 5 },
    })
  })

  it("sketches the nearest component's props, redacting secrets and naming callables", () => {
    const button = stamped()
    function Save() {}
    ;(button as unknown as Record<string, unknown>)["__reactFiber$p"] = {
      type: "button",
      return: {
        type: Save,
        return: null,
        memoizedProps: {
          variant: "primary",
          count: 3,
          onClick: function handleSave() {},
          authToken: "abc123",
          items: [1, 2, 3, 4, 5, 6, 7],
          icon: { $$typeof: Symbol.for("react.element"), type: "svg" },
          nested: { deep: { deeper: { deepest: 1 } } },
          long: "x".repeat(200),
        },
      },
    }
    const props = mainFrameworkSource("tok")?.props
    expect(props?.component).toBe("Save")
    expect(JSON.parse(props!.json)).toEqual({
      variant: "primary",
      count: 3,
      onClick: "[function handleSave]",
      authToken: "[redacted]",
      items: [1, 2, 3, 4, 5, "… 2 more"],
      icon: "<svg>",
      nested: { deep: "[object]" },
      long: `${"x".repeat(119)}…`,
    })
  })

  it("reads a function component's state hooks in call order, and a class's state", () => {
    const button = stamped()
    const dispatch = () => undefined
    function Cart() {}
    // useState, useRef, useReducer, useMemo: only the hooks with a dispatching queue are state.
    const hooks = {
      memoizedState: 2,
      queue: { dispatch },
      next: {
        memoizedState: { current: null },
        queue: null,
        next: {
          memoizedState: { open: true, sessionToken: "s3cret" },
          queue: { dispatch },
          next: { memoizedState: [42, []], queue: null, next: null },
        },
      },
    }
    ;(button as unknown as Record<string, unknown>)["__reactFiber$s"] = {
      type: "button",
      return: { type: Cart, memoizedProps: {}, memoizedState: hooks, return: null },
    }
    const state = mainFrameworkSource("tok")?.state
    expect(state?.component).toBe("Cart")
    expect(JSON.parse(state!.json)).toEqual([2, { open: true, sessionToken: "[redacted]" }])

    const classButton = stamped("tok2")
    class Panel {
      state = { tab: "billing", onPick: () => undefined }
      render() {}
    }
    ;(classButton as unknown as Record<string, unknown>)["__reactFiber$c"] = {
      type: "button",
      return: { type: Panel, stateNode: new Panel(), memoizedState: null, return: null },
    }
    expect(JSON.parse(mainFrameworkSource("tok2")!.state!.json)).toEqual({ tab: "billing" })
  })

  it("reads a Vue component's data and setup state, leaving out its methods", () => {
    stamped()
    ;(document.querySelector("div") as unknown as Record<string, unknown>).__vueParentComponent = {
      type: { __name: "Filters" },
      parent: null,
      data: { page: 1 },
      setupState: { query: "shoes", apiKey: "k", reset: () => undefined, $el: {} },
    }
    expect(JSON.parse(mainFrameworkSource("tok")!.state!.json)).toEqual({
      page: 1,
      query: "shoes",
      apiKey: "[redacted]",
    })
  })

  it("reads React 19's creation stack, skipping React and the dependency cache", () => {
    const button = stamped()
    const stack = [
      "Error: react-stack-top-frame",
      "    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1:250:30)",
      "    at App (http://localhost:5173/src/App.tsx?t=2:20:7)",
    ].join("\n")
    ;(button as unknown as Record<string, unknown>)["__reactFiber$x"] = {
      type: "button",
      return: { type: function App() {}, return: null },
      _debugStack: { stack },
    }
    expect(mainFrameworkSource("tok")).toMatchObject({
      framework: "react",
      components: [{ name: "App" }],
      source: { file: "/src/App.tsx", line: 20, column: 7, approximate: true },
    })
  })

  it("reads a Vue 3 component from the nearest element that knows it", () => {
    stamped()
    const parent = { type: { name: "App", __file: "src/App.vue" }, parent: null }
    const own = { type: { __name: "SaveButton", __file: "src/components/SaveButton.vue" }, parent }
    ;(document.querySelector("div") as unknown as Record<string, unknown>).__vueParentComponent =
      own
    expect(mainFrameworkSource("tok")).toEqual({
      framework: "vue",
      components: [
        { name: "SaveButton", source: { file: "src/components/SaveButton.vue" } },
        { name: "App", source: { file: "src/App.vue" } },
      ],
    })
  })

  it("reads Vue 2 and Svelte development builds", () => {
    const button = stamped()
    ;(button as unknown as Record<string, unknown>).__vue__ = {
      $options: { name: "LegacyButton", __file: "src/Legacy.vue" },
      $parent: null,
    }
    expect(mainFrameworkSource("tok")?.components).toEqual([
      { name: "LegacyButton", source: { file: "src/Legacy.vue" } },
    ])

    const svelteButton = stamped("tok2")
    ;(svelteButton as unknown as Record<string, unknown>).__svelte_meta = {
      loc: { file: "src/lib/Save.svelte", line: 4, column: 2 },
    }
    expect(mainFrameworkSource("tok2")).toEqual({
      framework: "svelte",
      components: [],
      source: { file: "src/lib/Save.svelte", line: 4, column: 2, approximate: true },
    })
  })

  it("reads Angular's owning component in a dev build", () => {
    const button = stamped()
    class SaveComponent {}
    const instance = new SaveComponent()
    ;(window as unknown as { ng: unknown }).ng = {
      getComponent: () => null,
      getOwningComponent: (element: Element) => (element === button ? instance : null),
      getHostElement: () => document.querySelector("section"),
    }
    expect(mainFrameworkSource("tok")).toEqual({
      framework: "angular",
      components: [{ name: "SaveComponent" }],
    })
  })

  it("never throws on a page that booby-traps its own objects", () => {
    const button = stamped()
    Object.defineProperty(button, "__reactFiber$trap", {
      enumerable: true,
      get() {
        throw new Error("gotcha")
      },
    })
    expect(mainFrameworkSource("tok")).toBeNull()
  })
})
