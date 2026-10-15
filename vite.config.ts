import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Lista plików wymaganych do startu aplikacji, wytwarzana przy każdym buildzie. */
function momentumOfflineManifest(): Plugin {
  return {
    name: 'momentum-offline-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const essential = new Set<string>();
      const queue = Object.entries(bundle)
        .filter(([, entry]) => entry.type === 'chunk' && entry.isEntry)
        .map(([name]) => name);
      while (queue.length > 0) {
        const name = queue.pop()!;
        if (essential.has(name)) continue;
        essential.add(name);
        const entry = bundle[name];
        if (entry?.type === 'chunk') {
          for (const imported of entry.imports) queue.push(imported);
          for (const css of entry.viteMetadata?.importedCss ?? []) essential.add(css);
          for (const asset of entry.viteMetadata?.importedAssets ?? []) essential.add(asset);
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: 'offline-assets.json',
        source: JSON.stringify({ version: 1, paths: [...essential].map(path => `/${path}`) }),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), momentumOfflineManifest()],
  server: {
    host: '0.0.0.0',
    port: 5180,
    strictPort: true,
  },
});
