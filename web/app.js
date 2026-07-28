// --- About modal ---
// Must be a Google Slides "Publish to web" embed URL (not edit URL).
const ABOUT_SLIDES_EMBED_URL =
  'https://docs.google.com/presentation/d/e/2PACX-1vTraXc7uqbvK62XYUSvtLul29KxMW3zTluA_wCIhTNML52gSJgnkFy04m7tiECySan_rU-qwvwd8HqT/pubembed?start=true&loop=true&delayms=5000';

// --- Right toolbar (centralized view state) ---
// activeView: 'wallet' | 'ledger' | 'payout'
let activeView = 'ledger';

const toolbarWalletBtn = document.getElementById('toolbar-wallet');
const toolbarScrollBtn = document.getElementById('toolbar-scroll');
const toolbarPayoutBtn = document.getElementById('toolbar-payout');
const walletView = document.getElementById('wallet-view');
const ledgerView = document.getElementById('ledger-view');
const payoutView = document.getElementById('payout-view');

function setActiveView(view) {
  activeView = view;

  // Sync aria-pressed state — exactly one button active at a time
  if (toolbarWalletBtn) toolbarWalletBtn.setAttribute('aria-pressed', String(view === 'wallet'));
  if (toolbarScrollBtn) toolbarScrollBtn.setAttribute('aria-pressed', String(view === 'ledger'));
  if (toolbarPayoutBtn) toolbarPayoutBtn.setAttribute('aria-pressed', String(view === 'payout'));

  // Update accessible labels to reflect current state
  if (toolbarWalletBtn) {
    toolbarWalletBtn.setAttribute(
      'aria-label',
      view === 'wallet' ? 'Wallet & Connection (active)' : 'Show Wallet & Connection Info',
    );
  }
  if (toolbarScrollBtn) {
    toolbarScrollBtn.setAttribute(
      'aria-label',
      view === 'ledger' ? 'Public Ledger (active)' : 'Show Public Ledger',
    );
  }
  if (toolbarPayoutBtn) {
    toolbarPayoutBtn.setAttribute(
      'aria-label',
      view === 'payout' ? 'Labor & Services Payout (active)' : 'Open Labor & Services Payout',
    );
  }

  // Show exactly one panel
  if (walletView) walletView.hidden = view !== 'wallet';
  if (ledgerView) ledgerView.hidden = view !== 'ledger';
  if (payoutView) payoutView.hidden = view !== 'payout';

  // Populate wallet panel when it becomes visible
  if (view === 'wallet') updateWalletPanel();
  if (view === 'payout') {
    startPayoutClock();
    renderPayoutView();
  } else {
    stopPayoutClock();
  }
}

// Toolbar button click handlers
if (toolbarWalletBtn) toolbarWalletBtn.addEventListener('click', () => setActiveView('wallet'));
if (toolbarScrollBtn) toolbarScrollBtn.addEventListener('click', () => setActiveView('ledger'));
if (toolbarPayoutBtn) toolbarPayoutBtn.addEventListener('click', () => setActiveView('payout'));

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
  contractAddress: '0x44500FFd99B621620f393FCdbcF55D5137A55A23',
  targetChainId: 10,
  targetChainName: 'Optimism',
  explorerBaseUrl: 'https://optimistic.etherscan.io/tx/',
  explorerAddressBaseUrl: 'https://optimistic.etherscan.io/address/',
  rpcUrl: 'https://mainnet.optimism.io',
  entryPageSize: 20,
};

const PROJECT_LEDGER_ABI = [
  // View — ledger reads
  'function totalEntries() view returns (uint256)',
  'function getEntry(uint256 entryId) view returns (tuple(uint256 id, uint256 amount, uint8 entryType, uint8 status, string category, string description, string referenceURI, uint256 createdAt, uint256 settledAt))',
  'function owner() view returns (address)',
  // Write — ledger mutations
  'function createEntry(uint8 entryType, uint8 status, uint256 amount, string category, string description, string referenceURI) returns (uint256 entryId)',
  'function updateStatus(uint256 entryId, uint8 newStatus)',
  'function confirmEntry(uint256 entryId, string referenceURI)',
  'function updateReferenceURI(uint256 entryId, string referenceURI)',
  'function updatePendingAmount(uint256 entryId, uint256 newAmount, string reason, string referenceURI)',
];

const STATUS_PENDING = 'PENDING';
const STATUS_CONFIRMED = 'CONFIRMED';
const STATUS_REQUESTED = 'REQUESTED';
const STATUS_COMMITTED = 'COMMITTED';
const STATUS_CANCELED = 'CANCELED';

// EntryType enum values in the deployed ProjectLedger contract.
const TX_TYPE_INCOMING = 0;
const TX_TYPE_OUTGOING = 1;
// EntryStatus enum values (on-chain uint8). Order must match EntryStatus in ProjectLedger.sol.
// PENDING (0) — soft incoming entry; CONFIRMED (1) — finalized/settled.
// REQUESTED (2) — soft outgoing entry; COMMITTED (3) — approved; CANCELED (4) — voided.
const ENTRY_STATUS_PENDING = 0;
const ENTRY_STATUS_CONFIRMED = 1;
const ENTRY_STATUS_REQUESTED = 2;
const ENTRY_STATUS_COMMITTED = 3;
const ENTRY_STATUS_CANCELED = 4;

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
const entryStatusEl = document.getElementById('entry-status');
const entryFormControls = entryFormEl ? Array.from(entryFormEl.elements) : [];
const walletConnectBtnEl = document.getElementById('wallet-connect-btn');
const walletStatusEl = document.getElementById('wallet-status');
const txStatusEl = document.getElementById('tx-status');
const payoutActiveCountEl = document.getElementById('payout-active-count');
const payoutCompletedCountEl = document.getElementById('payout-completed-count');
const payoutRequestedTotalEl = document.getElementById('payout-requested-total');
const payoutSettledTotalEl = document.getElementById('payout-settled-total');
const payoutQrGeneratorFormEl = document.getElementById('payout-qr-generator-form');
const payoutSiteIdEl = document.getElementById('payout-site-id');
const payoutTaskIdEl = document.getElementById('payout-task-id');
const payoutHourlyRateEl = document.getElementById('payout-hourly-rate');
const payoutQrReviewerWalletEl = document.getElementById('payout-qr-reviewer-wallet');
const payoutGeneratedQrEl = document.getElementById('payout-generated-qr');
const payoutQrStatusEl = document.getElementById('payout-qr-status');
const payoutClockInFormEl = document.getElementById('payout-clock-in-form');
const payoutWorkerNameEl = document.getElementById('payout-worker-name');
const payoutWorkerWalletEl = document.getElementById('payout-worker-wallet');
const payoutQrPayloadEl = document.getElementById('payout-qr-payload');
const payoutWorkerStatusEl = document.getElementById('payout-worker-status');
const payoutShiftsBodyEl = document.getElementById('payout-shifts-body');
const payoutReviewFormEl = document.getElementById('payout-review-form');
const payoutReviewShiftEl = document.getElementById('payout-review-shift');
const payoutReviewerWalletEl = document.getElementById('payout-reviewer-wallet');
const payoutApprovedAmountEl = document.getElementById('payout-approved-amount');
const payoutAdjustmentReasonEl = document.getElementById('payout-adjustment-reason');
const payoutProofUrlEl = document.getElementById('payout-proof-url');
const payoutSyncLedgerEl = document.getElementById('payout-sync-ledger');
const payoutUseAccruedBtnEl = document.getElementById('payout-use-accrued');
const payoutSyncLedgerBtnEl = document.getElementById('payout-sync-ledger-btn');
const payoutReviewStatusEl = document.getElementById('payout-review-status');
const payoutBodyEl = document.getElementById('payout-body');
const payoutEventsBodyEl = document.getElementById('payout-events-body');

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
// Cached ABI compatibility result for display in wallet panel.
let lastAbiStatus = '';

const ABI_STATUS_COMPATIBLE = 'Compatible ✓';

