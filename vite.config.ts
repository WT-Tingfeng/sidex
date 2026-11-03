import { defineConfig } from 'vite';
import type { HtmlTagDescriptor, Plugin } from 'vite';
import * as path from 'path';
import { nlsPlugin } from './scripts/vite-plugin-nls';

/**
 * Minimal shape of the Rollup chunks we care about. Kept local so the Vite
 * config does not need a hard dependency on rollup's type package.
 */
type BundleChunk = {
  type: 'chunk';
  name: string;
  fileName: string;
  imports: string[];
  viteMetadata?: { importedCss?: Set<string> };
};

/**
 * src/main.ts reaches the workbench barrels through dynamic `import()`, so
 * Vite cannot emit <link rel="modulepreload"> for them into index.html: the
 * browser only discovers them after the entry chunk has been fetched and
 * parsed — and that entry chunk is gated behind the multi-megabyte core/nls
 * chunk. Injecting preloads into the HTML (with the real build hashes) lets
 * those downloads start at parse time, in parallel with the core chunk,
 * instead of a serial waterfall.
 */
const FIRST_SCREEN_CHUNK_NAMES = [
  'workbench.common.main',
  'workbench.web.main',
  'web.main',
  'dialog.web.contribution',
];

function firstScreenPreload(): Plugin {
  return {
    name: 'sidex-first-screen-preload',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html, ctx) {
      const bundle = ctx.bundle;
      if (!bundle) {
        return [];
      }

      const existing = new Set<string>();
      for (const match of html.matchAll(/href="([^"]+)"/g)) {
        existing.add(match[1]);
      }

      const injected = new Set<string>();
      const tags: HtmlTagDescriptor[] = [];
      const has = (fileName: string) => injected.has(fileName) || existing.has('/' + fileName);

      const visit = (chunk: BundleChunk) => {
        if (!has(chunk.fileName)) {
          injected.add(chunk.fileName);
          tags.push({
            tag: 'link',
            attrs: { rel: 'modulepreload', crossorigin: '', href: '/' + chunk.fileName },
            injectTo: 'head',
          });
        }
        // Preload (not stylesheet) so these CSS files are fetched in parallel
        // without becoming render-blocking for the inline splash screen.
        for (const cssFile of chunk.viteMetadata?.importedCss ?? []) {
          if (!has(cssFile)) {
            injected.add(cssFile);
            tags.push({
              tag: 'link',
              attrs: { rel: 'preload', as: 'style', href: '/' + cssFile },
              injectTo: 'head',
            });
          }
        }
        for (const imported of chunk.imports) {
          const dep = bundle[imported];
          if (dep && dep.type === 'chunk') {
            visit(dep as unknown as BundleChunk);
          }
        }
      };

      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk' && FIRST_SCREEN_CHUNK_NAMES.includes(output.name)) {
          visit(output as unknown as BundleChunk);
        }
      }

      return tags;
    },
  };
}

function quietMissingSourceMaps() {
  const skip = [/\/vscode-textmate\/.*\.js\.map$/];
  return {
    name: 'sidex-quiet-missing-source-maps',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (skip.some((re) => re.test(url))) {
          res.statusCode = 204;
          res.end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  clearScreen: false,
  assetsInclude: ['**/*.wasm', '**/*.json', '**/*.tmLanguage.json'],
  publicDir: 'public',
  plugins: [nlsPlugin(), firstScreenPreload(), quietMissingSourceMaps()],
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  resolve: {
    alias: {
      'vs': path.resolve(__dirname, 'src/vs'),
    },
  },
  build: {
    target: ['es2022', 'chrome100', 'safari15'],
    minify: 'esbuild',
    sourcemap: false,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'index.html'),
        textMateWorker: path.resolve(__dirname, 'src/vs/workbench/services/textMate/browser/backgroundTokenization/worker/textMateTokenizationWorker.workerMain.ts'),
        editorWorker: path.resolve(__dirname, 'src/vs/editor/common/services/editorWebWorkerMain.ts'),
        extensionHostWorker: path.resolve(__dirname, 'src/vs/workbench/api/worker/extensionHostWorkerMain.ts'),
        // Force the NLS runtime (localize/localize2) into its own chunk so it
        // loads first and has its global translation tables in place before any
        // module evaluates `localize()` at top-level module scope.
        nls: path.resolve(__dirname, 'src/vs/nls.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'editorWorker') {
            return 'assets/editorWorker.js';
          }
          if (chunkInfo.name === 'textMateWorker') {
            return 'assets/textMateWorker.js';
          }
          if (chunkInfo.name === 'extensionHostWorker') {
            return 'assets/extensionHostWorker.js';
          }
          if (chunkInfo.name === 'nls') {
            return 'assets/nls.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if ((assetInfo.name ?? '').endsWith('.ts')) {
            const base = (assetInfo.name ?? 'asset').slice(0, -3);
            return `assets/${base}-[hash].js`;
          }
          return 'assets/[name]-[hash][extname]';
        },
        manualChunks(id, { getModuleInfo }) {
          const isWorkerDep = (moduleId: string, visited = new Set<string>()): boolean => {
            if (visited.has(moduleId)) return false;
            visited.add(moduleId);
            const info = getModuleInfo(moduleId);
            if (!info) return false;
            if (info.isEntry && (moduleId.includes('WorkerMain') || moduleId.includes('workerMain'))) {
              return true;
            }
            for (const importer of info.importers) {
              if (isWorkerDep(importer, visited)) return true;
            }
            return false;
          };

          if (isWorkerDep(id)) {
            return undefined;
          }

          if (id.endsWith('/vs/nls.ts') || id.endsWith('/vs/nls.js')) {
            return 'nls';
          }
          if (id.endsWith('/vs/nls.mock.js')) {
            return 'nls';
          }
          if (
            id.includes('/vs/base/') ||
            id.endsWith('/vs/amdX.ts') || id.endsWith('/vs/amdX.js') ||
            id.endsWith('/vs/sidex-bridge.ts') || id.endsWith('/vs/sidex-bridge.js') ||
            id.includes('xterm') || id.includes('/terminal/') ||
            (id.includes('/vs/editor/') && !id.includes('/workbench/')) ||
            id.includes('/vs/platform/')
          ) {
            return 'core';
          }
        },
      },
    },
  },
  optimizeDeps: {
    include: ['vscode-textmate', 'vscode-oniguruma'],
    exclude: ['@tauri-apps/api'],
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        entryFileNames: 'workers/[name]-[hash].js',
        chunkFileNames: 'workers/[name]-[hash].js',
      },
    },
  },
});
