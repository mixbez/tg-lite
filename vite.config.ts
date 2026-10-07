import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// GramJS expects Node globals (Buffer, process, util, os); polyfill them in the browser.
export default defineConfig({
  plugins: [react(), nodePolyfills({ exclude: ["vm"], globals: { Buffer: true, process: true, global: true } })],
  base: "./",
});
