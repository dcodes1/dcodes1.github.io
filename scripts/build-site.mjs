// Preserve static portfolio routes and assets in the Vite artifact.
import { cpSync, mkdirSync, copyFileSync } from 'node:fs';
for (const dir of ['assets', 'ai', 'research']) cpSync(dir, 'dist/' + dir, { recursive: true });
for (const file of ['404.html', 'CNAME']) copyFileSync(file, 'dist/' + file);
mkdirSync('dist/translator/data', { recursive: true });
copyFileSync('translator/engine.js', 'dist/translator/engine.js');
copyFileSync('translator/data/index.json', 'dist/translator/data/index.json');
