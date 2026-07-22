const enabledToggle = document.getElementById('enabledToggle');
const whitelistBtn = document.getElementById('whitelistBtn');
const pickerBtn = document.getElementById('pickerBtn');
const unlockBtn = document.getElementById('unlockBtn');
const unlockAlways = document.getElementById('unlockAlways');
const blockedCount = document.getElementById('blockedCount');
const hostLabel = document.getElementById('hostLabel');
const statusDot = document.getElementById('statusDot');
const optionsLink = document.getElementById('optionsLink');
const diagToggle = document.getElementById('diagToggle');
const diagArrow = document.getElementById('diagArrow');
const diagPanel = document.getElementById('diagPanel');

let currentTab = null;
let currentHost = '';
let diagLoaded = false;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function render(state) {
  enabledToggle.checked = state.enabled;
  statusDot.classList.toggle('off', !state.enabled);
  blockedCount.textContent = state.blocked ?? 0;
  currentHost = state.host || '';
  hostLabel.textContent = currentHost ? currentHost : '';

  if (state.whitelisted) {
    whitelistBtn.textContent = 'Blokker annonser på denne siden';
    whitelistBtn.classList.add('active');
  } else {
    whitelistBtn.textContent = 'Tillat annonser på denne siden';
    whitelistBtn.classList.remove('active');
  }
  whitelistBtn.disabled = !currentHost || !state.enabled;

  const url = currentTab?.url || '';
  const isHttp = url.startsWith('http://') || url.startsWith('https://');
  pickerBtn.disabled = !isHttp;
  unlockBtn.disabled = !isHttp;

  unlockAlways.checked = !!state.unlockThisSite;
  unlockAlways.disabled = !currentHost;
}

async function refresh() {
  currentTab = await getActiveTab();
  const state = await chrome.runtime.sendMessage({
    type: 'getPopupState',
    tabId: currentTab?.id,
  });
  render(state);
}

enabledToggle.addEventListener('change', async () => {
  await chrome.runtime.sendMessage({ type: 'setEnabled', value: enabledToggle.checked });
  if (currentTab?.id) chrome.tabs.reload(currentTab.id);
  refresh();
});

whitelistBtn.addEventListener('click', async () => {
  if (!currentHost) return;
  await chrome.runtime.sendMessage({ type: 'toggleWhitelist', host: currentHost });
  if (currentTab?.id) chrome.tabs.reload(currentTab.id);
  refresh();
});

pickerBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.runtime.sendMessage({ type: 'startPicker', tabId: tab.id });
  window.close();
});

unlockBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const res = await chrome.runtime.sendMessage({ type: 'runUnlock', tabId: tab.id });
  unlockBtn.disabled = true;
  unlockBtn.textContent = res && res.ok && res.removed > 0 ? 'Låst opp ✓' : 'Fant ingen vegg';
  setTimeout(() => {
    unlockBtn.textContent = 'Lås opp artikkel';
    const url = currentTab?.url || '';
    unlockBtn.disabled = !(url.startsWith('http://') || url.startsWith('https://'));
  }, 2000);
});

unlockAlways.addEventListener('change', async () => {
  if (!currentHost) return;
  await chrome.runtime.sendMessage({ type: 'toggleUnlockSite', host: currentHost });
});

function diagRow(label, value) {
  const row = document.createElement('div');
  row.className = 'diag-row';
  const l = document.createElement('span');
  l.className = 'diag-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'diag-value';
  v.textContent = value;
  row.append(l, v);
  return row;
}

function diagSub(label, value) {
  const row = document.createElement('div');
  row.className = 'diag-sub';
  const l = document.createElement('span');
  l.textContent = label;
  const v = document.createElement('span');
  v.textContent = value;
  row.append(l, v);
  return row;
}

function diagText(text, className) {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

function renderDiagnostics(d) {
  diagPanel.textContent = '';

  if (!d) {
    diagPanel.append(diagText('Diagnostikk utilgjengelig', 'hint'));
    return;
  }

  const blocked = d.blocked || {};
  const cosmetic = d.cosmetic || {};
  const unlock = d.unlock || {};
  const missing = (d.rulesets && d.rulesets.missing) || [];

  if (missing.length > 0) {
    diagPanel.append(
      diagText(
        `Chrome har deaktivert filtersett: ${missing.join(', ')}. Blokkeringen er svekket.`,
        'diag-warn'
      )
    );
  }

  diagPanel.append(diagRow('Blokkerte forespørsler', String(blocked.total ?? 0)));
  const parts = [
    ['Annonser', blocked.ads],
    ['Sporing', blocked.privacy],
    ['Irritasjoner', blocked.annoyances],
  ];
  for (const [label, value] of parts) {
    if (value) diagPanel.append(diagSub(label, String(value)));
  }

  const specific = cosmetic.specific ?? 0;
  const user = cosmetic.user ?? 0;
  const cosmeticText = user > 0 ? `${specific} regler (+${user} egne)` : `${specific} regler`;
  diagPanel.append(diagRow('Skjulte elementer', cosmeticText));
  if (cosmetic.generic === false) {
    diagPanel.append(diagSub('generiske regler ikke aktive', ''));
  }

  diagPanel.append(
    diagRow('Lås opp artikkel', unlock.ran ? `kjørte, fjernet ${unlock.removed ?? 0}` : 'ikke utløst')
  );

  if (d.precise === false) {
    diagPanel.append(diagText('Tallene er omtrentlige i pakket modus.', 'hint'));
  }
}

async function loadDiagnostics() {
  diagPanel.textContent = '';
  diagPanel.append(diagText('Laster…', 'hint'));
  try {
    const tab = currentTab || (await getActiveTab());
    const d = await chrome.runtime.sendMessage({ type: 'getDiagnostics', tabId: tab?.id });
    renderDiagnostics(d);
    diagLoaded = !!d;
  } catch (e) {
    renderDiagnostics(null);
  }
}

diagToggle.addEventListener('click', () => {
  const open = diagPanel.hidden;
  diagPanel.hidden = !open;
  diagArrow.textContent = open ? '▴' : '▾';
  if (open && !diagLoaded) loadDiagnostics();
});

optionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

refresh();
