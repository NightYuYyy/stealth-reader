/// Main application entry point
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { register } from '@tauri-apps/plugin-global-shortcut';

import * as Tabs from './tabs';
import * as Reader from './reader';
import * as Settings from './settings';

// ── State ──────────────────────────────────────────
interface ReaderSettings {
  font_size: number;
  line_height: number;
  theme: string;
}

interface AppState {
  window: {
    x: number; y: number; width: number; height: number;
    always_on_top: boolean;
    disguise_mode: boolean;
  };
  reader: ReaderSettings;
  recent_files: string[];
  books: Record<string, { position: number; encoding: string; last_opened: string }>;
  tabs: { open_files: string[]; active_index: number };
}

let appState: AppState | null = null;
let currentEncoding = 'auto';

// ── Initialization ─────────────────────────────────
async function init(): Promise<void> {
  // Load persisted state
  try {
    appState = await invoke<AppState>('get_full_state');
  } catch {
    // First run, use defaults
    appState = null;
  }

  const settings = appState?.reader ?? { font_size: 14, line_height: 1.8, theme: 'dark' };

  // Apply reader settings
  Reader.setFontSize(settings.font_size);
  Reader.setLineHeight(settings.line_height);

  // Restore disguise mode
  if (appState?.window?.disguise_mode) {
    document.body.classList.add('disguise');
    updateTitlebar('备忘录');
  }

  // Init settings panel
  Settings.initSettings(() => {
    saveReaderSettings();
  });

  // Restore tabs
  if (appState?.tabs?.open_files?.length) {
    for (const filePath of appState.tabs.open_files) {
      await openFileInTab(filePath, false);
    }
    const activeIdx = appState.tabs.active_index ?? 0;
    const allTabs = Tabs.getTabs();
    if (activeIdx < allTabs.length) {
      switchToTab(allTabs[activeIdx].id);
    }
  }

  // Window events
  const win = getCurrentWindow();

  // Save state before close
  win.onCloseRequested(async () => {
    await saveAllState();
  });

  // Register global shortcut Ctrl+Shift+H
  try {
    await register('Ctrl+Shift+H', (event) => {
      if (event.state === 'Pressed') {
        toggleVisibility();
      }
    });
  } catch (e) {
    console.warn('Failed to register global shortcut:', e);
  }

  // Bind keyboard shortcuts
  document.addEventListener('keydown', handleKeyDown);

  // Bind wheel for font size (Ctrl+Wheel)
  document.addEventListener('wheel', handleWheel, { passive: false });

  // Bind reader click navigation
  const readerEl = Reader.getReaderElement();
  readerEl.addEventListener('click', handleReaderClick);

  // Bind reader scroll for position tracking
  readerEl.addEventListener('scroll', handleReaderScroll);

  // Bind titlebar buttons
  document.getElementById('btn-minimize')?.addEventListener('click', () => {
    getCurrentWindow().minimize();
  });
  document.getElementById('btn-close')?.addEventListener('click', () => {
    getCurrentWindow().close();
  });
  document.getElementById('btn-new-tab')?.addEventListener('click', () => openFileDialog());

  // Bind drag-and-drop
  setupFileDrop();

  // Bind tab context menu
  setupTabContextMenu();

  // Search bar
  setupSearchBar();

  // Jump dialog
  setupJumpDialog();

  // Chapter panel
  setupChapterPanel();
}

// ── File Operations ────────────────────────────────
async function openFileDialog(): Promise<void> {
  try {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Text Files', extensions: ['txt'] }],
    });
    if (selected) {
      await openFileInTab(selected as string, true);
    }
  } catch (e) {
    console.error('File dialog error:', e);
  }
}

