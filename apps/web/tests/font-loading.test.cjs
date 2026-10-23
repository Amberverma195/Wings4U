const fs = require('node:fs');
const path = require('node:path');

describe('Google Fonts build-time self-hosting regression audit', () => {
  const webSrc = path.resolve(__dirname, '..', 'src');

  function walk(dir) {
    let files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(walk(fullPath));
      } else if (/\.(css|tsx?|jsx?|html)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
    return files;
  }

  test('no source files in apps/web/src make runtime requests to fonts.googleapis.com or fonts.gstatic.com', () => {
    const allFiles = walk(webSrc);
    expect(allFiles.length).toBeGreaterThan(10);

    const violations = [];
    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('fonts.googleapis.com')) {
        violations.push(`${file} contains fonts.googleapis.com`);
      }
      if (content.includes('fonts.gstatic.com')) {
        violations.push(`${file} contains fonts.gstatic.com`);
      }
    }

    expect(violations).toEqual([]);
  });

  test('global-style.tsx has removed the browser @import and uses self-hosted CSS variables', () => {
    const globalStylePath = path.join(webSrc, 'Wings4u', 'components', 'global-style.tsx');
    const content = fs.readFileSync(globalStylePath, 'utf8');

    expect(content).not.toContain('@import url(\'https://fonts.googleapis.com');
    expect(content).not.toContain('@import url("https://fonts.googleapis.com');
    expect(content).toContain('var(--font-bebas-neue)');
    expect(content).toContain('var(--font-black-han-sans)');
    expect(content).toContain('var(--font-dm-sans)');
    expect(content).toContain('var(--font-oswald)');
    expect(content).toContain('var(--font-outfit)');
    expect(content).toContain('var(--font-poppins)');
    expect(content).toContain('var(--font-rajdhani)');
  });

  test('fonts.ts exports all 8 configured fonts and the combined fontVariables class string', () => {
    const fontsPath = path.join(webSrc, 'app', 'fonts.ts');
    const content = fs.readFileSync(fontsPath, 'utf8');

    const expectedExports = [
      'bebasNeue',
      'blackHanSans',
      'dmSans',
      'libreBaskerville',
      'oswald',
      'outfit',
      'poppins',
      'rajdhani',
      'fontVariables',
    ];

    for (const exp of expectedExports) {
      expect(content).toContain(exp);
    }

    // Verify all 8 font variable tokens are referenced
    expect(content).toContain('--font-bebas-neue');
    expect(content).toContain('--font-black-han-sans');
    expect(content).toContain('--font-dm-sans');
    expect(content).toContain('--font-libre-baskerville');
    expect(content).toContain('--font-oswald');
    expect(content).toContain('--font-outfit');
    expect(content).toContain('--font-poppins');
    expect(content).toContain('--font-rajdhani');
  });

  test('app/layout.tsx imports fontVariables and attaches it to the <html> root element', () => {
    const layoutPath = path.join(webSrc, 'app', 'layout.tsx');
    const content = fs.readFileSync(layoutPath, 'utf8');

    expect(content).toContain('import { fontVariables } from "./fonts";');
    expect(content).toMatch(/<html[^>]*className=\{fontVariables\}/);
  });

  test('styles.ts preserves fallback font families while prepending self-hosted CSS variables', () => {
    const stylesPath = path.join(webSrc, 'Wings4u', 'styles.ts');
    const content = fs.readFileSync(stylesPath, 'utf8');

    expect(content).toContain("var(--font-bebas-neue), 'Bebas Neue'");
    expect(content).toContain("var(--font-black-han-sans), 'Black Han Sans'");
    expect(content).toContain("var(--font-dm-sans), 'DM Sans'");
    expect(content).toContain("var(--font-libre-baskerville), 'Libre Baskerville'");
  });

  test('globals.css preserves fallback font families while prepending self-hosted CSS variables', () => {
    const globalsCssPath = path.join(webSrc, 'app', 'globals.css');
    const content = fs.readFileSync(globalsCssPath, 'utf8');

    expect(content).toContain('var(--font-bebas-neue), "Bebas Neue"');
    expect(content).toContain('var(--font-dm-sans), "DM Sans"');
    expect(content).toContain('var(--font-outfit), var(--font-poppins), Outfit, Poppins');
    expect(content).toContain('var(--font-rajdhani), \'Rajdhani\'');
  });
});
