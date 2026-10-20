import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, the API runs on :3000 and Vite proxies to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
