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

// --- Ledger ---
const ledgerBody = document.getElementById('ledger-body');
const totalRaisedEl = document.getElementById('total-raised');
const totalSpentEl = document.getElementById('total-spent');
const balanceEl = document.getElementById('balance');
const typeFilterEl = document.getElementById('type-filter');
const statusFilterEl = document.getElementById('status-filter');
const searchFilterEl = document.getElementById('search-filter');
const entryFormEl = document.getElementById('entry-form');
const entryTypeEl = document.getElementById('entry-type');
const entryStatusEl = document.getElementById('entry-status');
const entryAmountEl = document.getElementById('entry-amount');
const entryCategoryEl = document.getElementById('entry-category');
const entryDescriptionEl = document.getElementById('entry-description');
const entryReferenceEl = document.getElementById('entry-reference');
const entryDateEl = document.getElementById('entry-date');

let entries = [];
let nextEntrySequence = 1;
const STATUS_PENDING = 'PENDING';
const STATUS_CONFIRMED = 'CONFIRMED';

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

function formatAmount(value) {
  return currency.format(Number(value) || 0);
}

function updateSummaryDisplay(summary) {
  totalRaisedEl.textContent = summary.totalRaised;
  totalSpentEl.textContent = summary.totalSpent;
  balanceEl.textContent = summary.balance;
}

function calculateSummary(allEntries) {
  const totalRaised = allEntries
    .filter((entry) => entry.type === 'INCOMING')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  const totalSpent = allEntries
    .filter((entry) => entry.type === 'OUTGOING')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  updateSummaryDisplay({
    totalRaised: formatAmount(totalRaised),
    totalSpent: formatAmount(totalSpent),
    balance: formatAmount(totalRaised - totalSpent),
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
      textQuery.length === 0 ||
      `${entry.category} ${entry.description}`.toLowerCase().includes(textQuery);

    return typeMatch && statusMatch && textMatch;
  });
}

function getSafeProofUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch (error) {}

  return '#';
}

function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function normalizeStatus(status) {
  if (status === STATUS_PENDING || status === STATUS_CONFIRMED) {
    return status;
  }

  if (typeof status === 'string' && status.length > 0) {
    console.warn(
      `Unknown ledger status "${status}" found. Valid statuses are ${STATUS_PENDING} or ${STATUS_CONFIRMED}. Defaulting to ${STATUS_PENDING}.`,
    );
  }

  return STATUS_PENDING;
}

function normalizeEntry(entry) {
  return {
    ...entry,
    status: normalizeStatus(entry.status),
    reference: typeof entry.reference === 'string' ? entry.reference : '',
    settledAt: Number(entry.settledAt) || 0,
    auditTrail: Array.isArray(entry.auditTrail) ? entry.auditTrail : [],
  };
}

