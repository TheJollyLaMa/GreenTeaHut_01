'use strict';

const { Contract, Interface, ZeroHash, isHexString, getAddress, JsonRpcProvider } = require('ethers');
const { ENTRY_TUPLE, hashEntries, validateSnapshot, serializeEntry } = require('./ledger-snapshot');

const V1_ADDRESS = '0x757B1F856f2Faea5a661820f9da56af032B1F9a1';
const V1_DEPLOYMENT_BLOCK = 52508544;
const PAYROLL_PREFIX = 'repo-payroll:';
const V1_ABI = [
  'function totalEntries() view returns (uint256)',
  `function getEntry(uint256) view returns (${ENTRY_TUPLE})`,
  'event FundsPaid(uint256 indexed transferId,address indexed asset,address indexed recipient,address manager,uint256 amount,string referenceURI)',
];
const v1 = new Interface(V1_ABI);
const FUNDS_PAID = v1.getEvent('FundsPaid').topicHash;

// Public endpoints split capabilities: mainnet.base.org serves block-pinned state but throttles
// eth_getLogs, while publicnode serves logs but rejects block-pinned state without a token.
function baseProvider() {
  return new JsonRpcProvider(process.env.BASE_RPC_URL || 'https://mainnet.base.org', 8453, { staticNetwork: true });
}

function baseLogsProvider() {
  return new JsonRpcProvider(process.env.BASE_LOGS_RPC_URL || 'https://base-rpc.publicnode.com', 8453, { staticNetwork: true });
}

async function assertBase(provider) {
  if (Number(BigInt(await provider.send('eth_chainId', []))) !== 8453) throw new Error('RPC must be Base mainnet (8453)');
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry(task) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      const message = String(error?.info?.responseBody || error?.shortMessage || error?.message);
      if (attempt >= 5 || !/limit|429|rate|timeout|busy/i.test(message)) throw error;
      await pause(1000 * 2 ** attempt);
    }
  }
}

async function collectLogs(provider, address, fromBlock, toBlock, span = 2000) {
  const logs = [];
  for (let start = fromBlock; start <= toBlock; start += span) {
    const end = Math.min(start + span - 1, toBlock);
    const batch = await withRetry(() => provider.getLogs({ address, fromBlock: start, toBlock: end }));
    logs.push(...batch.map((log) => ({
      blockNumber: log.blockNumber, transactionHash: log.transactionHash, index: log.index,
      topics: [...log.topics], data: log.data,
    })));
    await pause(150);
  }
  return logs;
}

function payrollPayouts(events) {
  return events.filter((log) => log.topics[0] === FUNDS_PAID)
    .map((log) => ({ log, args: v1.parseLog(log).args }))
    .filter(({ args }) => args.referenceURI.startsWith(PAYROLL_PREFIX))
    .map(({ log, args }) => ({ transactionHash: log.transactionHash, referenceURI: args.referenceURI }));
}

async function readV1History(provider, blockTag) {
  const ledger = new Contract(V1_ADDRESS, V1_ABI, provider);
  const count = Number(await withRetry(() => ledger.totalEntries({ blockTag })));
  if (!Number.isSafeInteger(count) || count > 200) throw new Error('V1 history size requires a reviewed batched migration');
  const entries = [];
  for (let id = 1; id <= count; id++) {
    entries.push(serializeEntry(await withRetry(() => ledger.getEntry(id, { blockTag }))));
  }
  return entries;
}

// The OP prototype entries must remain the unaltered prefix of the Base history.
function validateBaseSnapshot(snapshot, opSnapshot) {
  validateSnapshot(opSnapshot);
  if (snapshot.schemaVersion !== 1 || snapshot.sourceChainId !== 8453 ||
      getAddress(snapshot.sourceAddress) !== V1_ADDRESS || snapshot.sourceDeploymentBlock !== V1_DEPLOYMENT_BLOCK ||
      !Number.isSafeInteger(snapshot.sourceBlock) || snapshot.sourceBlock < V1_DEPLOYMENT_BLOCK ||
      !isHexString(snapshot.sourceBlockHash, 32) || snapshot.sourceBlockHash === ZeroHash ||
      !Array.isArray(snapshot.entries) || snapshot.count !== snapshot.entries.length || snapshot.count === 0 ||
      hashEntries(snapshot.entries) !== snapshot.historyHash || !Array.isArray(snapshot.events)) {
    throw new Error('Base V1 snapshot provenance, count or commitment is invalid');
  }
  const predecessor = snapshot.predecessor || {};
  if (predecessor.chainId !== opSnapshot.sourceChainId || predecessor.address !== opSnapshot.sourceAddress ||
      predecessor.block !== opSnapshot.sourceBlock || predecessor.blockHash !== opSnapshot.sourceBlockHash ||
      predecessor.historyHash !== opSnapshot.historyHash || snapshot.count < opSnapshot.count ||
      hashEntries(snapshot.entries.slice(0, opSnapshot.count)) !== opSnapshot.historyHash) {
    throw new Error('Base V1 snapshot does not preserve the OP prototype history');
  }
  if (snapshot.events.some((log) => log.blockNumber < V1_DEPLOYMENT_BLOCK || log.blockNumber > snapshot.sourceBlock)) {
    throw new Error('Base V1 snapshot events fall outside the exported range');
  }
  // V2 does not import V1 payroll flags, so any V1 payroll payout would allow a duplicate.
  const payouts = payrollPayouts(snapshot.events);
  if (payouts.length || !Array.isArray(snapshot.payrollPayouts) || snapshot.payrollPayouts.length) {
    throw new Error('V1 has repository payroll payouts; V2 cannot enforce their uniqueness. Stop and add a reviewed payroll-reference import.');
  }
  return snapshot;
}

module.exports = {
  V1_ADDRESS, V1_DEPLOYMENT_BLOCK, V1_ABI, PAYROLL_PREFIX,
  baseProvider, baseLogsProvider, assertBase, withRetry, readV1History, collectLogs, payrollPayouts, validateBaseSnapshot,
};
