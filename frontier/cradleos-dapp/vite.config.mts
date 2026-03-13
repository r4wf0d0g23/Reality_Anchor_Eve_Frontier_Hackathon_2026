import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages project page — set base to repo name for production builds
  base: process.env.NODE_ENV === "production"
    ? "/Reality_Anchor_Eve_Frontier_Hackathon_2026/"
    : "/",
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Intel proxy removed — system names now resolved via World API (world-api-utopia.uat.pub.evefrontier.com)
  },
});
