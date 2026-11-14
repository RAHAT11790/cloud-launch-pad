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
