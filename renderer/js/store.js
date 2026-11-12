// Datenzugriff: in Electron über window.api (preload), im Browser (Entwicklung) über localStorage
(function () {
  const R = (window.R = window.R || {});
  const LS_KEY = 'relatio.projects';

  const browserApi = {
    async list() {
      return readAll().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    async load(id) {
      const p = readAll().find((x) => x.id === id);
      if (!p) throw new Error('Projekt nicht gefunden');
      return p;
    },
    async save(project) {
      const all = readAll().filter((x) => x.id !== project.id);
      all.push(JSON.parse(JSON.stringify(project)));
      localStorage.setItem(LS_KEY, JSON.stringify(all));
      return true;
    },
    async remove(id) {
      localStorage.setItem(LS_KEY, JSON.stringify(readAll().filter((x) => x.id !== id)));
      return true;
    },
    async exportFile(project) {
      const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${project.name || 'Diagramm'}.relatio`;
      a.click();
      return a.download;
    },
    async importFile() {
      return null;
    },
    async exportPdf() {
      alert('Der PDF-Export ist nur in der Desktop-App verfügbar.');
      return null;
    },
    async openProjectsFolder() {},
    async openPath() {},
    async userName() {
      return '';
    },
  };

  function readAll() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    } catch {
      return [];
    }
  }

  R.api = window.api || browserApi;
  R.isDesktop = !!window.api;

  // Einstellungen (pro Rechner)
  const SETTINGS_KEY = 'relatio.settings';
  const defaults = { userName: '', snap: true, pdfFormat: 'a4-landscape', pdfHeader: true };
  R.settings = Object.assign({}, defaults, safeParse(localStorage.getItem(SETTINGS_KEY)));
  R.saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(R.settings));

  function safeParse(s) {
    try {
      return JSON.parse(s) || {};
    } catch {
      return {};
    }
  }

  R.uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
})();
