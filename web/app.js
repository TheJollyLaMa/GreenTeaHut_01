// --- About modal ---
// Must be a Google Slides "Publish to web" embed URL (not edit URL).
const ABOUT_SLIDES_EMBED_URL =
  'https://docs.google.com/presentation/d/e/2PACX-1vTraXc7uqbvK62XYUSvtLul29KxMW3zTluA_wCIhTNML52gSJgnkFy04m7tiECySan_rU-qwvwd8HqT/pubembed?start=true&loop=true&delayms=5000';

const aboutModal = document.getElementById('about-modal');
const aboutTrigger = document.getElementById('about-trigger');
const modalClose = aboutModal && aboutModal.querySelector('.modal-close');
const aboutSlidesEmbed = document.getElementById('about-slides-embed');
const aboutSlidesLink = document.getElementById('about-slides-link');

function getPublishedSlidesOpenUrl(embedUrl) {
  try {
    const parsed = new URL(embedUrl);
    const pathSegments = parsed.pathname.split('/');
    if (pathSegments[pathSegments.length - 1] === 'embed') {
      pathSegments[pathSegments.length - 1] = 'pub';
      parsed.pathname = pathSegments.join('/');
    }
    return parsed.toString();
  } catch (error) {
    console.warn(
      'Failed to parse ABOUT_SLIDES_EMBED_URL as a valid URL; using embed URL for fallback link.',
      error,
    );
    return embedUrl;
  }
}

if (aboutSlidesEmbed) {
  aboutSlidesEmbed.src = ABOUT_SLIDES_EMBED_URL;
}

if (aboutSlidesLink) {
  aboutSlidesLink.href = getPublishedSlidesOpenUrl(ABOUT_SLIDES_EMBED_URL);
}

if (aboutModal && aboutTrigger && modalClose) {
  function openAboutModal() {
    aboutModal.hidden = false;
    modalClose.focus();
  }

  function closeAboutModal() {
    aboutModal.hidden = true;
    aboutTrigger.focus();
  }

  aboutTrigger.addEventListener('click', openAboutModal);
  aboutTrigger.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openAboutModal();
    }
  });

  modalClose.addEventListener('click', closeAboutModal);

  aboutModal.addEventListener('click', (e) => {
    if (e.target === aboutModal) closeAboutModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !aboutModal.hidden) closeAboutModal();
  });
}

// --- Ledger (on-chain) ---
const LEDGER_CONFIG = {
  contractAddress: '0x942CcE8384a9d9bd2842365395d7a912e1a5322c',
  targetChainId: 11155111,
  targetChainName: 'Sepolia',
  explorerBaseUrl: 'https://sepolia.etherscan.io/tx/',
  rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
  adminAllowlist: ['0x807061DF657A7697c04045dA7d16D941861cAABc'],
};

const PROJECT_LEDGER_ABI = [
  'function owner() view returns (address)',
  'function totalEntries() view returns (uint256)',
  'function getEntry(uint256 entryId) view returns (tuple(uint256 id,uint256 amount,uint8 entryType,uint8 status,string category,string description,string referenceURI,uint256 createdAt,uint256 settledAt))',
  'function createEntry(uint8 entryType,uint256 amount,string category,string description,string referenceURI) returns (uint256)',
  'function confirmEntry(uint256 entryId,string referenceURI)',
  'function updateReferenceURI(uint256 entryId,string referenceURI)',
];

const STATUS_PENDING = 'PENDING';
const STATUS_SETTLED = 'SETTLED';

const ledgerBody = document.getElementById('ledger-body');
const totalRaisedEl = document.getElementById('total-raised');
const totalSpentEl = document.getElementById('total-spent');
const balanceEl = document.getElementById('balance');
const pendingRaisedEl = document.getElementById('pending-raised');
const pendingSpentEl = document.getElementById('pending-spent');
const requestSpentEl = document.getElementById('request-spent');
const pendingBalanceEl = document.getElementById('pending-balance');
const typeFilterEl = document.getElementById('type-filter');
const statusFilterEl = document.getElementById('status-filter');
const searchFilterEl = document.getElementById('search-filter');
const entryFormEl = document.getElementById('entry-form');
const entryTypeEl = document.getElementById('entry-type');
const entryAmountEl = document.getElementById('entry-amount');
const entryCategoryEl = document.getElementById('entry-category');
const entryDescriptionEl = document.getElementById('entry-description');
const entryProofEl = document.getElementById('entry-proof');
const walletButtonEl = document.querySelector('.wallet-button');
const walletStatusEl = document.getElementById('wallet-status');
const txStatusEl = document.getElementById('tx-status');

