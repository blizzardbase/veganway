import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Preload two files the first screen needs but the HTML cannot name by itself (their names carry a
 * hash): the Manrope latin font, so text does not wait for the CSS to be parsed before the font
 * request starts, and Motion's animation features, which load after first paint (see layouts.tsx)
 * but should already be downloaded when the first entrance animation starts.
 */
function preloadFirstScreen(): Plugin {
  return {
    name: 'veganway:preload-first-screen',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const font = Object.keys(ctx.bundle ?? {}).find((f) => /manrope-latin-wght-normal-[\w-]+\.woff2$/.test(f));
        if (!font) throw new Error('The Manrope latin font file is missing from the bundle.');
        const motion = Object.keys(ctx.bundle ?? {}).find((f) => /assets\/motionFeatures-[\w-]+\.js$/.test(f));
        if (!motion) throw new Error('The motion features chunk is missing from the bundle.');
        const tags = [
          `<link rel="preload" href="/${font}" as="font" type="font/woff2" crossorigin />`,
          `<link rel="modulepreload" crossorigin href="/${motion}">`,
        ];
        return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    ${tags.join('\n    ')}`);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), preloadFirstScreen()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    // Fonts must stay files: the CSP allows font-src 'self' and no data: fonts.
    assetsInlineLimit: 0,
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Stable vendor chunks: they change only when a dependency does, so a deploy of app code
        // leaves them cached. Icons and motion stay with the screens that use them.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
            { name: 'router', test: /node_modules[\\/]react-router[\\/]/, priority: 20 },
            { name: 'query', test: /node_modules[\\/]@tanstack[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
});
