/**
 * Tiny Vite plugin: after the production build, writes dist/sw.js with a precache list of
 * every emitted file and a content hash as the cache version. No Workbox dependency.
 */
import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function swPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'awm-service-worker',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files = walk(outDir)
        .map((p) => relative(outDir, p).split('\\').join('/'))
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map'));
      const template = readFileSync(new URL('./sw-template.js', import.meta.url), 'utf8');
      const hash = createHash('sha256').update(template);
      for (const f of files.sort()) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const sw = template
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(['./', ...files], null, 2));
      writeFileSync(join(outDir, 'sw.js'), sw);
      // eslint-disable-next-line no-console
      console.log(`[sw] precached ${files.length + 1} files, version ${version}`);
    },
  };
}
