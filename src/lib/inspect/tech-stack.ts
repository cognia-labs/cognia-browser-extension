/**
 * What the page is built with (Wappalyzer), so the agent starts from the
 * right framework, styling approach and build — and knows whether the page in
 * front of it is a development build whose component names can be trusted.
 *
 * Frameworks announce themselves through globals and DOM markers that only
 * the page's own world sees, so detection runs in the MAIN world. Besides
 * those, the page is read for what it says of itself: its generator meta tag,
 * the package versions in its CDN script addresses and import map, its
 * stylesheets' structure. Every finding carries the evidence it rests on, and
 * a version is reported only when the page says it. Alongside, a few facts
 * about how the page is put together: how much script and CSS it loads, from
 * where, and over what.
 */

export const STACK_CATEGORIES = [
  "meta-framework",
  "framework",
  "cms",
  "ui-library",
  "styling",
  "state",
  "build",
  "library",
  "analytics",
  "monitoring",
  "payments",
  "auth",
  "service",
  "hosting",
] as const
export type StackCategory = (typeof STACK_CATEGORIES)[number]

export interface StackEntry {
  name: string
  category: StackCategory
  version?: string
  /** What kind of it: `App Router`, `Vue 2`, `GA4`. */
  detail?: string
  /** What it was told by: `window.__NEXT_DATA__`, `<meta name="generator">`, a CDN address. */
  evidence?: string
}

/** How the page is put together, as far as it lets that be read. */
export interface StackFacts {
  /** Scripts loaded from an address, of which `moduleScripts` as modules; and inline ones. */
  scripts: number
  moduleScripts: number
  inlineScripts: number
  stylesheets: number
  /** Kilobytes of script and CSS transferred, where the browser could tell; null when not. */
  jsKb: number | null
  cssKb: number | null
  /** The protocol the page itself came over: `h2`, `h3`, `http/1.1`. */
  protocol: string | null
  serviceWorker: boolean
  manifest: boolean
  importMap: boolean
  /** The custom elements in use, first few. */
  customElements: string[]
  /** Other sites the page loads from, most requests first. */
  thirdParty: { host: string; count: number }[]
}

export interface TechStack {
  tabId: number
  ranAt: number
  entries: StackEntry[]
  /** A development build, as far as the page lets that be told; null when it cannot be. */
  development: boolean | null
  /** Absent from checks run by older builds. */
  facts?: StackFacts | null
}

export type DetectedStack = Pick<TechStack, "entries" | "development" | "facts">

