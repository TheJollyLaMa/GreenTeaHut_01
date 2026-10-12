'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEther } = require('ethers');
const { loadKey, validatePlan, checkBudget, fundingRequirement } = require('../scripts/deploy-base');

test('deployment rejects empty, malformed and seed-phrase input without echoing it', () => {
  for (const input of ['', undefined, 'not-a-private-key', 'seed phrase words', '0x123']) {
    assert.throws(() => loadKey(input), /Set BASE_DEPLOYER_PRIVATE_KEY locally/);
  }
  const testKey = '0x' + '01'.repeat(32);
  assert.equal(loadKey(testKey), testKey);
  assert.equal(loadKey(testKey.slice(2)), testKey);
  assert.equal(loadKey('AB'.repeat(32)), '0x' + 'AB'.repeat(32));
  for (const input of ['0'.repeat(64), 'f'.repeat(64)]) {
    assert.throws(() => loadKey(input), /not a valid secp256k1/);
  }
  for (const input of ['01'.repeat(31), '01'.repeat(33), 'zz'.repeat(32), ` ${testKey}`, `${testKey} `]) {
    assert.throws(() => loadKey(input), /exactly 64 hexadecimal/);
  }
});

test('fee budget rejects zero budget and cumulative overspend', () => {
  const cap = parseEther('0.01');
  assert.equal(checkBudget(0n, cap, cap), cap);
  assert.throws(() => checkBudget(cap, 1n, cap), /fee ceilings/);
  assert.throws(() => checkBudget(0n, 0n, 0n), /fee ceilings/);
});

test('minimum funding follows buffered quoted fees, not the configured maximum budget', () => {
  const execution = parseEther('0.00002');
  const data = parseEther('0.000003');
  const required = fundingRequirement(execution, data);
  assert.equal(required, parseEther('0.000046'));
  assert.ok(required < parseEther('0.01'));
  assert.equal(fundingRequirement(0n, 1n), 2n);
  assert.throws(() => fundingRequirement(-1n, 0n), /Invalid fee estimate/);
});

test('deployment only signs the reviewed bytecode, owner, Base chain and history import', async () => {
  const artifact = require('../artifacts/ProjectTreasuryLedger.json');
  const plan = require('../artifacts/base-deployment-plan.json');
  const config = require('../web/base-deployment.json');
  const snapshot = require('../web/optimism-history.json');
  const transaction = await validatePlan(artifact, plan, config, snapshot);
  assert.equal(transaction.data, plan.deployment.data);
  await assert.rejects(validatePlan(artifact, { ...plan, chainId: 10 }, config, snapshot), /chain or owner/);
  await assert.rejects(validatePlan(artifact, { ...plan, deployment: { ...plan.deployment, data: '0x00' } }, config, snapshot), /stale/);
  await assert.rejects(validatePlan(artifact, { ...plan, deployment: { ...plan.deployment, value: '1' } }, config, snapshot), /stale/);
  await assert.rejects(validatePlan(artifact, { ...plan, afterDeployment: [] }, config, snapshot), /only imports/);
});