function calculateNextEntrySequence(allEntries) {
  const maxId = allEntries.reduce((max, entry) => {
    const match = typeof entry.id === 'string' ? entry.id.match(/^L-(\d+)$/) : null;
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);

  return maxId + 1;
}

function getNextEntryId() {
  const nextId = `L-${String(nextEntrySequence).padStart(3, '0')}`;
  nextEntrySequence += 1;
  return nextId;
}

function setDefaultEntryDate() {
  if (entryDateEl) {
    entryDateEl.value = new Date().toISOString().slice(0, 10);
  }
}

function setFieldError(fieldName, message) {
  const errorEl = document.getElementById(`entry-${fieldName}-error`);
  if (errorEl) errorEl.textContent = message;
}

function clearFieldErrors() {
  ['type', 'status', 'amount', 'category', 'description', 'reference', 'date'].forEach((fieldName) => {
    setFieldError(fieldName, '');
  });
}

function appendAuditRecord(entry, eventType, details = {}) {
  if (!Array.isArray(entry.auditTrail)) {
    entry.auditTrail = [];
  }

  entry.auditTrail.push({
    eventType,
    timestamp: new Date().toISOString(),
    ...details,
  });
}

function handleEntrySubmit(event) {
  event.preventDefault();
  clearFieldErrors();

  const type = entryTypeEl.value;
  const status = entryStatusEl.value || STATUS_PENDING;
  const amountValue = entryAmountEl.value.trim();
  const amount = Number(amountValue);
  const category = entryCategoryEl.value.trim();
  const description = entryDescriptionEl.value.trim();
  const reference = entryReferenceEl.value.trim();
  const date = entryDateEl.value;

  let hasError = false;

  if (!type) {
    setFieldError('type', 'Type is required.');
    hasError = true;
  }

  if (!status) {
    setFieldError('status', 'Status is required.');
    hasError = true;
  }

  if (!amountValue) {
    setFieldError('amount', 'Amount is required.');
    hasError = true;
  } else if (Number.isNaN(amount) || amount < 0.01) {
    setFieldError('amount', 'Amount must be a number greater than or equal to 0.01.');
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

  if (reference && !isValidUrl(reference)) {
    setFieldError('reference', 'Reference URL must be a valid http/https URL.');
    hasError = true;
  }

  if (!date) {
    setFieldError('date', 'Date is required.');
    hasError = true;
  }

  if (hasError) return;

  const entry = normalizeEntry({
    id: getNextEntryId(),
    date,
    type,
    status,
    amount,
    category,
    description,
    reference,
  });

  appendAuditRecord(entry, 'ENTRY_CREATED', {
    status,
    referenceURI: reference,
  });

  entries.push(entry);

  calculateSummary(entries);
  renderTable();
  entryFormEl.reset();
  setDefaultEntryDate();
}

function getStatusBadge(status) {
  const badge = document.createElement('span');
  const isConfirmed = status === STATUS_CONFIRMED;
  badge.className = `status-badge ${isConfirmed ? 'status-confirmed' : 'status-pending'}`;
  badge.textContent = isConfirmed ? STATUS_CONFIRMED : STATUS_PENDING;
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

function handleConfirmEntry(entryId) {
  const entry = entries.find((item) => item.id === entryId);
  if (!entry || entry.status !== STATUS_PENDING) return;

  const proofUrl = window.prompt(
    `Confirm ${entry.id} with a proof URL (bank statement, receipt, or explorer transaction link).`,
    entry.reference || '',
  );

  if (proofUrl === null) return;

  const trimmedProofUrl = proofUrl.trim();

  if (!trimmedProofUrl) {
    window.alert('A valid proof URL (http/https) is required to confirm an entry.');
    return;
  }

  if (!isValidUrl(trimmedProofUrl)) {
    window.alert('Proof URL must be a valid http/https URL.');
    return;
  }

  entry.status = STATUS_CONFIRMED;
  entry.reference = trimmedProofUrl;
  entry.settledAt = Date.now();
  appendAuditRecord(entry, 'ENTRY_CONFIRMED', {
    status: STATUS_CONFIRMED,
    referenceURI: trimmedProofUrl,
    settledAt: entry.settledAt,
  });

  renderTable();
}

function createActionsCell(entry) {
  const actionsCell = document.createElement('td');

  if (entry.status !== STATUS_PENDING) {
    const confirmedLabel = document.createElement('span');
    confirmedLabel.className = 'muted-text';
    confirmedLabel.textContent = 'Confirmed';
    actionsCell.appendChild(confirmedLabel);
    return actionsCell;
  }

  const confirmButton = document.createElement('button');
  confirmButton.type = 'button';
  confirmButton.className = 'table-action';
  confirmButton.textContent = 'Confirm';
  confirmButton.addEventListener('click', () => handleConfirmEntry(entry.id));
  actionsCell.appendChild(confirmButton);

  return actionsCell;
}

function renderTable() {
  const filtered = getFilteredEntries();

  ledgerBody.innerHTML = '';

  filtered.forEach((entry) => {
    const row = document.createElement('tr');
    [entry.id, entry.date, entry.type].forEach((value) => {
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

async function init() {
  try {
    const response = await fetch('../data/seed-ledger.json');
    if (!response.ok) {
      throw new Error(`Failed to load ledger data: ${response.status}`);
    }

    const data = await response.json();
    entries = Array.isArray(data.entries) ? data.entries.map(normalizeEntry) : [];
    nextEntrySequence = calculateNextEntrySequence(entries);

    calculateSummary(entries);
    renderTable();
  } catch (error) {
    ledgerBody.innerHTML =
      '<tr><td colspan="9">Unable to load ledger data. Please check your connection and refresh the page.</td></tr>';
    console.error(error);
  }
}

[typeFilterEl, statusFilterEl, searchFilterEl].forEach((el) => {
  el.addEventListener('input', renderTable);
});

if (entryFormEl) {
  setDefaultEntryDate();
  entryFormEl.addEventListener('submit', handleEntrySubmit);
}

init();
