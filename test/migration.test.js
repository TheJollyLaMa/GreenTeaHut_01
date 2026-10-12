'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ZeroHash } = require('ethers');
const { hashEntries, validateSnapshot, SOURCE_ADDRESS } = require('../scripts/ledger-snapshot');
const { normalizeRuntime } = require('../scripts/activate-base');

const entry = { id: '1', amount: '123', entryType: '1', status: '2', category: 'Labor', description: 'Prior OP record', referenceURI: '', createdAt: '100', settledAt: '0' };
test('snapshot commitment includes every original field and enforces provenance', () => {
  const snapshot = { sourceChainId: 10, sourceAddress: SOURCE_ADDRESS, sourceBlock: 100, sourceBlockHash: '0x' + 'ab'.repeat(32), count: 1, entries: [entry], historyHash: hashEntries([entry]) };
  assert.equal(validateSnapshot(snapshot), snapshot);
  for (const key of ['amount', 'description', 'status', 'createdAt', 'referenceURI']) {
    const changed = { ...entry, [key]: key === 'amount' ? '124' : key === 'status' ? '3' : key === 'createdAt' ? '101' : 'changed' };
    assert.throws(() => validateSnapshot({ ...snapshot, entries: [changed] }));
  }
  assert.throws(() => validateSnapshot({ ...snapshot, sourceChainId: 8453 }));
  assert.throws(() => validateSnapshot({ ...snapshot, count: 2 }));
  assert.throws(() => validateSnapshot({ ...snapshot, sourceBlockHash: ZeroHash }));
  assert.throws(() => hashEntries([{ ...entry, id: '2' }]));
  assert.equal(hashEntries([]), ZeroHash);
});

test('persisted OP export contains all seven entries and source event provenance', () => {
  const snapshot = require('../web/optimism-history.json');
  validateSnapshot(snapshot);
  assert.equal(snapshot.count, 7);
  assert.equal(snapshot.events.length, 8);
  assert.ok(snapshot.events.every((event) => event.blockNumber >= snapshot.sourceDeploymentBlock && event.blockNumber <= snapshot.sourceBlock));
});

test('runtime comparison ignores only compiler-declared immutable slots', () => {
  const refs = { '1': [{ start: 1, length: 2 }] };
  assert.equal(normalizeRuntime('0xaa1234bb', refs), 'aa0000bb');
  assert.equal(normalizeRuntime('0xaa5678bb', refs), 'aa0000bb');
  assert.notEqual(normalizeRuntime('0xab1234bb', refs), 'aa0000bb');
});

test('deployment artifact, browser ABI and unsigned plan describe the same reviewed contract and history', () => {
  const solc = require('solc');
  const { Interface, AbiCoder } = require('ethers');
  const artifact = require('../artifacts/ProjectTreasuryLedger.json');
  const abi = require('../web/treasury-abi.json');
  const plan = require('../artifacts/base-deployment-plan.json');
  const config = require('../web/base-deployment.json');
  const snapshot = require('../web/optimism-history.json');
  const recompiled = JSON.parse(solc.compile(JSON.stringify(artifact.input)));
  const contract = recompiled.contracts['contracts/ProjectTreasuryLedger.sol'].ProjectTreasuryLedger;
  assert.equal(contract.evm.bytecode.object, artifact.evm.bytecode.object);
  assert.deepEqual(abi, artifact.abi);
  assert.equal(plan.chainId, 8453);
  assert.equal(plan.owner, config.owner);
  assert.deepEqual(plan.constructorArguments, [config.owner, snapshot.sourceBlock, snapshot.sourceBlockHash, snapshot.count, snapshot.historyHash]);
  const iface = new Interface(abi);
  const args = AbiCoder.defaultAbiCoder().encode(iface.deploy.inputs, plan.constructorArguments);
  assert.equal(plan.deployment.data, '0x' + artifact.evm.bytecode.object + args.slice(2));
  assert.equal(plan.afterDeployment[0].data, iface.encodeFunctionData('importHistory', [snapshot.entries]));
  assert.equal(plan.afterDeployment[1].data, iface.encodeFunctionData('finalizeMigration'));
});
