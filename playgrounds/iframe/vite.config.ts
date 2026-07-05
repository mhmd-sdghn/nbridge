import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Two entry pages: the parent host (index.html) and the embedded child
// (child.html). `vite dev` serves both automatically; the rollup inputs make
// `vite build` emit both as well.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        parent: fileURLToPath(new URL("index.html", import.meta.url)),
        child: fileURLToPath(new URL("child.html", import.meta.url)),
      },
    },
  },
});
