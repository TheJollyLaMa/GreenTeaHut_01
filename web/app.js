// --- About modal ---
// Must be a Google Slides "Publish to web" embed URL (not edit URL).
const ABOUT_SLIDES_EMBED_URL =
  'https://docs.google.com/presentation/d/e/2PACX-1vTraXc7uqbvK62XYUSvtLul29KxMW3zTluA_wCIhTNML52gSJgnkFy04m7tiECySan_rU-qwvwd8HqT/pubembed?start=true&loop=true&delayms=5000';

// --- Right toolbar ---
const toolbarScrollBtn = document.getElementById('toolbar-scroll');
const ledgerView = document.getElementById('ledger-view');

if (toolbarScrollBtn && ledgerView) {
  toolbarScrollBtn.addEventListener('click', () => {
    const isPressed = toolbarScrollBtn.getAttribute('aria-pressed') === 'true';
    const newState = !isPressed;
    toolbarScrollBtn.setAttribute('aria-pressed', String(newState));
    toolbarScrollBtn.setAttribute('aria-label', newState ? 'Hide Public Ledger' : 'Show Public Ledger');
    ledgerView.hidden = !newState;
  });
}

// --- Labor & Services Payout toolbar button ---
const toolbarPayoutBtn = document.getElementById('toolbar-payout');
const payoutView = document.getElementById('payout-view');

if (toolbarPayoutBtn && payoutView) {
  toolbarPayoutBtn.addEventListener('click', () => {
    const isPressed = toolbarPayoutBtn.getAttribute('aria-pressed') === 'true';
    const newState = !isPressed;
    toolbarPayoutBtn.setAttribute('aria-pressed', String(newState));
    toolbarPayoutBtn.setAttribute('aria-label', newState ? 'Close Labor & Services Payout' : 'Open Labor & Services Payout');
    payoutView.hidden = !newState;
  });
}

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
  targetChainId: 10,
  targetChainName: 'Optimism',
  explorerBaseUrl: 'https://optimistic.etherscan.io/tx/',
  rpcUrl: 'https://mainnet.optimism.io',
  entryPageSize: 20,
  adminAllowlist: ['0x807061DF657A7697c04045dA7d16D941861cAABc'],
};

const PROJECT_LEDGER_ABI = [
  // View — role-based access control (AccessControl from OpenZeppelin)
  'function ADMIN_ROLE() view returns (bytes32)',
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function getRoleAdmin(bytes32 role) view returns (bytes32)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  // View — ledger reads
  'function NATIVE_ASSET() view returns (address)',
  'function nextId() view returns (uint256)',
  'function getEntryCount() view returns (uint256)',
  'function getEntry(uint256 id) view returns (tuple(uint256 id, uint256 timestamp, uint256 settledAt, uint8 txType, uint8 status, address asset, uint8 assetDecimals, uint256 amount, string category, string description, string referenceURI, address enteredBy))',
  'function getEntries(uint256 offset, uint256 limit) view returns (tuple(uint256 id, uint256 timestamp, uint256 settledAt, uint8 txType, uint8 status, address asset, uint8 assetDecimals, uint256 amount, string category, string description, string referenceURI, address enteredBy)[])',
  'function getTotalsByAsset(address asset) view returns (uint256 incoming, uint256 outgoing, int256 balance)',
  'function getConfirmedTotalsByAsset(address asset) view returns (uint256 incoming, uint256 outgoing, int256 balance)',
  // Write — role-based access control
  'function grantRole(bytes32 role, address account)',
  'function revokeRole(bytes32 role, address account)',
  'function renounceRole(bytes32 role, address callerConfirmation)',
  // Write — ledger mutations
  'function addEntry(uint8 txType, uint8 status, address asset, uint8 assetDecimals, uint256 amount, string category, string description, string referenceURI)',
  'function confirmEntry(uint256 id, string referenceURI)',
  'function updateReferenceURI(uint256 id, string newReferenceURI)',
  'function updateStatus(uint256 id, uint8 newStatus)',
  // Write — asset flows
  'function depositNative(string category, string description, string referenceURI) payable returns (uint256 entryId)',
  'function depositERC20(address token, uint256 amount, string category, string description, string referenceURI) returns (uint256 entryId)',
  'function withdrawNative(address to, uint256 amount, string category, string description, string referenceURI) returns (uint256 entryId)',
  'function withdrawERC20(address token, address to, uint256 amount, string category, string description, string referenceURI) returns (uint256 entryId)',
];

const STATUS_PENDING = 'PENDING';
const STATUS_SETTLED = 'SETTLED';

