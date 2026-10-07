import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// GramJS expects Node globals (Buffer, process, util, os); polyfill them in the browser.
// `crypto` must resolve to GramJS's own WebCrypto build: crypto-browserify returns Buffers
// from a different copy of `buffer`, which GramJS's serializer rejects
// ("Bytes or str expected") during the 2FA password check.
export default defineConfig({
  plugins: [react(), nodePolyfills({ exclude: ["vm", "crypto"], globals: { Buffer: true, process: true, global: true } })],
  resolve: {
    alias: {
      crypto: decodeURIComponent(new URL("./node_modules/telegram/crypto/crypto.js", import.meta.url).pathname),
    },
  },
  base: "./",
});
