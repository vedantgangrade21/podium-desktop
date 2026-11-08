/* Podium Desktop - runs inside the page and adds what only the desktop version can do.
   Only the copy of Podium inside this folder loads it; the browser version doesn't. */
(function (P) {
  'use strict';
  const N = window.podiumNative;
  if (!N) return;

  const style = document.createElement('style');
  style.textContent = `
    #titlebar{-webkit-app-region:drag;padding-right:146px}
    #titlebar button,#titlebar input,#titlebar .tb-search,#docTitle{-webkit-app-region:no-drag}
    body>*:not(#app){-webkit-app-region:no-drag}
    #backstage{top:32px}
  `;
  document.head.append(style);

  /* ---------- files opened by path (double-click, Open with, dragging) ---------- */
  const baseName = file => file.split(/[\\/]/).pop();

  /* Stands in for the browser's file handle. Its methods live on the class, so the
     Recent list can store its path; openRecent turns that back into a handle. */
  class DesktopFileHandle {
    constructor(file, name) { this.kind = 'file'; this.desktopPath = file; this.name = name || baseName(file); }
    async getFile() { return new File([await N.readFile(this.desktopPath)], this.name, { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }); }
    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }
    async createWritable() {
      const parts = [], file = this.desktopPath;
      return {
        write: async part => { parts.push(part); },
        close: async () => { await N.writeFile(file, new Uint8Array(await new Blob(parts).arrayBuffer())); },
      };
    }
  }
  window.PodiumDesktop = { handleFor: (file, name) => new DesktopFileHandle(file, name) };

  /* Open and Save As use the Windows dialogs. The app treats a cancel as an AbortError. */
  const cancelled = () => new DOMException('Cancelled', 'AbortError');
  window.showOpenFilePicker = async () => {
    const file = await N.pickOpen();
    if (!file) throw cancelled();
    return [new DesktopFileHandle(file)];
  };
  window.showSaveFilePicker = async ({ suggestedName } = {}) => {
    const file = await N.pickSave(suggestedName);
    if (!file) throw cancelled();
    return new DesktopFileHandle(file);
  };

  const openPath = async file => {
    const handle = new DesktopFileHandle(file);
    try {
      const blob = await handle.getFile();
      P.confirmDiscard(() => P.openBlob(blob, handle));
    } catch (e) {
      console.error(e);
      P.toast(`Could not open ${handle.name}.`);
    }
  };
  N.onOpenFile(openPath);

  /* Dropping a deck on the window keeps its real path, so Save goes back to the same file. */
  window.addEventListener('drop', e => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f || !/\.pptx$/i.test(f.name)) return;
    const file = N.pathForFile(f);
    if (!file) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openPath(file);
  }, true);

  /* ---------- PDF with real, selectable text ---------- */
  const pause = ms => new Promise(r => setTimeout(r, ms));
  P.exportPdf = async range => {
    const slides = range || P.deck.slides.filter(s => !s.hidden);
    const name = await N.pickPdf(`${(P.deck.title || 'Presentation').replace(/\.pptx$/i, '')}.pdf`);
    if (!name) return;
    const root = document.getElementById('printRoot');
    const D = P.deck.size;
    const page = document.createElement('style');
    page.textContent = `@page{size:${D.w}pt ${D.h}pt;margin:0}`;
    document.head.append(page);
    const held = document.getElementById('printStyle');
    if (held) held.media = 'not all';
    try {
      P.toast('Publishing PDF…');
      root.innerHTML = '';
      /* The page is measured in points and the slide in CSS pixels; a point is 4/3 of a pixel. */
      const w = D.w * 4 / 3, hgt = D.h * 4 / 3;
      slides.forEach(s => {
        const p = document.createElement('div');
        p.className = 'print-page';
        p.style.width = `${w}px`;
        p.style.height = `${hgt}px`;
        const n = P.thumb(s, w, { index: P.deck.slides.indexOf(s) });
        n.classList.add('print-slide');
        p.append(n);
        root.append(p);
      });
      await Promise.all([...root.querySelectorAll('img')].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })));
      await document.fonts.ready;
      await pause(120);
      await N.printPdf();
      P.toast(`Saved as ${name}`);
    } catch (e) {
      console.error(e);
      P.toast('Could not publish that PDF. Is it open in another program?');
    } finally {
      root.innerHTML = '';
      page.remove();
      if (held) held.media = '';
    }
  };

  /* ---------- Presenter View on two monitors ---------- */
  const startShow = P.startShow;
  P.startShow = (from, opts = {}) => {
    const cfg = P.deck && P.deck.showCfg;
    const auto = cfg && cfg.presenterView && opts.presenter !== false && window.screen && window.screen.isExtended;
    if (!opts.presenter && !auto) return startShow(from, opts);
    return N.prepareShow().catch(() => false).then(() => startShow(from, opts));
  };

  /* ---------- tell the app when a file passed at launch can be opened ---------- */
  const boot = P.boot;
  P.boot = async () => {
    await boot();
    N.ready();
  };
})(window.P);