async function openFileInTab(filePath: string, switchTo: boolean): Promise<void> {
  // Check if already open
  const existing = Tabs.findTabByPath(filePath);
  if (existing) {
    if (switchTo) switchToTab(existing.id);
    return;
  }

  // Determine encoding from saved state
  const savedEncoding = appState?.books?.[filePath]?.encoding ?? 'auto';

  // Read file via Rust backend
  let text: string;
  try {
    text = await invoke<string>('read_file', {
      path: filePath,
      encodingHint: savedEncoding === 'auto' ? null : savedEncoding,
    });
  } catch (e) {
    console.error('Read file error:', e);
    return;
  }

  // Get file name
  const fileName = filePath.replace(/^.*[\\/]/, '').replace(/\.txt$/i, '');

  // Create tab
  const tab = Tabs.createTab(filePath, fileName, savedEncoding);
  Tabs.updateTabTotalChars(tab.id, text.length);

  // Restore position from saved state
  const savedPos = appState?.books?.[filePath]?.position ?? 0;
  tab.position = savedPos;

  // Render tab into bar
  renderTabBar();

  if (switchTo) {
    switchToTab(tab.id);
  }

  // If this is the first tab or switch requested, show content
  if (switchTo || Tabs.getTabs().length === 1) {
    Reader.setContent(tab.id, text, savedPos, savedEncoding, text.length);
  }
}

// ── Tab Management ──────────────────────────────────
function switchToTab(tabId: number): void {
  const prevTab = Tabs.getActiveTab();
  if (prevTab) {
    // Save current position
    const totalChars = prevTab.totalChars;
    prevTab.position = Reader.getCurrentPosition(totalChars);
  }
  // Persist after tab switch
  saveAllState();

  Tabs.setActiveTab(tabId);
  renderTabBar();

  const tab = Tabs.getActiveTab();
  if (!tab) {
    Reader.showPlaceholder();
    return;
  }

  // If content not loaded, load it
  if (!tab.totalChars) {
    loadTabContent(tab);
  } else {
    // Need to reload content
    loadTabContent(tab);
  }
}

async function loadTabContent(tab: Tabs.TabInfo): Promise<void> {
  try {
    const text = await invoke<string>('read_file', {
      path: tab.filePath,
      encodingHint: tab.encoding === 'auto' ? null : tab.encoding,
    });
    Tabs.updateTabTotalChars(tab.id, text.length);
    Reader.setContent(tab.id, text, tab.position, tab.encoding, text.length);
    currentEncoding = tab.encoding;
  } catch (e) {
    console.error('Load tab content error:', e);
  }
}

function closeTab(tabId: number): void {
  Tabs.removeTab(tabId);
  renderTabBar();

  const active = Tabs.getActiveTab();
  if (!active) {
    Reader.showPlaceholder();
  } else {
    switchToTab(active.id);
  }
}

function renderTabBar(): void {
  const container = document.getElementById('tabs')!;
  container.innerHTML = '';

  const tabs = Tabs.getTabs();
  const activeId = Tabs.getActiveTabId();

  for (const tab of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeId ? ' active' : '');
    el.dataset.tabId = String(tab.id);

    const label = document.createElement('span');
    label.textContent = tab.fileName;
    label.title = tab.filePath;
    el.appendChild(label);

    const close = document.createElement('span');
    close.className = 'tab-close';
    close.textContent = '×';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    el.appendChild(close);

    el.addEventListener('click', () => switchToTab(tab.id));
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(tab.id);
      }
    });

    container.appendChild(el);
  }
}

