import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import fs from "node:fs";

// Serve material-icon-theme SVG icons from node_modules.
// In dev, Vite serves them via the middleware. In production, they're copied to dist/material-icons.
function materialIconsPlugin(): Plugin {
  const iconsDir = path.resolve(__dirname, "node_modules/material-icon-theme/icons");
  return {
    name: "material-icons",
    configureServer(server) {
      server.middlewares.use("/material-icons", (req, res, next) => {
        const reqPath = decodeURIComponent(req.url ?? "").replace(/\.\./g, "");
        const filePath = path.resolve(iconsDir, reqPath.replace(/^\//, ""));
        // Prevent path traversal — resolved path must stay within iconsDir
        if (!filePath.startsWith(iconsDir) || !fs.existsSync(filePath)) {
          return next();
        }
        res.setHeader("Content-Type", "image/svg+xml");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        fs.createReadStream(filePath).pipe(res);
      });
    },
    writeBundle(options) {
      if (!fs.existsSync(iconsDir)) {
        console.warn("[material-icons] icons dir not found, skipping copy");
        return;
      }
      const outDir = options.dir ?? path.resolve(__dirname, "dist");
      const destDir = path.join(outDir, "material-icons");
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const files = fs.readdirSync(iconsDir);
      for (const file of files) {
        if (file.endsWith(".svg")) {
          fs.copyFileSync(path.join(iconsDir, file), path.join(destDir, file));
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [materialIconsPlugin(), tailwindcss(), react()],
  root: ".",
  base: "/",
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/renderer"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
    target: "safari16",
    minify: true,
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("material-icons.json")) return "material-icons";
          if (id.includes("posthog-js")) return "vendor-analytics";
          if (id.includes("@pierre") || id.includes("node_modules/diff/")) return "vendor-diffs";
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) return "vendor-react";
          if (id.includes("react-markdown") || id.includes("remark") || id.includes("rehype") || id.includes("unified") || id.includes("mdast") || id.includes("hast") || id.includes("micromark")) return "vendor-markdown";
          if (id.includes("node_modules/shiki") || id.includes("@shikijs/")) return "vendor-shiki";
          if (id.includes("ghostty-web")) return "vendor-terminal";
          if (id.includes("@tauri-apps")) return "vendor-tauri";
          if (id.includes("@tabler/icons") || id.includes("lucide")) return "vendor-icons";
        },
      },
    },
  },
  optimizeDeps: {
    include: ['diff'],
  },
  server: {
    port: 5174,
    strictPort: true,
    watch: {
      ignored: ['**/README.md', '**/activity.md', '**/src-tauri/**', '**/target/**'],
    },
  },
});
