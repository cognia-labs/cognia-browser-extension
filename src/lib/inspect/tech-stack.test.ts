/** @jest-environment <rootDir>/testing/jsdom-environment.cjs */
import { mainTechStack, stackMarkdown, type StackEntry } from "./tech-stack"

const win = window as unknown as Record<string, unknown>
const planted = new Set<string>()
function plant(values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    planted.add(key)
    win[key] = value
  }
}

const perf = performance as unknown as Record<string, unknown>

afterEach(() => {
  document.body.innerHTML = ""
  document.head.innerHTML = ""
  document.documentElement.removeAttribute("style")
  for (const key of planted) delete win[key]
  planted.clear()
  delete perf.getEntriesByType
})

function named(name: string): StackEntry | undefined {
  return mainTechStack().entries.find((entry) => entry.name === name)
}

describe("mainTechStack", () => {
  it("finds nothing on a plain page", () => {
    document.body.innerHTML = "<p>Hello</p>"
    expect(mainTechStack()).toEqual({ entries: [], development: null, facts: null })
  })

  it("names frameworks, versions, build tools and monitoring the page announces, with evidence", () => {
    document.body.innerHTML = `<div id="__next"><button class="px-4 py-2">Go</button></div>`
    const button = document.querySelector("button") as unknown as Record<string, unknown>
    button["__reactFiber$x"] = { _debugSource: { fileName: "a.tsx" } }
    plant({
      __NEXT_DATA__: { buildId: "abc" },
      next: { version: "15.1.0" },
      jQuery: { fn: { jquery: "3.7.1" } },
      __SENTRY__: { version: "8.0.0" },
      webpackChunk_app: [],
      __REACT_DEVTOOLS_GLOBAL_HOOK__: { renderers: new Map([[1, { version: "19.1.0" }]]) },
    })
    document.head.innerHTML = `<script type="module" src="/@vite/client"></script>`
    const stack = mainTechStack()
    expect(stack.entries).toEqual(
      expect.arrayContaining([
        {
          name: "React",
          category: "framework",
          version: "19.1.0",
          evidence: "React fiber on the DOM",
        },
        {
          name: "Next.js",
          category: "meta-framework",
          version: "15.1.0",
          detail: "Pages Router",
          evidence: "window.__NEXT_DATA__",
        },
        { name: "jQuery", category: "library", version: "3.7.1", evidence: "window.jQuery" },
        { name: "Sentry", category: "monitoring", version: "8.0.0", evidence: "window.__SENTRY__" },
        { name: "webpack", category: "build", evidence: "window.webpackChunk_app" },
        { name: "Vite", category: "build", detail: "dev server", evidence: "/@vite/client" },
      ])
    )
    // App frameworks first, then frameworks: the order the agent reads them in.
    expect(stack.entries[0]?.name).toBe("Next.js")
    expect(stack.development).toBe(true)
  })

  it("tells the Next.js routers apart, and a development build by its build id", () => {
    plant({ __next_f: [] })
    expect(named("Next.js")).toMatchObject({ detail: "App Router", evidence: "self.__next_f" })
    delete win.__next_f
    plant({ __NEXT_DATA__: { buildId: "development" } })
    expect(mainTechStack().development).toBe(true)
  })

  it("reads Angular's own version stamp, and AngularJS apart from it", () => {
    document.body.innerHTML = `<app-root ng-version="18.2.1"></app-root>`
    expect(named("Angular")).toEqual({
      name: "Angular",
      category: "framework",
      version: "18.2.1",
      evidence: "ng-version attribute",
    })
    document.body.innerHTML = `<div ng-app="shop"></div>`
    plant({ angular: { version: { full: "1.8.3" } } })
    expect(named("AngularJS")).toMatchObject({ version: "1.8.3" })
  })

  it("tells Vue 2 from Vue 3, and finds the router and store they carry", () => {
    const app = document.createElement("div")
    app.id = "app"
    document.body.append(app)
    ;(app as unknown as Record<string, unknown>).__vue_app__ = {
      version: "3.5.13",
      config: { globalProperties: { $pinia: {}, $router: {} } },
    }
    const stack = mainTechStack().entries
    expect(stack.find((entry) => entry.name === "Vue")).toMatchObject({
      version: "3.5.13",
      detail: "Vue 3",
    })
    expect(stack.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["Pinia", "Vue Router"])
    )

    document.body.innerHTML = `<div id="legacy"></div>`
    const legacy = document.getElementById("legacy") as unknown as Record<string, unknown>
    legacy.__vue__ = { $root: { constructor: { version: "2.7.16" }, $store: {} } }
    const old = mainTechStack().entries
    expect(old.find((entry) => entry.name === "Vue")).toMatchObject({
      version: "2.7.16",
      detail: "Vue 2",
      evidence: "Vue 2 instance (__vue__)",
    })
    expect(old.find((entry) => entry.name === "Vuex")).toBeDefined()
  })

  it("reads what the generator tag says, known or not", () => {
    document.head.innerHTML = `
      <meta name="generator" content="WordPress 6.5.2" />
      <meta name="generator" content="MkDocs-1.6.0, mkdocs-material-9.5.2" />
      <meta name="generator" content="Framer 5bd7f0e" />
      <meta name="generator" content="Acme Builder 2.1" />`
    const entries = mainTechStack().entries
    const pick = (name: string) => entries.find((entry) => entry.name === name)
    expect(pick("WordPress")).toEqual({
      name: "WordPress",
      category: "cms",
      version: "6.5.2",
      evidence: '<meta name="generator">',
    })
    expect(pick("MkDocs")).toMatchObject({ version: "1.6.0" })
    expect(pick("Material for MkDocs")).toMatchObject({ version: "9.5.2" })
    // A build hash is not a version.
    expect(pick("Framer")).not.toHaveProperty("version")
    expect(pick("Acme Builder")).toMatchObject({ category: "cms", version: "2.1" })
  })

  it("reads package versions from CDN addresses and the import map", () => {
    document.head.innerHTML = `
      <script src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js"></script>
      <script src="https://unpkg.com/htmx.org@2.0.3"></script>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
      <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/@acme/widgets@1.2.0/index.js"></script>
      <script type="importmap">{"imports":{"vue":"https://esm.sh/vue@3.4.21"}}</script>`
    const entries = mainTechStack().entries
    const pick = (name: string) => entries.find((entry) => entry.name === name)
    expect(pick("Alpine.js")).toEqual({
      name: "Alpine.js",
      category: "framework",
      version: "3.14.1",
      evidence: "jsDelivr: alpinejs@3.14.1",
    })
    expect(pick("htmx")).toMatchObject({ version: "2.0.3" })
    expect(pick("GSAP")).toMatchObject({ version: "3.12.5", evidence: "cdnjs: gsap@3.12.5" })
    expect(pick("jQuery")).toMatchObject({ version: "3.7.1" })
    expect(pick("Vue")).toMatchObject({ version: "3.4.21", evidence: "esm.sh: vue@3.4.21" })
    // Not one it knows: still named, as a library, by its package.
    expect(pick("@acme/widgets")).toMatchObject({ category: "library", version: "1.2.0" })
    expect(pick("Import maps")).toMatchObject({ category: "build" })
    expect(pick("jsDelivr")).toMatchObject({ category: "hosting" })
  })

  it("names styling and component libraries by their marks, with versions where they say", () => {
    document.head.innerHTML = `<style data-styled="active" data-styled-version="6.1.13"></style>
      <style>/*! tailwindcss v4.1.11 | MIT License */</style>`
    document.documentElement.style.setProperty("--bs-primary", "#0d6efd")
    document.documentElement.style.setProperty("--el-color-primary", "#409eff")
    document.body.innerHTML = `
      <div id="headlessui-menu-1"></div>
      <div class="ant-btn"></div>
      ${Array.from({ length: 4 }, (_, index) => `<p class="Card_title__a1B2c${index}"></p>`).join("")}`
    const entries = mainTechStack().entries
    const pick = (name: string) => entries.find((entry) => entry.name === name)
    expect(pick("styled-components")).toMatchObject({ version: "6.1.13" })
    expect(pick("Tailwind CSS")).toMatchObject({
      version: "4.1.11",
      evidence: "tailwindcss banner",
    })
    expect(pick("Bootstrap")).toMatchObject({ detail: "v5", evidence: "--bs-* variables" })
    expect(pick("Element Plus")).toMatchObject({ category: "ui-library" })
    expect(pick("Headless UI")).toBeDefined()
    expect(pick("Ant Design")).toBeDefined()
    expect(pick("CSS Modules")).toMatchObject({ evidence: "4 hashed class names" })
  })

  it("names libraries, analytics, monitoring, payments, auth and services by their globals", () => {
    document.head.innerHTML = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>`
    plant({
      gtag: () => undefined,
      google_tag_manager: { "GTM-XYZ": {}, dataLayer: {} },
      _: { VERSION: "4.17.21", flow: () => undefined },
      __THREE__: "168",
      echarts: { version: "5.5.1" },
      mixpanel: {},
      clarity: () => undefined,
      analytics: { track: () => undefined, VERSION: "4.4.0" },
      DD_RUM: { version: "5.20.0" },
      LogRocket: {},
      Stripe: Object.assign(() => undefined, { version: 3 }),
      Clerk: { version: "5.2.0" },
      grecaptcha: {},
      Intercom: () => undefined,
      __APOLLO_CLIENT__: { version: "3.11.0" },
      Livewire: {},
    })
    const entries = mainTechStack().entries
    const pick = (name: string) => entries.find((entry) => entry.name === name)
    expect(pick("Google Analytics")).toMatchObject({ category: "analytics", detail: "GA4" })
    expect(pick("Google Tag Manager")).toMatchObject({ evidence: "GTM-XYZ" })
    expect(pick("Lodash")).toMatchObject({ version: "4.17.21" })
    expect(pick("three.js")).toMatchObject({ version: "168" })
    expect(pick("ECharts")).toMatchObject({ version: "5.5.1" })
    expect(pick("Segment")).toMatchObject({ version: "4.4.0" })
    expect(pick("Mixpanel")).toBeDefined()
    expect(pick("Microsoft Clarity")).toBeDefined()
    expect(pick("Datadog RUM")).toMatchObject({ category: "monitoring", version: "5.20.0" })
    expect(pick("LogRocket")).toBeDefined()
    expect(pick("Stripe")).toMatchObject({ category: "payments", version: "3" })
    expect(pick("Clerk")).toMatchObject({ category: "auth", version: "5.2.0" })
    expect(pick("reCAPTCHA")).toMatchObject({ category: "auth" })
    expect(pick("Intercom")).toMatchObject({ category: "service" })
    expect(pick("Apollo Client")).toMatchObject({ category: "state", version: "3.11.0" })
    expect(pick("Livewire")).toBeDefined()
  })

  it("does not take a page's own `analytics` object for Segment", () => {
    plant({ analytics: { enabled: true } })
    expect(named("Segment")).toBeUndefined()
  })

  it("keeps going past a global that throws", () => {
    Object.defineProperty(window, "Vue", {
      configurable: true,
      get() {
        throw new Error("trap")
      },
    })
    planted.add("Vue")
    plant({ jQuery: { fn: { jquery: "3.6.0" } } })
    try {
      expect(named("jQuery")).toMatchObject({ version: "3.6.0" })
    } finally {
      delete win.Vue
    }
  })

  it("tells how the page is put together: scripts, weight, protocol and other sites", () => {
    document.head.innerHTML = `
      <script src="/a.js"></script>
      <script type="module" src="/b.js"></script>
      <script>window.x = 1</script>
      <script type="application/ld+json">{}</script>
      <link rel="stylesheet" href="/s.css" />
      <link rel="manifest" href="/manifest.webmanifest" />`
    document.body.innerHTML = `<my-card></my-card><my-card></my-card><x-icon></x-icon>`
    perf.getEntriesByType = (type: string) =>
      type === "navigation"
        ? [{ nextHopProtocol: "h2" }]
        : [
            { name: "http://localhost/a.js", initiatorType: "script", transferSize: 2048 },
            {
              name: "http://localhost/b.js",
              initiatorType: "script",
              transferSize: 0,
              encodedBodySize: 1024,
            },
            { name: "http://localhost/s.css", initiatorType: "link", transferSize: 1024 },
            { name: "https://www.google-analytics.com/g/collect", initiatorType: "beacon" },
            { name: "https://www.google-analytics.com/g/collect", initiatorType: "beacon" },
            { name: "https://fonts.gstatic.com/x.woff2", initiatorType: "css" },
          ]
    expect(mainTechStack().facts).toEqual({
      scripts: 2,
      moduleScripts: 1,
      inlineScripts: 1,
      stylesheets: 1,
      jsKb: 3,
      cssKb: 1,
      protocol: "h2",
      serviceWorker: false,
      manifest: true,
      importMap: false,
      customElements: ["my-card", "x-icon"],
      thirdParty: [
        { host: "www.google-analytics.com", count: 2 },
        { host: "fonts.gstatic.com", count: 1 },
      ],
    })
  })

  it("names the host a page is served from", () => {
    document.head.innerHTML = `<script src="/cdn-cgi/challenge-platform/h/b/orchestrate.js"></script>`
    expect(named("Cloudflare")).toMatchObject({ category: "hosting" })
  })
})

describe("stackMarkdown", () => {
  it("lists what was found by kind, with its evidence, and what kind of build it is", () => {
    expect(
      stackMarkdown({
        entries: [
          {
            name: "Vue",
            category: "framework",
            version: "3.5.0",
            detail: "Vue 3",
            evidence: "__vue_app__",
          },
          { name: "Tailwind CSS", category: "styling" },
          { name: "Pinia", category: "state", evidence: "app.$pinia" },
          { name: "Nuxt", category: "meta-framework" },
        ],
        development: false,
        facts: {
          scripts: 4,
          moduleScripts: 4,
          inlineScripts: 1,
          stylesheets: 1,
          jsKb: 310,
          cssKb: 22,
          protocol: "h3",
          serviceWorker: true,
          manifest: false,
          importMap: false,
          customElements: ["nuxt-link"],
          thirdParty: [{ host: "cdn.example.net", count: 3 }],
        },
      })
    ).toBe(
      [
        "## Tech stack",
        "",
        "- App framework: Nuxt",
        "- Framework: Vue 3.5.0 (Vue 3) — __vue_app__",
        "- Styling: Tailwind CSS",
        "- State & data: Pinia — app.$pinia",
        "",
        "This looks like a production build: component names and source positions may be minified or missing.",
        "",
        "Page: 4 scripts (4 modules), 1 inline, 1 stylesheet, 310 KB of JavaScript, 22 KB of CSS, served over h3, a service worker controls it.",
        "Custom elements: <nuxt-link>.",
        "Loads from other sites: cdn.example.net (3).",
      ].join("\n")
    )
  })

  it("says when nothing was recognisable", () => {
    expect(stackMarkdown({ entries: [], development: null })).toBe(
      "## Tech stack\n\nNothing recognisable: plain HTML, or a build that hides its tooling."
    )
  })
})