// Status indicator colors shared across the wallet panel.
const STATUS_COLOR_SUCCESS = '#166534';
const STATUS_COLOR_ERROR = '#b91c1c';
const STATUS_COLOR_WARNING = '#92400e';
const QR_EXPIRATION_WINDOW_MS = 10 * 60 * 1000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ACCRUAL_BUCKETS_PER_HOUR = 4;
const MIN_HOURLY_RATE_USD = ACCRUAL_BUCKETS_PER_HOUR;
const MAX_DISPLAYED_PAYOUT_EVENTS = 20;
const PAYOUT_STORAGE_KEY = 'gth-payout-mvp-v1';
const payoutPendingActions = new Set();
let payoutServerTimestampCache = '';
let payoutClock = null;

function formatAmount(value) {
  return currency.format(Number(value) || 0);
}

function toWholeUsd(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}

function getErrorMessage(error, fallback = 'An unexpected error occurred. Please try again.') {
  // Prefer the decoded revert reason (e.g. "Native must use 18 decimals") when available.
  // ethers.js v6 surfaces this as `reason`; also try `shortMessage` for ABI-decoded errors,
  // then the embedded JSON-RPC error message, and finally the raw Error message.
  return (
    error?.reason ||
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

function normalizeWallet(address) {
  return String(address || '').trim();
}

function isWalletAddress(address) {
  const value = normalizeWallet(address);
  if (!value) return false;
  if (typeof window.ethers !== 'undefined' && typeof window.ethers.isAddress === 'function') {
    return window.ethers.isAddress(value);
  }
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function formatLocalDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function createActionId(prefix) {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildQrMessage(payload) {
  return [
    'GreenTeaHut Labor QR',
    payload.siteId,
    payload.taskId,
    payload.nonce,
    payload.issuedAt,
    String(payload.ratePerHour),
    payload.reviewerWallet,
  ].join('|');
}

function loadPayoutState() {
  try {
    const raw = window.localStorage.getItem(PAYOUT_STORAGE_KEY);
    if (!raw) {
      return { shifts: [], usedNonces: {}, processedActions: {} };
    }
    const parsed = JSON.parse(raw);
    return {
      shifts: Array.isArray(parsed.shifts) ? parsed.shifts : [],
      usedNonces: parsed.usedNonces && typeof parsed.usedNonces === 'object' ? parsed.usedNonces : {},
      processedActions:
        parsed.processedActions && typeof parsed.processedActions === 'object' ? parsed.processedActions : {},
    };
  } catch (error) {
    console.warn('Unable to load payout state; resetting local payout store.', error);
    return { shifts: [], usedNonces: {}, processedActions: {} };
  }
}

function savePayoutState() {
  window.localStorage.setItem(PAYOUT_STORAGE_KEY, JSON.stringify(payoutState));
}

const payoutState = loadPayoutState();

function setPayoutStatus(element, message, type = '') {
  if (!element) return;
  element.textContent = message;
  element.className = `payout-status${type ? ` ${type}` : ''}`;
}

function getShiftStatus(shift) {
  if (shift.settledAt) return STATUS_CONFIRMED;
  if (shift.clockedOutAt) return shift.ledgerEntryId ? STATUS_REQUESTED : 'CLOCKED_OUT';
  return 'ACTIVE';
}

function getShiftAccruedBuckets(shift, now = Date.now()) {
  const end = shift.clockedOutAt || now;
  const start = shift.clockedInAt || now;
  const elapsed = Math.max(0, end - start);
  return Math.floor(elapsed / FIFTEEN_MINUTES_MS);
}

function getShiftAccruedAmount(shift, now = Date.now()) {
  const hourlyRate = Number(shift.ratePerHour || 0);
  if (!Number.isInteger(hourlyRate) || hourlyRate < MIN_HOURLY_RATE_USD || hourlyRate % ACCRUAL_BUCKETS_PER_HOUR !== 0) {
    return 0;
  }
  return getShiftAccruedBuckets(shift, now) * (hourlyRate / ACCRUAL_BUCKETS_PER_HOUR);
}

function formatShiftAccrual(shift) {
  const buckets = getShiftAccruedBuckets(shift);
  const amount = getShiftAccruedAmount(shift);
  return `${formatAmount(amount)} · ${buckets} × 15m`;
}

function getShiftDisplayAmount(shift) {
  if (typeof shift.approvedAmount === 'number') return toWholeUsd(shift.approvedAmount);
  return getShiftAccruedAmount(shift);
}

function findShiftById(shiftId) {
  return payoutState.shifts.find((shift) => shift.id === shiftId) || null;
}

function getActiveShiftForWorkerSite(workerWallet, siteId) {
  return payoutState.shifts.find(
    (shift) =>
      normalizeWallet(shift.workerWallet).toLowerCase() === normalizeWallet(workerWallet).toLowerCase() &&
      shift.siteId === siteId &&
      !shift.clockedOutAt &&
      !shift.settledAt,
  );
}

function getPayoutEventRows() {
  return payoutState.shifts
    .flatMap((shift) =>
      (shift.events || []).map((event) => ({
        ...event,
        shiftId: shift.id,
      })),
    )
    .sort((a, b) => new Date(b.clientTimestamp).getTime() - new Date(a.clientTimestamp).getTime());
}

async function getPayoutServerTimestamp() {
  try {
    const response = await window.fetch(window.location.href, {
      method: 'HEAD',
      cache: 'no-store',
    });
    const value = response.headers.get('date');
    payoutServerTimestampCache = value || payoutServerTimestampCache;
    return value || '';
  } catch (error) {
    console.warn('Unable to read server timestamp for payout event logging.', error);
    return payoutServerTimestampCache || '';
  }
}

function recordProcessedAction(actionKey, details = {}) {
  payoutState.processedActions[actionKey] = {
    ...details,
    processedAt: new Date().toISOString(),
  };
  savePayoutState();
}

function isProcessedAction(actionKey) {
  return Boolean(payoutState.processedActions[actionKey]);
}

function setPayoutActionPending(actionKey, isPending) {
  if (isPending) {
    payoutPendingActions.add(actionKey);
  } else {
    payoutPendingActions.delete(actionKey);
  }
  renderPayoutView();
}

function startPayoutClock() {
  if (payoutClock) return;
  payoutClock = window.setInterval(() => {
    renderPayoutView();
  }, 15000);
}

function stopPayoutClock() {
  if (!payoutClock) return;
  window.clearInterval(payoutClock);
  payoutClock = null;
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
  // If the wallet panel is visible, refresh it too
  if (activeView === 'wallet') updateWalletPanel();
}

function updateWalletPanel() {
  const statusEl = document.getElementById('wallet-info-status');
  const accountEl = document.getElementById('wallet-info-account');
  const networkEl = document.getElementById('wallet-info-network');
  const contractEl = document.getElementById('wallet-info-contract');
  const abiEl = document.getElementById('wallet-info-abi');

  const hasProvider = Boolean(getEthereumProvider());

  if (statusEl) {
    if (!hasProvider) {
      statusEl.textContent = 'Not installed — install MetaMask to connect.';
      statusEl.style.color = STATUS_COLOR_ERROR;
    } else if (currentAccount) {
      statusEl.textContent = 'Connected';
      statusEl.style.color = STATUS_COLOR_SUCCESS;
    } else {
      statusEl.textContent = 'Disconnected';
      statusEl.style.color = STATUS_COLOR_WARNING;
    }
  }

  if (accountEl) {
    accountEl.textContent = currentAccount || '—';
  }

  if (networkEl) {
    if (connectedChainId !== null) {
      const isTarget = Number(connectedChainId) === LEDGER_CONFIG.targetChainId;
      const networkName = isTarget ? LEDGER_CONFIG.targetChainName : 'Unknown network';
      networkEl.textContent = `${networkName} (Chain ID: ${connectedChainId})`;
      networkEl.style.color = isTarget ? '' : STATUS_COLOR_ERROR;
    } else {
      networkEl.textContent = '—';
      networkEl.style.color = '';
    }
  }

  if (contractEl) {
    const addr = LEDGER_CONFIG.contractAddress;
    contractEl.innerHTML = '';
    const link = document.createElement('a');
    link.href = `${LEDGER_CONFIG.explorerAddressBaseUrl}${addr}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = addr;
    contractEl.appendChild(link);
  }

  if (abiEl) {
    abiEl.textContent = lastAbiStatus || '—';
    if (lastAbiStatus === ABI_STATUS_COMPATIBLE) {
      abiEl.style.color = STATUS_COLOR_SUCCESS;
    } else if (lastAbiStatus) {
      abiEl.style.color = STATUS_COLOR_ERROR;
    } else {
      abiEl.style.color = '';
    }
  }

  // Show/hide connect button based on connection state
  if (walletConnectBtnEl) {
    walletConnectBtnEl.hidden = Boolean(currentAccount);
    walletConnectBtnEl.textContent = hasProvider ? 'Connect MetaMask' : 'Install MetaMask';
  }
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
  // Map on-chain uint8 status to a display string.
  // Values must match EntryStatus enum order in ProjectLedger.sol:
  //   0 = PENDING, 1 = CONFIRMED, 2 = REQUESTED, 3 = COMMITTED, 4 = CANCELED
  const ON_CHAIN_STATUS_MAP = {
    0: STATUS_PENDING,
    1: STATUS_CONFIRMED,
    2: STATUS_REQUESTED,
    3: STATUS_COMMITTED,
    4: STATUS_CANCELED,
  };
  const statusCode = Number(entry.status);
  const status = ON_CHAIN_STATUS_MAP[statusCode] ?? STATUS_PENDING;
  const type = Number(entry.entryType) === TX_TYPE_OUTGOING ? 'OUTGOING' : 'INCOMING';
  // Amount is stored as a plain uint256 (whole-number USD); no decimal scaling needed.
  const displayAmount = toNumeric(entry.amount);
  return {
    id: toNumeric(entry.id),
    createdAt: toNumeric(entry.createdAt),
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
  if (requestSpentEl) requestSpentEl.textContent = summary.requestedSpent || '';
  if (pendingBalanceEl) pendingBalanceEl.textContent = summary.pendingBalance;
}

function calculateSummary(allEntries) {
  const settledRaised = allEntries
    .filter((e) => e.type === 'INCOMING' && e.status === STATUS_CONFIRMED)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const pendingRaised = allEntries
    .filter((e) => e.type === 'INCOMING' && e.status === STATUS_PENDING)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const settledSpent = allEntries
    .filter((e) => e.type === 'OUTGOING' && e.status === STATUS_CONFIRMED)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const pendingSpent = allEntries
    .filter((e) => e.type === 'OUTGOING' && e.status === STATUS_PENDING)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  // REQUESTED and COMMITTED are soft outgoing entries — expected future outflows.
  const requestedSpent = allEntries
    .filter((e) => e.type === 'OUTGOING' && (e.status === STATUS_REQUESTED || e.status === STATUS_COMMITTED))
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const balance = settledRaised - settledSpent;
  const projectedRaised = settledRaised + pendingRaised;
  const projectedSpent = settledSpent + pendingSpent + requestedSpent;
  const projectedBalance = projectedRaised - projectedSpent;
  const hasGhostBalance = pendingRaised > 0 || pendingSpent > 0 || requestedSpent > 0;

  updateSummaryDisplay({
    totalRaised: formatAmount(settledRaised),
    pendingRaised: pendingRaised > 0 ? `(${formatAmount(projectedRaised)})` : '',
    totalSpent: formatAmount(settledSpent),
    pendingSpent: pendingSpent > 0 ? `(${formatAmount(settledSpent + pendingSpent)})` : '',
    requestedSpent: requestedSpent > 0 ? `(${formatAmount(settledSpent + requestedSpent)})` : '',
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
    [STATUS_CONFIRMED]: 'status-settled',
    [STATUS_PENDING]: 'status-pending',
    [STATUS_REQUESTED]: 'status-requested',
    [STATUS_COMMITTED]: 'status-committed',
    [STATUS_CANCELED]: 'status-canceled',
    ACTIVE: 'status-committed',
    CLOCKED_OUT: 'status-requested',
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
    const receipt = await tx.wait();
    setTxStatus(`${label} confirmed.`, 'success', tx.hash);
    await refreshLedger();
    return { tx, receipt };
  } catch (error) {
    setTxStatus(getErrorMessage(error, 'Transaction failed. Please try again.'), 'error');
    return null;
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

async function handleReviseAmount(entryId, currentAmount) {
  if (!isAdminWallet) return;
  const newAmountRaw = window.prompt(`Revise amount for entry #${entryId}.\nCurrent amount: ${formatAmount(currentAmount)}\n\nEnter new amount (whole number, USD):`);
  if (newAmountRaw === null) return;
  const newAmount = Number(newAmountRaw.trim());
  if (!newAmountRaw.trim() || !Number.isInteger(newAmount) || newAmount < 1) {
    setTxStatus('Amount must be a whole number greater than or equal to 1.', 'error');
    return;
  }
  const reason = window.prompt('Reason for this revision (required):');
  if (reason === null) return;
  if (!reason.trim()) {
    setTxStatus('A reason is required to revise an entry amount.', 'error');
    return;
  }
  const referenceUrl = window.prompt('Supporting reference URL (optional, leave blank to skip):') || '';
  if (referenceUrl && !isValidUrl(referenceUrl.trim())) {
    setTxStatus('Reference URL must start with http:// or https://.', 'error');
    return;
  }
  const signerContract = await getSignerContract();
  if (!signerContract) return;
  await runTransaction(
    'Amount revision',
    () => signerContract.updatePendingAmount(entryId, BigInt(Math.round(newAmount)), reason.trim(), referenceUrl.trim()),
  );
}

async function handleUpdateStatus(entryId, newStatusCode, label) {
  if (!isAdminWallet) return;
  const signerContract = await getSignerContract();
  if (!signerContract) return;
  await runTransaction(`Status update (→ ${label})`, () => signerContract.updateStatus(entryId, newStatusCode));
}

function createActionsCell(entry) {
  const actionsCell = document.createElement('td');
  const actionsWrap = document.createElement('div');
  actionsWrap.className = 'actions-wrap';

  // isSoftEntry: true for any status that can still be revised or settled.
  const isSoftEntry = entry.status === STATUS_PENDING || entry.status === STATUS_REQUESTED || entry.status === STATUS_COMMITTED;

  const confirmButton = document.createElement('button');
  confirmButton.type = 'button';
  confirmButton.className = 'table-action';
  confirmButton.textContent = 'Confirm/Settle';
  setActionButtonEnabled(confirmButton, isAdminWallet && isSoftEntry);
  confirmButton.addEventListener('click', () => handleConfirmEntry(entry.id));

  // Revise Amount: only allowed while soft (PENDING, REQUESTED, or COMMITTED).
  const reviseAmountButton = document.createElement('button');
  reviseAmountButton.type = 'button';
  reviseAmountButton.className = 'table-action';
  reviseAmountButton.textContent = 'Revise Amount';
  setActionButtonEnabled(reviseAmountButton, isAdminWallet && isSoftEntry);
  reviseAmountButton.addEventListener('click', () => handleReviseAmount(entry.id, entry.amount));

  const updateReferenceButton = document.createElement('button');
  updateReferenceButton.type = 'button';
  updateReferenceButton.className = 'table-action';
  updateReferenceButton.textContent = 'Update Proof';
  setActionButtonEnabled(updateReferenceButton, isAdminWallet);
  updateReferenceButton.addEventListener('click', () => handleUpdateReference(entry.id, entry.reference));

  actionsWrap.appendChild(confirmButton);
  actionsWrap.appendChild(reviseAmountButton);
  actionsWrap.appendChild(updateReferenceButton);

  // Status transition buttons: only shown for relevant statuses.
  if (entry.status === STATUS_REQUESTED) {
    const commitButton = document.createElement('button');
    commitButton.type = 'button';
    commitButton.className = 'table-action';
    commitButton.textContent = '→ Committed';
    setActionButtonEnabled(commitButton, isAdminWallet);
    commitButton.addEventListener('click', () => handleUpdateStatus(entry.id, ENTRY_STATUS_COMMITTED, 'COMMITTED'));
    actionsWrap.appendChild(commitButton);

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'table-action table-action-danger';
    cancelButton.textContent = '→ Cancel';
    setActionButtonEnabled(cancelButton, isAdminWallet);
    cancelButton.addEventListener('click', () => handleUpdateStatus(entry.id, ENTRY_STATUS_CANCELED, 'CANCELED'));
    actionsWrap.appendChild(cancelButton);
  }

  if (entry.status === STATUS_COMMITTED) {
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'table-action table-action-danger';
    cancelButton.textContent = '→ Cancel';
    setActionButtonEnabled(cancelButton, isAdminWallet);
    cancelButton.addEventListener('click', () => handleUpdateStatus(entry.id, ENTRY_STATUS_CANCELED, 'CANCELED'));
    actionsWrap.appendChild(cancelButton);
  }

  if (entry.status === STATUS_PENDING) {
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'table-action table-action-danger';
    cancelButton.textContent = '→ Cancel';
    setActionButtonEnabled(cancelButton, isAdminWallet);
    cancelButton.addEventListener('click', () => handleUpdateStatus(entry.id, ENTRY_STATUS_CANCELED, 'CANCELED'));
    actionsWrap.appendChild(cancelButton);
  }

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
    { selector: '0x7fef036e', name: 'totalEntries()' },
    // owner() returns the contract owner address — a simple no-arg view.
    { selector: '0x8da5cb5b', name: 'owner()' },
    // getEntry(uint256) requires an argument; pad with 64 hex zeros (32 bytes = one uint256).
    // id=0 triggers an EntryNotFound revert. A non-empty revert confirms the selector exists.
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
  const totalCount = toNumeric(await contract.totalEntries());

  if (totalCount === 0) return [];

  // Fetch entries individually by ID (1-indexed). The new contract exposes
  // getEntry(uint256) for single reads; there is no batch getEntries() method.
  // Entries are fetched in pages to avoid hammering the RPC with too many
  // simultaneous calls (concurrency limit = entryPageSize).
  const loaded = [];
  const pageSize = LEDGER_CONFIG.entryPageSize;

  for (let offset = 1; offset <= totalCount; offset += pageSize) {
    const end = Math.min(offset + pageSize - 1, totalCount);
    const ids = [];
    for (let id = offset; id <= end; id++) ids.push(id);
    const page = await Promise.all(ids.map((id) => contract.getEntry(id).then(normalizeEntry)));
    loaded.push(...page);
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
    renderPayoutView();
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
    syncPayoutWalletDefaults();
    renderPayoutView();
    return;
  }

  if (!isTargetNetwork(connectedChainId)) {
    isAdminWallet = false;
    setWalletStatus(
      `Wrong network. Switch to ${LEDGER_CONFIG.targetChainName} (chain ID ${LEDGER_CONFIG.targetChainId}) to use this ledger.`,
      true,
    );
    setFormEnabled(false);
    syncPayoutWalletDefaults();
    renderPayoutView();
    return;
  }

  let isOwner = false;
  try {
    const readContract = getReadContract().contract;
    const ownerAddress = await readContract.owner();
    isOwner = ownerAddress.toLowerCase() === currentAccount.toLowerCase();
  } catch (error) {
    console.error(error);
  }

  isAdminWallet = isOwner;
  setFormEnabled(isAdminWallet);

  if (isAdminWallet) {
    setWalletStatus(`Connected: ${shortAddress(currentAccount)} (admin write access)`);
  } else {
    setWalletStatus(`Connected: ${shortAddress(currentAccount)} (read-only; admin wallet required)`);
  }
  syncPayoutWalletDefaults();
  renderPayoutView();
}

async function refreshLedger() {
  renderStateRow('Loading live ledger data from chain...');

  // Validate contract existence and ABI compatibility before attempting reads.
  const { ok, reason } = await validateContractInterface();
  lastAbiStatus = ok ? ABI_STATUS_COMPATIBLE : `Incompatible — ${reason}`;
  if (activeView === 'wallet') updateWalletPanel();

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
  // Read selected soft-status from the form (defaults to PENDING if element absent).
  const statusValue = entryStatusEl ? entryStatusEl.value : 'PENDING';

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
  } else if (amount <= 0) {
    setFieldError('amount', 'Amount must be greater than zero.');
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
      status: statusValue,
    },
  };
}

async function handleEntrySubmit(event) {
  event.preventDefault();
  clearFieldErrors();

  if (!isAdminWallet) {
    setTxStatus('Only the contract owner can add entries.', 'error');
    return;
  }

  const { hasError, values } = parseSubmissionValues();
  if (hasError) return;

  const signerContract = await getSignerContract();
  if (!signerContract) return;

  const entryTypeValue = values.type === 'OUTGOING' ? TX_TYPE_OUTGOING : TX_TYPE_INCOMING;
  // Map the form status selection to the on-chain enum uint8.
  const entryStatusValue = values.status === 'REQUESTED' ? ENTRY_STATUS_REQUESTED : ENTRY_STATUS_PENDING;
  // Amount is stored as a plain whole-number uint256 (no decimal conversion needed).
  const amountValue = BigInt(Math.round(values.amount));

  if (amountValue === 0n) {
    setFieldError('amount', 'Amount must be greater than zero.');
    return;
  }

  await runTransaction('Entry creation', () =>
    signerContract.createEntry(
      entryTypeValue,
      entryStatusValue,
      amountValue,
      values.category,
      values.description,
      values.proofUrl,
    ),
  );

  entryFormEl.reset();
}

function appendShiftEvent(shift, type, actorWallet, clientTimestamp, serverTimestamp, notes = '') {
  shift.events = Array.isArray(shift.events) ? shift.events : [];
  shift.events.push({
    type,
    actorWallet,
    clientTimestamp,
    serverTimestamp,
    notes,
  });
}

function buildShiftLedgerMetadata(shift, approvedAmount, reviewerWallet) {
  const bucketCount = getShiftAccruedBuckets(shift);
  return {
    category: `Labor · ${shift.siteId}`,
    description: `Shift ${shift.id} · ${shift.workerName} (${shortAddress(shift.workerWallet)}) · ${shift.taskId} · reviewer ${shortAddress(reviewerWallet)} · ${bucketCount} x 15m buckets · approved ${approvedAmount} USD`,
  };
}

function getShiftLifecycleLabel(shift) {
  if (shift.settledAt) return STATUS_CONFIRMED;
  if (shift.ledgerStatus) return shift.ledgerStatus;
  if (shift.clockedOutAt) return STATUS_REQUESTED;
  return STATUS_PENDING;
}

function syncPayoutWalletDefaults() {
  if (currentAccount) {
    if (payoutQrReviewerWalletEl && !payoutQrReviewerWalletEl.value) payoutQrReviewerWalletEl.value = currentAccount;
    if (payoutReviewerWalletEl && !payoutReviewerWalletEl.value) payoutReviewerWalletEl.value = currentAccount;
    if (payoutWorkerWalletEl && !payoutWorkerWalletEl.value) payoutWorkerWalletEl.value = currentAccount;
  }
}

function renderPayoutSummary() {
  const activeCount = payoutState.shifts.filter((shift) => !shift.clockedOutAt && !shift.settledAt).length;
  const completedCount = payoutState.shifts.filter((shift) => Boolean(shift.clockedOutAt)).length;
  const requestedTotal = payoutState.shifts
    .filter((shift) => shift.clockedOutAt && !shift.settledAt)
    .reduce((sum, shift) => sum + getShiftDisplayAmount(shift), 0);
  const settledTotal = payoutState.shifts
    .filter((shift) => Boolean(shift.settledAt))
    .reduce((sum, shift) => sum + getShiftDisplayAmount(shift), 0);

  if (payoutActiveCountEl) payoutActiveCountEl.textContent = String(activeCount);
  if (payoutCompletedCountEl) payoutCompletedCountEl.textContent = String(completedCount);
  if (payoutRequestedTotalEl) payoutRequestedTotalEl.textContent = formatAmount(requestedTotal);
  if (payoutSettledTotalEl) payoutSettledTotalEl.textContent = formatAmount(settledTotal);
}

function renderPayoutWorkerStatus() {
  if (!payoutWorkerStatusEl) return;
  const activeShift = payoutState.shifts.find((shift) => !shift.clockedOutAt && !shift.settledAt);
  if (!activeShift) {
    setPayoutStatus(payoutWorkerStatusEl, 'No workers are currently clocked in.');
    return;
  }
  setPayoutStatus(
    payoutWorkerStatusEl,
    `${activeShift.workerName} is clocked in at ${activeShift.siteId} for ${activeShift.taskId}. Live accrual: ${formatShiftAccrual(activeShift)}.`,
    'info',
  );
}

function renderPayoutReviewOptions() {
  if (!payoutReviewShiftEl) return;
  const previousValue = payoutReviewShiftEl.value;
  payoutReviewShiftEl.innerHTML = '<option value="">Select a shift</option>';

  payoutState.shifts
    .filter((shift) => !shift.settledAt)
    .sort((a, b) => b.clockedInAt - a.clockedInAt)
    .forEach((shift) => {
      const option = document.createElement('option');
      option.value = shift.id;
      option.textContent = `${shift.workerName} · ${shift.siteId} / ${shift.taskId} · ${getShiftStatus(shift)}`;
      payoutReviewShiftEl.appendChild(option);
    });

  if (previousValue && payoutState.shifts.some((shift) => shift.id === previousValue && !shift.settledAt)) {
    payoutReviewShiftEl.value = previousValue;
  }
}

function createPayoutActionButton(label, actionKey, disabled, onClick, variant = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `table-action${variant ? ` ${variant}` : ''}`;
  button.textContent = label;
  button.disabled = disabled || payoutPendingActions.has(actionKey);
  button.addEventListener('click', onClick);
  return button;
}

function renderPayoutShiftTable() {
  if (!payoutShiftsBodyEl) return;
  payoutShiftsBodyEl.innerHTML = '';

  if (payoutState.shifts.length === 0) {
    payoutShiftsBodyEl.innerHTML = '<tr><td colspan="8" class="payout-empty">No shifts recorded yet.</td></tr>';
    return;
  }

  payoutState.shifts
    .slice()
    .sort((a, b) => b.clockedInAt - a.clockedInAt)
    .forEach((shift) => {
      const row = document.createElement('tr');

      const shiftCell = document.createElement('td');
      shiftCell.textContent = shift.id;
      row.appendChild(shiftCell);

      const workerCell = document.createElement('td');
      workerCell.innerHTML = '';
      const workerName = document.createElement('div');
      workerName.textContent = shift.workerName;
      const workerWallet = document.createElement('small');
      workerWallet.className = 'muted-text';
      workerWallet.textContent = shortAddress(shift.workerWallet);
      workerCell.appendChild(workerName);
      workerCell.appendChild(workerWallet);
      row.appendChild(workerCell);

      const siteCell = document.createElement('td');
      siteCell.innerHTML = '';
      const site = document.createElement('div');
      site.textContent = shift.siteId;
      const task = document.createElement('small');
      task.className = 'muted-text';
      task.textContent = shift.taskId;
      siteCell.appendChild(site);
      siteCell.appendChild(task);
      row.appendChild(siteCell);

      const statusCell = document.createElement('td');
      statusCell.appendChild(getStatusBadge(getShiftStatus(shift)));
      row.appendChild(statusCell);

      const clockCell = document.createElement('td');
      clockCell.innerHTML = '';
      const inTime = document.createElement('div');
      inTime.textContent = `In: ${formatLocalDateTime(shift.clockedInAt)}`;
      const outTime = document.createElement('small');
      outTime.className = 'muted-text';
      outTime.textContent = shift.clockedOutAt
        ? `Out: ${formatLocalDateTime(shift.clockedOutAt)}`
        : 'Out: active';
      clockCell.appendChild(inTime);
      clockCell.appendChild(outTime);
      row.appendChild(clockCell);

      const accruedCell = document.createElement('td');
      accruedCell.textContent = formatShiftAccrual(shift);
      row.appendChild(accruedCell);

      const reviewerCell = document.createElement('td');
      reviewerCell.textContent = shortAddress(shift.reviewerWallet);
      row.appendChild(reviewerCell);

      const actionsCell = document.createElement('td');
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'actions-wrap';
      if (!shift.clockedOutAt && !shift.settledAt) {
        actionsWrap.appendChild(
          createPayoutActionButton(
            'Clock out',
            `clock-out:${shift.id}`,
            false,
            () => handleClockOutShift(shift.id, 'worker'),
          ),
        );
        actionsWrap.appendChild(
          createPayoutActionButton(
            'Reviewer close',
            `reviewer-close:${shift.id}`,
            false,
            () => handleClockOutShift(shift.id, 'reviewer'),
          ),
        );
      }
      actionsWrap.appendChild(
        createPayoutActionButton(
          shift.settledAt ? 'Settled' : 'Review',
          `review:${shift.id}`,
          false,
          () => {
            if (payoutReviewShiftEl) payoutReviewShiftEl.value = shift.id;
            hydratePayoutReviewForm();
          },
        ),
      );
      actionsCell.appendChild(actionsWrap);
      row.appendChild(actionsCell);
      payoutShiftsBodyEl.appendChild(row);
    });
}

function renderPayoutLedgerTable() {
  if (!payoutBodyEl) return;
  payoutBodyEl.innerHTML = '';

  const visibleShifts = payoutState.shifts.filter((shift) => Boolean(shift.clockedOutAt || shift.settledAt));
  if (visibleShifts.length === 0) {
    payoutBodyEl.innerHTML = '<tr><td colspan="7" class="payout-empty">No payout records yet.</td></tr>';
    return;
  }

  visibleShifts
    .slice()
    .sort((a, b) => (b.settledAt || b.clockedOutAt) - (a.settledAt || a.clockedOutAt))
    .forEach((shift) => {
      const row = document.createElement('tr');
      [shift.id, `${shift.workerName} · ${shortAddress(shift.workerWallet)}`, formatAmount(getShiftDisplayAmount(shift))].forEach(
        (value) => {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.appendChild(cell);
        },
      );

      const lifecycleCell = document.createElement('td');
      lifecycleCell.appendChild(getStatusBadge(getShiftLifecycleLabel(shift)));
      const lifecycleMeta = document.createElement('div');
      lifecycleMeta.className = 'payout-meta-stack';
      if (shift.ledgerEntryId) {
        const entryMeta = document.createElement('small');
        entryMeta.className = 'muted-text';
        entryMeta.textContent = `Ledger entry #${shift.ledgerEntryId}`;
        lifecycleMeta.appendChild(entryMeta);
      }
      if (shift.adjustmentReason) {
        const note = document.createElement('small');
        note.className = 'muted-text';
        note.textContent = `Adjustment: ${shift.adjustmentReason}`;
        lifecycleMeta.appendChild(note);
      }
      lifecycleCell.appendChild(lifecycleMeta);
      row.appendChild(lifecycleCell);

      const approverCell = document.createElement('td');
      approverCell.textContent = shift.settledBy ? shortAddress(shift.settledBy) : '—';
      row.appendChild(approverCell);

      const settledCell = document.createElement('td');
      settledCell.textContent = shift.settledAt ? formatLocalDateTime(shift.settledAt) : 'Pending';
      row.appendChild(settledCell);

      const proofCell = document.createElement('td');
      const proofLinks = document.createElement('div');
      proofLinks.className = 'payout-proof-links';
      if (shift.proofUrl && isValidUrl(shift.proofUrl)) {
        const proofLink = document.createElement('a');
        proofLink.href = shift.proofUrl;
        proofLink.target = '_blank';
        proofLink.rel = 'noopener noreferrer';
        proofLink.textContent = 'Settlement proof';
        proofLinks.appendChild(proofLink);
      }
      if (shift.ledgerConfirmedTxHash) {
        const txProof = document.createElement('a');
        txProof.href = txLink(shift.ledgerConfirmedTxHash);
        txProof.target = '_blank';
        txProof.rel = 'noopener noreferrer';
        txProof.textContent = 'Ledger confirmation tx';
        proofLinks.appendChild(txProof);
      }
      if (proofLinks.childNodes.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'muted-text';
        empty.textContent = 'No proof yet';
        proofLinks.appendChild(empty);
      }
      proofCell.appendChild(proofLinks);
      row.appendChild(proofCell);

      payoutBodyEl.appendChild(row);
    });
}

function renderPayoutEventTable() {
  if (!payoutEventsBodyEl) return;
  payoutEventsBodyEl.innerHTML = '';
  const events = getPayoutEventRows();

  if (events.length === 0) {
    payoutEventsBodyEl.innerHTML = '<tr><td colspan="6" class="payout-empty">No payout events logged yet.</td></tr>';
    return;
  }

  events.slice(0, MAX_DISPLAYED_PAYOUT_EVENTS).forEach((event) => {
    const row = document.createElement('tr');
    [
      formatLocalDateTime(event.clientTimestamp),
      event.shiftId,
      event.type,
      shortAddress(event.actorWallet),
      event.serverTimestamp || 'Unavailable',
      event.notes || '—',
    ].forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    });
    payoutEventsBodyEl.appendChild(row);
  });
}

function renderPayoutView() {
  renderPayoutSummary();
  renderPayoutWorkerStatus();
  renderPayoutReviewOptions();
  renderPayoutShiftTable();
  renderPayoutLedgerTable();
  renderPayoutEventTable();
  if (payoutReviewShiftEl && payoutReviewShiftEl.value) hydratePayoutReviewForm(false);
}

async function handleGenerateQrPayload(event) {
  event.preventDefault();
  syncPayoutWalletDefaults();
  const siteId = payoutSiteIdEl ? payoutSiteIdEl.value.trim() : '';
  const taskId = payoutTaskIdEl ? payoutTaskIdEl.value.trim() : '';
  const ratePerHour = Number(payoutHourlyRateEl ? payoutHourlyRateEl.value.trim() : 0);
  const reviewerWallet = normalizeWallet(
    (payoutQrReviewerWalletEl && payoutQrReviewerWalletEl.value) || currentAccount,
  );

  if (!siteId || !taskId) {
    setPayoutStatus(payoutQrStatusEl, 'Site ID and task context are required to generate a QR payload.', 'error');
    return;
  }
  if (
    !Number.isInteger(ratePerHour) ||
    ratePerHour < MIN_HOURLY_RATE_USD ||
    ratePerHour % ACCRUAL_BUCKETS_PER_HOUR !== 0
  ) {
    setPayoutStatus(
      payoutQrStatusEl,
      'Hourly rate must be a whole USD value divisible by 4 so each 15-minute accrual bucket stays ledger-safe.',
      'error',
    );
    return;
  }
  if (!isWalletAddress(reviewerWallet)) {
    setPayoutStatus(payoutQrStatusEl, 'Connect or enter a valid reviewer wallet to sign the QR payload.', 'error');
    return;
  }

  const ethereumProvider = getEthereumProvider();
  if (!ethereumProvider) {
    setPayoutStatus(payoutQrStatusEl, 'Connect the reviewer/admin wallet before generating a signed QR payload.', 'error');
    return;
  }

  try {
    const browserProvider = new window.ethers.BrowserProvider(ethereumProvider, 'any');
    const signer = await browserProvider.getSigner();
    const signerAddress = normalizeWallet(await signer.getAddress());
    if (signerAddress.toLowerCase() !== reviewerWallet.toLowerCase()) {
      setPayoutStatus(
        payoutQrStatusEl,
        'The connected wallet must match the reviewer wallet embedded in the QR payload.',
        'error',
      );
      return;
    }

    const payload = {
      siteId,
      taskId,
      nonce: createActionId('nonce'),
      issuedAt: new Date().toISOString(),
      reviewerWallet,
      ratePerHour,
    };
    payload.signature = await signer.signMessage(buildQrMessage(payload));

    if (payoutGeneratedQrEl) payoutGeneratedQrEl.value = JSON.stringify(payload, null, 2);
    if (payoutQrPayloadEl) payoutQrPayloadEl.value = JSON.stringify(payload, null, 2);
    setPayoutStatus(
      payoutQrStatusEl,
      `Signed QR payload ready for ${siteId}/${taskId}. It expires in 10 minutes unless it is scanned first.`,
      'success',
    );
  } catch (error) {
    setPayoutStatus(payoutQrStatusEl, getErrorMessage(error, 'Unable to sign QR payload.'), 'error');
  }
}

function parseSignedQrPayload(payloadText) {
  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    throw new Error('QR payload must be valid JSON.');
  }

  const siteId = String(payload.siteId || '').trim();
  const taskId = String(payload.taskId || '').trim();
  const nonce = String(payload.nonce || '').trim();
  const issuedAt = String(payload.issuedAt || '').trim();
  const reviewerWallet = normalizeWallet(payload.reviewerWallet);
  const signature = String(payload.signature || '').trim();
  const ratePerHour = Number(payload.ratePerHour);
  const issuedAtMs = Date.parse(issuedAt);

  if (!siteId || !taskId || !nonce || !issuedAt || !signature) {
    throw new Error('QR payload is missing site, task, nonce, timestamp, or signature fields.');
  }
  if (!Number.isFinite(issuedAtMs)) {
    throw new Error('QR payload timestamp is invalid.');
  }
  if (
    !Number.isInteger(ratePerHour) ||
    ratePerHour < MIN_HOURLY_RATE_USD ||
    ratePerHour % ACCRUAL_BUCKETS_PER_HOUR !== 0
  ) {
    throw new Error('QR payload hourly rate must be a whole USD value divisible by 4.');
  }
  if (!isWalletAddress(reviewerWallet)) {
    throw new Error('QR payload reviewer wallet is invalid.');
  }
  if (issuedAtMs > Date.now() || Date.now() - issuedAtMs > QR_EXPIRATION_WINDOW_MS) {
    throw new Error('QR payload expired or is not yet valid. Generate a fresh signed QR code and try again.');
  }
  if (payoutState.usedNonces[`${siteId}:${nonce}`]) {
    throw new Error('This QR payload nonce has already been used. Duplicate clock-ins are blocked.');
  }

  const signedPayload = {
    siteId,
    taskId,
    nonce,
    issuedAt,
    reviewerWallet,
    ratePerHour,
  };
  const recoveredWallet = normalizeWallet(window.ethers.verifyMessage(buildQrMessage(signedPayload), signature));

  if (recoveredWallet.toLowerCase() !== reviewerWallet.toLowerCase()) {
    throw new Error('QR payload signature verification failed.');
  }

  return {
    siteId,
    taskId,
    nonce,
    issuedAt,
    issuedAtMs,
    reviewerWallet,
    ratePerHour,
    signature,
  };
}

