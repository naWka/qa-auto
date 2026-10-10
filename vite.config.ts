import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import YAML from 'yaml';
import { STARTER_ZIP, buildStarterZip } from './scripts/starter-zip';

// Content lives in YAML files; this plugin turns each into a JSON module.
function yaml(): Plugin {
  return {
    name: 'content-yaml',
    transform(code, id) {
      const [path, query] = id.split('?');
      if (!/\.ya?ml$/.test(path)) return null;
      try {
        let data = YAML.parse(code, { prettyErrors: true });
        // Lessons are split: metadata + check pool load with the app, the steps load when a lesson opens.
        if (query === 'meta' && data?.steps) {
          const { steps, ...meta } = data;
          const stepTasks = (steps as { type: string; task?: { id: string; kind: string; xp?: number } }[])
            .filter((s) => s.type === 'task' && s.task)
            .map((s) => ({ id: s.task!.id, kind: s.task!.kind, xp: s.task!.xp }));
          data = { ...meta, stepTasks };
        } else if (query === 'steps') data = data?.steps ?? null;
        return { code: `export default ${JSON.stringify(data)};`, map: null };
      } catch (e) {
        // A broken lesson file is skipped (npm run check:content reports it); anything else stops the build.
        if (!/\/chapters\/[^/]+\/l\d[^/]*\.ya?ml$/.test(path)) throw e;
        this.warn(`skipping ${id}: ${(e as Error).message.split('\n')[0]}`);
        return { code: 'export default null;', map: null };
      }
    },
  };
}

// The final-project starter (chapter 11) as a downloadable zip: /qa-auto/downloads/bloomly-playwright-tests.zip
function starterZip(): Plugin {
  const root = import.meta.dirname;
  return {
    name: 'starter-zip',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.split('?')[0].endsWith(`/${STARTER_ZIP}`)) return next();
        res.setHeader('Content-Type', 'application/zip');
        res.end(buildStarterZip(root));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: STARTER_ZIP, source: buildStarterZip(root) });
    },
  };
}

export default defineConfig({
  base: '/qa-auto/',
  plugins: [react(), yaml(), starterZip()],
  build: { chunkSizeWarningLimit: 3000 },
});
