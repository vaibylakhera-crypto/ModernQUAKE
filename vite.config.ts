import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// A build id baked into the code AND written to dist/version.json. On start the game compares the two: if the server
// has a newer build than the code that is running (phones love to keep an old copy), it reloads itself once.
const BUILD = Date.now().toString(36);

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [{
    name: 'write-version',
    apply: 'build',
    closeBundle() { fs.writeFileSync(path.resolve('dist/version.json'), JSON.stringify({ v: BUILD })); },
  }],
});
