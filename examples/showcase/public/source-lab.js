import {File, FileDiff, preloadHighlighter} from '@pierre/diffs';

const root = document.querySelector('#source-lab');
const theme = {light: 'github-light-high-contrast', dark: 'github-dark-high-contrast'};
const language = (name) => name.endsWith('.php') ? 'php' : name.endsWith('.sql') ? 'sql' : name.endsWith('.json') ? 'json' : name.endsWith('.js') ? 'javascript' : name.endsWith('.ts') ? 'typescript' : 'text';
const stringFiles = (value) => value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((text) => typeof text === 'string');
const sameFiles = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const button = (text, handler) => {
  const node = element('button', text, 'lab-button');
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
};
const field = (label, control) => {
  const wrapper = element('label', undefined, 'lab-field');
  wrapper.append(element('span', label), control);
  return wrapper;
};
const fillSelect = (select, names, previous) => {
  select.replaceChildren(...names.map((name) => {
    const option = element('option', name);
    option.value = name;
    return option;
  }));
  if (names.includes(previous)) select.value = previous;
};
const download = (name, contents) => {
  const blob = new Blob([contents], {type: 'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = element('a');
  link.href = url;
  link.download = name.replaceAll('/', '-');
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

async function start() {
  root.classList.add('source-lab');
  const title = element('h2', 'Read it. Change it. Compile it.');
  const intro = element('p', 'The complete showcase source, with real diffs.com syntax highlighting. Edit the TypeScript and compile it to PHP in your browser.');
  const boundary = element('p', 'Compile preview keeps your changes in this browser. It does not update WordPress, run actions, apply migrations or change the live demo.', 'lab-boundary');
  const loading = element('p', 'Loading the source lab…');
  loading.role = 'status';
  root.replaceChildren(title, intro, boundary, loading);
  const response = await fetch(new URL('./sources.json', import.meta.url));
  if (!response.ok) throw new Error(`Source files could not be loaded (${response.status}).`);
  const manifest = await response.json();
  if (!manifest || typeof manifest.name !== 'string' || !stringFiles(manifest.files) || typeof manifest.files['zero.config.ts'] !== 'string' || !stringFiles(manifest.output)) {
    throw new Error('The showcase source manifest is invalid.');
  }
  const baseline = {...manifest.files};
  let draft = {...baseline};
  let output = {...manifest.output};
  let compiledFiles = {...baseline};
  let activeView = 'source';
  let layout = 'split';
  let worker;
  let running = false;
  let sequence = 0;
  let renderSequence = 0;
  const renderers = [];
  let hasStorage = true;
  const storageKey = `zero-showcase-source-draft:${manifest.name}`;
  let restored = false;
  let earlierDraft;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved && sameFiles(saved.baseline, baseline) && stringFiles(saved.files) && sameFiles(Object.keys(saved.files).sort(), Object.keys(baseline).sort())) {
      draft = {...saved.files};
      restored = !sameFiles(draft, baseline);
    } else if (saved && stringFiles(saved.files)) {
      // Keep an earlier build's draft recoverable instead of silently replacing it.
      earlierDraft = saved.files;
    }
    const older = JSON.parse(localStorage.getItem(`${storageKey}:earlier`) || 'null');
    if (!earlierDraft && older && stringFiles(older.files)) earlierDraft = older.files;
  } catch { hasStorage = false; }

  const sourceSelect = element('select');
  sourceSelect.id = 'lab-source-file';
  fillSelect(sourceSelect, Object.keys(baseline), 'zero.config.ts');
  const outputSelect = element('select');
  outputSelect.id = 'lab-output-file';
  fillSelect(outputSelect, Object.keys(output), 'functions.php');
  const editor = element('textarea', undefined, 'lab-editor');
  editor.id = 'lab-source-editor';
  editor.spellcheck = false;
  editor.autocapitalize = 'off';
  editor.autocomplete = 'off';
  editor.setAttribute('aria-describedby', 'lab-editor-help');
  const editorHelp = element('p', 'Edits are saved in this browser for this version of the source. Copy or download to keep a separate file.', 'lab-help');
  editorHelp.id = 'lab-editor-help';
  if (!hasStorage) editorHelp.textContent = 'Browser storage is unavailable. Copy or download your edits before leaving.';
  const status = element('p', restored ? 'Restored your browser draft. Compile preview to update the output.' : 'Showing the exact source and generated output used to build this demo.', 'lab-status');
  status.role = 'status';
  status.setAttribute('aria-live', 'polite');
  const outputStatus = element('p', undefined, 'lab-output-status');
  outputStatus.role = 'status';
  const diagnostics = element('div', undefined, 'lab-diagnostics');
  diagnostics.setAttribute('aria-live', 'polite');
  const preview = element('div', undefined, 'lab-preview');
  const previewTools = element('div', undefined, 'lab-toolbar');
  const views = element('div', undefined, 'lab-toolbar');
  views.setAttribute('role', 'group');
  views.setAttribute('aria-label', 'Source preview mode');
  const viewButtons = new Map();
  for (const [name, label] of [['source', 'Highlighted source'], ['changes', 'Changes'], ['paired', 'Source → output']]) {
    const control = button(label, () => { activeView = name; updatePreview(); });
    viewButtons.set(name, control);
    views.append(control);
  }
  const target = element('select');
  fillSelect(target, ['Source changes', 'Generated output changes']);
  const diffTarget = field('Compare baseline with draft', target);
  const split = button('Split', () => { layout = 'split'; updatePreview(); });
  const unified = button('Unified', () => { layout = 'unified'; updatePreview(); });
  const layoutControls = element('div', undefined, 'lab-toolbar');
  layoutControls.setAttribute('role', 'group');
  layoutControls.setAttribute('aria-label', 'Diff layout');
  layoutControls.append(split, unified);
  const compile = button('Compile preview', compileDraft);
  compile.classList.add('lab-primary');
  const reset = button('Reset all edits', () => {
    if (!sameFiles(draft, baseline) && !window.confirm('Discard all your source edits and restore the original showcase source?')) return;
    draft = {...baseline};
    output = {...manifest.output};
    compiledFiles = {...baseline};
    diagnostics.replaceChildren();
    editor.value = draft[sourceSelect.value];
    saveDraft();
    fillSelect(outputSelect, Object.keys(output), outputSelect.value);
    status.textContent = 'Restored the original source and generated output.';
    updatePreview();
  });
  const actions = element('div', undefined, 'lab-toolbar');
  actions.append(compile, reset, button('Download all sources', () => download('showcase-sources.json', `${JSON.stringify({name: manifest.name, files: draft}, null, 2)}\n`)));
  if (earlierDraft) {
    status.textContent = 'An earlier source draft is saved. Download it if you want to carry changes into this version.';
    actions.append(button('Download earlier draft', () => download('showcase-earlier-draft.json', `${JSON.stringify({name: manifest.name, files: earlierDraft}, null, 2)}\n`)));
  }
  const editTools = element('div', undefined, 'lab-toolbar');
  editTools.append(button('Copy source', () => copy(draft[sourceSelect.value])), button('Download source', () => download(sourceSelect.value, draft[sourceSelect.value])));
  const outputTools = element('div', undefined, 'lab-toolbar');
  outputTools.append(field('Generated file', outputSelect), button('Copy output', () => copy(output[outputSelect.value] || '')), button('Download output', () => download(outputSelect.value, output[outputSelect.value] || '')));
  const editorColumn = element('div', undefined, 'lab-editor-column');
  const sourceLabel = field('Edit source file', sourceSelect);
  const editorLabel = element('label', undefined, 'lab-field');
  const editorCaption = element('span');
  editorLabel.append(editorCaption, editor);
  editorColumn.append(sourceLabel, editorLabel, editorHelp, editTools);
  const previewColumn = element('div', undefined, 'lab-preview-column');
  previewTools.append(diffTarget, layoutControls);
  previewColumn.append(views, previewTools, outputTools, outputStatus, preview);
  const columns = element('div', undefined, 'lab-columns');
  columns.append(editorColumn, previewColumn);
  const credit = element('p', undefined, 'lab-help');
  const diffsLink = element('a', 'diffs.com / @pierre/diffs 1.6.2');
  diffsLink.href = 'https://diffs.com/';
  const notices = element('a', 'Dependency notices');
  notices.href = new URL('./code-notices.txt', import.meta.url).href;
  credit.append('Syntax and diffs: ', diffsLink, '. Bundled locally; no CDN. ', notices, '. TypeScript and PHP are paired translations; Changes compares each file with the same language.');
  root.replaceChildren(title, intro, boundary, actions, status, diagnostics, columns, credit);

  const highlighter = preloadHighlighter({
    themes: Object.values(theme),
    langs: ['typescript', 'javascript', 'php', 'sql', 'json'],
    preferredHighlighter: 'shiki-js',
  });
  // Keep editing/compiling available if highlighting cannot initialize.
  let highlighting = true;
  highlighter.catch(() => { highlighting = false; });

  function saveDraft() {
    try {
      if (earlierDraft) localStorage.setItem(`${storageKey}:earlier`, JSON.stringify({files: earlierDraft}));
      localStorage.setItem(storageKey, JSON.stringify({baseline, files: draft}));
    }
    catch {
      hasStorage = false;
      editorHelp.textContent = 'Browser storage is unavailable. Copy or download your edits before leaving.';
    }
  }
  async function copy(contents) {
    try {
      await navigator.clipboard.writeText(contents);
      status.textContent = 'Copied the complete file.';
    } catch { status.textContent = 'Clipboard unavailable. Download the file, or select and copy its text.'; }
  }
  function editorFile() {
    editor.value = draft[sourceSelect.value];
    editorCaption.textContent = `${sourceSelect.value} — editable source`;
  }
  function clearRenderers() {
    for (const renderer of renderers.splice(0)) renderer.cleanUp();
    preview.replaceChildren();
  }
  function codePanel(name, contents, before) {
    const panel = element('section', undefined, 'lab-code-panel');
    panel.append(element('h3', name));
    const container = element('div', undefined, 'lab-code');
    panel.append(container);
    preview.append(panel);
    if (!highlighting) {
      const plain = element('pre', before === undefined ? contents : `BASELINE\n${before}\nDRAFT\n${contents}`);
      plain.tabIndex = 0;
      container.append(plain);
      return;
    }
    const options = {
      theme,
      disableFileHeader: true,
      overflow: 'scroll',
      unsafeCSS: ':host{font-size:12px;--diffs-font-size:12px;--diffs-line-height:20px}pre{max-height:620px;overflow:auto}pre:focus-visible{outline:3px solid #5b5bd6;outline-offset:-3px}',
      onPostRender(node) {
        const code = node.shadowRoot?.querySelector('pre') || node.querySelector('pre');
        if (code) { code.tabIndex = 0; code.setAttribute('aria-label', `${name}; scroll with arrow keys`); }
      },
    };
    if (before !== undefined) {
      const renderer = new FileDiff({...options, diffStyle: layout, expandUnchanged: true});
      renderers.push(renderer);
      renderer.render({oldFile: {name, contents: before, lang: language(name)}, newFile: {name, contents, lang: language(name)}, containerWrapper: container});
    } else {
      const renderer = new File(options);
      renderers.push(renderer);
      renderer.render({file: {name, contents, lang: language(name)}, containerWrapper: container});
    }
  }
  async function updatePreview() {
    const render = ++renderSequence;
    for (const [name, control] of viewButtons) control.setAttribute('aria-pressed', String(name === activeView));
    split.setAttribute('aria-pressed', String(layout === 'split'));
    unified.setAttribute('aria-pressed', String(layout === 'unified'));
    previewTools.hidden = activeView !== 'changes';
    outputTools.hidden = activeView === 'source' || (activeView === 'changes' && target.value === 'Source changes');
    const stale = !sameFiles(draft, compiledFiles);
    outputStatus.textContent = stale ? 'Output is from the last successful build. Compile preview to include your latest edits.' : 'Output matches the current source. Preview compilation does not run PHP or apply SQL.';
    outputStatus.classList.toggle('lab-stale', stale);
    outputStatus.hidden = activeView === 'source' || (activeView === 'changes' && target.value === 'Source changes');
    try { await highlighter; } catch { /* Plain text remains usable if the local highlighter fails. */ }
    if (render !== renderSequence) return;
    clearRenderers();
    try {
      if (activeView === 'source') codePanel(sourceSelect.value, draft[sourceSelect.value]);
      else if (activeView === 'changes') {
        const isSource = target.value === 'Source changes';
        const name = isSource ? sourceSelect.value : outputSelect.value;
        const current = isSource ? draft[name] : output[name];
        const original = isSource ? baseline[name] : manifest.output[name];
        if (current === original) preview.append(element('p', 'No changes in this file.', 'lab-help'));
        codePanel(name, current || '', original || '');
      } else {
        codePanel(sourceSelect.value, draft[sourceSelect.value]);
        codePanel(outputSelect.value, output[outputSelect.value] || '');
      }
    } catch (error) {
      clearRenderers();
      preview.append(element('p', `Code rendering failed: ${error instanceof Error ? error.message : String(error)}. Your editable source and downloads are still available.`, 'lab-error'));
    }
  }
  function showDiagnostics(check, extra = []) {
    diagnostics.replaceChildren();
    for (const diagnostic of check.diagnostics || []) {
      const row = element('div', undefined, 'lab-diagnostic');
      const location = diagnostic.location;
      const heading = `${diagnostic.severity || 'error'} ${diagnostic.code || ''}${location ? ` · ${location.file}:${location.line}:${location.column}` : ''}`;
      row.append(element('strong', heading), element('p', diagnostic.message));
      if (diagnostic.help) row.append(element('p', diagnostic.help, 'lab-help'));
      if (location && Object.hasOwn(draft, location.file)) row.append(button('Go to source', () => {
        sourceSelect.value = location.file;
        editorFile();
        editor.focus();
        // The compiler reports UTF-8 offsets; textarea selection uses UTF-16.
        // Locate by its one-based line/column instead of reusing byte offsets.
        const lines = editor.value.split('\n');
        const line = Math.max(0, location.line - 1);
        const start = lines.slice(0, line).reduce((length, text) => length + text.length + 1, 0);
        const prefix = (lines[line] || '').slice(0, Math.max(0, location.column - 1));
        editor.setSelectionRange(start + prefix.length, start + prefix.length);
        updatePreview();
      }));
      diagnostics.append(row);
    }
    for (const note of extra) diagnostics.append(element('p', String(note), 'lab-help'));
  }
  function compileRequest(request) {
    return new Promise((resolve, reject) => {
      if (!worker) worker = new Worker(new URL('./source-compiler-worker.js', import.meta.url), {type: 'module'});
      const currentWorker = worker;
      const id = ++sequence;
      const timer = setTimeout(() => {
        currentWorker.terminate();
        if (worker === currentWorker) worker = undefined;
        cleanup();
        reject(new Error('Compilation exceeded 25 seconds. Your edits are preserved; simplify the source and try again.'));
      }, 25000);
      const cleanup = () => {
        clearTimeout(timer);
        currentWorker.removeEventListener('message', message);
        currentWorker.removeEventListener('error', failure);
      };
      const message = ({data}) => {
        if (data.id !== id) return;
        cleanup();
        if (data.error) {
          currentWorker.terminate();
          if (worker === currentWorker) worker = undefined;
          reject(new Error(data.error));
        } else resolve(data.result);
      };
      const failure = () => {
        cleanup();
        currentWorker.terminate();
        if (worker === currentWorker) worker = undefined;
        reject(new Error('The browser compiler stopped. Your edits are preserved; try compiling again.'));
      };
      currentWorker.addEventListener('message', message);
      currentWorker.addEventListener('error', failure);
      currentWorker.postMessage({id, request});
    });
  }
  async function compileDraft() {
    if (running) return;
    running = true;
    compile.disabled = true;
    reset.disabled = true;
    compile.textContent = 'Compiling…';
    status.textContent = 'Compiling this draft in a local browser worker…';
    const files = {...draft};
    try {
      const result = await compileRequest({
        name: manifest.name,
        files,
        previous: manifest.previous ?? null,
        migrationFiles: Array.isArray(manifest.migrationFiles) ? manifest.migrationFiles : [],
      });
      showDiagnostics(result.check, [...(result.output?.warnings || []), ...(result.output?.hints || [])]);
      if (!result.check.ok || !result.output) {
        status.textContent = sameFiles(files, draft)
          ? 'Compilation refused. Correct the diagnostics below; your edits and last successful output are preserved.'
          : 'Compilation refused for the submitted draft. You made newer edits while compiling; compile again to check them.';
      } else {
        output = {
          'schema.php': result.output.schemaPhp,
          'functions.php': result.output.functionsPhp,
          ...Object.fromEntries(Object.entries(result.output.client).map(([name, contents]) => [`client/${name}`, contents])),
          'zero.gen.ts': result.output.genTs,
          'snapshot.json': `${JSON.stringify(result.output.snapshot, null, 2)}\n`,
          ...Object.fromEntries(result.output.migrations.map(([name, contents]) => [`migrations/${name}`, contents])),
        };
        compiledFiles = files;
        fillSelect(outputSelect, Object.keys(output), outputSelect.value);
        status.textContent = sameFiles(files, draft) ? 'Compiled successfully. Read the generated output or compare its changes.' : 'Compiled successfully. You made newer edits while compiling; the output is marked stale.';
        activeView = 'paired';
      }
      updatePreview();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      updatePreview();
    } finally {
      running = false;
      compile.disabled = false;
      reset.disabled = false;
      compile.textContent = 'Compile preview';
    }
  }
  let scheduled;
  editor.addEventListener('input', () => {
    draft[sourceSelect.value] = editor.value;
    saveDraft();
    status.textContent = 'Draft changed. Compile preview to update the generated output.';
    clearTimeout(scheduled);
    scheduled = setTimeout(updatePreview, 200);
    // Retire the old output claim as soon as the user types.
    outputStatus.textContent = 'Output is from the last successful build. Compile preview to include your latest edits.';
    outputStatus.classList.add('lab-stale');
  });
  sourceSelect.addEventListener('change', () => { editorFile(); updatePreview(); });
  outputSelect.addEventListener('change', updatePreview);
  target.addEventListener('change', updatePreview);
  window.addEventListener('beforeunload', (event) => {
    if (!hasStorage && !sameFiles(draft, baseline)) { event.preventDefault(); event.returnValue = ''; }
  });
  editorFile();
  updatePreview();
}

if (root) start().catch((error) => {
  root.append(element('p', error instanceof Error ? error.message : String(error), 'lab-error'));
});