const fieldErrorNames = ['type', 'amount', 'category', 'description', 'reference'];

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

let entries = [];
let currentAccount = '';
let connectedChainId = null;
let isAdminWallet = false;

function formatAmount(value) {
  return currency.format(Number(value) || 0);
}

function formatDateTime(unixSeconds) {
  if (!unixSeconds) return '—';
  const date = new Date(Number(unixSeconds) * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function getSafeProofUrl(url) {
  return isValidUrl(url) ? new URL(url).toString() : '#';
}

function toNumeric(value) {
  if (typeof value === 'bigint') {
    const safe = BigInt(Number.MAX_SAFE_INTEGER);
    if (value <= safe) return Number(value);
    return Number(value.toString());
  }
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : 0;
}

function shortAddress(address) {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function txLink(txHash) {
  return `${LEDGER_CONFIG.explorerBaseUrl}${txHash}`;
}

function setTxStatus(message, type = 'info', hash = '') {
  if (!txStatusEl) return;
  txStatusEl.className = `tx-status ${type}`;
  if (hash) {
    const url = txLink(hash);
    txStatusEl.innerHTML = `${message} <a href="${url}" target="_blank" rel="noopener noreferrer">View transaction</a>`;
    return;
  }
  txStatusEl.textContent = message;
}

function setWalletStatus(message, isError = false) {
  if (!walletStatusEl) return;
  walletStatusEl.textContent = message;
  walletStatusEl.style.color = isError ? '#b91c1c' : '#475569';
}

function setFieldError(fieldName, message) {
  const errorEl = document.getElementById(`entry-${fieldName}-error`);
  if (errorEl) errorEl.textContent = message;
}

function clearFieldErrors() {
  fieldErrorNames.forEach((fieldName) => setFieldError(fieldName, ''));
}

function setFormEnabled(enabled) {
  if (!entryFormEl) return;
  Array.from(entryFormEl.elements).forEach((element) => {
    element.disabled = !enabled;
  });
}

function normalizeEntry(entry) {
  const status = Number(entry.status) === 1 ? STATUS_SETTLED : STATUS_PENDING;
  const type = Number(entry.entryType) === 1 ? 'OUTGOING' : 'INCOMING';
  return {
    id: toNumeric(entry.id),
    createdAt: toNumeric(entry.createdAt),
    settledAt: toNumeric(entry.settledAt),
    type,
    status,
    amount: toNumeric(entry.amount),
    category: entry.category || '',
    description: entry.description || '',
    reference: entry.referenceURI || '',
  };
}

function updateSummaryDisplay(summary) {
  totalRaisedEl.textContent = summary.totalRaised;
  totalSpentEl.textContent = summary.totalSpent;
  balanceEl.textContent = summary.balance;
  if (pendingRaisedEl) pendingRaisedEl.textContent = summary.pendingRaised;
  if (pendingSpentEl) pendingSpentEl.textContent = summary.pendingSpent;
  if (requestSpentEl) requestSpentEl.textContent = '';
  if (pendingBalanceEl) pendingBalanceEl.textContent = summary.pendingBalance;
}

function calculateSummary(allEntries) {
  const settledRaised = allEntries
    .filter((e) => e.type === 'INCOMING' && e.status === STATUS_SETTLED)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const pendingRaised = allEntries
    .filter((e) => e.type === 'INCOMING' && e.status === STATUS_PENDING)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const settledSpent = allEntries
    .filter((e) => e.type === 'OUTGOING' && e.status === STATUS_SETTLED)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const pendingSpent = allEntries
    .filter((e) => e.type === 'OUTGOING' && e.status === STATUS_PENDING)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const balance = settledRaised - settledSpent;
  const projectedRaised = settledRaised + pendingRaised;
  const projectedSpent = settledSpent + pendingSpent;
  const projectedBalance = projectedRaised - projectedSpent;
  const hasGhostBalance = pendingRaised > 0 || pendingSpent > 0;

  updateSummaryDisplay({
    totalRaised: formatAmount(settledRaised),
    pendingRaised: pendingRaised > 0 ? `(${formatAmount(projectedRaised)})` : '',
    totalSpent: formatAmount(settledSpent),
    pendingSpent: pendingSpent > 0 ? `(${formatAmount(projectedSpent)})` : '',
    balance: formatAmount(balance),
    pendingBalance: hasGhostBalance ? `(${formatAmount(projectedBalance)})` : '',
  });
}

function getFilteredEntries() {
  const selectedType = typeFilterEl.value;
  const selectedStatus = statusFilterEl.value;
  const textQuery = searchFilterEl.value.trim().toLowerCase();

  return entries.filter((entry) => {
    const typeMatch = selectedType === 'ALL' || entry.type === selectedType;
    const statusMatch = selectedStatus === 'ALL' || entry.status === selectedStatus;
    const textMatch =
      textQuery.length === 0 || `${entry.category} ${entry.description}`.toLowerCase().includes(textQuery);

    return typeMatch && statusMatch && textMatch;
  });
}

function getStatusBadge(status) {
  const badge = document.createElement('span');
  const classMap = {
    [STATUS_SETTLED]: 'status-settled',
    [STATUS_PENDING]: 'status-pending',
  };
  badge.className = `status-badge ${classMap[status] || 'status-pending'}`;
  badge.textContent = status || STATUS_PENDING;
  return badge;
}

function createProofCell(entry) {
  const proofCell = document.createElement('td');

  if (entry.reference && isValidUrl(entry.reference)) {
    const proofLink = document.createElement('a');
    proofLink.href = getSafeProofUrl(entry.reference);
    proofLink.target = '_blank';
    proofLink.rel = 'noopener noreferrer';
    proofLink.textContent = 'View proof';
    proofCell.appendChild(proofLink);
    return proofCell;
  }

  const emptyProof = document.createElement('span');
  emptyProof.className = 'muted-text';
  emptyProof.textContent = 'No proof yet';
  proofCell.appendChild(emptyProof);
  return proofCell;
}

function createTimestampCell(entry) {
  const dateCell = document.createElement('td');
  const created = document.createElement('div');
  created.textContent = formatDateTime(entry.createdAt);
  dateCell.appendChild(created);

  if (entry.settledAt) {
    const settled = document.createElement('small');
    settled.className = 'muted-text';
    settled.textContent = `Settled: ${formatDateTime(entry.settledAt)}`;
    dateCell.appendChild(settled);
  }

  return dateCell;
}

function setActionButtonEnabled(button, enabled) {
  button.disabled = !enabled;
  if (!enabled) {
    button.title = 'Connect the admin wallet on the correct network to perform this action.';
  } else {
    button.removeAttribute('title');
  }
}

async function runTransaction(label, action) {
  try {
    setTxStatus(`${label} submitted...`, 'info');
    const tx = await action();
    setTxStatus(`${label} pending confirmation.`, 'info', tx.hash);
    await tx.wait();
    setTxStatus(`${label} confirmed.`, 'success', tx.hash);
    await refreshLedger();
  } catch (error) {
    const message =
      error?.shortMessage ||
      error?.info?.error?.message ||
      error?.message ||
      'Transaction failed. Please try again.';
    setTxStatus(message, 'error');
  }
}

async function handleConfirmEntry(entryId) {
  if (!isAdminWallet) return;
  const proofUrl = window.prompt('Enter settlement proof URL (required):');
  if (proofUrl === null) return;
  if (!proofUrl.trim() || !isValidUrl(proofUrl.trim())) {
    setTxStatus('A valid proof URL is required to confirm/settle an entry.', 'error');
    return;
  }
  const signerContract = await getSignerContract();
  if (!signerContract) return;
  await runTransaction('Entry confirmation', () => signerContract.confirmEntry(entryId, proofUrl.trim()));
}

async function handleUpdateReference(entryId, currentReference) {
  if (!isAdminWallet) return;
  const nextReference = window.prompt('Enter updated proof/reference URL:', currentReference || '');
  if (nextReference === null) return;
  if (!nextReference.trim() || !isValidUrl(nextReference.trim())) {
    setTxStatus('A valid proof/reference URL is required.', 'error');
    return;
  }
  const signerContract = await getSignerContract();
  if (!signerContract) return;
  await runTransaction('Reference update', () => signerContract.updateReferenceURI(entryId, nextReference.trim()));
}

function createActionsCell(entry) {
  const actionsCell = document.createElement('td');
  const actionsWrap = document.createElement('div');
  actionsWrap.className = 'actions-wrap';

  const confirmButton = document.createElement('button');
  confirmButton.type = 'button';
  confirmButton.className = 'table-action';
  confirmButton.textContent = 'Confirm/Settle';
  setActionButtonEnabled(confirmButton, isAdminWallet && entry.status === STATUS_PENDING);
  confirmButton.addEventListener('click', () => handleConfirmEntry(entry.id));

  const updateReferenceButton = document.createElement('button');
  updateReferenceButton.type = 'button';
  updateReferenceButton.className = 'table-action';
  updateReferenceButton.textContent = 'Update Proof';
  setActionButtonEnabled(updateReferenceButton, isAdminWallet);
  updateReferenceButton.addEventListener('click', () => handleUpdateReference(entry.id, entry.reference));

  actionsWrap.appendChild(confirmButton);
  actionsWrap.appendChild(updateReferenceButton);
  actionsCell.appendChild(actionsWrap);
  return actionsCell;
}

function renderStateRow(message) {
  ledgerBody.innerHTML = `<tr><td colspan="9">${message}</td></tr>`;
}

function renderTable() {
  const filtered = getFilteredEntries();

  ledgerBody.innerHTML = '';

  if (filtered.length === 0) {
    renderStateRow('No ledger entries found on-chain for the selected filters.');
    return;
  }

  filtered.forEach((entry) => {
    const row = document.createElement('tr');

    const idCell = document.createElement('td');
    idCell.textContent = `#${entry.id}`;
    row.appendChild(idCell);

    row.appendChild(createTimestampCell(entry));

    [entry.type].forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    });

    const statusCell = document.createElement('td');
    statusCell.appendChild(getStatusBadge(entry.status));
    row.appendChild(statusCell);

    [formatAmount(entry.amount), entry.category, entry.description].forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    });

    row.appendChild(createProofCell(entry));
    row.appendChild(createActionsCell(entry));

    ledgerBody.appendChild(row);
  });
}