async function handleClockInSubmit(event) {
  event.preventDefault();
  const workerName = payoutWorkerNameEl ? payoutWorkerNameEl.value.trim() : '';
  const workerWallet = normalizeWallet(payoutWorkerWalletEl ? payoutWorkerWalletEl.value : '');
  const qrPayload = payoutQrPayloadEl ? payoutQrPayloadEl.value.trim() : '';

  if (!workerName) {
    setPayoutStatus(payoutWorkerStatusEl, 'Worker name is required.', 'error');
    return;
  }
  if (!isWalletAddress(workerWallet)) {
    setPayoutStatus(payoutWorkerStatusEl, 'Enter a valid worker wallet before clocking in.', 'error');
    return;
  }
  if (!qrPayload) {
    setPayoutStatus(payoutWorkerStatusEl, 'Paste the signed QR payload before clocking in.', 'error');
    return;
  }

  let parsedPayload;
  try {
    parsedPayload = parseSignedQrPayload(qrPayload);
  } catch (error) {
    setPayoutStatus(payoutWorkerStatusEl, error.message, 'error');
    return;
  }

  if (getActiveShiftForWorkerSite(workerWallet, parsedPayload.siteId)) {
    setPayoutStatus(
      payoutWorkerStatusEl,
      'This worker already has an active shift at the selected site. Overlapping active intervals are blocked.',
      'error',
    );
    return;
  }

  const clientTimestamp = new Date().toISOString();
  const serverTimestamp = await getPayoutServerTimestamp();
  const shift = {
    id: createActionId('shift'),
    siteId: parsedPayload.siteId,
    taskId: parsedPayload.taskId,
    qrNonce: parsedPayload.nonce,
    qrIssuedAt: parsedPayload.issuedAt,
    workerName,
    workerWallet,
    reviewerWallet: parsedPayload.reviewerWallet,
    ratePerHour: parsedPayload.ratePerHour,
    clockedInAt: Date.now(),
    clockedOutAt: null,
    closedBy: '',
    proofUrl: '',
    approvedAmount: null,
    adjustmentReason: '',
    ledgerEntryId: null,
    ledgerAmount: null,
    ledgerStatus: '',
    ledgerRequestedTxHash: '',
    ledgerCommittedTxHash: '',
    ledgerConfirmedTxHash: '',
    settlementIdempotencyKey: createActionId(`settle-${parsedPayload.siteId}`),
    settledAt: null,
    settledBy: '',
    events: [],
  };

  appendShiftEvent(
    shift,
    'CLOCK_IN',
    workerWallet,
    clientTimestamp,
    serverTimestamp,
    `Signed QR from reviewer ${shortAddress(parsedPayload.reviewerWallet)}`,
  );

  payoutState.shifts.unshift(shift);
  payoutState.usedNonces[`${parsedPayload.siteId}:${parsedPayload.nonce}`] = shift.id;
  savePayoutState();
  renderPayoutView();
  if (payoutClockInFormEl) payoutClockInFormEl.reset();
  syncPayoutWalletDefaults();
  setPayoutStatus(
    payoutWorkerStatusEl,
    `${workerName} clocked in at ${parsedPayload.siteId}. Accrual now ticks every 15 minutes.`,
    'success',
  );
}

