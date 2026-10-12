'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { JsonRpcProvider, Contract } = require('ethers');
const { SOURCE_ADDRESS, LEGACY_ABI, hashEntries, serializeEntry, validateSnapshot } = require('./ledger-snapshot');

async function exportSnapshot() {
  const provider = new JsonRpcProvider(process.env.OP_RPC_URL || 'https://mainnet.optimism.io', 10, { staticNetwork: true });
  if (Number((await provider.getNetwork()).chainId) !== 10 ||
      Number(BigInt(await provider.send('eth_chainId', []))) !== 10) throw new Error('RPC is not Optimism');
  const block = await provider.getBlock('finalized');
  if (!block?.hash) throw new Error('Cannot read a finalized Optimism block');
  if (await provider.getCode(SOURCE_ADDRESS, block.number) === '0x') throw new Error('Source ledger is not deployed');
  const ledger = new Contract(SOURCE_ADDRESS, LEGACY_ABI, provider);
  const count = Number(await ledger.totalEntries({ blockTag: block.number }));
  if (!Number.isSafeInteger(count) || count > 200) throw new Error('Snapshot size requires a reviewed batched migration');
  const entries = [];
  for (let id = 1; id <= count; id++) {
    entries.push(serializeEntry(await ledger.getEntry(id, { blockTag: block.number })));
  }
  // Export all source logs in bounded ranges. Abort rather than silently lose provenance.
  const events = [];
  // Locate the first block with code so a fresh export need not scan the entire chain.
  let low = 0;
  let high = block.number;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (await provider.getCode(SOURCE_ADDRESS, mid) === '0x') low = mid + 1;
    else high = mid;
  }
  async function collectLogs(fromBlock, toBlock) {
    let logs;
    try {
      logs = await provider.getLogs({ address: SOURCE_ADDRESS, fromBlock, toBlock });
    } catch (error) {
      const message = String(error?.info?.error?.message || error.message);
      if (!/range|too many|limit exceeded|response size/i.test(message) || toBlock - fromBlock < 1000) throw error;
      const mid = Math.floor((fromBlock + toBlock) / 2);
      await collectLogs(fromBlock, mid);
      await collectLogs(mid + 1, toBlock);
      return;
    }
    events.push(...logs.map((log) => ({
      blockNumber: log.blockNumber, transactionHash: log.transactionHash, index: log.index,
      topics: log.topics, data: log.data,
    })));
  }
  await collectLogs(low, block.number);
  const snapshot = validateSnapshot({
    schemaVersion: 1, sourceChainId: 10, sourceAddress: SOURCE_ADDRESS,
    sourceBlock: block.number, sourceBlockHash: block.hash, sourceDeploymentBlock: low,
    exportedAt: new Date().toISOString(), count, entries, historyHash: hashEntries(entries), events,
  });
  const output = path.resolve(__dirname, '../web/optimism-history.json');
  fs.writeFileSync(output, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Exported ${count} historical entries and ${events.length} logs at finalized OP block ${block.number}`);
  provider.destroy();
}

if (require.main === module) exportSnapshot().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { exportSnapshot };
