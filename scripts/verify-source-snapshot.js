'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { JsonRpcProvider, Contract } = require('ethers');
const { validateSnapshot, SOURCE_ADDRESS, LEGACY_ABI, hashEntries, serializeEntry } = require('./ledger-snapshot');

async function verifySourceSnapshot(snapshot) {
  validateSnapshot(snapshot);
  const provider = new JsonRpcProvider(process.env.OP_RPC_URL || 'https://mainnet.optimism.io');
  try {
    if (Number((await provider.getNetwork()).chainId) !== 10) throw new Error('Source RPC must be Optimism');
    const original = await provider.getBlock(snapshot.sourceBlock);
    if (original?.hash !== snapshot.sourceBlockHash) throw new Error('OP source block hash changed');
    const latest = await provider.getBlock('finalized');
    if (!latest) throw new Error('Cannot verify finalized OP history');
    const contract = new Contract(SOURCE_ADDRESS, LEGACY_ABI, provider);
    const count = Number(await contract.totalEntries({ blockTag: latest.number }));
    if (count !== snapshot.count) throw new Error('OP entries changed after snapshot. Export and prepare again before deploying.');
    const entries = [];
    for (let id = 1; id <= count; id++) entries.push(serializeEntry(await contract.getEntry(id, { blockTag: latest.number })));
    if (hashEntries(entries) !== snapshot.historyHash) throw new Error('OP entry content changed after snapshot. Export and prepare again before deploying.');
    console.log(`Verified ${count} OP entries still match snapshot at finalized block ${latest.number}`);
  } finally {
    provider.destroy();
  }
}

if (require.main === module) {
  const snapshot = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../web/optimism-history.json'), 'utf8'));
  verifySourceSnapshot(snapshot).catch((error) => { console.error(error); process.exitCode = 1; });
}
module.exports = { verifySourceSnapshot };