async function closeShiftRecord(shift, closedBy, actorWallet) {
  shift.clockedOutAt = Date.now();
  shift.closedBy = closedBy;
  const clientTimestamp = new Date().toISOString();
  const serverTimestamp = await getPayoutServerTimestamp();
  appendShiftEvent(
    shift,
    'CLOCK_OUT',
    actorWallet,
    clientTimestamp,
    serverTimestamp,
    closedBy === 'reviewer' ? 'Reviewer closed the shift.' : 'Worker clocked out.',
  );
  savePayoutState();
}

async function handleClockOutShift(shiftId, closedBy) {
  const shift = findShiftById(shiftId);
  if (!shift) return;
  if (shift.clockedOutAt || shift.settledAt) {
    setPayoutStatus(payoutReviewStatusEl, 'This shift is already closed.', 'error');
    return;
  }

  const actionKey = `${closedBy === 'reviewer' ? 'reviewer-close' : 'clock-out'}:${shiftId}`;
  if (payoutPendingActions.has(actionKey)) return;

  setPayoutActionPending(actionKey, true);
  try {
    const actorWallet =
      closedBy === 'reviewer'
        ? normalizeWallet((payoutReviewerWalletEl && payoutReviewerWalletEl.value) || currentAccount || shift.reviewerWallet)
        : shift.workerWallet;
    await closeShiftRecord(shift, closedBy, actorWallet);
    renderPayoutView();
    setPayoutStatus(
      closedBy === 'reviewer' ? payoutReviewStatusEl : payoutWorkerStatusEl,
      `${shift.workerName} clocked out. Pending labor amount: ${formatAmount(getShiftAccruedAmount(shift))}.`,
      'success',
    );
  } finally {
    setPayoutActionPending(actionKey, false);
  }
}

