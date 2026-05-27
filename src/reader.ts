/// Reader viewport, pagination, search, and jump

const readerEl = document.getElementById('reader')!;
const contentEl = document.getElementById('reader-content')!;
const placeholderEl = document.getElementById('reader-placeholder')!;
const statusPos = document.getElementById('status-position')!;
const statusProg = document.getElementById('status-progress')!;
const statusEnc = document.getElementById('status-encoding')!;

export let currentText = '';
let currentTabId = -1;

export function showPlaceholder(): void {
  placeholderEl.style.display = '';
  contentEl.textContent = '';
  statusPos.textContent = '—';
  statusProg.style.setProperty('--progress', '0%');
  statusEnc.textContent = '';
  currentText = '';
  currentTabId = -1;
}

export function setContent(tabId: number, text: string, position: number, encoding: string, totalChars: number): void {
  placeholderEl.style.display = 'none';
  contentEl.textContent = text;
  contentEl.style.fontSize = `var(--font-size)`;
  contentEl.style.lineHeight = `var(--line-height)`;

  currentText = text;
  currentTabId = tabId;

  // Use double rAF to ensure layout is complete before scrolling
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const ratio = totalChars > 0 ? position / totalChars : 0;
      readerEl.scrollTop = ratio * (readerEl.scrollHeight - readerEl.clientHeight);
      updateStatus(position, totalChars, encoding);
    });
  });
}

export function scrollTo(delta: number): void {
  readerEl.scrollBy({ top: delta, behavior: 'auto' });
}

export function scrollToRatio(ratio: number): void {
  const maxScroll = readerEl.scrollHeight - readerEl.clientHeight;
  readerEl.scrollTop = Math.max(0, ratio * maxScroll);
}

export function getScrollRatio(): number {
  const maxScroll = readerEl.scrollHeight - readerEl.clientHeight;
  if (maxScroll <= 0) return 0;
  return readerEl.scrollTop / maxScroll;
}

// ── Jump to character position using Range API ──────
export function scrollToCharPosition(charPos: number): void {
  const textNode = contentEl.firstChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
    // Fallback: ratio
    const total = currentText.length;
    if (total > 0) scrollToRatio(charPos / total);
    return;
  }

  const clamped = Math.min(charPos, (textNode.textContent || '').length);
  const range = document.createRange();
  range.setStart(textNode, clamped);
  range.collapse(true);

  const rects = range.getClientRects();
  if (rects.length > 0) {
    const rect = rects[0];
    const readerRect = readerEl.getBoundingClientRect();
    readerEl.scrollTop += rect.top - readerRect.top - readerRect.height / 2;
  } else {
    const total = currentText.length;
    if (total > 0) scrollToRatio(clamped / total);
  }
}

// ── Navigation ──────────────────────────────────────
export function pageUp(): void {
  scrollTo(-readerEl.clientHeight * 0.85);
}

export function pageDown(): void {
  scrollTo(readerEl.clientHeight * 0.85);
}

export function lineUp(): void {
  const lineHeight = parseFloat(getComputedStyle(document.body).lineHeight);
  const px = parseFloat(getComputedStyle(document.body).fontSize) * lineHeight;
  scrollTo(-px);
}

export function lineDown(): void {
  const lineHeight = parseFloat(getComputedStyle(document.body).lineHeight);
  const px = parseFloat(getComputedStyle(document.body).fontSize) * lineHeight;
  scrollTo(px);
}

export function goHome(): void {
  readerEl.scrollTop = 0;
}

export function goEnd(): void {
  readerEl.scrollTop = readerEl.scrollHeight;
}

export function getCurrentPosition(totalChars: number): number {
  return Math.round(getScrollRatio() * totalChars);
}

function updateStatus(position: number, total: number, encoding: string): void {
  const pct = total > 0 ? ((position / total) * 100).toFixed(1) : '0.0';
  statusPos.textContent = `${pct}%`;
  statusProg.style.setProperty('--progress', `${pct}%`);
  statusEnc.textContent = encoding.toUpperCase();
}

