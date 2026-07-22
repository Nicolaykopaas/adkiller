const whitelistEl = document.getElementById('whitelist');
const emptyWl = document.getElementById('emptyWl');
const updateCosmeticBtn = document.getElementById('updateCosmeticBtn');
const cosmeticStatus = document.getElementById('cosmeticStatus');
const userRulesEl = document.getElementById('userRules');
const emptyUserRules = document.getElementById('emptyUserRules');
const readerAuto = document.getElementById('readerAuto');
const clearWhitelistBtn = document.getElementById('clearWhitelist');
const unlockSitesEl = document.getElementById('unlockSites');
const emptyUnlock = document.getElementById('emptyUnlock');

function formatDate(ts) {
  if (!ts) return null;
  return new Date(ts).toLocaleString('no-NO');
}

async function load() {
  const state = await chrome.runtime.sendMessage({ type: 'getOptions' });

  for (const box of document.querySelectorAll('input[data-ruleset]')) {
    const id = box.dataset.ruleset;
    box.checked = state.rulesets[id] !== false;
    box.disabled = !state.enabled;
  }

  renderWhitelist(state.whitelist);

  readerAuto.checked = !!state.readerAuto;
  renderUnlockSites(state.unlockSites || []);
}

function renderUnlockSites(list) {
  unlockSitesEl.innerHTML = '';
  if (!list.length) {
    emptyUnlock.style.display = 'block';
    return;
  }
  emptyUnlock.style.display = 'none';
  for (const host of list) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = host;
    const btn = document.createElement('button');
    btn.textContent = 'Fjern';
    btn.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'removeUnlockSite', host });
      load();
    });
    li.append(span, btn);
    unlockSitesEl.appendChild(li);
  }
}

function renderWhitelist(list) {
  whitelistEl.innerHTML = '';
  if (!list.length) {
    emptyWl.style.display = 'block';
    return;
  }
  emptyWl.style.display = 'none';
  for (const host of list) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = host;
    const btn = document.createElement('button');
    btn.textContent = 'Fjern';
    btn.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'removeWhitelist', host });
      load();
    });
    li.append(span, btn);
    whitelistEl.appendChild(li);
  }
}

async function loadCosmeticInfo() {
  const info = await chrome.runtime.sendMessage({ type: 'getCosmeticInfo' });
  const when = formatDate(info?.updated);
  cosmeticStatus.textContent = when ? `Sist oppdatert: ${when}` : 'Aldri oppdatert.';
}

updateCosmeticBtn.addEventListener('click', async () => {
  updateCosmeticBtn.disabled = true;
  updateCosmeticBtn.textContent = 'Oppdaterer …';
  const res = await chrome.runtime.sendMessage({ type: 'updateCosmeticNow' });
  if (res && res.ok) {
    cosmeticStatus.textContent = `Oppdatert: ${formatDate(res.updated)}`;
  } else {
    cosmeticStatus.textContent = `Feil: ${res?.error || 'ukjent feil'}`;
  }
  updateCosmeticBtn.textContent = 'Oppdater nå';
  updateCosmeticBtn.disabled = false;
});

async function loadUserRules() {
  const res = await chrome.runtime.sendMessage({ type: 'getUserRules' });
  renderUserRules(res?.userRules || {});
}

function renderUserRules(rules) {
  userRulesEl.innerHTML = '';
  const hosts = Object.keys(rules);
  if (!hosts.length) {
    emptyUserRules.style.display = 'block';
    return;
  }
  emptyUserRules.style.display = 'none';
  for (const host of hosts) {
    const heading = document.createElement('h3');
    heading.className = 'rule-host';
    heading.textContent = host;
    userRulesEl.appendChild(heading);

    const ul = document.createElement('ul');
    ul.className = 'whitelist';
    for (const selector of rules[host]) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = selector;
      const btn = document.createElement('button');
      btn.textContent = 'Fjern';
      btn.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ type: 'removeUserRule', host, selector });
        loadUserRules();
      });
      li.append(span, btn);
      ul.appendChild(li);
    }
    userRulesEl.appendChild(ul);
  }
}

clearWhitelistBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'clearWhitelist' });
  await load();
});

readerAuto.addEventListener('change', async () => {
  await chrome.runtime.sendMessage({ type: 'setReaderAuto', value: readerAuto.checked });
});

document.querySelectorAll('input[data-ruleset]').forEach((box) => {
  box.addEventListener('change', async () => {
    await chrome.runtime.sendMessage({
      type: 'setRuleset',
      id: box.dataset.ruleset,
      value: box.checked,
    });
  });
});

load();
loadCosmeticInfo();
loadUserRules();