function hydratePayoutReviewForm(announce = true) {
  if (!payoutReviewShiftEl) return;
  const shift = findShiftById(payoutReviewShiftEl.value);
  syncPayoutWalletDefaults();

  if (!shift) {
    if (payoutApprovedAmountEl) payoutApprovedAmountEl.value = '';
    return;
  }

  if (payoutApprovedAmountEl && payoutApprovedAmountEl.value === '') {
    payoutApprovedAmountEl.value = String(getShiftDisplayAmount(shift));
  }
  if (payoutProofUrlEl && !payoutProofUrlEl.value && shift.proofUrl) payoutProofUrlEl.value = shift.proofUrl;
  if (payoutAdjustmentReasonEl && !payoutAdjustmentReasonEl.value && shift.adjustmentReason) {
    payoutAdjustmentReasonEl.value = shift.adjustmentReason;
  }
  if (payoutReviewerWalletEl && !payoutReviewerWalletEl.value) {
    payoutReviewerWalletEl.value = shift.reviewerWallet || currentAccount;
  }

  if (announce) {
    setPayoutStatus(
      payoutReviewStatusEl,
      `${shift.workerName}: ${formatShiftAccrual(shift)} · ledger ${shift.ledgerEntryId ? `#${shift.ledgerEntryId}` : 'not synced yet'}.`,
      'info',
    );
  }
}

