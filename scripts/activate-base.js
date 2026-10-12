'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { JsonRpcProvider, Contract, isAddress, getAddress } = require('ethers');
const { validateSnapshot, hashEntries, serializeEntry } = require('./ledger-snapshot');
const { verifySourceSnapshot } = require('./verify-source-snapshot');

function normalizeRuntime(code, references) {
  let normalized = code.replace(/^0x/, '');
  for (const slots of Object.values(references)) {
    for (const { start, length } of slots) {
      normalized = normalized.slice(0, start * 2) + '0'.repeat(length * 2) + normalized.slice((start + length) * 2);
    }
  }
  return normalized;
}

async function activate() {
  const root = path.resolve(__dirname, '..');
  const address = process.argv[2];
  if (!isAddress(address || '')) throw new Error('Usage: node scripts/activate-base.js <deployed-Base-address>');
  const file = path.join(root, 'web/base-deployment.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  const snapshot = validateSnapshot(JSON.parse(fs.readFileSync(path.join(root, 'web/optimism-history.json'), 'utf8')));
  const artifact = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/ProjectTreasuryLedger.json'), 'utf8'));
  await verifySourceSnapshot(snapshot);
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL || 'https://mainnet.base.org', 8453, { staticNetwork: true });
  try {
    if (Number(BigInt(await provider.send('eth_chainId', []))) !== 8453) throw new Error('RPC must be Base mainnet');
    const block = await provider.getBlock('finalized');
    if (!block) throw new Error('No finalized Base block available');
    const code = await provider.getCode(address, block.number);
    const compiled = artifact.evm.deployedBytecode;
    if (!compiled.immutableReferences ||
        normalizeRuntime(code, compiled.immutableReferences) !== normalizeRuntime(compiled.object, compiled.immutableReferences)) {
      throw new Error('Finalized deployed runtime differs from the compiled treasury');
    }
    const ledger = new Contract(address, artifact.abi, provider);
    const at = { blockTag: block.number };
    if (getAddress(await ledger.owner(at)) !== getAddress(config.owner) ||
        !(await ledger.migrationFinalized(at)) ||
        Number(await ledger.sourceChainId(at)) !== 10 ||
        getAddress(await ledger.sourceLedger(at)) !== getAddress(snapshot.sourceAddress) ||
        Number(await ledger.sourceBlock(at)) !== snapshot.sourceBlock ||
        await ledger.sourceBlockHash(at) !== snapshot.sourceBlockHash ||
        Number(await ledger.historicalEntries(at)) !== snapshot.count ||
        await ledger.historyHash(at) !== snapshot.historyHash ||
        await ledger.importedHash(at) !== snapshot.historyHash) {
      throw new Error('Owner or finalized migration provenance does not match the reviewed configuration');
    }
    const imported = [];
    for (let id = 1; id <= snapshot.count; id++) imported.push(serializeEntry(await ledger.getEntry(id, at)));
    if (hashEntries(imported) !== snapshot.historyHash) throw new Error('Imported entries differ from the OP snapshot');
    let low = 0;
    let high = block.number;
    while (low < high) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const mid = Math.floor((low + high) / 2);
      if (await provider.getCode(address, mid) === '0x') low = mid + 1;
      else high = mid;
    }
    const metadataFile = path.join(root, 'web/deployment-metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    metadata.contracts.ProjectTreasuryLedger.networks['8453'] = {
      chainName: 'Base', address: getAddress(address), status: 'deployed',
      explorerUrl: `${config.explorerUrl}/address/${getAddress(address)}`,
    };
    fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2) + '\n');
    fs.writeFileSync(file, JSON.stringify({ ...config, address: getAddress(address), deploymentBlock: low, ready: true }, null, 2) + '\n');
    console.log(`Base treasury activated at ${getAddress(address)}; verified runtime and all ${snapshot.count} historical entries. No transaction sent.`);
  } finally {
    provider.destroy();
  }
}

if (require.main === module) activate().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { normalizeRuntime };
