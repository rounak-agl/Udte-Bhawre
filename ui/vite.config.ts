import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5310, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true, target: "chrome130" },
});
