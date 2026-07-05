import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "react/index": "src/react/index.ts",
    "next/index": "src/next/index.ts",
    "devtools/index": "src/devtools/index.ts",
  },
  format: ["esm"],
  dts: true,
  platform: "browser",
  external: ["react", "react-dom", "react/jsx-runtime", "next/navigation"],
  clean: true,
  // Rebuild the precompiled devtools stylesheet after every (re)build so
  // watch mode keeps dist/devtools/styles.css in place — `clean: true`
  // wipes it at watch startup otherwise.
  onSuccess:
    "tailwindcss -i ./src/devtools/styles.source.css -o ./dist/devtools/styles.css --minify",
});