async function syncRequestedLedger(shift, approvedAmount, reviewerWallet, reasonNote) {
  if (!isAdminWallet) {
    return { ok: false, message: 'Connect the admin wallet on Optimism to sync payout lifecycle artifacts to ProjectLedger.' };
  }
  if (!shift.clockedOutAt) {
    await closeShiftRecord(shift, 'reviewer', reviewerWallet);
  }

  const actionKey = `ledger-request:${shift.id}`;
  if (payoutPendingActions.has(actionKey)) {
    return { ok: false, message: 'Ledger sync already in progress for this shift.' };
  }

  setPayoutActionPending(actionKey, true);
  try {
    const signerContract = await getSignerContract();
    if (!signerContract) {
      return { ok: false, message: 'Unable to access the signer contract.' };
    }

    if (shift.ledgerEntryId) {
      if (toWholeUsd(shift.ledgerAmount) !== approvedAmount && shift.ledgerStatus === STATUS_REQUESTED) {
        const result = await runTransaction('Labor ledger amount update', () =>
          signerContract.updatePendingAmount(
            shift.ledgerEntryId,
            BigInt(toWholeUsd(approvedAmount)),
            reasonNote || 'Reviewer adjusted payout before settlement.',
            '',
          ),
        );
        if (!result) return { ok: false, message: 'Unable to update the pending labor amount on-chain.' };
        shift.ledgerAmount = approvedAmount;
        shift.ledgerStatus = STATUS_REQUESTED;
        appendShiftEvent(
          shift,
          'LEDGER_REQUEST_UPDATED',
          reviewerWallet,
          new Date().toISOString(),
          await getPayoutServerTimestamp(),
          `Updated ProjectLedger entry #${shift.ledgerEntryId} to ${approvedAmount} USD.`,
        );
        savePayoutState();
      }
      return { ok: true, entryId: shift.ledgerEntryId };
    }

    const { contract: readContract } = getReadContract();
    const previousTotal = toNumeric(await readContract.totalEntries());
    const payload = buildShiftLedgerMetadata(shift, approvedAmount, reviewerWallet);
    const result = await runTransaction('Labor request ledger sync', () =>
      signerContract.createEntry(
        TX_TYPE_OUTGOING,
        ENTRY_STATUS_REQUESTED,
        BigInt(toWholeUsd(approvedAmount)),
        payload.category,
        payload.description,
        '',
      ),
    );
    if (!result) return { ok: false, message: 'Unable to create the requested labor ledger entry.' };

    shift.ledgerEntryId = previousTotal + 1;
    shift.ledgerAmount = approvedAmount;
    shift.ledgerStatus = STATUS_REQUESTED;
    shift.ledgerRequestedTxHash = result.tx.hash;
    appendShiftEvent(
      shift,
      'LEDGER_REQUEST_CREATED',
      reviewerWallet,
      new Date().toISOString(),
      await getPayoutServerTimestamp(),
      `Created ProjectLedger entry #${shift.ledgerEntryId} for ${approvedAmount} USD.`,
    );
    savePayoutState();
    return { ok: true, entryId: shift.ledgerEntryId };
  } finally {
    setPayoutActionPending(actionKey, false);
  }
}

