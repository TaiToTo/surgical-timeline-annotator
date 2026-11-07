import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

// Dev server for the annotator. Two jobs beyond serving the page:
//   1. expose outputs/ (frame JPEGs + saved annotation JSON) over HTTP,
//   2. a tiny API: list frame sequences, list annotations, save an annotation.
// No database and no build step for the data — the filesystem is the store.

const FRAMES_SUBDIR = 'frames';
const ANN_SUBDIR    = 'annotations';

const MIME = {
  '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4',
};

export default defineConfig({
  base: './',
  server: {
    // Fixed non-default port (override with ANNOTATOR_PORT=NNNN).
    // strictPort: fail loudly if it's taken instead of silently hopping to 5181.
    port: Number(process.env.ANNOTATOR_PORT) || 5180,
    strictPort: true,
    fs: { allow: ['.', '..'] },
    // outputs/ holds frame sequences (tens of thousands of JPEGs each, often
    // symlinked in from shared storage) and saved JSON — data, not source.
    // Watching it exhausts the inotify limit (ENOSPC) and kills the server.
    watch: { ignored: ['**/outputs/**', '**/data/**'] },
  },
  build: {
    outDir: 'dist',
    rollupOptions: { input: { annotator: path.resolve(__dirname, 'index.html') } },
  },
  publicDir: false,
  plugins: [
    {
      name: 'annotator-api',
      configureServer(server) {
        const outputsRoot = path.resolve(__dirname, 'outputs');
        const framesRoot  = path.join(outputsRoot, FRAMES_SUBDIR);
        const annDir      = path.join(outputsRoot, ANN_SUBDIR);

        const sendJson = (res, obj, code = 200) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(obj));
        };

        /**
         * Extract the pathname from a raw request URL using the WHATWG URL
         * parser. Returns null if the URL is structurally malformed so the
         * caller can answer 400 instead of letting the error propagate.
         */
        function safeParsePath(rawUrl) {
          try {
            return new URL(rawUrl, 'http://localhost').pathname;
          } catch {
            return null;
          }
        }

        /**
         * Build a middleware that serves a local directory under a URL prefix.
         * Supports HTTP range requests. decodeURIComponent errors and
         * path-traversal attempts both return non-500 status codes so the
         * dev-server process cannot be crashed by a malformed request URL.
         */
        function serveDir(root, prefix) {
          return (req, res, next) => {
            if (!req.url.startsWith(prefix)) return next();
            const pathname = safeParsePath(req.url);
            if (!pathname) { res.statusCode = 400; res.end('Bad Request'); return; }
            let relPath;
            try {
              relPath = decodeURIComponent(pathname.slice(prefix.length));
            } catch {
              res.statusCode = 400; res.end('Bad Request'); return;
            }
            const filePath = path.resolve(root, relPath);
            // Prevent path traversal: the resolved path must stay inside root.
            if (!filePath.startsWith(root + path.sep)) {
              res.statusCode = 403; res.end('Forbidden'); return;
            }
            if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
              res.statusCode = 404; res.end('Not found'); return;
            }
            const stat = fs.statSync(filePath);
            const contentType = MIME[path.extname(filePath).toLowerCase()]
              || 'application/octet-stream';
            const range = req.headers.range;
            if (range) {
              const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
              const start = parseInt(startStr, 10);
              const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
              res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${stat.size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': end - start + 1,
                'Content-Type': contentType,
                // dev server: never let the browser cache regenerated outputs
                'Cache-Control': 'no-store',
              });
              fs.createReadStream(filePath, { start, end }).pipe(res);
            } else {
              res.writeHead(200, {
                'Content-Length': stat.size,
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'no-store',
              });
              fs.createReadStream(filePath).pipe(res);
            }
          };
        }

        /**
         * On-disk shape of one frame sequence. meta.json's own `layout` wins
         * (the preparation scripts write it); otherwise it is probed from the
         * directory: per-view subfolders mean 'grid' (console/body/hands) or
         * 'duo' (console/body), and a flat folder of frames means 'single'.
         */
        function layoutOf(seqDir) {
          try {
            const meta = JSON.parse(fs.readFileSync(path.join(seqDir, 'meta.json'), 'utf8'));
            if (meta.layout) return meta.layout;
          } catch { /* fall through to probing */ }
          const has = (sub) => fs.existsSync(path.join(seqDir, sub));
          if (!has('console')) return 'single';
          return has('hands') ? 'grid' : 'duo';
        }

        // List frame sequences (subdirs of outputs/frames holding a meta.json).
        server.middlewares.use((req, res, next) => {
          if (req.url !== '/api/frame-sequences') return next();
          try {
            const dirs = fs.existsSync(framesRoot)
              ? fs.readdirSync(framesRoot, { withFileTypes: true })
                  // a sequence may be a symlink to a directory on shared storage
                  .filter(d => d.isDirectory() || d.isSymbolicLink())
                  .map(d => d.name)
                  .filter(n => fs.existsSync(path.join(framesRoot, n, 'meta.json')))
                  .sort()
              : [];
            // Segment counts of the newest phase / gesture file — the same files
            // autoLoadLatestAnnotation() opens — so the picker can show which
            // sequences already carry labels (a 1-segment gesture file is a seed).
            const annFiles = fs.existsSync(annDir)
              ? fs.readdirSync(annDir).filter(f => f.endsWith('.json')).sort().reverse()
              : [];
            const countOf = (file) => {
              try {
                return JSON.parse(fs.readFileSync(path.join(annDir, file), 'utf8'))
                  .annotations?.length ?? 0;
              } catch { return null; }
            };
            const counts = (name) => {
              const mine = annFiles.filter(f => f.startsWith(name + '_annotations_'));
              const phase   = mine.find(f => !/_gesture/i.test(f));
              const gesture = mine.find(f => /_gesture/i.test(f));
              return { phases: phase ? countOf(phase) : null,
                       gestures: gesture ? countOf(gesture) : null };
            };
            sendJson(res, dirs.map(name => ({
              name, layout: layoutOf(path.join(framesRoot, name)), ...counts(name),
            })));
          } catch {
            sendJson(res, []);
          }
        });

        // List saved annotation files (newest-first ordering is the client's job).
        server.middlewares.use((req, res, next) => {
          if (req.url !== '/api/annotations' || req.method !== 'GET') return next();
          try {
            const files = fs.existsSync(annDir)
              ? fs.readdirSync(annDir).filter(f => f.endsWith('.json')).sort()
              : [];
            sendJson(res, files);
          } catch {
            sendJson(res, []);
          }
        });

        // Save an annotation JSON to outputs/annotations/.
        server.middlewares.use((req, res, next) => {
          if (req.method !== 'POST' || !req.url.startsWith('/api/annotations/')) return next();
          const pathname = safeParsePath(req.url);
          if (!pathname) { res.statusCode = 400; res.end('Bad Request'); return; }
          let filename;
          try {
            filename = decodeURIComponent(pathname.slice('/api/annotations/'.length));
          } catch {
            res.statusCode = 400; res.end('Bad Request'); return;
          }
          // Confine writes to a plain .json name directly inside annDir.
          if (!filename.endsWith('.json') || filename.includes('/') || filename.includes('..')) {
            res.statusCode = 400; res.end('Invalid filename'); return;
          }
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              fs.mkdirSync(annDir, { recursive: true });
              fs.writeFileSync(path.join(annDir, filename), body);
              sendJson(res, { ok: true });
            } catch (e) {
              sendJson(res, { error: e.message }, 500);
            }
          });
        });

        server.middlewares.use(serveDir(outputsRoot, '/outputs/'));
      },
    },
  ],
});
