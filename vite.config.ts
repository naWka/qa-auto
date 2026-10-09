import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import YAML from 'yaml';

// Content lives in YAML files; this plugin turns each into a JSON module.
function yaml(): Plugin {
  return {
    name: 'content-yaml',
    transform(code, id) {
      if (!/\.ya?ml$/.test(id)) return null;
      const data = YAML.parse(code, { prettyErrors: true });
      return { code: `export default ${JSON.stringify(data)};`, map: null };
    },
  };
}

export default defineConfig({
  base: '/qa-auto/',
  plugins: [react(), yaml()],
  build: { chunkSizeWarningLimit: 3000 },
});
