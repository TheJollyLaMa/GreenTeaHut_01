'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ganache = require('ganache');
const ethers = require('ethers');
const { V1_ABI, V1_ADDRESS, payrollPayouts, validateBaseSnapshot } = require('../scripts/base-snapshot');
const { hashEntries } = require('../scripts/ledger-snapshot');
const { buildV2Plan } = require('../scripts/prepare-v2');
const { validateV2Plan } = require('../scripts/deploy-v2');

const artifact = require('../artifacts/ProjectTreasuryV2.json');
const snapshot = require('../web/base-history.json');
const opSnapshot = require('../web/optimism-history.json');
const config = require('../web/base-deployment.json');
const clone = (value) => JSON.parse(JSON.stringify(value));

function fundsPaidLog(referenceURI) {
  const iface = new ethers.Interface(V1_ABI);
  const encoded = iface.encodeEventLog('FundsPaid', [1, ethers.ZeroAddress, config.owner, config.owner, 1, referenceURI]);
  return { blockNumber: snapshot.sourceBlock, transactionHash: ethers.ZeroHash, index: 0, ...encoded };
}

test('Base V1 snapshot keeps OP history as its prefix and contains no payroll payouts', () => {
  assert.equal(validateBaseSnapshot(clone(snapshot), opSnapshot).sourceAddress, V1_ADDRESS);
  assert.equal(snapshot.historyHash, hashEntries(snapshot.entries));
  const wrongChain = { ...clone(snapshot), sourceChainId: 10 };
  assert.throws(() => validateBaseSnapshot(wrongChain, opSnapshot), /provenance/);
  const edited = clone(snapshot);
  edited.entries[0].description = 'rewritten';
  edited.historyHash = hashEntries(edited.entries);
  assert.throws(() => validateBaseSnapshot(edited, opSnapshot), /OP prototype/);
  const outside = clone(snapshot);
  outside.events.push({ ...fundsPaidLog('ok'), blockNumber: snapshot.sourceBlock + 1 });
  assert.throws(() => validateBaseSnapshot(outside, opSnapshot), /outside/);
});

test('V1 repository payroll payouts block the V2 migration', () => {
  assert.deepEqual(payrollPayouts([fundsPaidLog('Green Tea Hut USDC receive/withdraw smoke test')]), []);
  const payroll = fundsPaidLog('repo-payroll:TheJollyLaMa/GreenTeaHut_01#1:alice:contributor:USDC');
  assert.equal(payrollPayouts([payroll]).length, 1);
  const withPayroll = clone(snapshot);
  withPayroll.events.push(payroll);
  assert.throws(() => validateBaseSnapshot(withPayroll, opSnapshot), /payroll/);
});

test('V2 deployment signs only the reviewed bytecode, V1 predecessor and history import', async () => {
  const plan = require('../artifacts/base-v2-deployment-plan.json');
  const transaction = await validateV2Plan(artifact, plan, config, snapshot, opSnapshot);
  assert.equal(transaction.data, plan.deployment.data);
  assert.equal(plan.constructorArguments[1], V1_ADDRESS);
  await assert.rejects(validateV2Plan(artifact, { ...plan, chainId: 10 }, config, snapshot, opSnapshot), /chain/);
  await assert.rejects(validateV2Plan(artifact, { ...plan, contract: 'ProjectTreasuryLedger' }, config, snapshot, opSnapshot), /contract/);
  await assert.rejects(validateV2Plan(artifact, { ...plan, deployment: { ...plan.deployment, data: '0x00' } }, config, snapshot, opSnapshot), /stale/);
  await assert.rejects(validateV2Plan(artifact, { ...plan, deployment: { ...plan.deployment, value: '1' } }, config, snapshot, opSnapshot), /stale/);
  await assert.rejects(validateV2Plan(artifact, { ...plan, afterDeployment: plan.afterDeployment.slice(1) }, config, snapshot, opSnapshot), /only imports/);
  const changed = clone(snapshot);
  changed.sourceBlock += 1;
  await assert.rejects(validateV2Plan(artifact, plan, config, changed, opSnapshot), /stale/);
});

test('V2 plan deploys, imports and finalizes on a local Base-id chain', async () => {
  const rpc = ganache.provider({ chain: { chainId: 8453 }, logging: { quiet: true }, wallet: { totalAccounts: 1 } });
  const provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  try {
    const signer = await provider.getSigner(0);
    const plan = await buildV2Plan(artifact, snapshot, opSnapshot, await signer.getAddress());
    const deployed = await (await signer.sendTransaction({ data: plan.deployment.data })).wait();
    for (const call of plan.afterDeployment) {
      await (await signer.sendTransaction({ to: deployed.contractAddress, data: call.data })).wait();
    }
    const treasury = new ethers.Contract(deployed.contractAddress, artifact.abi, provider);
    assert.equal(await treasury.migrationFinalized(), true);
    assert.equal(await treasury.importedHash(), snapshot.historyHash);
    assert.equal(await treasury.sourceLedger(), V1_ADDRESS);
    assert.equal(await treasury.totalEntries(), BigInt(snapshot.count));
    assert.equal(await treasury.storeOpen(), false);
    assert.equal(await treasury.productCount(), 0n);
  } finally {
    await rpc.disconnect();
  }
});
