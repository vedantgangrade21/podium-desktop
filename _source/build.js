/* Builds Podium Desktop from the browser version, which it only reads.
   Run: npm install, then npm run build. Close Podium Desktop first. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const here = __dirname;
const folder = path.resolve(here, '..');
const webSource = process.env.PODIUM_WEB || path.resolve(folder, '..', 'Podium');
const target = path.join(folder, 'app');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'podium-stage-'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'podium-out-'));

/* Fails loudly if the browser version's code has moved, rather than building something half-wired. */
const patch = (file, find, change) => {
  const full = path.join(stage, 'web', file);
  const text = fs.readFileSync(full, 'utf8');
  if (text.split(find).length !== 2) throw new Error(`Expected exactly one "${find}" in ${file}. Update build.js.`);
  fs.writeFileSync(full, text.replace(find, () => change(find)));
};

(async () => {
  const { packager } = await import('@electron/packager');
  if (!fs.existsSync(path.join(webSource, 'index.html'))) throw new Error(`Browser version not found at ${webSource}`);

  for (const name of ['index.html', 'css', 'js', 'lib']) fs.cpSync(path.join(webSource, name), path.join(stage, 'web', name), { recursive: true });
  for (const name of ['main.js', 'preload.js', 'icon.ico']) fs.copyFileSync(path.join(here, 'src', name), path.join(stage, name));
  fs.copyFileSync(path.join(here, 'src', 'desktop-bridge.js'), path.join(stage, 'web', 'desktop-bridge.js'));

  patch('index.html', "<script>window.addEventListener('DOMContentLoaded'", found => `<script src="desktop-bridge.js"></script>\n${found}`);
  patch('js/backstage.js', 'const openRecent = async it => {', found => `${found}\n    if (it.handle && it.handle.desktopPath) it = Object.assign({}, it, { handle: PodiumDesktop.handleFor(it.handle.desktopPath, it.handle.name) });`);

  /* Full-page printing: slides are laid out in CSS pixels, so a page sized in points left them at 75%. */
  patch('js/backstage.js', '@page{size:${D.w}pt ${D.h}pt;margin:0}', () => '@page{size:${D.w}px ${D.h}px;margin:0}');

  const own = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: 'podium', productName: 'Podium', version: own.version, main: 'main.js' }, null, 2));

  const [built] = await packager({
    dir: stage,
    out,
    name: 'Podium',
    executableName: 'Podium',
    platform: 'win32',
    arch: 'x64',
    asar: false,
    prune: false,
    overwrite: true,
    electronVersion: own.devDependencies.electron,
    icon: path.join(here, 'src', 'icon.ico'),
    appVersion: own.version,
    win32metadata: { ProductName: 'Podium', FileDescription: 'Podium', CompanyName: 'Podium' },
  });

  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(built, target, { recursive: true });
  console.log(`Built ${path.join(target, 'Podium.exe')}`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => {
  fs.rmSync(stage, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
});
