import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import fs from "node:fs";

// Drop the syntax grammars this app never asks for.
//
// Shiki bundles 332 languages behind `bundledLanguages`, each one a dynamic
// import, so the bundler emitted 368 chunks — 10.5 MB of a 12.4 MB build for
// grammars an everyday-agent audience never opens (emacs-lisp alone was
// 764 kB). They were lazy, so this costs no runtime, but it rode along in
// every DMG.
//
// The kept set is `BUNDLED_GRAMMARS` in src/renderer/lib/chatHighlighter.ts,
// which also normalises every code fence to that set — so a stubbed module
// is unreachable, not merely unused. Keep the two in sync; the list there is
// the one a human edits.
function shikiGrammarSubset(): Plugin {
  const KEEP = new Set([
    "css", "diff", "html", "javascript", "json", "jsonc", "jsx",
    "markdown", "python", "shellscript", "sql", "tsx", "typescript",
  ]);
  const GRAMMAR_MODULE = /^@shikijs\/langs\/([\w.+-]+)$/;
  const STUB = "\0shiki-grammar-stub:";
  return {
    name: "laf-shiki-grammar-subset",
    enforce: "pre",
    resolveId(id) {
      const match = GRAMMAR_MODULE.exec(id);
      if (!match || KEEP.has(match[1])) return null;
      return STUB + match[1];
    },
    load(id) {
      if (!id.startsWith(STUB)) return null;
      // Shape matches a real grammar module: a default export of an array of
      // TextMate grammars. Empty means "registers nothing", which shiki only
      // ever sees if something bypasses normalizeLanguage.
      return "export default []\n";
    },
  };
}

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
  plugins: [shikiGrammarSubset(), materialIconsPlugin(), tailwindcss(), react()],
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
          // Vite's dynamic-import preload helper is shared by every chunk
          // that calls import(). Without an explicit home, rolldown folds it
          // into one of the manual buckets below, which drags that entire
          // chunk into the entry's static import graph — this is how a
          // 290 kB vendor-diffs (and later a 637 kB vendor-terminal) ended
          // up modulepreloaded at startup. Pin it to its own tiny chunk.
          if (id.includes("vite/preload-helper")) return "preload-helper";
          if (id.includes("material-icons.json")) return "material-icons";
          // No manual bucket for @pierre/diffs, shiki, or the react-markdown
          // stack: all are only ever imported dynamically (chatHighlighter,
          // lazy ChatMarkdown/MarkdownViewer), so rolldown already gives them
          // shared lazy chunks. A shiki bucket merged ~300 per-language
          // grammar chunks into one 9 MB chunk loaded at startup, and a
          // markdown bucket captured react/jsx-runtime (an entry dependency),
          // pulling the whole parser stack into the startup preload list.
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) return "vendor-react";
          if (id.includes("ghostty-web")) return "vendor-terminal";
          if (id.includes("@tauri-apps")) return "vendor-tauri";
          if (id.includes("@tabler/icons")) return "vendor-icons";
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
