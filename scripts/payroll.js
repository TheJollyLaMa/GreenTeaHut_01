const { amountUnits, formatUnits, validAddress, entryKey } = require('../web/payroll-core');
const BOUNTY_LABEL_RE = /^bounty:\s*((?:0|[1-9]\d*)(?:\.\d+)?)\s*\$?USDC$/i;
const TEST_BOUNTY_LABEL_RE = /^test-bounty:\s*((?:0|[1-9]\d*)(?:\.\d+)?)\s*\$?USDC$/i;
const IDEA_CREDIT_LABEL_RE = /^idea-credit:\s*@?([-\w]+)$/i;
const CLOSING_ISSUE_RE = /(?:closes?|fixes?|resolves?)\s+(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+))?#(\d+)/gi;
const TITLE_ISSUE_RE = /(?:^|[\s(])#(\d+)\b/g;

const CONTRIBUTOR_ALIASES = {
  'copilot-swe-agent': 'copilot',
  'copilot-swe-agent[bot]': 'copilot',
};

function normalizeLogin(login) {
  const value = String(login || '').trim();
  return CONTRIBUTOR_ALIASES[value.toLowerCase()] || value;
}

function labelNames(issue) {
  return (issue.labels || []).map(label => typeof label === 'string' ? label : label.name);
}

function normalizeAmount(value) {
  return formatUnits(amountUnits(String(value).trim()));
}

function parseAmountLabel(issue, pattern = BOUNTY_LABEL_RE) {
  let result = null;
  for (const label of labelNames(issue)) {
    const match = String(label || '').match(pattern);
    if (!match) continue;
    if (result) throw new Error('Issue has more than one USDC bounty label');
    result = { label, amount: normalizeAmount(match[1]), currency: 'USDC' };
  }
  return result;
}

function parseIdeaCredit(issue) {
  for (const label of labelNames(issue)) {
    const match = String(label || '').match(IDEA_CREDIT_LABEL_RE);
    if (match) return normalizeLogin(match[1]);
  }
  return null;
}

function extractIssueNumbers({ body = '', title = '', linked = [], override = [], repoSlug = 'TheJollyLaMa/GreenTeaHut_01' } = {}) {
  const numbers = new Set();
  for (const value of override) {
    const number = Number(value);
    if (Number.isInteger(number) && number > 0) numbers.add(number);
  }
  for (const match of String(body).matchAll(CLOSING_ISSUE_RE)) {
    if (!match[1] || match[1].toLowerCase() === repoSlug.toLowerCase()) numbers.add(Number(match[2]));
  }
  for (const match of String(title).matchAll(TITLE_ISSUE_RE)) numbers.add(Number(match[1]));
  for (const value of linked) {
    const number = Number(value);
    if (Number.isInteger(number) && number > 0) numbers.add(number);
  }
  return [...numbers];
}

function splitIdeaCredit(amount) {
  const units = amountUnits(normalizeAmount(amount));
  if (units % 5n !== 0n) throw new Error(`Payout amount cannot be split exactly at six USDC decimals: ${amount}`);
  const originatorUnits = units / 5n;
  return {
    implementer: formatUnits(units - originatorUnits),
    originator: formatUnits(originatorUnits),
  };
}

function findAccount(accounts, login) {
  const normalized = normalizeLogin(login).toLowerCase();
  return (accounts.contributors || []).find(
    account => String(account.github || '').trim().toLowerCase() === normalized
  );
}

function requireWhitelistedAccount(accounts, candidates, description) {
  for (const login of candidates) {
    const account = findAccount(accounts, login);
    if (account && validAddress(account.walletAddress)) return account;
  }
  throw new Error(`No whitelisted wallet found for ${description}: ${candidates.filter(Boolean).join(', ') || 'none'}`);
}

function isDuplicate(queue, candidate) {
  return [...queue.pending, ...queue.settled].some(entry => entryKey(entry) === entryKey(candidate));
}

function pickWhitelistedTester({ assigneeLogins = [], accounts, commenter = '' } = {}) {
  const eligible = assigneeLogins
    .map(login => normalizeLogin(login))
    .filter(Boolean)
    .map(login => findAccount(accounts, login))
    .filter(account => account && validAddress(account.walletAddress));

  if (eligible.length === 0) throw new Error('No assigned tester on this issue has a whitelisted wallet.');
  const commenterKey = normalizeLogin(commenter).toLowerCase();
  const commenterMatch = eligible.find(
    account => String(account.github || '').trim().toLowerCase() === commenterKey
  );
  if (commenterMatch) return commenterMatch;
  if (eligible.length > 1) {
    throw new Error(`Multiple assigned testers have whitelisted wallets: ${eligible.map(account => account.github).join(', ')}`);
  }
  return eligible[0];
}

function createBountyEntries({ issue, pr, accounts, queue, repoSlug, queuedAt, queuedBy }) {
  const bounty = parseAmountLabel(issue);
  if (!bounty) return { entries: [], reason: 'missing-bounty-label' };

  const prAuthor = normalizeLogin(pr.user && pr.user.login);
  const assignees = (issue.assignees || []).map(assignee => normalizeLogin(assignee.login));
  const candidates = [...new Set([prAuthor, ...assignees].filter(Boolean))];
  const implementer = requireWhitelistedAccount(accounts, candidates, 'PR author or issue assignee');
  const ideaOriginatorLogin = parseIdeaCredit(issue);
  const issueRef = `${repoSlug}#${issue.number}`;
  const common = { issueRef, currency: 'USDC', queuedAt, queuedBy, prNumber: pr.number };

  let entries;
  if (ideaOriginatorLogin) {
    const originator = requireWhitelistedAccount(accounts, [ideaOriginatorLogin], 'idea originator');
    const split = splitIdeaCredit(bounty.amount);
    entries = [
      { ...common, contributor: implementer.walletAddress, contributorGithub: implementer.github, amount: split.implementer, role: 'implementer' },
      { ...common, contributor: originator.walletAddress, contributorGithub: originator.github, amount: split.originator, role: 'idea-originator' },
    ];
  } else {
    entries = [{
      ...common,
      contributor: implementer.walletAddress,
      contributorGithub: implementer.github,
      amount: bounty.amount,
      role: 'contributor',
    }];
  }

  const newEntries = entries.filter(entry => !isDuplicate(queue, entry));
  return {
    entries: newEntries,
    skippedDuplicates: entries.length - newEntries.length,
    bountyLabel: bounty.label,
  };
}

function applyAccountAccrual(accounts, entries) {
  for (const entry of entries) {
    const account = findAccount(accounts, entry.contributorGithub);
    if (!account) throw new Error(`Unregistered contributor: ${entry.contributorGithub}`);
    account.usdcPending = formatUnits(amountUnits(account.usdcPending, true) + amountUnits(entry.amount));
    if (!Array.isArray(account.issuesClosed)) account.issuesClosed = [];
    if (!account.issuesClosed.includes(entry.issueRef)) account.issuesClosed.push(entry.issueRef);
    if (entry.role === 'idea-originator') {
      if (!Array.isArray(account.ideasCredited)) account.ideasCredited = [];
      if (!account.ideasCredited.includes(entry.issueRef)) account.ideasCredited.push(entry.issueRef);
    }
  }
}

function settleEntries({ queue, accounts, entry, proof, settledAt, settledBy }) {
  const key = entryKey(entry);
  const selected = queue.pending.filter(candidate => entryKey(candidate) === key);
  if (selected.length !== 1) throw new Error('Exactly one pending entry must match settlement');
  if (!/^0x[0-9a-f]{64}$/i.test(proof?.txHash || '') || !Number.isSafeInteger(proof.paymentLogIndex)) {
    throw new Error('Verified payment proof is required');
  }
  if (queue.settled.some(item => item.txHash.toLowerCase() === proof.txHash.toLowerCase() &&
      item.paymentLogIndex === proof.paymentLogIndex)) throw new Error('Payment proof already used');
  const account = findAccount(accounts, entry.contributorGithub);
  if (!account) throw new Error('Unregistered settlement recipient');
  const pending = amountUnits(account.usdcPending, true) - amountUnits(entry.amount);
  if (pending < 0n) throw new Error('USDC pending balance is insufficient');
  const earned = amountUnits(account.usdcEarned, true) + amountUnits(entry.amount);
  const settled = { ...selected[0], ...proof, settledAt, settledBy };
  queue.pending = queue.pending.filter(candidate => entryKey(candidate) !== key);
  queue.settled.push(settled);
  account.usdcPending = formatUnits(pending);
  account.usdcEarned = formatUnits(earned);
  return [settled];
}

module.exports = {
  BOUNTY_LABEL_RE,
  TEST_BOUNTY_LABEL_RE,
  applyAccountAccrual,
  createBountyEntries,
  extractIssueNumbers,
  findAccount,
  isDuplicate,
  normalizeAmount,
  normalizeLogin,
  parseAmountLabel,
  parseIdeaCredit,
  pickWhitelistedTester,
  settleEntries,
  splitIdeaCredit,
};