async function handleSyncRequestedLedger() {
  const shift = findShiftById(payoutReviewShiftEl ? payoutReviewShiftEl.value : '');
  if (!shift) {
    setPayoutStatus(payoutReviewStatusEl, 'Select a shift before syncing the requested ledger entry.', 'error');
    return;
  }

  const approvedAmount = toWholeUsd(payoutApprovedAmountEl ? payoutApprovedAmountEl.value : 0);
  const reviewerWallet = normalizeWallet((payoutReviewerWalletEl && payoutReviewerWalletEl.value) || currentAccount);
  if (!isWalletAddress(reviewerWallet)) {
    setPayoutStatus(payoutReviewStatusEl, 'Enter a valid reviewer wallet before syncing the ledger.', 'error');
    return;
  }
  if (!Number.isInteger(approvedAmount) || approvedAmount < 0) {
    setPayoutStatus(payoutReviewStatusEl, 'Approved amount must be a whole number greater than or equal to zero.', 'error');
    return;
  }
  if (!shift.ledgerEntryId && approvedAmount < 1) {
    setPayoutStatus(payoutReviewStatusEl, 'Requested ledger sync requires an approved amount of at least 1 USD.', 'error');
    return;
  }

  const reasonNote = payoutAdjustmentReasonEl ? payoutAdjustmentReasonEl.value.trim() : '';
  const result = await syncRequestedLedger(shift, approvedAmount, reviewerWallet, reasonNote);
  renderPayoutView();
  setPayoutStatus(
    payoutReviewStatusEl,
    result.ok
      ? `Requested labor entry synced${shift.ledgerEntryId ? ` as #${shift.ledgerEntryId}` : ''}.`
      : result.message,
    result.ok ? 'success' : 'error',
  );
}

