import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/intel": {
        target: "http://localhost:8899",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/intel/, ""),
      },
    },
  },
});
