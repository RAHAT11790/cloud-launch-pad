import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
// Android user-panel build (APP_TARGET=android) ships without any admin code.
const isAndroidTarget = process.env.APP_TARGET === "android";

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: { overlay: false },
  },
  build: {
    rollupOptions: {
      // Second page: the hidden isolated frame of the multi-core video decoder.
      input: { main: path.resolve(__dirname, "index.html"), rsIsoFrame: path.resolve(__dirname, "rs-iso/frame.html") },
    },
  },
  worker: { format: "es" },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      ...(isAndroidTarget
        ? { "@/pages/Admin": path.resolve(__dirname, "./src/pages/AdminUnavailable.tsx") }
        : {}),
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
}));