// ── Keyboard Shortcuts ─────────────────────────────
function handleKeyDown(e: KeyboardEvent): void {
  const ctrl = e.ctrlKey || e.metaKey;

  // Don't handle shortcuts when settings are open
  if (Settings.isSettingsVisible()) {
    if (e.key === 'Escape') Settings.hideSettings();
    return;
  }

  if (ctrl && e.key === 'o') {
    e.preventDefault();
    openFileDialog();
    return;
  }

  if (ctrl && e.key === 'w') {
    e.preventDefault();
    const active = Tabs.getActiveTab();
    if (active) closeTab(active.id);
    return;
  }

  if (ctrl && e.key === 't') {
    e.preventDefault();
    toggleAlwaysOnTop();
    return;
  }

  if (ctrl && e.key === 'b') {
    e.preventDefault();
    toggleDisguiseMode();
    return;
  }

  if (ctrl && e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) switchToPrevTab();
    else switchToNextTab();
    return;
  }

  if (ctrl && e.key === 'f') {
    e.preventDefault();
    toggleSearchBar();
    return;
  }

  if (ctrl && e.key === 'g') {
    e.preventDefault();
    showJumpDialog();
    return;
  }

  if (ctrl && e.key === 'l') {
    e.preventDefault();
    toggleChapterPanel();
    return;
  }

  // Search bar navigation
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  if (e.key === 'Enter' && document.activeElement === searchInput) {
    e.preventDefault();
    if (e.shiftKey) {
      Reader.navigateSearch(-1);
    } else {
      Reader.navigateSearch(1);
    }
    return;
  }
  if (e.key === 'Escape' && document.activeElement === searchInput) {
    e.preventDefault();
    hideSearchBar();
    return;
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    if (document.body.classList.contains('disguise')) {
      toggleDisguiseMode();
    } else {
      getCurrentWindow().minimize();
    }
    return;
  }

  // Reading navigation
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    Reader.lineUp();
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    Reader.lineDown();
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    e.preventDefault();
    Reader.pageUp();
    return;
  }
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
    e.preventDefault();
    Reader.pageDown();
    return;
  }
  if (e.key === 'Home') {
    e.preventDefault();
    Reader.goHome();
    return;
  }
  if (e.key === 'End') {
    e.preventDefault();
    Reader.goEnd();
    return;
  }

  // Font size: Ctrl+/-
  if (ctrl && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    const size = Reader.adjustFontSize(1);
    saveReaderSettings();
    return;
  }
  if (ctrl && e.key === '-') {
    e.preventDefault();
    const size = Reader.adjustFontSize(-1);
    saveReaderSettings();
    return;
  }
}

function handleWheel(e: WheelEvent): void {
  if (e.ctrlKey) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -1 : 1;
    Reader.adjustFontSize(delta);
    saveReaderSettings();
  }
}

function handleReaderClick(e: MouseEvent): void {
  const rect = Reader.getReaderElement().getBoundingClientRect();
  const y = e.clientY - rect.top;
  const mid = rect.height / 2;

  if (y < mid) {
    Reader.pageUp();
  } else {
    Reader.pageDown();
  }
}

function handleReaderScroll(): void {
  const tab = Tabs.getActiveTab();
  if (tab && tab.totalChars > 0) {
    tab.position = Reader.getCurrentPosition(tab.totalChars);
    Reader.updateStatusFromScroll(tab.totalChars);
  }
}

// ── Tab Switching ───────────────────────────────────
function switchToNextTab(): void {
  const tabs = Tabs.getTabs();
  const activeId = Tabs.getActiveTabId();
  const idx = tabs.findIndex(t => t.id === activeId);
  const next = (idx + 1) % tabs.length;
  if (tabs[next]) switchToTab(tabs[next].id);
}

function switchToPrevTab(): void {
  const tabs = Tabs.getTabs();
  const activeId = Tabs.getActiveTabId();
  const idx = tabs.findIndex(t => t.id === activeId);
  const prev = (idx - 1 + tabs.length) % tabs.length;
  if (tabs[prev]) switchToTab(tabs[prev].id);
}

// ── Window Controls ─────────────────────────────────
async function toggleVisibility(): Promise<void> {
  const win = getCurrentWindow();
  const visible = await win.isVisible();
  if (visible) {
    await win.hide();
  } else {
    await win.show();
  }
}

