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

function renderTable() {
  const filtered = getFilteredEntries();

  ledgerBody.innerHTML = filtered
    .map(
      (entry) => `
      <tr>
        <td>${entry.id}</td>
        <td>${entry.date}</td>
        <td>${entry.type}</td>
        <td>${entry.status}</td>
        <td>${formatAmount(entry.amount)}</td>
        <td>${entry.category}</td>
        <td>${entry.description}</td>
        <td><a href="${entry.reference}" target="_blank" rel="noopener noreferrer">Proof</a></td>
      </tr>
    `
    )
    .join('');
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
    ledgerBody.innerHTML = `<tr><td colspan="8">Unable to load ledger data.</td></tr>`;
    console.error(error);
  }
}

[typeFilterEl, statusFilterEl, searchFilterEl].forEach((el) => {
  el.addEventListener('input', renderTable);
});

init();
