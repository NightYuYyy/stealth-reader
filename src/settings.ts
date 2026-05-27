/// Settings panel management

const overlay = document.getElementById('settings-overlay')!;
const fontSizeSlider = document.getElementById('set-font-size') as HTMLInputElement;
const lineHeightSlider = document.getElementById('set-line-height') as HTMLInputElement;
const encodingSelect = document.getElementById('set-encoding') as HTMLSelectElement;
const closeBtn = document.getElementById('btn-close-settings')!;

let onSettingsChanged: (() => void) | null = null;

export function initSettings(onChanged: () => void): void {
  onSettingsChanged = onChanged;

  fontSizeSlider.addEventListener('input', () => {
    const val = parseInt(fontSizeSlider.value);
    document.documentElement.style.setProperty('--font-size', `${val}px`);
    if (onSettingsChanged) onSettingsChanged();
  });

  lineHeightSlider.addEventListener('input', () => {
    const val = parseFloat(lineHeightSlider.value);
    document.documentElement.style.setProperty('--line-height', String(val));
    if (onSettingsChanged) onSettingsChanged();
  });

  closeBtn.addEventListener('click', hideSettings);

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hideSettings();
  });
}

export function showSettings(fontSize: number, lineHeight: number, encoding: string): void {
  fontSizeSlider.value = String(fontSize);
  lineHeightSlider.value = String(lineHeight);
  encodingSelect.value = encoding;
  overlay.classList.remove('hidden');
}

export function hideSettings(): void {
  overlay.classList.add('hidden');
}

export function getSettingsValues(): { fontSize: number; lineHeight: number; encoding: string } {
  return {
    fontSize: parseInt(fontSizeSlider.value),
    lineHeight: parseFloat(lineHeightSlider.value),
    encoding: encodingSelect.value,
  };
}

export function isSettingsVisible(): boolean {
  return !overlay.classList.contains('hidden');
}