// TxType enum values in the deployed ProjectLedger contract.
const TX_TYPE_INCOMING = 0;
const TX_TYPE_OUTGOING = 1;
// Status enum values (on-chain uint8).
const ENTRY_STATUS_PENDING = 0;
// Fallback zero-address used as nativeAssetAddress before NATIVE_ASSET() resolves.
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

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
const entryFormControls = entryFormEl ? Array.from(entryFormEl.elements) : [];
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
// Cached from NATIVE_ASSET() view call; used as the asset address for off-chain addEntry records.
let nativeAssetAddress = ZERO_ADDRESS;

function formatAmount(value) {
  return currency.format(Number(value) || 0);
}

function getErrorMessage(error, fallback = 'An unexpected error occurred. Please try again.') {
  return (
    error?.shortMessage ||
    error?.info?.error?.message ||
    error?.message ||
    fallback
  );
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
  txStatusEl.textContent = '';
  const messageNode = document.createElement('span');
  messageNode.textContent = message;
  txStatusEl.appendChild(messageNode);
  if (hash) {
    const url = txLink(hash);
    txStatusEl.appendChild(document.createTextNode(' '));
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'View transaction';
    txStatusEl.appendChild(link);
  }
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
  entryFormControls.forEach((element) => {
    element.disabled = !enabled;
  });
}

