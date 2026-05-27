/// Tab management types and logic

export interface TabInfo {
  id: number;
  filePath: string;
  fileName: string;
  position: number;
  encoding: string;
  totalChars: number;
  dirty: boolean;
}

let tabIdCounter = 0;
const tabs: TabInfo[] = [];
let activeTabId = -1;

export function getTabs(): TabInfo[] {
  return tabs;
}

export function getActiveTab(): TabInfo | undefined {
  return tabs.find(t => t.id === activeTabId);
}

export function createTab(filePath: string, fileName: string, encoding: string): TabInfo {
  const tab: TabInfo = {
    id: ++tabIdCounter,
    filePath,
    fileName,
    position: 0,
    encoding,
    totalChars: 0,
    dirty: false,
  };
  tabs.push(tab);
  return tab;
}

export function removeTab(tabId: number): TabInfo | undefined {
  const idx = tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return undefined;
  const removed = tabs.splice(idx, 1)[0];

  if (activeTabId === tabId) {
    if (tabs.length > 0) {
      activeTabId = tabs[Math.min(idx, tabs.length - 1)].id;
    } else {
      activeTabId = -1;
    }
  }
  return removed;
}

export function setActiveTab(tabId: number): void {
  activeTabId = tabId;
}

export function getActiveTabId(): number {
  return activeTabId;
}

export function updateTabPosition(tabId: number, position: number): void {
  const tab = tabs.find(t => t.id === tabId);
  if (tab) {
    tab.position = position;
    tab.dirty = true;
  }
}

export function updateTabTotalChars(tabId: number, total: number): void {
  const tab = tabs.find(t => t.id === tabId);
  if (tab) tab.totalChars = total;
}

export function findTabByPath(filePath: string): TabInfo | undefined {
  return tabs.find(t => t.filePath === filePath);
}

export function getOpenFilePaths(): string[] {
  return tabs.map(t => t.filePath);
}

export function activeIndex(): number {
  return tabs.findIndex(t => t.id === activeTabId);
}

// Serialize tab state for persistence
export interface TabStateData {
  open_files: string[];
  active_index: number;
}

export function exportTabState(): TabStateData {
  return {
    open_files: tabs.map(t => t.filePath),
    active_index: activeIndex(),
  };
}

export function importTabState(data: TabStateData): void {
  // Tabs are created via openFile(), this just tracks the index
  // The actual restoration happens in app.ts startup logic
}
