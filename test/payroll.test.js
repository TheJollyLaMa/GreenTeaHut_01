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
} = require('../scripts/payroll');

const owner = {
  github: 'TheJollyLaMa',
  walletAddress: '0x807061DF657A7697c04045dA7d16D941861cAABc',
};

function fixture(overrides = {}) {
  return {
    issue: { number: 14, labels: [{ name: 'bounty: 100 ART' }], assignees: [{ login: 'TheJollyLaMa' }], ...overrides.issue },
    pr: { number: 15, user: { login: 'copilot-swe-agent[bot]' }, ...overrides.pr },
    accounts: { contributors: [{ ...owner }], ...overrides.accounts },
    queue: { pending: [], settled: [], ...overrides.queue },
    repoSlug: 'TheJollyLaMa/GreenTeaHut_01',
    queuedAt: '2026-09-16T00:00:00.000Z',
    queuedBy: 'github-actions[bot]',
  };
}

test('accepts only exact positive ART bounty labels', () => {
  assert.equal(parseAmountLabel({ labels: [{ name: 'bounty: 100 ART' }] }).amount, '100');
  assert.equal(parseAmountLabel({ labels: [{ name: 'bounty: 2.5 $ART' }] }).amount, '2.5');
  assert.equal(parseAmountLabel({ labels: [{ name: 'test-bounty: 10 ART' }] }, TEST_BOUNTY_LABEL_RE).amount, '10');
  assert.match('bounty: 1 ART', BOUNTY_LABEL_RE);
  for (const label of ['bounty: 0 ART', 'bounty: -1 ART', 'bounty: 1 ETH', 'bounty: 1 ART extra', 'bounty: 1e3 ART']) {
    assert.equal(parseAmountLabel({ labels: [{ name: label }] }), null, label);
  }
});

test('combines body, title, linked, and manual issue references', () => {
  assert.deepEqual(extractIssueNumbers({
    body: 'Closes #14 and resolves TheJollyLaMa/GreenTeaHut_01#18',
    title: 'Finish #14 and #22',
    linked: [18, 30],
    override: ['31'],
  }), [31, 14, 18, 22, 30]);
});

test('falls back from an unwhitelisted PR author to a whitelisted assignee', () => {
  const result = createBountyEntries(fixture());
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].contributorGithub, owner.github);
  assert.equal(result.entries[0].currency, 'ART');
});

test('splits exact idea credit into 80/20 role entries', () => {
  const result = createBountyEntries(fixture({ issue: {
    number: 14,
    labels: [{ name: 'bounty: 100 ART' }, { name: 'idea-credit: @TheJollyLaMa' }],
    assignees: [{ login: 'TheJollyLaMa' }],
  } }));
  assert.deepEqual(result.entries.map(entry => [entry.role, entry.amount]), [
    ['implementer', '80'],
    ['idea-originator', '20'],
  ]);
});

test('splits decimal idea credit without floating-point drift', () => {
  assert.deepEqual(splitIdeaCredit('0.00000001'), {
    implementer: '0.000000008',
    originator: '0.000000002',
  });
});

test('generic idea-credit does not trigger a split', () => {
  const result = createBountyEntries(fixture({ issue: {
    number: 18,
    labels: [{ name: 'bounty: 100 ART' }, { name: 'idea-credit' }],
    assignees: [{ login: 'TheJollyLaMa' }],
  } }));
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].amount, '100');
});

test('deduplicates pending and settled role entries', () => {
  const issue = {
    number: 14,
    labels: [{ name: 'bounty: 100 ART' }, { name: 'idea-credit: @TheJollyLaMa' }],
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

test('accrues ART and settles only the selected issue', () => {
  const accounts = { contributors: [{ ...owner, artPending: 0, artEarned: 0, issuesClosed: [] }] };
  const target = { issueRef: 'TheJollyLaMa/GreenTeaHut_01#14', contributorGithub: owner.github, contributor: owner.walletAddress, amount: '100', currency: 'ART', role: 'idea-originator' };
  const other = { ...target, issueRef: 'TheJollyLaMa/GreenTeaHut_01#99', amount: '50', role: 'contributor' };
  applyAccountAccrual(accounts, [target, other]);
  assert.equal(accounts.contributors[0].artPending, 150);
  assert.deepEqual(accounts.contributors[0].ideasCredited, [target.issueRef]);
  const queue = { pending: [target, other], settled: [] };
  const settled = settleEntries({ queue, accounts, issueRef: target.issueRef, settledAt: '2026-09-16T01:00:00.000Z', settledBy: owner.github });
  assert.equal(settled.length, 1);
  assert.equal(queue.pending[0].issueRef, other.issueRef);
  assert.equal(accounts.contributors[0].artPending, 50);
  assert.equal(accounts.contributors[0].artEarned, 100);
});