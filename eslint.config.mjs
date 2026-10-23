import tseslint from "typescript-eslint"
import hooks from "eslint-plugin-react-hooks"

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".wxt/**",
      "build/**",
      ".cache/**",
      "vendor/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": hooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "testing/**/*", "**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  }
)
