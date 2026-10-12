const test = require('node:test');
const assert = require('node:assert/strict');
const ethers = require('ethers');
const core = require('../web/payroll-core');
const config = require('../payroll-assets.json');
const { settleVerifiedPayment } = require('../scripts/settlePayroll');

const entry = {
  issueRef: `${config.repository}#123`, contributorGithub: 'TheJollyLaMa',
  contributor: '0x807061DF657A7697c04045dA7d16D941861cAABc',
  amount: '12.345678', currency: 'USDC', role: 'contributor',
  queuedAt: '2026-10-12T12:00:00Z', queuedBy: 'maintainer',
};
const txHash = '0x' + 'ab'.repeat(32);
const blockHash = '0x' + 'cd'.repeat(32);
function log(iface, event, values, address, index) {
  return { ...iface.encodeEventLog(iface.getEvent(event), values), address, index };
}
function receipt(overrides = {}) {
  return {
    status: 1, to: core.TREASURY, hash: txHash, blockNumber: 52514000, blockHash,
    logs: [
      log(new ethers.Interface(core.PAYMENT_ABI), 'FundsPaid',
        [1, core.USDC, entry.contributor, entry.contributor, 12345678, core.paymentReference(entry)], core.TREASURY, 1),
      log(new ethers.Interface(core.TOKEN_ABI), 'Transfer',
        [core.TREASURY, entry.contributor, 12345678], core.USDC, 2),
      log(new ethers.Interface(core.PAYMENT_ABI), 'PayrollPaid',
        [core.workReference(entry, ethers), entry.contributor, 12345678, entry.contributor], core.TREASURY, 3),
    ],
    ...overrides,
  };
}
function provider(proof = receipt(), options = {}) {
  return {
    send: async () => options.chain || '0x2105',
    getTransactionReceipt: async () => proof,
    getBlock: async tag => tag === 'finalized'
      ? { number: options.finalized || 52514000 } : { hash: options.blockHash || blockHash },
  };
}
function state() {
  return {
    queue: { pending: [{ ...entry }], settled: [] },
    accounts: { contributors: [{ github: entry.contributorGithub, walletAddress: entry.contributor,
      usdcPending: entry.amount, usdcEarned: '0' }] },
  };
}

test('settles one exact finalized Base USDC treasury payment and stores unique proof', async () => {
  const data = state();
  const settled = await settleVerifiedPayment({ ...data, contributorGithub: 'thejollylama',
    issueRef: entry.issueRef, role: entry.role, txHash, provider: provider(), ethers,
    settledAt: '2026-10-12T12:10:00Z', settledBy: 'maintainer' });
  assert.equal(settled.length, 1);
  assert.equal(data.queue.pending.length, 0);
  assert.equal(data.accounts.contributors[0].usdcEarned, entry.amount);
  assert.equal(settled[0].paymentLogIndex, 1);
  core.validateData(data.queue, data.accounts, config);
  await assert.rejects(settleVerifiedPayment({ ...data, contributorGithub: entry.contributorGithub,
    issueRef: entry.issueRef, role: entry.role, txHash, provider: provider(), ethers }), /Exactly one/);
});

test('rejects wrong chain, failed, unfinalized, noncanonical and missing receipts without mutating accounting', async () => {
  for (const rpc of [
    provider(receipt(), { chain: '0xa' }), provider(null),
    provider(receipt({ status: 0 })), provider(receipt(), { finalized: 52513999 }),
    provider(receipt(), { blockHash: '0x' + 'ff'.repeat(32) }),
  ]) {
    const data = state();
    const before = structuredClone(data);
    await assert.rejects(settleVerifiedPayment({ ...data, contributorGithub: entry.contributorGithub,
      issueRef: entry.issueRef, role: entry.role, txHash, provider: rpc, ethers,
      settledAt: '2026-10-12T12:10:00Z', settledBy: 'maintainer' }));
    assert.deepEqual(data, before);
  }
});

test('requires exact asset, sender, recipient, amount, role, unique work reference and all event types', () => {
  const verify = (candidate = entry, proof = receipt()) =>
    core.verifyReceipt({ entry: candidate, config, receipt: proof, ethers });
  for (const change of [
    { amount: '12.345677' }, { role: 'tester' }, { issueRef: `${config.repository}#124` },
    { contributor: '0x' + '1'.repeat(40) },
  ]) assert.throws(() => verify({ ...entry, ...change }), /exact treasury/);
  assert.throws(() => verify(entry, receipt({ to: entry.contributor })), /project treasury/);
  const good = receipt();
  for (const logs of [good.logs.slice(0, 1), good.logs.slice(1), good.logs.slice(0, 2), [...good.logs, good.logs[2]],
    [...good.logs, good.logs[0]],
    good.logs.map(item => ({ ...item, address: entry.contributor }))]) {
    assert.throws(() => verify(entry, receipt({ logs })), /exact treasury/);
  }
  const smoke = receipt();
  smoke.logs[0] = log(new ethers.Interface(core.PAYMENT_ABI), 'FundsPaid',
    [1, core.USDC, entry.contributor, entry.contributor, 12345678, 'USDC smoke test'], core.TREASURY, 1);
  assert.throws(() => verify(entry, smoke), /exact treasury/);
  const fakeSender = receipt();
  fakeSender.logs[1] = log(new ethers.Interface(core.TOKEN_ABI), 'Transfer',
    [entry.contributor, entry.contributor, 12345678], core.USDC, 2);
  assert.throws(() => verify(entry, fakeSender), /exact treasury/);
  const otherWork = receipt();
  otherWork.logs[2] = log(new ethers.Interface(core.PAYMENT_ABI), 'PayrollPaid',
    [ethers.id('repo-payroll:other'), entry.contributor, 12345678, entry.contributor], core.TREASURY, 3);
  assert.throws(() => verify(entry, otherWork), /exact treasury/);
});

test('payroll call arguments rebuild the on-chain V2 work reference', () => {
  const call = core.payrollCall({ ...entry, role: 'idea-originator' });
  assert.deepEqual(call, { issueId: 123n, contributorGithub: 'thejollylama', role: 2,
    recipient: entry.contributor, amount: 12345678n });
  assert.equal(core.workReference(entry, ethers),
    ethers.id('repo-payroll:TheJollyLaMa/GreenTeaHut_01#123:thejollylama:contributor:USDC'));
  assert.throws(() => core.payrollCall({ ...entry, contributorGithub: 'a'.repeat(40) }), /Invalid repository/);
  assert.equal(core.validAddress(core.PREVIOUS_TREASURY), false);
});

module.exports = { entry, receipt, provider, state };