function getEthereumProvider() {
  return window.ethereum || null;
}

function getReadContract() {
  if (typeof window.ethers === 'undefined') {
    throw new Error('Ethers library failed to load. Refresh the page and try again.');
  }
  const provider = new window.ethers.JsonRpcProvider(LEDGER_CONFIG.rpcUrl);
  return new window.ethers.Contract(LEDGER_CONFIG.contractAddress, PROJECT_LEDGER_ABI, provider);
}

async function getSignerContract() {
  const ethereumProvider = getEthereumProvider();
  if (!ethereumProvider) {
    setTxStatus('MetaMask is required for admin write actions.', 'error');
    return null;
  }

  const provider = new window.ethers.BrowserProvider(ethereumProvider, 'any');
  const signer = await provider.getSigner();
  return new window.ethers.Contract(LEDGER_CONFIG.contractAddress, PROJECT_LEDGER_ABI, signer);
}

async function fetchEntriesFromContract() {
  const contract = getReadContract();
  const totalEntriesRaw = await contract.totalEntries();
  const totalEntries = toNumeric(totalEntriesRaw);

  if (totalEntries === 0) return [];

  const pageSize = 20;
  const loaded = [];

  for (let start = 1; start <= totalEntries; start += pageSize) {
    const end = Math.min(totalEntries, start + pageSize - 1);
    const ids = [];
    for (let id = start; id <= end; id += 1) ids.push(id);
    const pageEntries = await Promise.all(ids.map((id) => contract.getEntry(id)));
    loaded.push(...pageEntries.map(normalizeEntry));
  }

  loaded.sort((a, b) => b.id - a.id);
  return loaded;
}

