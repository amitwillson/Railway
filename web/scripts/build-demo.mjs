/**
 * Bundles the offline demonstration build into a single portable HTML file.
 *
 *   npm run seed:reset --workspace server
 *   node web/scripts/make-demo-data.mjs
 *   DEMO=1 vite build
 *   node web/scripts/build-demo.mjs
 *
 * The result opens straight from the file system - no server, no network - and
 * runs the real application against the embedded demonstration data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '..');
const DIST = path.join(WEB, 'dist-demo');
const OUT = path.resolve(WEB, '..', 'demo', 'railway-inspection-demo.html');

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('No demo build found. Run "DEMO=1 vite build" first.');
  process.exit(1);
}

let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

/** Replaces every <script src> and <link rel=stylesheet> with its contents. */
const inline = () => {
  html = html.replace(
    /<script[^>]*src="([^"]+)"[^>]*><\/script>/g,
    (match, src) => {
      const file = path.join(DIST, src.replace(/^\.?\//, ''));
      if (!fs.existsSync(file)) return match;
      const code = fs.readFileSync(file, 'utf8');
      return `<script type="module">\n${code}\n</script>`;
    }
  );
  html = html.replace(
    /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
    (match, href) => {
      const file = path.join(DIST, href.replace(/^\.?\//, ''));
      if (!fs.existsSync(file)) return match;
      return `<style>\n${fs.readFileSync(file, 'utf8')}\n</style>`;
    }
  );
};
inline();

// The manifest, service worker and icon files are not part of a single-file
// build; drop the references rather than leaving broken links behind.
html = html.replace(/\s*<link rel="manifest"[^>]*>/g, '');
html = html.replace(/\s*<link rel="apple-touch-icon"[^>]*>/g, '');
html = html.replace(
  /\s*<link rel="icon"[^>]*>/g,
  '\n    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Crect width=%2264%22 height=%2264%22 rx=%2214%22 fill=%22%230b4f6c%22/%3E%3Cpath d=%22M20 14h24a6 6 0 016 6v22a6 6 0 01-6 6H20a6 6 0 01-6-6V20a6 6 0 016-6z%22 fill=%22%23fff%22/%3E%3Ccircle cx=%2246%22 cy=%2246%22 r=%2212%22 fill=%22%23fab219%22/%3E%3C/svg%3E">'
);
html = html.replace(
  /<title>[^<]*<\/title>/,
  '<title>Railway Inspection - offline demonstration</title>'
);

// A short banner so nobody mistakes the demonstration build for the real
// deployment, and so the limitations are stated up front rather than found.
const banner = `
    <noscript>
      <div style="font-family:system-ui;padding:24px;max-width:40em;margin:0 auto">
        <h1>JavaScript is required</h1>
        <p>This demonstration runs entirely in the browser, so it needs JavaScript enabled.</p>
      </div>
    </noscript>
    <script>
      window.__RAILWAY_DEMO__ = true;
      // The single-file build has no service worker; make sure a previously
      // registered one from the served application never intercepts it.
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations?.()
          .then((rs) => rs.forEach((r) => r.unregister()))
          .catch(() => {});
      }
    </script>`;
html = html.replace('<div id="root"></div>', `<div id="root"></div>${banner}`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);

const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
console.info(`Single-file demonstration written to ${path.relative(path.resolve(WEB, '..'), OUT)} (${mb} MB)`);