async function toggleAlwaysOnTop(): Promise<void> {
  const win = getCurrentWindow();
  const current = await win.isAlwaysOnTop();
  await win.setAlwaysOnTop(!current);
}

function toggleDisguiseMode(): void {
  document.body.classList.toggle('disguise');
  const inDisguise = document.body.classList.contains('disguise');
  updateTitlebar(inDisguise ? '📝 备忘录' : 'Stealth Reader');

  if (appState) {
    appState.window.disguise_mode = inDisguise;
  }
}

function updateTitlebar(text: string): void {
  const label = document.getElementById('titlebar-label');
  if (label) label.textContent = text;
}

// ── Persistence ─────────────────────────────────────
async function saveAllState(): Promise<void> {
  if (!appState) return;

  // Save all tabs' reading positions
  const allTabs = Tabs.getTabs();
  for (const t of allTabs) {
    if (t.totalChars > 0) {
      // For active tab, get current scroll position; for others, use stored position
      const pos = t.id === Tabs.getActiveTabId()
        ? Reader.getCurrentPosition(t.totalChars)
        : t.position;
      try {
        await invoke('update_book_position', {
          filePath: t.filePath,
          position: pos,
          encoding: t.encoding,
        });
      } catch { /* ignore */ }
    }
  }

  // Save tab state (open files + active index)
  try {
    await invoke('save_tab_state', {
      tabs: Tabs.exportTabState(),
    });
  } catch { /* ignore */ }

  // Persist to disk
  try {
    await invoke('persist_state');
  } catch { /* ignore */ }
}

async function saveReaderSettings(): Promise<void> {
  const vals = Settings.getSettingsValues();
  try {
    await invoke('update_reader_settings', {
      settings: {
        font_size: vals.fontSize,
        line_height: vals.lineHeight,
        theme: 'dark',
      },
    });
  } catch { /* ignore */ }

}
// ── File Drop ───────────────────────────────────────
function setupFileDrop(): void {
  getCurrentWindow().onDragDropEvent((event) => {
    if (event.payload.type === 'drop') {
      for (const path of event.payload.paths) {
        if (path.toLowerCase().endsWith('.txt')) {
          openFileInTab(path, true);
        }
      }
    }
  });
}

// ── Context Menu on Tabs ───────────────────────────
function setupTabContextMenu(): void {
  document.getElementById('tabs')?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    // Minimal: just enable browser-like behavior
    // In a full implementation, we'd show a custom context menu
  });
}


// ── Search Bar ──────────────────────────────────────
let searchDebounce: ReturnType<typeof setTimeout> | null = null;

function setupSearchBar(): void {
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const btnPrev = document.getElementById('btn-search-prev')!;
  const btnNext = document.getElementById('btn-search-next')!;
  const btnClose = document.getElementById('btn-search-close')!;

  searchInput.addEventListener('input', () => {
    const query = searchInput.value;
    if (searchDebounce) clearTimeout(searchDebounce);
    if (query) {
      searchDebounce = setTimeout(() => {
        Reader.searchInContent(query);
      }, 150);
    } else {
      Reader.clearSearch();
      document.getElementById('search-count')!.textContent = '0/0';
    }
  });

  btnPrev.addEventListener('click', () => Reader.navigateSearch(-1));
  btnNext.addEventListener('click', () => Reader.navigateSearch(1));
  btnClose.addEventListener('click', hideSearchBar);
}

function toggleSearchBar(): void {
  const bar = document.getElementById('searchbar')!;
  const input = document.getElementById('search-input') as HTMLInputElement;
  if (bar.classList.contains('hidden')) {
    bar.classList.remove('hidden');
    input.value = '';
    input.focus();
    Reader.clearSearch();
    document.getElementById('search-count')!.textContent = '0/0';
  } else {
    hideSearchBar();
  }
}

function hideSearchBar(): void {
  const bar = document.getElementById('searchbar')!;
  bar.classList.add('hidden');
  Reader.clearSearch();
}

