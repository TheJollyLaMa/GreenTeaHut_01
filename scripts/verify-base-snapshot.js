'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { hashEntries } = require('./ledger-snapshot');
const {
  V1_ADDRESS, baseProvider, baseLogsProvider, assertBase, withRetry,
  collectLogs, payrollPayouts, readV1History, validateBaseSnapshot,
} = require('./base-snapshot');

const root = path.resolve(__dirname, '..');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

// V1 stays live until cutover, so re-prove nothing changed since the export before signing or activating.
async function verifyBaseSnapshot(snapshot = readJson('web/base-history.json'), opSnapshot = readJson('web/optimism-history.json')) {
  validateBaseSnapshot(snapshot, opSnapshot);
  const provider = baseProvider();
  const logsProvider = baseLogsProvider();
  try {
    await assertBase(provider);
    await assertBase(logsProvider);
    const original = await withRetry(() => provider.getBlock(snapshot.sourceBlock));
    if (original?.hash !== snapshot.sourceBlockHash) throw new Error('Base V1 snapshot block hash changed');
    const latest = await withRetry(() => provider.getBlock('finalized'));
    if (!latest || latest.number < snapshot.sourceBlock) throw new Error('Cannot verify finalized Base V1 history');
    const entries = await readV1History(provider, latest.number);
    if (entries.length !== snapshot.count || hashEntries(entries) !== snapshot.historyHash) {
      throw new Error('V1 entries changed after the snapshot. Run npm run export:base and npm run prepare:v2 again before deploying.');
    }
    const later = await collectLogs(logsProvider, V1_ADDRESS, snapshot.sourceBlock + 1, latest.number);
    if (payrollPayouts(later).length) throw new Error('V1 paid repository payroll after the snapshot; V2 cannot enforce uniqueness for it. Stop.');
    console.log(`Verified ${snapshot.count} V1 entries still match the snapshot at finalized Base block ${latest.number}; no V1 payroll payouts.`);
    return latest.number;
  } finally {
    provider.destroy();
    logsProvider.destroy();
  }
}

if (require.main === module) verifyBaseSnapshot().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { verifyBaseSnapshot };
