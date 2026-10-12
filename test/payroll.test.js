const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BOUNTY_LABEL_RE,
  TEST_BOUNTY_LABEL_RE,
  applyAccountAccrual,
  createBountyEntries,
  extractIssueNumbers,
  parseAmountLabel,
  pickWhitelistedTester,
  settleEntries,
  splitIdeaCredit,
  normalizeAmount,
} = require('../scripts/payroll');
const core = require('../web/payroll-core');
const config = require('../payroll-assets.json');

const owner = {
  github: 'TheJollyLaMa',
  walletAddress: '0x807061DF657A7697c04045dA7d16D941861cAABc',
  usdcPending: '0',
  usdcEarned: '0',
};

function fixture(overrides = {}) {
  return {
    issue: { number: 14, labels: [{ name: 'bounty: 100 USDC' }], assignees: [{ login: 'TheJollyLaMa' }], ...overrides.issue },
    pr: { number: 15, user: { login: 'copilot-swe-agent[bot]' }, ...overrides.pr },
    accounts: { contributors: [{ ...owner }], ...overrides.accounts },
    queue: { pending: [], settled: [], ...overrides.queue },
    repoSlug: 'TheJollyLaMa/GreenTeaHut_01',
    queuedAt: '2026-09-16T00:00:00.000Z',
    queuedBy: 'github-actions[bot]',
  };
}

test('accepts only exact positive USDC labels at six decimals and rejects duplicate labels', () => {
  assert.equal(parseAmountLabel({ labels: [{ name: 'bounty: 100 USDC' }] }).amount, '100');
  assert.equal(parseAmountLabel({ labels: [{ name: 'bounty: 2.5 $USDC' }] }).amount, '2.5');
  assert.equal(parseAmountLabel({ labels: [{ name: 'test-bounty: 0.000001 USDC' }] }, TEST_BOUNTY_LABEL_RE).amount, '0.000001');
  assert.match('bounty: 1 USDC', BOUNTY_LABEL_RE);
  for (const label of ['bounty: -1 USDC', 'bounty: 1 ETH', 'bounty: 1 ART', 'bounty: 1 USDC extra', 'bounty: 1e3 USDC']) {
    assert.equal(parseAmountLabel({ labels: [{ name: label }] }), null, label);
  }
  assert.throws(() => parseAmountLabel({ labels: ['bounty: 0 USDC'] }), /Invalid USDC amount/);
  assert.throws(() => parseAmountLabel({ labels: ['bounty: 0.0000001 USDC'] }), /six decimal/);
  assert.throws(() => parseAmountLabel({ labels: ['bounty: 1 USDC', 'bounty: 2 USDC'] }), /more than one/);
});

test('combines body, title, linked, and manual issue references', () => {
  assert.deepEqual(extractIssueNumbers({
    body: 'Closes #14 and resolves TheJollyLaMa/GreenTeaHut_01#18 and fixes another/project#78',
    title: 'Finish #14 and #22, not another/project#78',
    linked: [18, 30],
    override: ['31'],
  }), [31, 14, 18, 22, 30]);
});

test('falls back from an unwhitelisted PR author to a whitelisted assignee', () => {
  const result = createBountyEntries(fixture());
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].contributorGithub, owner.github);
  assert.equal(result.entries[0].currency, 'USDC');
});

test('splits exact idea credit into 80/20 role entries', () => {
  const result = createBountyEntries(fixture({ issue: {
    number: 14,
    labels: [{ name: 'bounty: 100 USDC' }, { name: 'idea-credit: @TheJollyLaMa' }],
    assignees: [{ login: 'TheJollyLaMa' }],
  } }));
  assert.deepEqual(result.entries.map(entry => [entry.role, entry.amount]), [
    ['implementer', '80'],
    ['idea-originator', '20'],
  ]);
});

test('splits decimal idea credit without floating-point drift', () => {
  assert.deepEqual(splitIdeaCredit('0.000005'), {
    implementer: '0.000004',
    originator: '0.000001',
  });
  assert.throws(() => splitIdeaCredit('0.000001'), /cannot be split exactly/);
});

test('generic idea-credit does not trigger a split', () => {
  const result = createBountyEntries(fixture({ issue: {
    number: 18,
    labels: [{ name: 'bounty: 100 USDC' }, { name: 'idea-credit' }],
    assignees: [{ login: 'TheJollyLaMa' }],
  } }));
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].amount, '100');
});