function normalizeEntry(entry) {
  const status = Number(entry.status) === 1 ? STATUS_SETTLED : STATUS_PENDING;
  const type = Number(entry.txType) === TX_TYPE_OUTGOING ? 'OUTGOING' : 'INCOMING';
  // Scale the raw on-chain amount by the asset's decimal places so the UI
  // displays a human-readable value (e.g. 1e18 wei → 1 ETH, or whole-dollar
  // records stored with assetDecimals=0 are returned unchanged).
  const decimals = Number(entry.assetDecimals) || 0;
  const rawAmount = toNumeric(entry.amount);
  const displayAmount = decimals > 0 ? rawAmount / 10 ** decimals : rawAmount;
  return {
    id: toNumeric(entry.id),
    createdAt: toNumeric(entry.timestamp),
    settledAt: toNumeric(entry.settledAt),
    type,
    status,
    amount: displayAmount,
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
    setTxStatus(getErrorMessage(error, 'Transaction failed. Please try again.'), 'error');
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
  const hasActiveFilters =
    typeFilterEl.value !== 'ALL' || statusFilterEl.value !== 'ALL' || searchFilterEl.value.trim().length > 0;

  ledgerBody.innerHTML = '';

  if (filtered.length === 0) {
    renderStateRow(
      hasActiveFilters
        ? 'No ledger entries match the selected filters.'
        : 'No ledger entries have been recorded on-chain yet.',
    );
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
  return { contract: new window.ethers.Contract(LEDGER_CONFIG.contractAddress, PROJECT_LEDGER_ABI, provider), provider };
}

// Validates the contract is accessible: confirms bytecode exists at the address and
// that required view function selectors respond without a CALL_EXCEPTION.
// Returns an object: { ok: boolean, reason: string }
async function validateContractInterface() {
  let provider;
  try {
    ({ provider } = getReadContract());
  } catch (error) {
    return { ok: false, reason: error.message };
  }

  // 1. Verify bytecode is deployed at the configured address.
  let code;
  try {
    code = await provider.getCode(LEDGER_CONFIG.contractAddress);
  } catch (error) {
    return {
      ok: false,
      reason: `Unable to reach the RPC endpoint (${LEDGER_CONFIG.rpcUrl}). Check your internet connection.`,
    };
  }

  if (!code || code === '0x') {
    return {
      ok: false,
      reason: `No contract found at ${LEDGER_CONFIG.contractAddress} on ${LEDGER_CONFIG.targetChainName}. The address may be wrong or the contract may not be deployed on this network.`,
    };
  }

  // 2. Verify required function selectors are present by making raw calls.
  //    Selectors not in the contract's dispatch table return empty data (0x),
  //    allowing precise detection of ABI drift without relying on full ABI encoding.
  //    Selector values are keccak256(signature)[0:4] — see web/deployment-metadata.json.
  const requiredSelectors = [
    { selector: '0x7a360e65', name: 'getEntryCount()' },
    // ADMIN_ROLE() is a simple no-arg view that returns the bytes32 role hash.
    { selector: '0x75b238fc', name: 'ADMIN_ROLE()' },
    // getEntry(uint256) requires an argument; pad with 64 hex zeros (32 bytes = one uint256).
    // id=0 triggers a revert in the contract. A non-empty revert confirms the selector exists.
    {
      selector: '0xbae78d7b',
      name: 'getEntry(uint256)',
      // 64 hex chars = 32 bytes = one ABI-encoded uint256(0) argument.
      data: '0xbae78d7b' + '0'.repeat(64),
      expectRevertWithData: true,
    },
  ];

  for (const { selector, name, data, expectRevertWithData } of requiredSelectors) {
    let result;
    try {
      result = await provider.call({
        to: LEDGER_CONFIG.contractAddress,
        data: data || selector,
      });
    } catch (error) {
      if (expectRevertWithData) {
        // A revert with non-empty error data means the function exists but rejected
        // the invalid argument (expected behaviour for getEntry with id=0).
        const hasErrorData = error?.data && error.data !== '0x';
        if (hasErrorData) continue;
      }
      const isAbiMismatch =
        error?.code === 'CALL_EXCEPTION' ||
        error?.code === 'BAD_DATA' ||
        String(error?.message).includes('CALL_EXCEPTION');
      if (isAbiMismatch) {
        return {
          ok: false,
          reason: `Contract ABI mismatch: ${name} (selector ${selector}) is not available at ${LEDGER_CONFIG.contractAddress}. The ABI in this app may not match the deployed contract.`,
        };
      }
      return { ok: false, reason: getErrorMessage(error, 'Contract call failed.') };
    }

    // An empty result means the 4-byte selector is not in the contract's dispatch table.
    if (!result || result === '0x') {
      return {
        ok: false,
        reason: `Contract ABI mismatch: ${name} (selector ${selector}) is not present at ${LEDGER_CONFIG.contractAddress}. The contract may have been redeployed with a different ABI.`,
      };
    }
  }

  return { ok: true, reason: '' };
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
  const { contract } = getReadContract();
  const totalEntriesRaw = await contract.getEntryCount();
  const totalEntries = toNumeric(totalEntriesRaw);

  if (totalEntries === 0) return [];

  const pageSize = LEDGER_CONFIG.entryPageSize;
  const loaded = [];

  // Use getEntries(offset, limit) for batched reads; avoids N individual calls.
  for (let offset = 0; offset < totalEntries; offset += pageSize) {
    const limit = Math.min(pageSize, totalEntries - offset);
    const pageEntries = await contract.getEntries(offset, limit);
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

  let isAdminByRole = false;
  try {
    const readContract = getReadContract().contract;
    const adminRole = await readContract.ADMIN_ROLE();
    isAdminByRole = await readContract.hasRole(adminRole, currentAccount);
  } catch (error) {
    console.error(error);
  }

  const normalizedAccount = currentAccount.toLowerCase();
  const isAllowlisted = LEDGER_CONFIG.adminAllowlist.some((address) => address.toLowerCase() === normalizedAccount);

  isAdminWallet = Boolean(isAdminByRole || isAllowlisted);
  setFormEnabled(isAdminWallet);

  if (isAdminWallet) {
    setWalletStatus(`Connected: ${shortAddress(currentAccount)} (admin write access)`);
  } else {
    setWalletStatus(`Connected: ${shortAddress(currentAccount)} (read-only; admin wallet required)`);
  }
}

async function refreshLedger() {
  renderStateRow('Loading live ledger data from chain...');

  // Validate contract existence and ABI compatibility before attempting reads.
  const { ok, reason } = await validateContractInterface();
  if (!ok) {
    console.error('Contract validation failed:', reason);
    calculateSummary([]);
    renderStateRow(reason);
    return;
  }

  try {
    entries = await fetchEntriesFromContract();
    calculateSummary(entries);
    renderTable();
  } catch (error) {
    console.error(error);
    calculateSummary([]);
    const isNetwork = error?.code === 'NETWORK_ERROR' || error?.code === 'ETIMEDOUT';
    const message = isNetwork
      ? `Network error: unable to reach the RPC endpoint. Check your internet connection and refresh.`
      : getErrorMessage(error, 'Unable to load on-chain ledger data. Check your network and refresh the page.');
    renderStateRow(message);
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
  } else if (Number.isNaN(amount)) {
    setFieldError('amount', 'Amount must be a valid number.');
    hasError = true;
  } else if (!Number.isInteger(amount)) {
    setFieldError('amount', 'Amount must be a whole number.');
    hasError = true;
  } else if (amount < 1) {
    setFieldError('amount', 'Amount must be a number greater than or equal to 1.');
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

  const entryTypeValue = values.type === 'OUTGOING' ? TX_TYPE_OUTGOING : TX_TYPE_INCOMING;
  // ENTRY_STATUS_PENDING = 0; asset is the native-asset sentinel from the contract,
  // with assetDecimals=0 so whole-number dollar amounts are stored as-is.
  const assetDecimals = 0;

  await runTransaction('Entry creation', () =>
    signerContract.addEntry(
      entryTypeValue,
      ENTRY_STATUS_PENDING,
      nativeAssetAddress,
      assetDecimals,
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
  // Cache the native-asset sentinel address used by addEntry for off-chain records.
  try {
    const { contract } = getReadContract();
    nativeAssetAddress = await contract.NATIVE_ASSET();
  } catch {
    // Keep the zero-address fallback if the RPC is unavailable at startup.
  }

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
