import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Lista plików startowych PWA, generowana na podstawie rzeczywistych assetów Vite. */
function momentumOfflineManifest(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'momentum-offline-manifest',
    apply: 'build',
    configResolved(resolved) { config = resolved; },
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
    async closeBundle() {
      const outputDir = resolve(config.root, config.build.outDir);
      const manifest = await readFile(resolve(outputDir, 'offline-assets.json'));
      const page = await readFile(resolve(outputDir, 'index.html'));
      const workerTemplate = await readFile(resolve(config.publicDir, 'sw.js'), 'utf8');
      const token = '__MOMENTUM_BUILD_ID__';
      if (!workerTemplate.includes(token)) throw new Error('Brak znacznika identyfikatora wersji w public/sw.js');
      // Identyfikator zależy od zawartości wydania, NIE od daty deploymentu:
      // ta sama wersja ma te same cache, a zmiana kodu/HTML/SW tworzy nowe.
      const release = createHash('sha256').update(manifest).update(page).update(workerTemplate)
        .digest('hex').slice(0, 12);
      await writeFile(resolve(outputDir, 'sw.js'), workerTemplate.replace(token, release), 'utf8');
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