test('deduplicates pending and settled role entries', () => {
  const issue = {
    number: 14,
    labels: [{ name: 'bounty: 100 USDC' }, { name: 'idea-credit: @TheJollyLaMa' }],
    assignees: [{ login: 'TheJollyLaMa' }],
  };
  const previous = createBountyEntries(fixture({ issue })).entries;
  const result = createBountyEntries(fixture({ issue, queue: { pending: [previous[0]], settled: [previous[1]] } }));
  assert.equal(result.entries.length, 0);
  assert.equal(result.skippedDuplicates, 2);
});

test('selects the commenting assigned tester and rejects ambiguity', () => {
  const accounts = { contributors: [
    { github: 'alice', walletAddress: '0x1111111111111111111111111111111111111111' },
    { github: 'bob', walletAddress: '0x2222222222222222222222222222222222222222' },
  ] };
  assert.equal(pickWhitelistedTester({ assigneeLogins: ['alice', 'bob'], accounts, commenter: 'bob' }).github, 'bob');
  assert.throws(() => pickWhitelistedTester({ assigneeLogins: ['alice', 'bob'], accounts, commenter: 'carol' }), /Multiple assigned testers/);
});

test('accrues exact USDC and settles only the selected issue and role with proof', () => {
  const accounts = { contributors: [{ ...owner, issuesClosed: [] }] };
  const target = { issueRef: 'TheJollyLaMa/GreenTeaHut_01#14', contributorGithub: owner.github, contributor: owner.walletAddress, amount: '100', currency: 'USDC', role: 'idea-originator' };
  const other = { ...target, issueRef: 'TheJollyLaMa/GreenTeaHut_01#99', amount: '50', role: 'contributor' };
  applyAccountAccrual(accounts, [target, other]);
  assert.equal(accounts.contributors[0].usdcPending, '150');
  assert.deepEqual(accounts.contributors[0].ideasCredited, [target.issueRef]);
  const queue = { pending: [target, other], settled: [] };
  const settled = settleEntries({ queue, accounts, entry: target,
    proof: { txHash: '0x' + 'a'.repeat(64), paymentLogIndex: 1 },
    settledAt: '2026-09-16T01:00:00.000Z', settledBy: owner.github });
  assert.equal(settled.length, 1);
  assert.equal(queue.pending[0].issueRef, other.issueRef);
  assert.equal(accounts.contributors[0].usdcPending, '50');
  assert.equal(accounts.contributors[0].usdcEarned, '100');
});

test('micro-unit accrual remains exact beyond JavaScript safe integers', () => {
  const accounts = { contributors: [{ ...owner }] };
  const entry = { contributorGithub: owner.github, issueRef: `${config.repository}#1`, amount: '9007199254740993.000001' };
  applyAccountAccrual(accounts, [entry, { ...entry, amount: '0.000001' }]);
  assert.equal(accounts.contributors[0].usdcPending, '9007199254740993.000002');
  assert.equal(normalizeAmount('2.500000'), '2.5');
});

test('validates registry, queue, recipient, totals, roles, currency and reusable proofs', () => {
  const f = fixture();
  const entries = createBountyEntries(f).entries;
  const queue = { pending: entries, settled: [] };
  applyAccountAccrual(f.accounts, entries);
  core.validateData(queue, f.accounts, config);
  for (const mutate of [
    q => { q.pending[0].currency = 'ART'; },
    q => { q.pending[0].amount = '0.0000001'; },
    q => { q.pending[0].contributor = '0x' + '0'.repeat(40); },
    q => { q.pending[0].contributor = '0x' + '1'.repeat(40); },
    q => { q.pending[0].role = 'stranger'; },
    q => { q.pending.push(q.pending[0]); },
  ]) {
    const bad = structuredClone(queue);
    mutate(bad);
    assert.throws(() => core.validateData(bad, f.accounts, config));
  }
  const badAccounts = structuredClone(f.accounts);
  badAccounts.contributors[0].usdcPending = '99';
  assert.throws(() => core.validateData(queue, badAccounts, config), /reconcile/);
  assert.throws(() => core.validateConfig({ ...config, chainId: 10 }), /native Base USDC/);
  const settled = structuredClone(queue.pending[0]);
  Object.assign(settled, { txHash: '0x' + 'a'.repeat(64), paymentLogIndex: 1,
    settledAt: '2026-10-12T12:05:00Z', settledBy: 'maintainer' });
  const reused = { ...settled, role: 'tester' };
  assert.throws(() => core.validateData({ pending: [], settled: [settled, reused] }, f.accounts, config), /cannot settle multiple/);
});