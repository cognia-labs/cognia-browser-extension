const common = {
  clearMocks: true,
  transform: {
    "^.+\\.[jt]sx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", tsx: true },
          target: "es2022",
          transform: { react: { runtime: "automatic" } },
        },
        module: { type: "commonjs" },
      },
    ],
  },
  moduleNameMapper: {
    "^@ext/(.*)$": "<rootDir>/$1",
    "^@cognia/companion-client$": "<rootDir>/vendor/companion-client/src/index.ts",
    "^@cognia/companion-client/(.*)$": "<rootDir>/vendor/companion-client/src/$1",
    "^@cognia/plugin-ui$": "<rootDir>/vendor/plugin-ui/src/index.ts",
    "^@cognia/plugin-ui/(.*)$": "<rootDir>/vendor/plugin-ui/src/$1",
  },
  setupFilesAfterEnv: ["<rootDir>/testing/setup-common.ts"],
  // Product CI checks out this repository under .cache; ignore only our own outputs.
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/build/", "<rootDir>/\\.cache/"],
}

export default {
  cacheDirectory: "<rootDir>/.cache/jest",
  projects: [
    {
      ...common,
      displayName: "extension",
      testEnvironment: "<rootDir>/testing/jsdom-environment.cjs",
      testMatch: [
        "<rootDir>/src/**/*.test.{ts,tsx}",
        "<rootDir>/vendor/{plugin-ui,overlay}/**/*.test.{ts,tsx}",
      ],
      setupFilesAfterEnv: [...common.setupFilesAfterEnv, "<rootDir>/testing/setup-dom.ts"],
    },
    {
      ...common,
      displayName: "portable",
      testEnvironment: "node",
      testMatch: [
        "<rootDir>/vendor/companion-client/**/*.test.ts",
        "<rootDir>/testing/**/*.test.ts",
      ],
    },
  ],
}
