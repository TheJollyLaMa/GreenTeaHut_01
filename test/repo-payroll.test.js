const test = require('node:test');
const assert = require('node:assert/strict');
const ethers = require('ethers');
const fs = require('node:fs');
const core = require('../web/payroll-core');
const config = require('../payroll-assets.json');
const { sendPayment, scanPayments } = require('../web/repo-payroll');

const entry = { issueRef: `${config.repository}#123`, contributorGithub: 'TheJollyLaMa',
  contributor: '0x807061DF657A7697c04045dA7d16D941861cAABc',
  amount: '0.000001', currency: 'USDC', role: 'contributor' };
function fixture(overrides = {}, chain = {}) {
  let sent = 0;
  let args;
  let submitted;
  let referenceChecks = 0;
  const payPayroll = async (...values) => {
    sent += 1; args = values;
    return { hash: '0x' + 'aa'.repeat(32), wait: async () => ({ mockReceipt: true }) };
  };
  payPayroll.staticCall = async () => { if (chain.reverts) throw new Error('execution reverted'); };
  const mockEthers = {
    keccak256: ethers.keccak256, toUtf8Bytes: ethers.toUtf8Bytes,
    Contract: class {
      constructor() { this.payPayroll = payPayroll; }
      async owner() { return entry.contributor; }
      async managers() { return false; }
      async availableUSDC() { return chain.available ?? 1000000n; }
      async paidPayrollReferences() { return Boolean(chain.paidAfter && ++referenceChecks >= chain.paidAfter); }
      async decimals() { return 6n; }
    },
  };
  const params = { entry, config, core: { ...core, verifyReceipt: () => ({ txHash: '0x' + 'aa'.repeat(32) }) },
    ethers: mockEthers, reader: { send: async () => '0x2105' },
    wallet: { getNetwork: async () => ({ chainId: 8453n }),
      getSigner: async () => ({ getAddress: async () => entry.contributor }) },
    deploymentReady: () => true, checkUnpaid: async () => {}, confirm: () => true,
    recordSubmission: hash => { submitted = hash; }, ...overrides };
  return { params, sent: () => sent, args: () => args, submitted: () => submitted };
}

test('panel calls the unique V2 payroll method with issue, lowercase login, role index and exact USDC', async () => {
  const f = fixture();
  await sendPayment(f.params);
  assert.equal(f.sent(), 1);
  assert.deepEqual(f.args(), [123n, 'thejollylama', 0, entry.contributor, 1n]);
  assert.ok(f.submitted());
});

test('no funds sent when the treasury already recorded the reference, escrow leaves too little, or simulation reverts', async () => {
  for (const chain of [{ paidAfter: 1 }, { paidAfter: 2 }, { available: 0n }, { reverts: true }]) {
    const f = fixture({}, chain);
    await assert.rejects(sendPayment(f.params));
    assert.equal(f.sent(), 0);
  }
});

test('no funds sent for unverified deployment, wrong network, unauthorized wallet, duplicate, insufficient funds, or cancelled confirmation', async () => {
  for (const overrides of [
    { deploymentReady: () => false },
    { wallet: { getNetwork: async () => ({ chainId: 10n }) } },
    { reader: { send: async () => '0xa' } },
    { checkUnpaid: async () => { throw new Error('already paid'); } },
    { wallet: { getNetwork: async () => ({ chainId: 8453n }),
      getSigner: async () => ({ getAddress: async () => '0x' + '1'.repeat(40) }) } },
    { entry: { ...entry, amount: '2' } },
  ]) {
    const f = fixture(overrides);
    await assert.rejects(sendPayment(f.params));
    assert.equal(f.sent(), 0);
  }
  const f = fixture({ confirm: () => false });
  assert.equal(await sendPayment(f.params), null);
  assert.equal(f.sent(), 0);
});

test('payment checks run again after confirmation and RPC failures prevent payment', async () => {
  let checks = 0;
  const f = fixture({ checkUnpaid: async () => { if (++checks === 2) throw new Error('paid meanwhile'); } });
  await assert.rejects(sendPayment(f.params), /paid meanwhile/);
  assert.equal(f.sent(), 0);
  assert.equal(checks, 2);
  let networks = 0;
  const switched = fixture({ wallet: {
    getNetwork: async () => ({ chainId: ++networks === 1 ? 8453n : 10n }),
    getSigner: async () => ({ getAddress: async () => entry.contributor }),
  } });
  await assert.rejects(sendPayment(switched.params), /Wallet network changed/);
  assert.equal(switched.sent(), 0);
});

test('scan covers every deployment block in bounded windows and rejects duplicate work references', async () => {
  const iface = new ethers.Interface(core.PAYMENT_ABI);
  const encoded = iface.encodeEventLog(iface.getEvent('FundsPaid'),
    [1, core.USDC, entry.contributor, entry.contributor, 1, core.paymentReference(entry)]);
  const windows = [];
  const provider = { getBlockNumber: async () => config.deploymentBlock + 18000,
    getLogs: async query => {
      windows.push(query);
      return windows.length === 2 ? [{ ...encoded, transactionHash: '0x' + 'aa'.repeat(32) }] : [];
    } };
  const payments = await scanPayments({ provider, config, core, ethers });
  assert.equal(payments.size, 1);
  assert.equal(windows.length, 3);
  assert.equal(windows[0].fromBlock, config.deploymentBlock);
  assert.equal(windows[2].toBlock, config.deploymentBlock + 18000);
  provider.getLogs = async () => [encoded];
  await assert.rejects(scanPayments({ provider, config, core, ethers }), /Duplicate on-chain/);
});

test('repo panel is inside the existing Labor & Services view and old clock controls remain', () => {
  const html = fs.readFileSync('web/index.html', 'utf8');
  const app = fs.readFileSync('web/app.js', 'utf8');
  assert.ok(html.indexOf('id="repo-payroll-body"') > html.indexOf('id="payout-view"'));
  assert.ok(html.indexOf('id="repo-payroll-body"') < html.indexOf('id="payout-clock-in-form"'));
  assert.match(html, /id="payout-review-form"/);
  assert.match(html, /src="payroll-core.js"/);
  assert.match(html, /src="repo-payroll.js"/);
  assert.match(app, /GreenTeaRepoPayroll.mount/);
  assert.doesNotMatch(fs.readFileSync('index.html', 'utf8'), /artizen\.fund|Network: Optimism/);
  for (const name of ['bounty-bot', 'testing-bounty', 'settle-payroll']) {
    const workflow = fs.readFileSync(`.github/workflows/${name}.yml`, 'utf8');
    assert.match(workflow, /pages: write/);
    assert.match(workflow, /gh api --method POST "repos\/\$\{GITHUB_REPOSITORY\}\/pages\/builds"/);
  }
});
