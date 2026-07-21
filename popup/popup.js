const enabledToggle = document.getElementById('enabledToggle');
const whitelistBtn = document.getElementById('whitelistBtn');
const pickerBtn = document.getElementById('pickerBtn');
const unlockBtn = document.getElementById('unlockBtn');
const unlockAlways = document.getElementById('unlockAlways');
const blockedCount = document.getElementById('blockedCount');
const hostLabel = document.getElementById('hostLabel');
const statusDot = document.getElementById('statusDot');
const optionsLink = document.getElementById('optionsLink');

let currentTab = null;
let currentHost = '';

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

optionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

refresh();
