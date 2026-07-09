import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');

function indexOfCode(snippet) {
  const index = source.indexOf(snippet);
  assert.notEqual(index, -1, `Missing expected startup code: ${snippet}`);
  return index;
}

test('startup binds add-book controls before non-critical async work', () => {
  const addBookBinding = indexOfCode("document.getElementById('btn-new-tab')?.addEventListener");
  const tabRestore = indexOfCode('await openFileInTab(filePath, false)');
  const globalShortcut = indexOfCode("await register('Ctrl+Shift+H'");

  assert.ok(
    addBookBinding < tabRestore,
    'Add-book click handler must be bound before restoring persisted tabs so stale or huge books cannot block adding a new book.'
  );
  assert.ok(
    addBookBinding < globalShortcut,
    'Add-book click handler must be bound before global shortcut registration so shortcut failures cannot block adding a new book.'
  );
});