async function handlePayoutReviewSubmit(event) {
  event.preventDefault();
  const shift = findShiftById(payoutReviewShiftEl ? payoutReviewShiftEl.value : '');
  if (!shift) {
    setPayoutStatus(payoutReviewStatusEl, 'Select a shift before approving or settling.', 'error');
    return;
  }

  const reviewerWallet = normalizeWallet((payoutReviewerWalletEl && payoutReviewerWalletEl.value) || currentAccount);
  const approvedAmount = toWholeUsd(payoutApprovedAmountEl ? payoutApprovedAmountEl.value : 0);
  const proofUrl = payoutProofUrlEl ? payoutProofUrlEl.value.trim() : '';
  const adjustmentReason = payoutAdjustmentReasonEl ? payoutAdjustmentReasonEl.value.trim() : '';
  const syncLedgerSelection = Boolean(payoutSyncLedgerEl && payoutSyncLedgerEl.checked);
  const accruedAmount = toWholeUsd(getShiftAccruedAmount(shift));

  if (!isWalletAddress(reviewerWallet)) {
    setPayoutStatus(payoutReviewStatusEl, 'Reviewer wallet is required and must be valid.', 'error');
    return;
  }
  if (!Number.isInteger(approvedAmount) || approvedAmount < 0) {
    setPayoutStatus(payoutReviewStatusEl, 'Approved amount must be a whole USD number greater than or equal to zero.', 'error');
    return;
  }
  if (!proofUrl || !isValidUrl(proofUrl)) {
    setPayoutStatus(payoutReviewStatusEl, 'A valid settlement proof URL is required.', 'error');
    return;
  }
  if (syncLedgerSelection && approvedAmount < 1) {
    setPayoutStatus(payoutReviewStatusEl, 'Public-ledger settlement requires an approved amount of at least 1 USD.', 'error');
    return;
  }
  if (approvedAmount !== accruedAmount && !adjustmentReason) {
    setPayoutStatus(
      payoutReviewStatusEl,
      approvedAmount < accruedAmount
        ? 'A reason is required for a downward payout adjustment.'
        : 'A reason is required when settling above the accrued amount.',
      'error',
    );
    return;
  }
  if (shift.settledAt || isProcessedAction(shift.settlementIdempotencyKey)) {
    setPayoutStatus(payoutReviewStatusEl, 'This shift has already been settled. Duplicate settlement is blocked.', 'error');
    return;
  }
  if (payoutPendingActions.has(shift.settlementIdempotencyKey)) {
    setPayoutStatus(payoutReviewStatusEl, 'Settlement already in progress for this shift.', 'error');
    return;
  }

  setPayoutActionPending(shift.settlementIdempotencyKey, true);
  try {
    if (!shift.clockedOutAt) {
      await closeShiftRecord(shift, 'reviewer', reviewerWallet);
    }

    if (syncLedgerSelection) {
      const requestSync = await syncRequestedLedger(shift, approvedAmount, reviewerWallet, adjustmentReason);
      if (!requestSync.ok) {
        setPayoutStatus(payoutReviewStatusEl, requestSync.message, 'error');
        return;
      }

      const signerContract = await getSignerContract();
      if (!signerContract) {
        setPayoutStatus(payoutReviewStatusEl, 'Unable to access the signer contract for settlement.', 'error');
        return;
      }

      if (shift.ledgerStatus !== STATUS_COMMITTED && shift.ledgerStatus !== STATUS_CONFIRMED) {
        const commitResult = await runTransaction('Labor approval commit', () =>
          signerContract.updateStatus(shift.ledgerEntryId, ENTRY_STATUS_COMMITTED),
        );
        if (!commitResult) {
          setPayoutStatus(payoutReviewStatusEl, 'Unable to commit the requested labor entry.', 'error');
          return;
        }
        shift.ledgerStatus = STATUS_COMMITTED;
        shift.ledgerCommittedTxHash = commitResult.tx.hash;
        appendShiftEvent(
          shift,
          'LEDGER_COMMITTED',
          reviewerWallet,
          new Date().toISOString(),
          await getPayoutServerTimestamp(),
          `Committed ProjectLedger entry #${shift.ledgerEntryId}.`,
        );
      }

      const confirmResult = await runTransaction('Labor settlement confirmation', () =>
        signerContract.confirmEntry(shift.ledgerEntryId, proofUrl),
      );
      if (!confirmResult) {
        setPayoutStatus(payoutReviewStatusEl, 'Unable to confirm the labor settlement entry.', 'error');
        return;
      }
      shift.ledgerStatus = STATUS_CONFIRMED;
      shift.ledgerConfirmedTxHash = confirmResult.tx.hash;
    }

    shift.approvedAmount = approvedAmount;
    shift.adjustmentReason = adjustmentReason;
    shift.proofUrl = proofUrl;
    shift.reviewerWallet = reviewerWallet;
    shift.settledAt = Date.now();
    shift.settledBy = reviewerWallet;
    appendShiftEvent(
      shift,
      'SETTLED',
      reviewerWallet,
      new Date().toISOString(),
      await getPayoutServerTimestamp(),
      syncLedgerSelection && shift.ledgerEntryId
        ? `Settled via ProjectLedger entry #${shift.ledgerEntryId}.`
        : 'Settled off-chain without public ledger sync.',
    );
    recordProcessedAction(shift.settlementIdempotencyKey, {
      shiftId: shift.id,
      ledgerEntryId: shift.ledgerEntryId,
    });
    savePayoutState();
    renderPayoutView();
    setPayoutStatus(
      payoutReviewStatusEl,
      `Shift ${shift.id} settled${shift.ledgerEntryId ? ` with ProjectLedger entry #${shift.ledgerEntryId}` : ''}.`,
      'success',
    );
  } finally {
    setPayoutActionPending(shift.settlementIdempotencyKey, false);
  }
}

function handleUseAccruedAmount() {
  const shift = findShiftById(payoutReviewShiftEl ? payoutReviewShiftEl.value : '');
  if (!shift || !payoutApprovedAmountEl) return;
  payoutApprovedAmountEl.value = String(getShiftAccruedAmount(shift));
  hydratePayoutReviewForm();
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
  if (walletConnectBtnEl) {
    walletConnectBtnEl.addEventListener('click', connectWallet);
  }

  [typeFilterEl, statusFilterEl, searchFilterEl].forEach((el) => {
    el.addEventListener('input', renderTable);
  });

  if (entryFormEl) {
    entryFormEl.addEventListener('submit', handleEntrySubmit);
  }

  if (payoutQrGeneratorFormEl) {
    payoutQrGeneratorFormEl.addEventListener('submit', handleGenerateQrPayload);
  }

  if (payoutClockInFormEl) {
    payoutClockInFormEl.addEventListener('submit', handleClockInSubmit);
  }

  if (payoutReviewShiftEl) {
    payoutReviewShiftEl.addEventListener('change', () => {
      if (payoutApprovedAmountEl) payoutApprovedAmountEl.value = '';
      if (payoutAdjustmentReasonEl) payoutAdjustmentReasonEl.value = '';
      if (payoutProofUrlEl) payoutProofUrlEl.value = '';
      hydratePayoutReviewForm();
    });
  }

  if (payoutUseAccruedBtnEl) {
    payoutUseAccruedBtnEl.addEventListener('click', handleUseAccruedAmount);
  }

  if (payoutSyncLedgerBtnEl) {
    payoutSyncLedgerBtnEl.addEventListener('click', handleSyncRequestedLedger);
  }

  if (payoutReviewFormEl) {
    payoutReviewFormEl.addEventListener('submit', handlePayoutReviewSubmit);
  }

  // Set Ledger as the default active view on load
  setActiveView('ledger');

  bindWalletEvents();
  syncPayoutWalletDefaults();
  renderPayoutView();
  hydratePayoutReviewForm();
  await refreshWalletState();
  await refreshLedger();
}

init();
