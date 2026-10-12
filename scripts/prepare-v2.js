'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ContractFactory, getAddress, isAddress, ZeroAddress } = require('ethers');
const { V1_ADDRESS, validateBaseSnapshot } = require('./base-snapshot');
const { verifyBaseSnapshot } = require('./verify-base-snapshot');

const root = path.resolve(__dirname, '..');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

// Products and managers are configured later through the reviewed UI, never seeded by deployment.
async function buildV2Plan(artifact, snapshot, opSnapshot, owner) {
  validateBaseSnapshot(snapshot, opSnapshot);
  if (!isAddress(owner || '') || owner === ZeroAddress) throw new Error('Invalid V2 owner');
  const args = [getAddress(owner), V1_ADDRESS, snapshot.sourceBlock, snapshot.sourceBlockHash, snapshot.count, snapshot.historyHash];
  const factory = new ContractFactory(artifact.abi, artifact.evm.bytecode.object);
  const deployment = await factory.getDeployTransaction(...args);
  return {
    chainId: 8453, network: 'Base', contract: 'ProjectTreasuryV2', owner: getAddress(owner),
    source: { chainId: 8453, address: V1_ADDRESS, block: snapshot.sourceBlock, hash: snapshot.sourceBlockHash },
    constructorArguments: args,
    deployment: { data: deployment.data, value: '0' },
    afterDeployment: [
      { function: 'importHistory', data: factory.interface.encodeFunctionData('importHistory', [snapshot.entries]), value: '0' },
      { function: 'finalizeMigration', data: factory.interface.encodeFunctionData('finalizeMigration'), value: '0' },
    ],
  };
}

async function main() {
  if (process.argv.length > 2) throw new Error('Usage: npm run prepare:v2. The owner comes from reviewed web/base-deployment.json. No transaction is sent.');
  const config = readJson('web/base-deployment.json');
  const snapshot = readJson('web/base-history.json');
  const opSnapshot = readJson('web/optimism-history.json');
  await verifyBaseSnapshot(snapshot, opSnapshot);
  const plan = await buildV2Plan(readJson('artifacts/ProjectTreasuryV2.json'), snapshot, opSnapshot, config.owner);
  fs.writeFileSync(path.join(root, 'artifacts/base-v2-deployment-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  console.log(`Prepared unsigned V2 deployment importing ${snapshot.count} V1 entries for owner ${plan.owner}. Nothing broadcast.`);
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { buildV2Plan };
