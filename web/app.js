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
const pendingRaisedEl = document.getElementById('pending-raised');
const pendingSpentEl = document.getElementById('pending-spent');
const requestSpentEl = document.getElementById('request-spent');
const pendingBalanceEl = document.getElementById('pending-balance');
const typeFilterEl = document.getElementById('type-filter');
const statusFilterEl = document.getElementById('status-filter');
const searchFilterEl = document.getElementById('search-filter');
const entryFormEl = document.getElementById('entry-form');
const entryTypeEl = document.getElementById('entry-type');
const entryStatusEl = document.getElementById('entry-status');
const entryAmountEl = document.getElementById('entry-amount');
const entryCategoryEl = document.getElementById('entry-category');
const entryDescriptionEl = document.getElementById('entry-description');
const entryProofEl = document.getElementById('entry-proof');
const entryDateEl = document.getElementById('entry-date');

let entries = [];
let nextEntrySequence = 1;
const STATUS_PENDING = 'PENDING';
const STATUS_SETTLED = 'SETTLED';
const STATUS_REQUEST = 'REQUEST';

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

  if (pendingRaisedEl) pendingRaisedEl.textContent = summary.pendingRaised;
  if (pendingSpentEl) pendingSpentEl.textContent = summary.pendingSpent;
  if (requestSpentEl) requestSpentEl.textContent = summary.totalRequests;
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

  const totalRequests = allEntries
    .filter((e) => e.status === STATUS_REQUEST)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const balance = settledRaised - settledSpent;
  const projectedRaised = settledRaised + pendingRaised;
  const projectedSpent = settledSpent + pendingSpent;
  const projectedBalance = projectedRaised - projectedSpent - totalRequests;
  const hasGhostBalance = pendingRaised > 0 || pendingSpent > 0 || totalRequests > 0;

  updateSummaryDisplay({
    totalRaised: formatAmount(settledRaised),
    pendingRaised: pendingRaised > 0 ? `(${formatAmount(projectedRaised)})` : '',
    totalSpent: formatAmount(settledSpent),
    pendingSpent: pendingSpent > 0 ? `(${formatAmount(projectedSpent)})` : '',
    totalRequests: totalRequests > 0 ? `(${formatAmount(totalRequests)})` : '',
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
  if (status === STATUS_PENDING || status === STATUS_SETTLED || status === STATUS_REQUEST) {
    return status;
  }

  if (typeof status === 'string' && status.length > 0) {
    console.warn(
      `Unknown ledger status "${status}" found. Valid statuses are ${STATUS_PENDING}, ${STATUS_SETTLED}, or ${STATUS_REQUEST}. Defaulting to ${STATUS_PENDING}. Update the entry's status field to one of the valid values to resolve this.`,
    );
  }

  return STATUS_PENDING;
}

function normalizeEntry(entry) {
  return {
    id: typeof entry.id === 'string' ? entry.id : '',
    date: typeof entry.date === 'string' ? entry.date : '',
    type: entry.type === 'OUTGOING' ? 'OUTGOING' : 'INCOMING',
    status: normalizeStatus(entry.status),
    amount: Number(entry.amount) || 0,
    category: typeof entry.category === 'string' ? entry.category : '',
    description: typeof entry.description === 'string' ? entry.description : '',
    reference: typeof entry.reference === 'string' ? entry.reference : '',
    settledAt: Number(entry.settledAt) || 0,
    auditTrail: Array.isArray(entry.auditTrail)
      ? entry.auditTrail.map((record) => ({ ...record }))
      : [],
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

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleEntrySubmit(event) {
  event.preventDefault();
  clearFieldErrors();

  const type = entryTypeEl.value;
  const status = entryStatusEl.value;
  const amountValue = entryAmountEl.value.trim();
  const amount = Number(amountValue);
  const category = entryCategoryEl.value.trim();
  const description = entryDescriptionEl.value.trim();
  const proofFile = entryProofEl && entryProofEl.files[0] ? entryProofEl.files[0] : null;
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

  if (!date) {
    setFieldError('date', 'Date is required.');
    hasError = true;
  }

  if (!hasError && status === STATUS_REQUEST) {
    const settledRaised = entries
      .filter((e) => e.type === 'INCOMING' && e.status === STATUS_SETTLED)
      .reduce((sum, e) => sum + e.amount, 0);
    const settledSpent = entries
      .filter((e) => e.type === 'OUTGOING' && e.status === STATUS_SETTLED)
      .reduce((sum, e) => sum + e.amount, 0);
    const pendingRaised = entries
      .filter((e) => e.type === 'INCOMING' && e.status === STATUS_PENDING)
      .reduce((sum, e) => sum + e.amount, 0);
    const existingRequests = entries
      .filter((e) => e.status === STATUS_REQUEST)
      .reduce((sum, e) => sum + e.amount, 0);
    const maxRequestable = settledRaised - settledSpent + pendingRaised;
    if (existingRequests + amount > maxRequestable) {
      const remaining = Math.max(0, maxRequestable - existingRequests);
      setFieldError(
        'amount',
        `Cannot request more than available funds. Maximum requestable: ${formatAmount(remaining)}.`,
      );
      hasError = true;
    }
  }

  if (hasError) return;

  let reference = '';
  if (proofFile) {
    try {
      reference = await readFileAsDataURL(proofFile);
    } catch {
      setFieldError('reference', 'Failed to read the proof file. Please try again.');
      return;
    }
  }

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
    proofFileName: proofFile ? proofFile.name : null,
  });

  entries.push(entry);

  calculateSummary(entries);
  renderTable();
  entryFormEl.reset();
  setDefaultEntryDate();
}

function getStatusBadge(status) {
  const badge = document.createElement('span');
  const classMap = {
    [STATUS_SETTLED]: 'status-settled',
    [STATUS_PENDING]: 'status-pending',
    [STATUS_REQUEST]: 'status-request',
  };
  badge.className = `status-badge ${classMap[status] || 'status-pending'}`;
  badge.textContent = status || STATUS_PENDING;
  return badge;
}

function createProofCell(entry) {
  const proofCell = document.createElement('td');

  if (entry.reference) {
    if (entry.reference.startsWith('data:image/')) {
      const img = document.createElement('img');
      img.src = entry.reference;
      img.alt = 'Proof screenshot';
      img.style.cssText = 'height:2rem;width:auto;cursor:pointer;border-radius:0.25rem;vertical-align:middle;';
      img.title = 'Click to view full proof';
      img.addEventListener('click', () => {
        const win = window.open('', '_blank');
        if (win) {
          win.document.write(`<!doctype html><html><body style="margin:0;background:#000;display:flex;justify-content:center;align-items:center;min-height:100vh"><img src="${entry.reference}" style="max-width:100%;height:auto;" /></body></html>`);
        }
      });
      proofCell.appendChild(img);
      return proofCell;
    }

    if (entry.reference.startsWith('data:')) {
      const link = document.createElement('a');
      link.href = entry.reference;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'View proof';
      proofCell.appendChild(link);
      return proofCell;
    }

    if (isValidUrl(entry.reference)) {
      const proofLink = document.createElement('a');
      proofLink.href = getSafeProofUrl(entry.reference);
      proofLink.target = '_blank';
      proofLink.rel = 'noopener noreferrer';
      proofLink.textContent = 'View proof';
      proofCell.appendChild(proofLink);
      return proofCell;
    }
  }

  const emptyProof = document.createElement('span');
  emptyProof.className = 'muted-text';
  emptyProof.textContent = 'No proof yet';
  proofCell.appendChild(emptyProof);
  return proofCell;
}

function handleSettleEntry(entryId) {
  const entry = entries.find((item) => item.id === entryId);
  if (!entry || entry.status === STATUS_SETTLED) return;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*,.pdf';

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      entry.status = STATUS_SETTLED;
      entry.reference = reader.result;
      entry.settledAt = Date.now();
      appendAuditRecord(entry, 'ENTRY_SETTLED', {
        status: STATUS_SETTLED,
        proofFileName: file.name,
        settledAt: entry.settledAt,
      });
      calculateSummary(entries);
      renderTable();
    };
    reader.onerror = () => {
      window.alert('Failed to read the proof file. Please try again.');
    };
    reader.readAsDataURL(file);
  });

  fileInput.click();
}

function createActionsCell(entry) {
  const actionsCell = document.createElement('td');

  if (entry.status === STATUS_SETTLED) {
    const settledLabel = document.createElement('span');
    settledLabel.className = 'muted-text';
    settledLabel.textContent = 'Settled';
    actionsCell.appendChild(settledLabel);
    return actionsCell;
  }

  const settleButton = document.createElement('button');
  settleButton.type = 'button';
  settleButton.className = 'table-action';
  settleButton.textContent = 'Settle';
  settleButton.addEventListener('click', () => handleSettleEntry(entry.id));
  actionsCell.appendChild(settleButton);

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
