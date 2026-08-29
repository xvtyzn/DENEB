import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [dts({ rollupTypes: false, include: ['src'] })],
  build: {
    lib: {
      entry: {
        index: 'src/index.ts',
        react: 'src/react/index.ts',
        presets: 'src/presets/index.ts',
        lint: 'src/lint/index.ts',
        diff: 'src/diff/index.ts',
        panel: 'src/render/panel.ts',
        import: 'src/import/index.ts',
        abml: 'src/abml/index.ts',
        veritas: 'src/veritas/index.ts',
      },
      formats: ['es', 'cjs'],
      fileName: (format, name) => (format === 'es' ? `${name}.js` : `${name}.cjs`),
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      output: {
        // Keep the optional areas in chunks of their own. Without this Rollup
        // groups the preset catalogue together with the domain catalogue that
        // the viewer genuinely needs, and every consumer ends up carrying both.
        manualChunks(id) {
          if (id.includes('/src/render/panel')) return 'panel-composer';
          if (id.includes('/src/presets/')) return 'presets-data';
          // Name the viewer's own modules too, or Rollup hoists shared ones —
          // the domain catalogue in particular — into whichever chunk it likes,
          // which is how the presets ended up travelling with the core.
          // The model is what the optional tools depend on; the drawing engine
          // is what only the viewer needs. Splitting them means a consumer that
          // only lints or only imports never downloads the renderer.
          // `normalize` assigns the target palette, so the theme travels with
          // the model rather than with the renderer.
          if (
            id.includes('/src/model/') ||
            id.includes('/src/dsl/') ||
            id.includes('/src/theme/')
          ) {
            return 'model';
          }
          if (
            id.includes('/src/layout/') ||
            id.includes('/src/render/') ||
            id.includes('/src/export/')
          ) {
            return 'viewer';
          }
          if (id.includes('/src/lint/')) return 'lint-rules';
          if (id.includes('/src/diff/')) return 'diff-engine';
          if (id.includes('/src/import/')) return 'import-adapters';
          if (id.includes('/src/abml/')) return 'abml';
          if (id.includes('/src/veritas/')) return 'veritas';
          return undefined;
        },
      },
    },
    sourcemap: true,
    target: 'es2020',
  },
});
