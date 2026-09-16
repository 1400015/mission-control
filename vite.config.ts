import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// O Vite constrói apenas o RENDERER (interface React).
// O processo principal (Electron) é compilado separadamente com o tsconfig.node.json.
export default defineConfig({
  plugins: [react()],
  base: "./", // caminhos relativos para funcionar dentro do Electron via file://
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