function isTargetNetwork(chainId) {
  return Number(chainId) === LEDGER_CONFIG.targetChainId;
}

async function refreshWalletState() {
  const ethereumProvider = getEthereumProvider();
  if (!ethereumProvider) {
    currentAccount = '';
    connectedChainId = null;
    isAdminWallet = false;
    setWalletStatus(
      `Wallet not detected. Install MetaMask to perform admin actions. Read-only mode is enabled on ${LEDGER_CONFIG.targetChainName}.`,
    );
    setFormEnabled(false);
    return;
  }

  const provider = new window.ethers.BrowserProvider(ethereumProvider, 'any');
  const network = await provider.getNetwork();
  connectedChainId = toNumeric(network.chainId);
  const accounts = await ethereumProvider.request({ method: 'eth_accounts' });
  currentAccount = accounts && accounts[0] ? accounts[0] : '';

  if (!currentAccount) {
    isAdminWallet = false;
    setWalletStatus('Wallet available. Click the fox icon to connect.', false);
    setFormEnabled(false);
    return;
  }

  if (!isTargetNetwork(connectedChainId)) {
    isAdminWallet = false;
    setWalletStatus(
      `Wrong network. Switch to ${LEDGER_CONFIG.targetChainName} (chain ID ${LEDGER_CONFIG.targetChainId}) to use this ledger.`,
      true,
    );
    setFormEnabled(false);
    return;
  }

  let ownerAddress = '';
  try {
    ownerAddress = await getReadContract().owner();
  } catch (error) {
    console.error(error);
  }

  const normalizedAccount = currentAccount.toLowerCase();
  const isAllowlisted = LEDGER_CONFIG.adminAllowlist.some((address) => address.toLowerCase() === normalizedAccount);
  const isOwner = ownerAddress && ownerAddress.toLowerCase() === normalizedAccount;

  isAdminWallet = Boolean(isOwner || isAllowlisted);
  setFormEnabled(isAdminWallet);

  if (isAdminWallet) {
    setWalletStatus(`Connected: ${shortAddress(currentAccount)} (admin write access)`);
  } else {
    setWalletStatus(`Connected: ${shortAddress(currentAccount)} (read-only; admin wallet required)`);
  }
}

