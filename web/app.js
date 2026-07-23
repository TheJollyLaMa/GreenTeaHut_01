const ledgerBody = document.getElementById('ledger-body');
const totalRaisedEl = document.getElementById('total-raised');
const totalSpentEl = document.getElementById('total-spent');
const balanceEl = document.getElementById('balance');
const typeFilterEl = document.getElementById('type-filter');
const statusFilterEl = document.getElementById('status-filter');
const searchFilterEl = document.getElementById('search-filter');

let entries = [];

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

function formatAmount(value) {
  return currency.format(Number(value) || 0);
}

function updateSummary(allEntries) {
  const totalRaised = allEntries
    .filter((entry) => entry.type === 'INCOMING')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  const totalSpent = allEntries
    .filter((entry) => entry.type === 'OUTGOING')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  totalRaisedEl.textContent = formatAmount(totalRaised);
  totalSpentEl.textContent = formatAmount(totalSpent);
  balanceEl.textContent = formatAmount(totalRaised - totalSpent);
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

function renderTable() {
  const filtered = getFilteredEntries();

  ledgerBody.innerHTML = '';

  filtered.forEach((entry) => {
    const row = document.createElement('tr');
    const cells = [
      entry.id,
      entry.date,
      entry.type,
      entry.status,
      formatAmount(entry.amount),
      entry.category,
      entry.description,
    ];

    cells.forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    });

    const proofCell = document.createElement('td');
    const proofLink = document.createElement('a');
    proofLink.href = getSafeProofUrl(entry.reference);
    proofLink.target = '_blank';
    proofLink.rel = 'noopener noreferrer';
    proofLink.textContent = 'Proof';
    proofCell.appendChild(proofLink);
    row.appendChild(proofCell);

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
    entries = Array.isArray(data.entries) ? data.entries : [];

    updateSummary(entries);
    renderTable();
  } catch (error) {
    ledgerBody.innerHTML =
      '<tr><td colspan="8">Unable to load ledger data. Please check your connection and refresh the page.</td></tr>';
    console.error(error);
  }
}

[typeFilterEl, statusFilterEl, searchFilterEl].forEach((el) => {
  el.addEventListener('input', renderTable);
});

// ── Lightbox ──────────────────────────────────────────────

const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxCaption = document.getElementById('lightbox-caption');
const lightboxClose = document.getElementById('lightbox-close');

function openLightbox(src, alt, caption) {
  lightboxImg.src = src;
  lightboxImg.alt = alt;
  lightboxCaption.textContent = caption;
  lightbox.hidden = false;
  lightboxClose.focus();
}

function closeLightbox() {
  lightbox.hidden = true;
  lightboxImg.src = '';
  lightboxImg.alt = '';
  lightboxCaption.textContent = '';
}

document.querySelectorAll('.gallery-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const src = btn.dataset.src;
    const caption = btn.dataset.caption || '';
    const img = btn.querySelector('img');
    const alt = img ? img.alt : caption;
    openLightbox(src, alt, caption);
  });
});

lightboxClose.addEventListener('click', closeLightbox);

lightbox.addEventListener('click', (event) => {
  if (event.target === lightbox) {
    closeLightbox();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !lightbox.hidden) {
    closeLightbox();
  }
});

init();

