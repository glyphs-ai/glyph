#!/usr/bin/env node
// Render a self-contained HTML file to a CJK-safe PDF.
//
// Strategy: drive a Chromium-family browser (Edge or Chrome) in headless
// mode with --no-pdf-header-footer so the output carries NO browser-injected
// header/footer (the "date | title | file:/// | page/total" band that
// otherwise pollutes every print-to-pdf). Chromium embeds the system CJK
// fonts, so Chinese/Japanese/Korean text stays selectable and extractable.
//
// If no Chromium browser is found, fall back to wkhtmltopdf, then to a
// Python weasyprint one-liner. Each fallback is best-effort; the caller is
// expected to run the companion verify step regardless.
//
// Usage:
//   node render.mjs <input.html> <output.pdf> [--landscape] [--browser <path>]
//
// Env overrides:
//   CJK_PDF_BROWSER   absolute path to an Edge/Chrome binary (highest priority)

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { platform } from 'node:os';

function parseArgs(argv) {
  const args = { landscape: false, browser: null, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--landscape') args.landscape = true;
    else if (a === '--browser') args.browser = argv[++i];
    else args._.push(a);
  }
  return args;
}

// Candidate Chromium-family binaries per platform, in preference order
// (Edge first, then Chrome — both honour --no-pdf-header-footer).
function browserCandidates() {
  const os = platform();
  if (os === 'win32') {
    const pf = process.env['PROGRAMFILES'] || 'C:\\Program Files';
    const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const local = process.env['LOCALAPPDATA'] || '';
    return [
      `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
      local ? `${local}\\Google\\Chrome\\Application\\chrome.exe` : null,
    ].filter(Boolean);
  }
  if (os === 'darwin') {
    return [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  // linux / other unix: prefer PATH lookups, then common install paths
  return [
    'microsoft-edge', 'microsoft-edge-stable',
    'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
    '/usr/bin/microsoft-edge', '/usr/bin/google-chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
}

function resolveBrowser(explicit) {
  const fromEnv = process.env.CJK_PDF_BROWSER;
  const first = explicit || fromEnv;
  if (first) {
    if (existsSync(first)) return first;
    // allow a bare command name resolvable via PATH
    if (commandExists(first)) return first;
    throw new Error(`browser not found at: ${first}`);
  }
  for (const c of browserCandidates()) {
    if (c.includes('/') || c.includes('\\')) {
      if (existsSync(c)) return c;
    } else if (commandExists(c)) {
      return c;
    }
  }
  return null;
}

function commandExists(cmd) {
  const probe = platform() === 'win32' ? 'where' : 'which';
  const r = spawnSync(probe, [cmd], { stdio: 'ignore' });
  return r.status === 0;
}

function renderWithChromium(browser, inHtml, outPdf, landscape) {
  const url = pathToFileURL(resolve(inHtml)).href;
  const flags = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-pdf-header-footer',
    landscape ? '--landscape' : null,
    `--print-to-pdf=${resolve(outPdf)}`,
    url,
  ].filter(Boolean);
  const r = spawnSync(browser, flags, { stdio: 'inherit' });
  return r.status === 0 && existsSync(outPdf);
}

function renderWithWkhtmltopdf(inHtml, outPdf, landscape) {
  if (!commandExists('wkhtmltopdf')) return false;
  const flags = [
    '--encoding', 'utf-8',
    '--enable-local-file-access',
    landscape ? '--orientation' : null, landscape ? 'Landscape' : null,
    resolve(inHtml), resolve(outPdf),
  ].filter(Boolean);
  const r = spawnSync('wkhtmltopdf', flags, { stdio: 'inherit' });
  return r.status === 0 && existsSync(outPdf);
}

function renderWithWeasyprint(inHtml, outPdf) {
  const py = commandExists('python') ? 'python'
    : commandExists('python3') ? 'python3' : null;
  if (!py) return false;
  const code = 'import sys; from weasyprint import HTML; '
    + 'HTML(sys.argv[1]).write_pdf(sys.argv[2])';
  const r = spawnSync(py, ['-c', code, resolve(inHtml), resolve(outPdf)],
    { stdio: 'inherit' });
  return r.status === 0 && existsSync(outPdf);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const [inHtml, outPdf] = args._;
  if (!inHtml || !outPdf) {
    console.error('usage: node render.mjs <input.html> <output.pdf> [--landscape] [--browser <path>]');
    process.exit(2);
  }
  if (!existsSync(inHtml)) {
    console.error(`input HTML not found: ${inHtml}`);
    process.exit(2);
  }

  const browser = resolveBrowser(args.browser);
  if (browser) {
    console.error(`[render] chromium: ${browser}`);
    if (renderWithChromium(browser, inHtml, outPdf, args.landscape)) {
      console.error(`[render] ok -> ${outPdf}`);
      process.exit(0);
    }
    console.error('[render] chromium failed, trying fallbacks');
  } else {
    console.error('[render] no Edge/Chrome found, trying fallbacks');
  }

  if (renderWithWkhtmltopdf(inHtml, outPdf, args.landscape)) {
    console.error(`[render] ok (wkhtmltopdf) -> ${outPdf}`);
    process.exit(0);
  }
  if (renderWithWeasyprint(inHtml, outPdf)) {
    console.error(`[render] ok (weasyprint) -> ${outPdf}`);
    process.exit(0);
  }

  console.error('[render] all render backends failed. Install Edge/Chrome, '
    + 'or wkhtmltopdf, or `pip install weasyprint`.');
  process.exit(1);
}

main();