/** Runs in the page's MAIN world; serialized by `chrome.scripting`. */
export function mainTechStack(): DetectedStack {
  type Category = StackCategory
  type Entry = StackEntry
  const ORDER: Category[] = [
    "meta-framework",
    "framework",
    "cms",
    "ui-library",
    "styling",
    "state",
    "build",
    "library",
    "analytics",
    "monitoring",
    "payments",
    "auth",
    "service",
    "hosting",
  ]
  const entries: Entry[] = []
  const win = window as unknown as Record<string, unknown>
  const record = (value: unknown): Record<string, unknown> | null =>
    value && (typeof value === "object" || typeof value === "function")
      ? (value as Record<string, unknown>)
      : null
  const text = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
    return typeof value === "string" && value.length > 0 && value.length < 40 ? value : undefined
  }
  /** Read a path of properties off a global, through any getter that throws. */
  const read = (root: unknown, ...path: string[]): unknown => {
    let value = root
    for (const key of path) {
      const holder = record(value)
      if (!holder) return undefined
      try {
        value = holder[key]
      } catch {
        return undefined
      }
    }
    return value
  }
  const add = (
    name: string,
    category: Category,
    evidence: string,
    version?: unknown,
    detail?: string
  ) => {
    const known = text(version)?.replace(/^v(?=\d)/, "")
    const found = entries.find((entry) => entry.name === name)
    if (found) {
      // A second source fills in what the first did not say.
      if (!found.version && known) found.version = known
      if (!found.detail && detail) found.detail = detail
      return
    }
    entries.push({
      name,
      category,
      ...(known ? { version: known } : {}),
      ...(detail ? { detail } : {}),
      evidence: evidence.slice(0, 80),
    })
  }
  const found = (name: string) => entries.some((entry) => entry.name === name)
  const has = (selector: string) => {
    try {
      return document.querySelector(selector) !== null
    } catch {
      return false
    }
  }
  const attr = (selector: string, name: string) => {
    try {
      return document.querySelector(selector)?.getAttribute(name) ?? null
    } catch {
      return null
    }
  }
  const safely = (check: () => void) => {
    try {
      check()
    } catch {
      // A page that booby-traps one global keeps the rest of what it says.
    }
  }
  let globals: string[] = []
  safely(() => {
    globals = Object.keys(win)
  })
  const globalLike = (prefix: string) => globals.find((key) => key.startsWith(prefix))
  let development: boolean | null = null
  const sources: string[] = []
  safely(() => {
    for (const element of document.querySelectorAll("script[src], link[href]")) {
      const url = element.getAttribute(element.tagName === "SCRIPT" ? "src" : "href")
      if (url) sources.push(url)
      if (sources.length >= 400) break
    }
  })
  const sourced = (pattern: RegExp) => sources.find((url) => pattern.test(url))

  // —— Frameworks ——
  safely(() => {
    const sample = [document.documentElement, ...document.querySelectorAll("body, body *")].slice(
      0,
      400
    )
    let fiber: Record<string, unknown> | null = null
    let reactRoot = false
    let vue2: Record<string, unknown> | null = null
    let preact = false
    for (const element of sample) {
      const own = element as unknown as Record<string, unknown>
      for (const key of Object.keys(element)) {
        if (key.startsWith("__reactContainer$") || key.startsWith("_reactRootContainer"))
          reactRoot = true
        if (key.startsWith("__reactFiber$") && !fiber) fiber = record(own[key])
        if (key === "__vue__" && !vue2) vue2 = record(own[key])
        // Preact keeps its tree on the container under its mangled `_children`.
        if (key === "__k" && record(own[key]) && "__e" in (record(own[key]) ?? {})) preact = true
      }
      if (fiber && vue2) break
    }
    const hook = record(win.__REACT_DEVTOOLS_GLOBAL_HOOK__)
    const renderers = hook?.renderers instanceof Map ? [...hook.renderers.values()] : []
    const hooked = renderers.map((renderer) => record(renderer)?.version).find(text)
    const reactVersion = hooked ?? read(win.React, "version")
    if (fiber || reactRoot || reactVersion || has("[data-reactroot]")) {
      add(
        "React",
        "framework",
        fiber
          ? "React fiber on the DOM"
          : hooked
            ? "React DevTools hook"
            : reactRoot
              ? "React root container"
              : "window.React",
        reactVersion
      )
      if (fiber)
        development = "_debugSource" in fiber || "_debugStack" in fiber || "_debugOwner" in fiber
    }
    if (preact || win.__PREACT_DEVTOOLS__) add("Preact", "framework", "Preact vnode on the DOM")

    const vueApp = [...document.querySelectorAll("body, body > *, #app, [data-v-app]")]
      .map((element) => record((element as unknown as Record<string, unknown>).__vue_app__))
      .find(Boolean)
    const legacyVue = record(win.Vue)
    const vue2Version = vue2 ? read(vue2, "$root", "constructor", "version") : undefined
    if (vueApp || vue2 || win.__VUE__ || legacyVue || has("[data-v-app]")) {
      const version = text(read(vueApp, "version") ?? vue2Version ?? read(legacyVue, "version"))
      const major = version?.split(".")[0] ?? (vue2 ? "2" : vueApp ? "3" : undefined)
      add(
        "Vue",
        "framework",
        vueApp
          ? "Vue app on the DOM (__vue_app__)"
          : vue2
            ? "Vue 2 instance (__vue__)"
            : "Vue global",
        version,
        major ? `Vue ${major}` : undefined
      )
      if (development === null && win.__VUE_HMR_RUNTIME__) development = true
      const properties = record(read(vueApp, "config", "globalProperties"))
      const root = record(read(vue2, "$root"))
      if (properties?.$pinia || (root && root.$pinia)) add("Pinia", "state", "app.$pinia")
      if (properties?.$store || (root && root.$store)) add("Vuex", "state", "app.$store")
      if (properties?.$router || (root && root.$router)) add("Vue Router", "library", "app.$router")
      if (properties?.$i18n || (root && root.$i18n)) add("Vue I18n", "library", "app.$i18n")
    }

    const ngVersion = attr("[ng-version]", "ng-version")
    if (ngVersion || read(win.ng, "getComponent")) {
      add("Angular", "framework", ngVersion ? "ng-version attribute" : "window.ng", ngVersion)
      if (development === null && read(win.ng, "getComponent")) development = true
      if (has("[ngh], script#ng-state")) add("Angular SSR", "meta-framework", "hydration markers")
    }
    const angularJs = read(win.angular, "version", "full")
    if (angularJs || has("[ng-app], .ng-scope"))
      add("AngularJS", "framework", "window.angular", angularJs)

    const svelte = record(win.__svelte)
    if (svelte || globalLike("__svelte") || has('[class*="svelte-"]')) {
      const majors = svelte?.v instanceof Set ? [...svelte.v].map(String) : []
      add(
        "Svelte",
        "framework",
        svelte ? "window.__svelte" : "svelte- scoped classes",
        undefined,
        majors.length > 0 ? `Svelte ${majors.join(", ")}` : undefined
      )
    }
    if (win._$HY) add("Solid", "framework", "hydration global _$HY")
    const qwik = attr("[q\\:container]", "q:version")
    if (qwik || has("[q\\:container]")) add("Qwik", "framework", "q:container attribute", qwik)
    const lit = win.litElementVersions ?? win.litHtmlVersions
    if (Array.isArray(lit) && lit.length > 0)
      add("Lit", "framework", "window.litElementVersions", lit[lit.length - 1])
    const alpine = record(win.Alpine)
    if (alpine || has("[x-data]"))
      add("Alpine.js", "framework", alpine ? "window.Alpine" : "x-data attributes", alpine?.version)
    const htmx = record(win.htmx)
    if (htmx || has("[hx-get], [hx-post], [hx-boost]"))
      add("htmx", "framework", htmx ? "window.htmx" : "hx- attributes", htmx?.version)
    const ember = record(win.Ember)
    if (ember) add("Ember", "framework", "window.Ember", ember.VERSION)
    const backbone = record(win.Backbone)
    if (backbone) add("Backbone.js", "framework", "window.Backbone", backbone.VERSION)
    const knockout = record(win.ko)
    if (knockout?.applyBindings) add("Knockout", "framework", "window.ko", knockout.version)
    if (record(win.Stimulus)) add("Stimulus", "framework", "window.Stimulus")
    if (record(win.Turbo) || has("turbo-frame")) add("Turbo", "framework", "window.Turbo")
    if (record(win.Livewire) || has("[wire\\:id]"))
      add("Livewire", "framework", "wire:id attributes")
    if (record(win.Blazor)) add("Blazor", "framework", "window.Blazor")
    const inertia = attr("#app[data-page]", "data-page")
    if (inertia?.includes('"component"')) add("Inertia.js", "framework", "#app[data-page]")
    if (has("ion-app")) add("Ionic", "ui-library", "<ion-app>")
    const stencil = has("[s-id], [sty-id]") || has("style[sty-id]")
    if (stencil) add("Stencil", "framework", "Stencil hydration attributes")
  })

  // —— App frameworks ——
  safely(() => {
    const nextData = record(win.__NEXT_DATA__)
    const next = record(win.next)
    const appRouter = Array.isArray(win.__next_f) || globals.includes("__next_f")
    if (nextData || next || appRouter || has("#__next")) {
      add(
        "Next.js",
        "meta-framework",
        nextData ? "window.__NEXT_DATA__" : appRouter ? "self.__next_f" : "#__next",
        next?.version,
        appRouter ? "App Router" : nextData ? "Pages Router" : undefined
      )
      if (nextData?.buildId === "development") development = true
      else if (development === null && typeof nextData?.buildId === "string") development = false
    }
    const nuxt = record(win.__NUXT__)
    if (nuxt || has("#__nuxt") || win.useNuxtApp || win.$nuxt)
      add(
        "Nuxt",
        "meta-framework",
        nuxt ? "window.__NUXT__" : "#__nuxt",
        undefined,
        has("#__nuxt") ? "Nuxt 3+" : nuxt ? "Nuxt 2" : undefined
      )
    if (win.__remixContext) add("Remix", "meta-framework", "window.__remixContext")
    if (win.__reactRouterContext || win.__reactRouterVersion)
      add(
        "React Router",
        win.__reactRouterContext ? "meta-framework" : "library",
        win.__reactRouterContext ? "window.__reactRouterContext" : "window.__reactRouterVersion",
        win.__reactRouterVersion,
        win.__reactRouterContext ? "framework mode" : undefined
      )
    if (win.__TSR_ROUTER__ || win.__TSR__) add("TanStack Router", "library", "window.__TSR__")
    if (win.___gatsby || has("#___gatsby")) add("Gatsby", "meta-framework", "#___gatsby")
    if (globalLike("__sveltekit") || has("[data-sveltekit-preload-data]"))
      add("SvelteKit", "meta-framework", "SvelteKit globals")
    if (has("astro-island, astro-slot")) add("Astro", "meta-framework", "<astro-island>")
    if (win.__VP_SITE_DATA__ || win.__VP_HASH_MAP__)
      add("VitePress", "meta-framework", "window.__VP_SITE_DATA__")
    if (win.__VUEPRESS_SSR_CONTEXT__ || has("#app > .theme-container"))
      add("VuePress", "meta-framework", "VuePress theme container")
    if (record(win.docusaurus) || has("[data-has-hydrated], .docusaurus-mt-lg"))
      add("Docusaurus", "meta-framework", "window.docusaurus")
    if (has("#__solid")) add("SolidStart", "meta-framework", "#__solid")
  })

  // —— What the page says it was made with ——
  safely(() => {
    const GENERATED: Record<string, [string, Category]> = {
      wordpress: ["WordPress", "cms"],
      "wordpress.com": ["WordPress.com", "cms"],
      drupal: ["Drupal", "cms"],
      joomla: ["Joomla", "cms"],
      "joomla!": ["Joomla", "cms"],
      ghost: ["Ghost", "cms"],
      "typo3 cms": ["TYPO3", "cms"],
      typo3: ["TYPO3", "cms"],
      hubspot: ["HubSpot CMS", "cms"],
      "wix.com website builder": ["Wix", "cms"],
      wix: ["Wix", "cms"],
      squarespace: ["Squarespace", "cms"],
      webflow: ["Webflow", "cms"],
      framer: ["Framer", "cms"],
      shopify: ["Shopify", "cms"],
      blogger: ["Blogger", "cms"],
      weebly: ["Weebly", "cms"],
      hugo: ["Hugo", "cms"],
      jekyll: ["Jekyll", "cms"],
      hexo: ["Hexo", "cms"],
      eleventy: ["Eleventy", "cms"],
      zola: ["Zola", "cms"],
      mkdocs: ["MkDocs", "cms"],
      "mkdocs-material": ["Material for MkDocs", "cms"],
      sphinx: ["Sphinx", "cms"],
      gitbook: ["GitBook", "cms"],
      mintlify: ["Mintlify", "cms"],
      nextra: ["Nextra", "meta-framework"],
      astro: ["Astro", "meta-framework"],
      docusaurus: ["Docusaurus", "meta-framework"],
      vitepress: ["VitePress", "meta-framework"],
      vuepress: ["VuePress", "meta-framework"],
      gatsby: ["Gatsby", "meta-framework"],
      gridsome: ["Gridsome", "meta-framework"],
      nuxt: ["Nuxt", "meta-framework"],
      "next.js": ["Next.js", "meta-framework"],
    }
    for (const meta of document.querySelectorAll('meta[name="generator" i]')) {
      // One tag may name several: "MkDocs-1.6.0, mkdocs-material-9.5.2".
      for (const part of (meta.getAttribute("content") ?? "").split(/[,;]\s*/).slice(0, 3)) {
        const content = part.trim()
        if (!content) continue
        const versioned = /^(.+?)[\s-]+v?(\d+(?:\.\d+)*)(?![\w])/.exec(content)
        // Without a version, what follows the name is a tagline or a build hash.
        const raw = (
          versioned?.[1] ??
          (content.split(/\s+[-–(|]/)[0] ?? content).replace(/(?:\s+\S*\d\S*)+$/, "")
        ).trim()
        const known = GENERATED[raw.toLowerCase()]
        const name = known?.[0] ?? raw.replace(/\s+website builder$/i, "").slice(0, 30)
        if (name) add(name, known?.[1] ?? "cms", '<meta name="generator">', versioned?.[2])
      }
    }
    if (sourced(/\/wp-(?:content|includes)\//) || record(win.wp))
      add("WordPress", "cms", "wp-content addresses")
    if (record(win.wc_add_to_cart_params) || has("body.woocommerce, .woocommerce"))
      add("WooCommerce", "cms", "WooCommerce markup")
    const shopify = record(win.Shopify)
    if (shopify || sourced(/cdn\.shopify\.com/))
      add(
        "Shopify",
        "cms",
        shopify ? "window.Shopify" : "cdn.shopify.com",
        undefined,
        text(read(shopify, "theme", "name")) ? `theme ${read(shopify, "theme", "name")}` : undefined
      )
    if (has("html[data-wf-site]") || record(win.Webflow)) add("Webflow", "cms", "data-wf-site")
    if (record(read(win.Static, "SQUARESPACE_CONTEXT")))
      add("Squarespace", "cms", "Static.SQUARESPACE_CONTEXT")
    if (win.wixBiSession || win.wixPerformanceMeasurements) add("Wix", "cms", "Wix globals")
    if (has("#__framer-badge-container, [data-framer-component-type]"))
      add("Framer", "cms", "Framer markup")
    if (has("[data-mage-init], [data-mage]") || sourced(/\/static\/version\d+\/frontend\//))
      add("Magento", "cms", "data-mage-init")
    if (record(win.Drupal)) add("Drupal", "cms", "window.Drupal")
    if (has("body.ghost, [data-ghost]") || sourced(/\/ghost\/api\//))
      add("Ghost", "cms", "Ghost markup")
  })

  // —— Packages in CDN addresses and the import map ——
  safely(() => {
    const PACKAGES: Record<string, [string, Category]> = {
      react: ["React", "framework"],
      "react-dom": ["React", "framework"],
      preact: ["Preact", "framework"],
      vue: ["Vue", "framework"],
      "@angular/core": ["Angular", "framework"],
      svelte: ["Svelte", "framework"],
      "solid-js": ["Solid", "framework"],
      lit: ["Lit", "framework"],
      alpinejs: ["Alpine.js", "framework"],
      "htmx.org": ["htmx", "framework"],
      htmx: ["htmx", "framework"],
      jquery: ["jQuery", "library"],
      "jquery-ui": ["jQuery UI", "library"],
      jqueryui: ["jQuery UI", "library"],
      bootstrap: ["Bootstrap", "styling"],
      "twitter-bootstrap": ["Bootstrap", "styling"],
      tailwindcss: ["Tailwind CSS", "styling"],
      "@tailwindcss/browser": ["Tailwind CSS", "styling"],
      bulma: ["Bulma", "styling"],
      "font-awesome": ["Font Awesome", "styling"],
      "@fortawesome/fontawesome-free": ["Font Awesome", "styling"],
      "animate.css": ["Animate.css", "styling"],
      "element-plus": ["Element Plus", "ui-library"],
      "element-ui": ["Element UI", "ui-library"],
      antd: ["Ant Design", "ui-library"],
      vuetify: ["Vuetify", "ui-library"],
      quasar: ["Quasar", "ui-library"],
      lodash: ["Lodash", "library"],
      "lodash.js": ["Lodash", "library"],
      underscore: ["Underscore.js", "library"],
      "underscore.js": ["Underscore.js", "library"],
      moment: ["Moment.js", "library"],
      "moment.js": ["Moment.js", "library"],
      dayjs: ["Day.js", "library"],
      axios: ["Axios", "library"],
      gsap: ["GSAP", "library"],
      three: ["three.js", "library"],
      "three.js": ["three.js", "library"],
      d3: ["D3", "library"],
      "chart.js": ["Chart.js", "library"],
      echarts: ["ECharts", "library"],
      highcharts: ["Highcharts", "library"],
      leaflet: ["Leaflet", "library"],
      "mapbox-gl": ["Mapbox GL", "library"],
      swiper: ["Swiper", "library"],
      "@popperjs/core": ["Popper", "library"],
      "popper.js": ["Popper", "library"],
      "lottie-web": ["Lottie", "library"],
      "highlight.js": ["highlight.js", "library"],
      prismjs: ["Prism", "library"],
      prism: ["Prism", "library"],
      katex: ["KaTeX", "library"],
      mathjax: ["MathJax", "library"],
      "video.js": ["Video.js", "library"],
      "hls.js": ["hls.js", "library"],
      "socket.io": ["Socket.IO", "library"],
      "socket.io-client": ["Socket.IO", "library"],
      "core-js": ["core-js", "library"],
      modernizr: ["Modernizr", "library"],
      firebase: ["Firebase", "service"],
      "@supabase/supabase-js": ["Supabase", "service"],
    }
    const CDNS: [RegExp, string][] = [
      [/cdn\.jsdelivr\.net\/npm\/((?:@[^/@]+\/)?[^/@]+)@([\w.-]+)/, "jsDelivr"],
      [/unpkg\.com\/((?:@[^/@]+\/)?[^/@]+)@([\w.-]+)/, "unpkg"],
      [/esm\.sh\/(?:v\d+\/)?((?:@[^/@]+\/)?[^/@]+)@([\w.-]+)/, "esm.sh"],
      [/cdn\.skypack\.dev\/((?:@[^/@]+\/)?[^/@]+)@([\w.-]+)/, "Skypack"],
      [/ga\.jspm\.io\/npm:((?:@[^/@]+\/)?[^/@]+)@([\w.-]+)/, "JSPM"],
      [/cdnjs\.cloudflare\.com\/ajax\/libs\/([^/]+)\/([\w.-]+)\//, "cdnjs"],
      [/ajax\.googleapis\.com\/ajax\/libs\/([^/]+)\/([\w.-]+)\//, "Google Hosted Libraries"],
      [/code\.jquery\.com\/(jquery(?:-ui)?)-(\d[\w.]*?)(?:\.min|\.slim)*\.js/, "jQuery CDN"],
      [/cdn\.bootcdn\.net\/ajax\/libs\/([^/]+)\/([\w.-]+)\//, "BootCDN"],
      [/lib\.baomitu\.com\/([^/]+)\/([\w.-]+)\//, "baomitu"],
    ]
    const urls = [...sources]
    const importMap = document.querySelector('script[type="importmap"]')?.textContent
    if (importMap) {
      const parsed = record(JSON.parse(importMap))
      const imports = record(parsed?.imports) ?? {}
      for (const value of Object.values(imports)) if (typeof value === "string") urls.push(value)
    }
    let unknown = 0
    for (const url of urls) {
      for (const [pattern, cdn] of CDNS) {
        const match = pattern.exec(url)
        if (!match) continue
        const name = match[1]!.toLowerCase()
        const version = /^\d/.test(match[2]!) ? match[2] : undefined
        const known = PACKAGES[name]
        if (known) add(known[0], known[1], `${cdn}: ${name}@${version ?? "latest"}`, version)
        else if (unknown++ < 8) add(match[1]!, "library", `${cdn}: ${name}`, version)
        break
      }
      // A file named for its version: `jquery-3.7.1.min.js`.
      const file =
        /\/([a-z][\w.]*?)[-.]v?(\d+\.\d+(?:\.\d+)?)(?:\.min|\.slim|\.bundle)*\.js(?:[?#]|$)/i.exec(
          url
        )
      const known = file ? PACKAGES[file[1]!.toLowerCase()] : undefined
      if (file && known) add(known[0], known[1], `script ${file[0].slice(1)}`, file[2])
    }
  })

  // —— Build ——
  safely(() => {
    if (has('script[src*="/@vite/client"]')) {
      add("Vite", "build", "/@vite/client", undefined, "dev server")
      development = true
    } else if (
      has(
        'link[rel="modulepreload"][href*="/assets/"], script[type="module"][src*="/assets/index-"]'
      )
    )
      add("Vite", "build", "hashed /assets/ module chunks")
    const chunk = globalLike("webpackChunk") ?? globalLike("webpackJsonp")
    if (chunk || win.__webpack_require__)
      add("webpack", "build", `window.${chunk ?? "__webpack_require__"}`)
    if (globalLike("webpackHotUpdate") || win.__webpack_dev_server_client__) {
      add("webpack", "build", "webpack-dev-server", undefined, "dev server")
      development = true
    }
    if (win.TURBOPACK || globalLike("TURBOPACK")) add("Turbopack", "build", "window.TURBOPACK")
    if (globalLike("__rspack")) add("Rspack", "build", "Rspack runtime globals")
    if (globalLike("parcelRequire")) add("Parcel", "build", `window.${globalLike("parcelRequire")}`)
    const requirejs = record(win.requirejs)
    if (requirejs) add("RequireJS", "build", "window.requirejs", requirejs.version)
    if (typeof read(win.System, "import") === "function" && read(win.System, "register"))
      add("SystemJS", "build", "window.System")
    if (has('script[type="importmap"]')) add("Import maps", "build", '<script type="importmap">')
    if (sourced(/\/@react-refresh|\/__webpack_hmr|\/_next\/static\/webpack\/.*hot-update/))
      development = true
  })

  // —— Styling ——
  safely(() => {
    const rootStyle = getComputedStyle(document.documentElement)
    const bodyStyle = document.body ? getComputedStyle(document.body) : rootStyle
    const declares = (prefix: string) => {
      for (let index = 0; index < rootStyle.length; index++)
        if (rootStyle[index]?.startsWith(prefix)) return true
      return false
    }
    // What the page's own stylesheets are made of, where it may be read.
    let layers = false
    let twProperties = false
    let banner: string | undefined
    for (const style of document.querySelectorAll("style")) {
      const head = style.textContent?.slice(0, 300) ?? ""
      banner ??= /tailwindcss v(\d[\w.]*)/i.exec(head)?.[1]
    }
    for (const sheet of [...document.styleSheets].slice(0, 30)) {
      let rules: CSSRuleList
      try {
        rules = sheet.cssRules
      } catch {
        continue
      }
      for (let index = 0; index < Math.min(rules.length, 400); index++) {
        const rule = rules[index] as CSSRule & { nameList?: string[]; name?: string }
        if (Array.isArray(rule.nameList) && rule.nameList.includes("utilities")) layers = true
        if (typeof rule.name === "string" && rule.name.startsWith("--tw-")) twProperties = true
      }
    }
    const utilityCount = document.querySelectorAll(
      '[class*="px-"], [class*="py-"], [class*="text-sm"], [class*="rounded-"], [class*="gap-"]'
    ).length
    if (
      banner ||
      twProperties ||
      bodyStyle.getPropertyValue("--tw-ring-offset-width") ||
      declares("--tw-") ||
      // Tailwind 3 declares its variables per element; utility classes in
      // numbers are the tell for a build that has none on the root.
      utilityCount >= 20
    ) {
      const four = twProperties || (layers && declares("--spacing"))
      add(
        "Tailwind CSS",
        "styling",
        banner
          ? "tailwindcss banner"
          : twProperties
            ? "@property --tw-* rules"
            : declares("--tw-")
              ? "--tw-* variables"
              : `${utilityCount} utility-class elements`,
        banner,
        four
          ? "v4"
          : declares("--tw-") || bodyStyle.getPropertyValue("--tw-ring-offset-width")
            ? "v3"
            : undefined
      )
    }
    const bootstrapVersion =
      read(win.bootstrap, "Tooltip", "VERSION") ??
      read(win.bootstrap, "Modal", "VERSION") ??
      read(win.jQuery, "fn", "tooltip", "Constructor", "VERSION")
    if (bootstrapVersion || record(win.bootstrap) || declares("--bs-"))
      add(
        "Bootstrap",
        "styling",
        declares("--bs-") ? "--bs-* variables" : "window.bootstrap",
        bootstrapVersion,
        declares("--bs-") ? "v5" : undefined
      )
    const styled = attr("style[data-styled]", "data-styled-version")
    if (styled || has("style[data-styled]"))
      add("styled-components", "styling", "style[data-styled]", styled)
    if (has("style[data-emotion]")) add("Emotion", "styling", "style[data-emotion]")
    if (has("style[data-jss], style[data-meta^='Mui']")) add("JSS", "styling", "style[data-jss]")
    if (has("style[data-unocss], style[data-unocss-runtime]") || declares("--un-"))
      add("UnoCSS", "styling", "UnoCSS styles")
    if (declares("--bulma-") || has("link[href*='bulma']"))
      add("Bulma", "styling", "--bulma-* variables")
    const foundation = record(win.Foundation)
    if (foundation) add("Foundation", "styling", "window.Foundation", foundation.version)
    if (has("[class*='fa-solid'], [class*='fa-brands'], i.fa, .fas, .fab") || declares("--fa-"))
      add("Font Awesome", "styling", "fa- icon classes")
    if (sourced(/fonts\.googleapis\.com|fonts\.gstatic\.com/))
      add("Google Fonts", "styling", "fonts.googleapis.com")
    if (sourced(/use\.typekit\.net/)) add("Adobe Fonts", "styling", "use.typekit.net")
    // CSS Modules: `Button_primary__a1b2c` (Next.js) or `button_primary_x7Yz1` (Vite).
    const classes = new Set<string>()
    for (const element of [...document.querySelectorAll("[class]")].slice(0, 1500))
      for (const name of element.classList) classes.add(name)
    const modules = [...classes].filter((name) =>
      /^[A-Za-z][\w-]*_[\w-]+__[\w-]{5,8}$|^_[\w-]+_[a-z0-9]{5}_\d+$/.test(name)
    )
    if (modules.length >= 3) add("CSS Modules", "styling", `${modules.length} hashed class names`)

    // —— Component libraries ——
    if (has('[class*="Mui"]')) add("MUI", "ui-library", "Mui class names")
    if (declares("--chakra-")) add("Chakra UI", "ui-library", "--chakra-* variables")
    const antd = read(win.antd, "version")
    if (antd || has('[class^="ant-"], [class*=" ant-"]'))
      add("Ant Design", "ui-library", "ant- class names", antd)
    if (
      has(
        "[data-radix-popper-content-wrapper], [data-radix-collection-item], [data-radix-scroll-area-viewport]"
      )
    )
      add("Radix UI", "ui-library", "data-radix attributes")
    if (has("[data-slot]") && found("Tailwind CSS"))
      add("shadcn/ui", "ui-library", "data-slot with Tailwind")
    if (has('[id^="headlessui-"]')) add("Headless UI", "ui-library", "headlessui- ids")
    if (declares("--mantine-") || has('[class*="mantine-"]'))
      add("Mantine", "ui-library", "--mantine-* variables")
    if (declares("--el-color-primary")) add("Element Plus", "ui-library", "--el-* variables")
    else if (has(".el-button, .el-input, .el-table"))
      add("Element UI", "ui-library", "el- class names")
    const vuetify = read(win.Vuetify, "version")
    if (vuetify || has(".v-application")) add("Vuetify", "ui-library", ".v-application", vuetify)
    const quasar = read(win.Quasar, "version")
    if (quasar || declares("--q-primary")) add("Quasar", "ui-library", "--q-* variables", quasar)
    if (has("style[cssr-id^='n-'], [class^='n-config-provider']"))
      add("Naive UI", "ui-library", "style[cssr-id]")
    if (has('[class*="arco-"]')) add("Arco Design", "ui-library", "arco- class names")
    if (has('[class*="semi-"]') && has('[class*="semi-button"], [class*="semi-input"]'))
      add("Semi Design", "ui-library", "semi- class names")
    if (declares("--td-brand-color") || has('[class^="t-button"], [class*=" t-button"]'))
      add("TDesign", "ui-library", "--td-* variables")
    if (declares("--van-")) add("Vant", "ui-library", "--van-* variables")
    if (has(".p-component")) add("PrimeVue / PrimeReact", "ui-library", ".p-component")
    if (has('[class*="fui-"]')) add("Fluent UI", "ui-library", "fui- class names")
    if (has("[data-headlessui-state]") && !found("Headless UI"))
      add("Headless UI", "ui-library", "data-headlessui-state")
  })

  // —— State and data ——
  safely(() => {
    const apollo = record(win.__APOLLO_CLIENT__)
    if (apollo || win.__APOLLO_STATE__)
      add("Apollo Client", "state", "window.__APOLLO_CLIENT__", apollo?.version)
    if (win.__mobxGlobals || win.__mobxInstanceCount) add("MobX", "state", "window.__mobxGlobals")
    if (win.__RELAY_STORE__ || win.__RELAY_PAYLOADS__) add("Relay", "state", "Relay store")
    if (win.__REACT_QUERY_STATE__ || win.__TANSTACK_QUERY_CLIENT__)
      add("TanStack Query", "state", "query client global")
    if (win.__URQL_DATA__) add("urql", "state", "window.__URQL_DATA__")
  })

  // —— Libraries ——
  safely(() => {
    const jquery = read(win.jQuery, "fn", "jquery")
    if (jquery || record(win.jQuery)) add("jQuery", "library", "window.jQuery", jquery)
    const jqueryUi = read(win.jQuery, "ui", "version")
    if (jqueryUi) add("jQuery UI", "library", "jQuery.ui", jqueryUi)
    const lodash = record(win._)
    if (lodash?.VERSION)
      add(lodash.flow ? "Lodash" : "Underscore.js", "library", "window._", lodash.VERSION)
    const LIBRARIES: [string, string, string[]][] = [
      ["moment", "Moment.js", ["version"]],
      ["dayjs", "Day.js", []],
      ["axios", "Axios", ["VERSION"]],
      ["gsap", "GSAP", ["version"]],
      ["d3", "D3", ["version"]],
      ["Chart", "Chart.js", ["version"]],
      ["echarts", "ECharts", ["version"]],
      ["Highcharts", "Highcharts", ["version"]],
      ["mapboxgl", "Mapbox GL", ["version"]],
      ["Swiper", "Swiper", []],
      ["lottie", "Lottie", ["version"]],
      ["anime", "anime.js", ["version"]],
      ["hljs", "highlight.js", ["versionString"]],
      ["Prism", "Prism", []],
      ["katex", "KaTeX", ["version"]],
      ["MathJax", "MathJax", ["version"]],
      ["videojs", "Video.js", ["VERSION"]],
      ["Hls", "hls.js", ["version"]],
      ["Modernizr", "Modernizr", []],
      ["Popper", "Popper", []],
      ["Vimeo", "Vimeo Player", []],
      ["YT", "YouTube embed", []],
    ]
    for (const [key, name, path] of LIBRARIES) {
      const value = record(win[key])
      if (value)
        add(name, "library", `window.${key}`, path.length ? read(value, ...path) : undefined)
    }
    const three = win.__THREE__ ?? read(win.THREE, "REVISION")
    if (three || record(win.THREE)) add("three.js", "library", "window.__THREE__", three)
    const leaflet = read(win.L, "version")
    if (leaflet && read(win.L, "map")) add("Leaflet", "library", "window.L", leaflet)
    const shared = record(win["__core-js_shared__"])
    const coreJs = Array.isArray(shared?.versions) ? record(shared.versions[0])?.version : undefined
    if (shared) add("core-js", "library", "window.__core-js_shared__", coreJs)
    const io = record(win.io)
    if (io && typeof io.connect === "function") add("Socket.IO", "library", "window.io")
    if (record(read(win.google, "maps")))
      add("Google Maps", "service", "google.maps", read(win.google, "maps", "version"))
    const firebase = record(win.firebase)
    if (firebase) add("Firebase", "service", "window.firebase", firebase.SDK_VERSION)
    if (record(win.supabase)) add("Supabase", "service", "window.supabase")
    if (record(win.workbox)) add("Workbox", "library", "window.workbox")
  })

  // —— Analytics, monitoring and services ——
  safely(() => {
    const gtag = sourced(/googletagmanager\.com\/gtag\/js\?id=(G-|UA-|AW-)/)
    if (gtag || win.gtag) {
      const kind = /id=G-/.test(gtag ?? "")
        ? "GA4"
        : /id=UA-/.test(gtag ?? "")
          ? "Universal Analytics"
          : undefined
      add("Google Analytics", "analytics", gtag ? "gtag.js" : "window.gtag", undefined, kind)
    }
    const gtm = record(win.google_tag_manager)
    const containers = gtm ? Object.keys(gtm).filter((key) => key.startsWith("GTM-")) : []
    if (containers.length > 0 || sourced(/googletagmanager\.com\/gtm\.js/))
      add("Google Tag Manager", "analytics", containers[0] ?? "gtm.js")
    else if (win.dataLayer && !found("Google Analytics"))
      add("Google Tag Manager", "analytics", "window.dataLayer", undefined, "probably")
    if (
      sourced(/google-analytics\.com\/analytics\.js/) ||
      (typeof win.ga === "function" &&
        (read(win.ga, "l") !== undefined || typeof read(win.ga, "getAll") === "function") &&
        !found("Google Analytics"))
    )
      add("Google Analytics", "analytics", "analytics.js", undefined, "Universal Analytics")
    const ANALYTICS: [string, string, string[]][] = [
      ["analytics", "Segment", ["VERSION"]],
      ["mixpanel", "Mixpanel", []],
      ["amplitude", "Amplitude", []],
      ["posthog", "PostHog", ["version"]],
      ["hj", "Hotjar", []],
      ["clarity", "Microsoft Clarity", []],
      ["plausible", "Plausible", []],
      ["_paq", "Matomo", []],
      ["fbq", "Meta Pixel", []],
      ["ttq", "TikTok Pixel", []],
      ["heap", "Heap", []],
      ["_hmt", "Baidu Analytics", []],
      ["umami", "Umami", []],
      ["fathom", "Fathom", []],
      ["optimizely", "Optimizely", []],
      ["_linkedin_partner_id", "LinkedIn Insight", []],
      ["twq", "X (Twitter) Pixel", []],
      ["pintrk", "Pinterest Tag", []],
      ["snaptr", "Snap Pixel", []],
      ["ym", "Yandex Metrica", []],
    ]
    for (const [key, name, path] of ANALYTICS) {
      const value = win[key]
      // Segment's `analytics` is an object with `track`; other pages use the name too.
      if (key === "analytics" && typeof read(value, "track") !== "function") continue
      if (value !== undefined && value !== null)
        add(name, "analytics", `window.${key}`, path.length ? read(value, ...path) : undefined)
    }
    if (win.va || sourced(/\/_vercel\/insights\//))
      add("Vercel Analytics", "analytics", "/_vercel/insights")
    if (sourced(/\/_vercel\/speed-insights\//))
      add("Vercel Speed Insights", "monitoring", "/_vercel/speed-insights")
    if (has("script[data-cf-beacon]") || sourced(/static\.cloudflareinsights\.com/))
      add("Cloudflare Web Analytics", "analytics", "data-cf-beacon")

    const sentry = record(win.__SENTRY__)
    const sentryVersion =
      read(win.Sentry, "SDK_VERSION") ?? sentry?.version ?? read(sentry, "hub", "version")
    if (sentry || record(win.Sentry))
      add("Sentry", "monitoring", "window.__SENTRY__", sentryVersion)
    const MONITORING: [string, string, string[]][] = [
      ["DD_RUM", "Datadog RUM", ["version"]],
      ["DD_LOGS", "Datadog Logs", ["version"]],
      ["NREUM", "New Relic", []],
      ["LogRocket", "LogRocket", []],
      ["FS", "FullStory", []],
      ["Bugsnag", "Bugsnag", []],
      ["Rollbar", "Rollbar", []],
      ["TrackJS", "TrackJS", ["version"]],
      ["rg4js", "Raygun", []],
      ["elasticApm", "Elastic APM", []],
      ["appInsights", "Azure Application Insights", []],
      ["Raven", "Sentry (Raven)", ["VERSION"]],
      ["__bugsnag", "Bugsnag", []],
    ]
    for (const [key, name, path] of MONITORING) {
      const value = win[key]
      if (
        value !== undefined &&
        value !== null &&
        (typeof value === "object" || typeof value === "function")
      )
        add(name, "monitoring", `window.${key}`, path.length ? read(value, ...path) : undefined)
    }

    const stripe = win.Stripe
    if (typeof stripe === "function" || sourced(/js\.stripe\.com/))
      add("Stripe", "payments", "js.stripe.com", read(stripe, "version"))
    const paypal = record(win.paypal)
    if (paypal || sourced(/paypal\.com\/sdk\/js/))
      add("PayPal", "payments", "PayPal SDK", paypal?.version)
    if (record(win.braintree)) add("Braintree", "payments", "window.braintree")
    if (win.AdyenCheckout) add("Adyen", "payments", "window.AdyenCheckout")
    if (sourced(/pay\.google\.com\/gp\/p\/js/)) add("Google Pay", "payments", "pay.google.com")
    if (win.ApplePaySession && has("apple-pay-button, .apple-pay-button"))
      add("Apple Pay", "payments", "Apple Pay button")

    const clerk = record(win.Clerk)
    if (clerk) add("Clerk", "auth", "window.Clerk", clerk.version)
    if (record(win.auth0) || sourced(/cdn\.auth0\.com|auth0-spa-js|\.auth0\.com\//))
      add("Auth0", "auth", "Auth0 SDK")
    if (record(win.OktaAuth) || sourced(/okta(?:cdn)?\.com|okta-auth-js/))
      add("Okta", "auth", "Okta SDK")
    if (record(read(win.google, "accounts", "id")) || sourced(/accounts\.google\.com\/gsi\/client/))
      add("Google Identity Services", "auth", "accounts.google.com/gsi")
    if (record(win.grecaptcha) || sourced(/google\.com\/recaptcha/))
      add("reCAPTCHA", "auth", "window.grecaptcha")
    if (record(win.hcaptcha)) add("hCaptcha", "auth", "window.hcaptcha")
    if (record(win.turnstile) || sourced(/challenges\.cloudflare\.com\/turnstile/))
      add("Cloudflare Turnstile", "auth", "window.turnstile")

    const SERVICES: [string, string][] = [
      ["Intercom", "Intercom"],
      ["$crisp", "Crisp"],
      ["zE", "Zendesk"],
      ["_hsq", "HubSpot"],
      ["drift", "Drift"],
      ["tidioChatApi", "Tidio"],
      ["LiveChatWidget", "LiveChat"],
      ["Tawk_API", "tawk.to"],
      ["OneSignal", "OneSignal"],
      ["Cookiebot", "Cookiebot"],
      ["OneTrust", "OneTrust"],
      ["Osano", "Osano"],
      ["algoliasearch", "Algolia"],
      ["docsearch", "Algolia DocSearch"],
      ["Calendly", "Calendly"],
      ["Typeform", "Typeform"],
      ["Weglot", "Weglot"],
    ]
    for (const [key, name] of SERVICES)
      if (win[key] !== undefined && win[key] !== null) add(name, "service", `window.${key}`)
  })

  // —— Where it is served from ——
  safely(() => {
    const host = location.hostname
    const ends = (suffix: string) => host === suffix.slice(1) || host.endsWith(suffix)
    if (ends(".vercel.app") || sourced(/^\/_vercel\//)) add("Vercel", "hosting", host)
    if (ends(".netlify.app") || sourced(/\/\.netlify\//)) add("Netlify", "hosting", host)
    if (ends(".github.io")) add("GitHub Pages", "hosting", host)
    if (ends(".pages.dev") || ends(".workers.dev")) add("Cloudflare Pages", "hosting", host)
    if (ends(".web.app") || ends(".firebaseapp.com") || sourced(/^\/__\/firebase\//))
      add("Firebase Hosting", "hosting", host)
    if (ends(".herokuapp.com")) add("Heroku", "hosting", host)
    if (ends(".onrender.com")) add("Render", "hosting", host)
    if (ends(".fly.dev")) add("Fly.io", "hosting", host)
    if (ends(".azurewebsites.net") || ends(".azurestaticapps.net")) add("Azure", "hosting", host)
    if (ends(".amplifyapp.com")) add("AWS Amplify", "hosting", host)
    if (sourced(/\/cdn-cgi\//) || win.__CF$cv$params || win.__cfBeacon)
      add("Cloudflare", "hosting", "/cdn-cgi/ addresses")
    if (sourced(/\.cloudfront\.net\//))
      add("Amazon CloudFront", "hosting", "cloudfront.net addresses")
    if (sourced(/\.akamaized\.net\/|\.akamaihd\.net\//))
      add("Akamai", "hosting", "akamaized.net addresses")
    if (sourced(/\.fastly\.net\/|\.fastlylb\.net\//))
      add("Fastly", "hosting", "fastly.net addresses")
    if (sourced(/cdn\.jsdelivr\.net/)) add("jsDelivr", "hosting", "cdn.jsdelivr.net")
    if (sourced(/unpkg\.com/)) add("unpkg", "hosting", "unpkg.com")
    if (sourced(/cdnjs\.cloudflare\.com/)) add("cdnjs", "hosting", "cdnjs.cloudflare.com")
  })

  // —— How the page is put together ——
  let facts: StackFacts | null = null
  safely(() => {
    const scripts = [...document.querySelectorAll("script")]
    const external = scripts.filter((script) => script.hasAttribute("src"))
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[]
    const size = (entry: PerformanceResourceTiming) =>
      entry.transferSize || entry.encodedBodySize || 0
    const kb = (list: PerformanceResourceTiming[]) => {
      const bytes = list.reduce((sum, entry) => sum + size(entry), 0)
      return list.length > 0 && bytes > 0 ? Math.round(bytes / 1024) : null
    }
    const isCss = (entry: PerformanceResourceTiming) =>
      entry.initiatorType === "css" ||
      (entry.initiatorType === "link" && /\.css(?:[?#]|$)/.test(entry.name))
    const isJs = (entry: PerformanceResourceTiming) =>
      entry.initiatorType === "script" || /\.m?js(?:[?#]|$)/.test(entry.name)
    // The site is its last two labels, or three under a two-letter country domain.
    const siteOf = (hostname: string) => {
      const labels = hostname.split(".")
      const take =
        labels.length > 2 && /^(?:co|com|net|org|gov|edu|ac)$/.test(labels.at(-2)!) ? 3 : 2
      return labels.slice(-take).join(".")
    }
    const ownSite = siteOf(location.hostname)
    const hosts = new Map<string, number>()
    for (const entry of resources) {
      try {
        const { hostname, protocol } = new URL(entry.name)
        if (!protocol.startsWith("http") || siteOf(hostname) === ownSite) continue
        hosts.set(hostname, (hosts.get(hostname) ?? 0) + 1)
      } catch {
        // Not an address: nothing to count.
      }
    }
    const tags = new Set<string>()
    for (const element of document.querySelectorAll("body *")) {
      const tag = element.tagName.toLowerCase()
      if (tag.includes("-") && !tag.startsWith("cognia-")) tags.add(tag)
      if (tags.size >= 8) break
    }
    const navigation = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined
    facts = {
      scripts: external.length,
      moduleScripts: external.filter((script) => script.type === "module").length,
      inlineScripts: scripts.filter(
        (script) =>
          !script.hasAttribute("src") &&
          !/json|importmap|template|text\/x-/.test(script.type) &&
          (script.textContent ?? "").trim().length > 0
      ).length,
      stylesheets: document.querySelectorAll('link[rel~="stylesheet"], style').length,
      jsKb: kb(resources.filter(isJs)),
      cssKb: kb(resources.filter(isCss)),
      protocol: navigation?.nextHopProtocol || null,
      serviceWorker: Boolean(navigator.serviceWorker?.controller),
      manifest: has('link[rel="manifest"]'),
      importMap: has('script[type="importmap"]'),
      customElements: [...tags],
      thirdParty: [...hosts]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([host, count]) => ({ host, count })),
    }
  })

  entries.sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category))
  return { entries: entries.slice(0, 80), development, facts }
}

const CATEGORY_TITLES: Record<StackCategory, string> = {
  framework: "Framework",
  "meta-framework": "App framework",
  cms: "CMS / site generator",
  build: "Build",
  styling: "Styling",
  "ui-library": "Components",
  state: "State & data",
  library: "Library",
  analytics: "Analytics",
  monitoring: "Monitoring",
  payments: "Payments",
  auth: "Auth & security",
  service: "Service",
  hosting: "Hosting / CDN",
}

export function stackLabel(entry: StackEntry): string {
  return `${entry.name}${entry.version ? ` ${entry.version}` : ""}${entry.detail ? ` (${entry.detail})` : ""}`
}

export function factsLine(facts: StackFacts): string {
  const parts = [
    `${facts.scripts} script${facts.scripts === 1 ? "" : "s"}${facts.moduleScripts ? ` (${facts.moduleScripts} modules)` : ""}`,
    `${facts.inlineScripts} inline`,
    `${facts.stylesheets} stylesheet${facts.stylesheets === 1 ? "" : "s"}`,
  ]
  if (facts.jsKb !== null) parts.push(`${facts.jsKb} KB of JavaScript`)
  if (facts.cssKb !== null) parts.push(`${facts.cssKb} KB of CSS`)
  if (facts.protocol) parts.push(`served over ${facts.protocol}`)
  if (facts.serviceWorker) parts.push("a service worker controls it")
  if (facts.manifest) parts.push("web app manifest")
  return parts.join(", ")
}

export function stackMarkdown(stack: DetectedStack): string {
  const lines = ["## Tech stack", ""]
  if (stack.entries.length === 0)
    lines.push("Nothing recognisable: plain HTML, or a build that hides its tooling.")
  for (const category of STACK_CATEGORIES) {
    const group = stack.entries.filter((entry) => entry.category === category)
    if (group.length === 0) continue
    lines.push(
      `- ${CATEGORY_TITLES[category]}: ${group
        .map((entry) => `${stackLabel(entry)}${entry.evidence ? ` — ${entry.evidence}` : ""}`)
        .join("; ")}`
    )
  }
  if (stack.development !== null)
    lines.push(
      "",
      stack.development
        ? "This is a development build: component names and source positions come from it."
        : "This looks like a production build: component names and source positions may be minified or missing."
    )
  const facts = stack.facts
  if (facts) {
    lines.push("", `Page: ${factsLine(facts)}.`)
    if (facts.customElements.length > 0)
      lines.push(`Custom elements: ${facts.customElements.map((tag) => `<${tag}>`).join(", ")}.`)
    if (facts.thirdParty.length > 0)
      lines.push(
        `Loads from other sites: ${facts.thirdParty.map(({ host, count }) => `${host} (${count})`).join(", ")}.`
      )
  }
  return lines.join("\n")
}