async function refreshLedger() {
  renderStateRow('Loading live ledger data from chain...');

  try {
    entries = await fetchEntriesFromContract();
    calculateSummary(entries);
    renderTable();
  } catch (error) {
    console.error(error);
    calculateSummary([]);
    renderStateRow('Unable to load on-chain ledger data. Check your network and refresh the page.');
  }
}

function parseSubmissionValues() {
  const type = entryTypeEl.value;
  const amountValue = entryAmountEl.value.trim();
  const amount = Number(amountValue);
  const category = entryCategoryEl.value.trim();
  const description = entryDescriptionEl.value.trim();
  const proofUrl = entryProofEl.value.trim();

  let hasError = false;

  if (!type) {
    setFieldError('type', 'Type is required.');
    hasError = true;
  }

  if (!amountValue) {
    setFieldError('amount', 'Amount is required.');
    hasError = true;
  } else if (Number.isNaN(amount) || amount < 1) {
    setFieldError('amount', 'Amount must be a number greater than or equal to 1.');
    hasError = true;
  } else if (!Number.isInteger(amount)) {
    setFieldError('amount', 'Amount must be a whole number.');
    hasError = true;
  }

  if (!category) {
    setFieldError('category', 'Category is required.');
    hasError = true;
  }

  if (!description) {
    setFieldError('description', 'Description is required.');
    hasError = true;
  }

  if (proofUrl && !isValidUrl(proofUrl)) {
    setFieldError('reference', 'Proof URL must start with http:// or https://.');
    hasError = true;
  }

  return {
    hasError,
    values: {
      type,
      amount,
      category,
      description,
      proofUrl,
    },
  };
}

async function handleEntrySubmit(event) {
  event.preventDefault();
  clearFieldErrors();

  if (!isAdminWallet) {
    setTxStatus('Only the admin wallet can add entries.', 'error');
    return;
  }

  const { hasError, values } = parseSubmissionValues();
  if (hasError) return;

  const signerContract = await getSignerContract();
  if (!signerContract) return;

  const entryTypeValue = values.type === 'OUTGOING' ? 1 : 0;

  await runTransaction('Entry creation', () =>
    signerContract.createEntry(
      entryTypeValue,
      values.amount,
      values.category,
      values.description,
      values.proofUrl,
    ),
  );

  entryFormEl.reset();
}

async function connectWallet() {
  const ethereumProvider = getEthereumProvider();
  if (!ethereumProvider) {
    setWalletStatus('MetaMask not detected. Install it to connect an admin wallet.', true);
    return;
  }

  try {
    await ethereumProvider.request({ method: 'eth_requestAccounts' });
    await refreshWalletState();
    await refreshLedger();
  } catch (error) {
    const message = error?.message || 'Wallet connection was rejected.';
    setWalletStatus(message, true);
  }
}

function bindWalletEvents() {
  const ethereumProvider = getEthereumProvider();
  if (!ethereumProvider) return;

  ethereumProvider.on('accountsChanged', async () => {
    await refreshWalletState();
    renderTable();
  });

  ethereumProvider.on('chainChanged', async () => {
    await refreshWalletState();
    await refreshLedger();
  });
}

async function init() {
  if (walletButtonEl) {
    walletButtonEl.addEventListener('click', connectWallet);
  }

  [typeFilterEl, statusFilterEl, searchFilterEl].forEach((el) => {
    el.addEventListener('input', renderTable);
  });

  if (entryFormEl) {
    entryFormEl.addEventListener('submit', handleEntrySubmit);
  }

  bindWalletEvents();
  await refreshWalletState();
  await refreshLedger();
}

init();
