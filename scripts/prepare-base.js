'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ContractFactory, isAddress, ZeroAddress, getAddress } = require('ethers');
const { validateSnapshot } = require('./ledger-snapshot');
const { verifySourceSnapshot } = require('./verify-source-snapshot');

const root = path.resolve(__dirname, '..');
const owner = process.argv[2];
const managers = process.argv.slice(3);
if (!isAddress(owner || '') || owner === ZeroAddress) {
  console.error('Usage: npm run prepare:base -- <owner-wallet-or-Safe-address>. No transaction is sent.');
  process.exit(1);
}
for (const manager of managers) {
  if (!isAddress(manager) || manager === ZeroAddress) throw new Error(`Invalid manager address: ${manager}`);
}
const snapshot = validateSnapshot(JSON.parse(fs.readFileSync(path.join(root, 'web/optimism-history.json'), 'utf8')));
const artifact = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/ProjectTreasuryLedger.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'web/base-deployment.json'), 'utf8'));
if (getAddress(owner) !== getAddress(config.owner)) throw new Error('Owner differs from reviewed web/base-deployment.json; update and review the planned owner first');

async function main() {
  await verifySourceSnapshot(snapshot);
  const args = [getAddress(owner), snapshot.sourceBlock, snapshot.sourceBlockHash, snapshot.count, snapshot.historyHash];
  const factory = new ContractFactory(artifact.abi, artifact.evm.bytecode.object);
  const deployment = await factory.getDeployTransaction(...args);
  const iface = factory.interface;
  const plan = {
    chainId: 8453, network: 'Base', owner: getAddress(owner),
    source: { chainId: 10, address: snapshot.sourceAddress, block: snapshot.sourceBlock, hash: snapshot.sourceBlockHash },
    constructorArguments: args,
    deployment: { data: deployment.data, value: '0' },
    afterDeployment: [
      ...(snapshot.count ? [{ function: 'importHistory', data: iface.encodeFunctionData('importHistory', [snapshot.entries]), value: '0' }] : []),
      { function: 'finalizeMigration', data: iface.encodeFunctionData('finalizeMigration'), value: '0' },
      ...managers.map((manager) => ({ function: 'setManager', data: iface.encodeFunctionData('setManager', [getAddress(manager), true]), value: '0' })),
    ],
  };
  fs.writeFileSync(path.join(root, 'artifacts/base-deployment-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  console.log(`Prepared unsigned Base deployment and history import for ${getAddress(owner)}. Nothing broadcast.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