// ── Jump Dialog ─────────────────────────────────────
let chapters: { title: string; position: number }[] = [];

function setupJumpDialog(): void {
  document.getElementById('btn-jump-go')?.addEventListener('click', doJump);
  document.getElementById('btn-jump-cancel')?.addEventListener('click', hideJumpDialog);

  const jumpInput = document.getElementById('jump-input') as HTMLInputElement;
  jumpInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doJump();
    if (e.key === 'Escape') hideJumpDialog();
  });

  document.getElementById('jump-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideJumpDialog();
  });
}

function showJumpDialog(): void {
  document.getElementById('jump-overlay')!.classList.remove('hidden');
  (document.getElementById('jump-input') as HTMLInputElement).value = '';
  (document.getElementById('jump-input') as HTMLInputElement).focus();
}

function hideJumpDialog(): void {
  document.getElementById('jump-overlay')!.classList.add('hidden');
}

function doJump(): void {
  const input = (document.getElementById('jump-input') as HTMLInputElement).value.trim();
  if (!input) { hideJumpDialog(); return; }

  const tab = Tabs.getActiveTab();
  if (!tab || !tab.totalChars) { hideJumpDialog(); return; }

  // Try chapter name match
  const lower = input.toLowerCase();
  for (const ch of chapters) {
    if (ch.title.toLowerCase().includes(lower)) {
      Reader.scrollToCharPosition(ch.position);
      hideJumpDialog();
      return;
    }
  }

  // Try percentage
  const pctMatch = input.match(/^(\d+(?:\.\d+)?)\s*%?$/);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]) / 100;
    Reader.scrollToRatio(Math.max(0, Math.min(1, pct)));
    hideJumpDialog();
    return;
  }

  // Try line number (approximate by average chars per line)
  const lineMatch = input.match(/^(\d+)$/);
  if (lineMatch) {
    const line = parseInt(lineMatch[1]);
    const avgCharsPerLine = 60;
    const pos = Math.min(tab.totalChars, line * avgCharsPerLine);
    Reader.scrollToRatio(pos / tab.totalChars);
    hideJumpDialog();
    return;
  }

  hideJumpDialog();
}

// ── Chapter Panel ───────────────────────────────────
async function loadChapters(): Promise<void> {
  const tab = Tabs.getActiveTab();
  if (!tab) return;

  try {
    const text = await invoke<string>('read_file', {
      path: tab.filePath,
      encodingHint: tab.encoding === 'auto' ? null : tab.encoding,
    });
    chapters = await invoke<{ title: string; position: number }[]>('detect_chapters', { text });
    renderChapterList();
  } catch { /* ignore */ }
}

function setupChapterPanel(): void {
  // Panel is rendered on demand
}

function toggleChapterPanel(): void {
  const panel = document.getElementById('chapter-panel')!;
  if (panel.classList.contains('hidden')) {
    if (chapters.length === 0) {
      loadChapters().then(() => {
        panel.classList.remove('hidden');
      });
    } else {
      panel.classList.remove('hidden');
    }
  } else {
    panel.classList.add('hidden');
  }
}

function renderChapterList(): void {
  const list = document.getElementById('chapter-list')!;
  list.innerHTML = '';

  const tab = Tabs.getActiveTab();
  if (!tab) return;

  const currentPos = tab.position || 0;
  let currentIdx = -1;

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const item = document.createElement('div');
    item.className = 'chapter-item';
    item.textContent = ch.title;
    item.title = ch.title;

    // Highlight current chapter
    if (ch.position <= currentPos) {
      currentIdx = i;
    }

    item.addEventListener('click', () => {
      Reader.scrollToCharPosition(ch.position);
    });
    list.appendChild(item);
  }

  // Mark current chapter
  if (currentIdx >= 0 && list.children[currentIdx]) {
    list.children[currentIdx].classList.add('current');
  }
}
// ── Start ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  init();
});
