'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { hashEntries } = require('./ledger-snapshot');
const {
  V1_ADDRESS, V1_DEPLOYMENT_BLOCK, baseProvider, baseLogsProvider, assertBase,
  withRetry, collectLogs, payrollPayouts, readV1History, validateBaseSnapshot,
} = require('./base-snapshot');

const root = path.resolve(__dirname, '..');

async function exportBase() {
  const opSnapshot = JSON.parse(fs.readFileSync(path.join(root, 'web/optimism-history.json'), 'utf8'));
  const provider = baseProvider();
  const logsProvider = baseLogsProvider();
  try {
    await assertBase(provider);
    await assertBase(logsProvider);
    const block = await withRetry(() => provider.getBlock('finalized'));
    if (!block?.hash) throw new Error('Cannot read a finalized Base block');
    if (await withRetry(() => provider.getCode(V1_ADDRESS, block.number)) === '0x') throw new Error('V1 treasury is not deployed');
    const entries = await readV1History(provider, block.number);
    const events = await collectLogs(logsProvider, V1_ADDRESS, V1_DEPLOYMENT_BLOCK, block.number);
    const payouts = payrollPayouts(events);
    if (payouts.length) {
      throw new Error(`V1 has ${payouts.length} repository payroll payout(s). V2 cannot enforce their uniqueness; stop and add a reviewed payroll-reference import.`);
    }
    const snapshot = validateBaseSnapshot({
      schemaVersion: 1, sourceChainId: 8453, sourceAddress: V1_ADDRESS, sourceDeploymentBlock: V1_DEPLOYMENT_BLOCK,
      sourceBlock: block.number, sourceBlockHash: block.hash, exportedAt: new Date().toISOString(),
      predecessor: {
        chainId: opSnapshot.sourceChainId, address: opSnapshot.sourceAddress, block: opSnapshot.sourceBlock,
        blockHash: opSnapshot.sourceBlockHash, historyHash: opSnapshot.historyHash,
      },
      count: entries.length, entries, historyHash: hashEntries(entries), payrollPayouts: [], events,
    }, opSnapshot);
    fs.writeFileSync(path.join(root, 'web/base-history.json'), JSON.stringify(snapshot, null, 2) + '\n');
    console.log(`Exported ${snapshot.count} V1 entries and ${events.length} logs at finalized Base block ${block.number}; no repository payroll payouts found.`);
  } finally {
    provider.destroy();
    logsProvider.destroy();
  }
}

if (require.main === module) exportBase().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { exportBase };
