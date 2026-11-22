// The templates' Inter and JetBrains Mono, from the @fontsource packages installed here, so an
// Astro build fetches no font. Astro's own Fontsource provider downloads every file from
// cdn.jsdelivr.net, and one failed download fails the build.
import { createRequire } from 'node:module';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fontProviders } from 'astro/config';

/**
 * Astro's npm provider, local only, giving the faces Astro's Fontsource provider gives.
 * - It names each file by a `file:` URL, which Astro 7.4.5 passes to fetch(); Astro reads a file
 *   it is given as an absolute path, so each URL becomes one.
 * - It returns every subset a package has. Fontsource names its files `<family>-<subset>-<weight>-<style>`,
 *   so the faces kept are those of the family's `subsets` (Astro's default: latin), as the
 *   Fontsource provider keeps.
 * - Astro measures the fallback font metrics on a family's first face. The faces are sorted by
 *   weight, normal before italic, so that face is the 400 normal one the Fontsource provider
 *   lists first.
 */
export function installedFonts() {
  // The packages are installed beside the templates, not under each template's root.
  const npm = fontProviders.npm({ remote: false, resolve: createRequire(import.meta.url).resolve });
  return {
    ...npm,
    async resolveFont(options) {
      const result = await npm.resolveFont(options);
      if (!result) return result;
      const slug = options.familyName.toLowerCase().replaceAll(' ', '-');
      const subsetOf = (path) => basename(path).match(new RegExp(`^${slug}-(.+)-\\d+-(?:normal|italic)\\.`))?.[1];
      const fonts = [];
      for (const font of result.fonts) {
        const src = font.src.map((source) => 'url' in source && source.url.startsWith('file:') ? { ...source, url: fileURLToPath(source.url) } : source);
        const file = src.find((source) => 'url' in source);
        if (file && !options.subsets.includes(subsetOf(file.url))) continue;
        fonts.push({ ...font, src });
      }
      const order = (font) => Number.parseInt(String(font.weight), 10) * 2 + (font.style === 'italic' ? 1 : 0);
      return { ...result, fonts: fonts.sort((a, b) => order(a) - order(b)) };
    },
  };
}