export function updateStatusFromScroll(totalChars: number): void {
  if (totalChars <= 0) return;
  const pos = getCurrentPosition(totalChars);
  const pct = ((pos / totalChars) * 100).toFixed(1);
  statusPos.textContent = `${pct}%`;
  statusProg.style.setProperty('--progress', `${pct}%`);
}

// ── Font / line-height ──────────────────────────────
export function setFontSize(size: number): void {
  document.documentElement.style.setProperty('--font-size', `${size}px`);
}

export function adjustFontSize(delta: number): number {
  const current = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--font-size'));
  const next = Math.max(10, Math.min(28, current + delta));
  document.documentElement.style.setProperty('--font-size', `${next}px`);
  return next;
}

export function setLineHeight(lh: number): void {
  document.documentElement.style.setProperty('--line-height', String(lh));
}

export function getReaderElement(): HTMLElement {
  return readerEl;
}

export function getContentElement(): HTMLElement {
  return contentEl;
}

// ── Search ──────────────────────────────────────────
interface SearchMatch { start: number; end: number }
let searchMatches: SearchMatch[] = [];
let activeMatchIndex = -1;

export function searchInContent(query: string): void {
  searchMatches = [];
  activeMatchIndex = -1;

  if (!query || !currentText) {
    // Clear any existing highlights
    if (contentEl.querySelector('.search-highlight')) {
      contentEl.textContent = currentText;
    }
    updateSearchCount();
    return;
  }

  // Reset to plain text before building new highlights
  contentEl.textContent = currentText;

  const lowerText = currentText.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let idx = 0;

  while (idx < lowerText.length) {
    const pos = lowerText.indexOf(lowerQuery, idx);
    if (pos === -1) break;
    searchMatches.push({ start: pos, end: pos + query.length });
    idx = pos + 1;
  }

  highlightMatches();
  if (searchMatches.length > 0) {
    activeMatchIndex = 0;
    updateSearchCount();
    requestAnimationFrame(() => scrollToActiveHighlight());
  }
}

export function navigateSearch(direction: 1 | -1): void {
  if (searchMatches.length === 0) return;
  activeMatchIndex = (activeMatchIndex + direction + searchMatches.length) % searchMatches.length;
  updateSearchCount();
  highlightMatches();
  requestAnimationFrame(() => scrollToActiveHighlight());
}

export function clearSearch(): void {
  clearHighlights();
  searchMatches = [];
  activeMatchIndex = -1;
}

function highlightMatches(): void {
  if (searchMatches.length === 0) return;

  const text = contentEl.textContent || currentText;
  let html = '';
  let lastEnd = 0;

  for (let i = 0; i < searchMatches.length; i++) {
    const m = searchMatches[i];
    html += escHtml(text.slice(lastEnd, m.start));
    const cls = i === activeMatchIndex ? 'search-highlight active' : 'search-highlight';
    html += `<span class="${cls}" data-search-idx="${i}">${escHtml(text.slice(m.start, m.end))}</span>`;
    lastEnd = m.end;
  }
  html += escHtml(text.slice(lastEnd));
  contentEl.innerHTML = html;
}

function clearHighlights(): void {
  if (contentEl.querySelector('.search-highlight')) {
    contentEl.textContent = currentText;
  }
}

function scrollToActiveHighlight(): void {
  const active = contentEl.querySelector<HTMLElement>('.search-highlight.active');
  if (active) {
    active.scrollIntoView({ block: 'center', behavior: 'auto' });
  }
}

function updateSearchCount(): void {
  const el = document.getElementById('search-count');
  if (el) {
    el.textContent = searchMatches.length > 0
      ? `${activeMatchIndex + 1}/${searchMatches.length}`
      : '0/0';
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
