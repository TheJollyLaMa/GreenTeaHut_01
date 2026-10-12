'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Contract, Interface, isAddress, getAddress, ZeroAddress } = require('ethers');
const { hashEntries, serializeEntry } = require('./ledger-snapshot');
const { normalizeRuntime } = require('./activate-base');
const { V1_ADDRESS, V1_DEPLOYMENT_BLOCK, baseProvider, baseLogsProvider, assertBase, withRetry, collectLogs, validateBaseSnapshot } = require('./base-snapshot');
const { verifyBaseSnapshot } = require('./verify-base-snapshot');
const { AMOUNT, PURPOSE, USDC, USDC_AMOUNT, USDC_PURPOSE } = require('./smoke-base');

const root = path.resolve(__dirname, '..');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + '\n');
const BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'];

// Both smoke round trips must have moved exactly the test amount in and back out to the owner.
function smokeRoundTrips(logs, iface, owner) {
  const missing = [];
  for (const [asset, amount, purpose, label] of [[ZeroAddress, AMOUNT, PURPOSE, 'ETH'], [USDC, USDC_AMOUNT, USDC_PURPOSE, 'USDC']]) {
    const matches = (name, actor) => logs.some((log) => {
      const event = iface.parseLog(log);
      return event?.name === name && getAddress(event.args.asset) === getAddress(asset) &&
        event.args.amount === amount && event.args.referenceURI === purpose && getAddress(event.args[actor]) === owner;
    });
    if (!matches('FundsReceived', 'sender') || !matches('FundsPaid', 'recipient')) missing.push(label);
  }
  return missing;
}

async function activate() {
  const address = process.argv[2];
  if (!isAddress(address || '') || getAddress(address) === V1_ADDRESS) {
    throw new Error('Usage: node scripts/activate-v2.js <deployed-V2-address>');
  }
  const treasury = getAddress(address);
  const config = readJson('web/base-deployment.json');
  const owner = getAddress(config.owner);
  const opSnapshot = readJson('web/optimism-history.json');
  const snapshot = validateBaseSnapshot(readJson('web/base-history.json'), opSnapshot);
  const artifact = readJson('artifacts/ProjectTreasuryV2.json');
  const finalizedCheck = await verifyBaseSnapshot(snapshot, opSnapshot);
  const provider = baseProvider();
  const logsProvider = baseLogsProvider();
  try {
    await assertBase(provider);
    await assertBase(logsProvider);
    const block = await withRetry(() => provider.getBlock('finalized'));
    if (!block || block.number < finalizedCheck) throw new Error('No finalized Base block available');
    const at = { blockTag: block.number };
    const code = await withRetry(() => provider.getCode(treasury, block.number));
    const compiled = artifact.evm.deployedBytecode;
    if (code === '0x') throw new Error('V2 deployment is not finalized on Base yet; retry in a few minutes');
    if (normalizeRuntime(code, compiled.immutableReferences) !== normalizeRuntime(compiled.object, compiled.immutableReferences)) {
      throw new Error('Finalized V2 runtime differs from artifacts/ProjectTreasuryV2.json');
    }
    const ledger = new Contract(treasury, artifact.abi, provider);
    const read = (name, ...args) => withRetry(() => ledger[name](...args, at));
    if (getAddress(await read('owner')) !== owner || !(await read('migrationFinalized')) ||
        Number(await read('sourceChainId')) !== 8453 || getAddress(await read('sourceLedger')) !== V1_ADDRESS ||
        Number(await read('sourceBlock')) !== snapshot.sourceBlock || await read('sourceBlockHash') !== snapshot.sourceBlockHash ||
        Number(await read('historicalEntries')) !== snapshot.count || await read('historyHash') !== snapshot.historyHash ||
        await read('importedHash') !== snapshot.historyHash || getAddress(await read('USDC')) !== getAddress(USDC)) {
      throw new Error('V2 owner, USDC or finalized migration provenance does not match the reviewed V1 snapshot');
    }
    const imported = [];
    for (let id = 1; id <= snapshot.count; id++) imported.push(serializeEntry(await read('getEntry', id)));
    if (hashEntries(imported) !== snapshot.historyHash) throw new Error('V2 imported entries differ from the V1 snapshot');

    // Funds left on V1 would disappear from the site after cutover.
    const usdc = new Contract(USDC, BALANCE_ABI, provider);
    const [v1Eth, v1Usdc] = await Promise.all([
      withRetry(() => provider.getBalance(V1_ADDRESS, block.number)), withRetry(() => usdc.balanceOf(V1_ADDRESS, at)),
    ]);
    if (v1Eth !== 0n || v1Usdc !== 0n) throw new Error('V1 still holds ETH or USDC. Withdraw it to the owner before switching the site to V2.');

    let low = snapshot.sourceBlock;
    let high = block.number;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (await withRetry(() => provider.getCode(treasury, mid)) === '0x') low = mid + 1;
      else high = mid;
    }
    const core = require('../web/payroll-core');
    if (treasury !== getAddress(core.TREASURY) || low !== core.DEPLOYMENT_BLOCK) {
      throw new Error(`Reviewed site code pins ${core.TREASURY} at block ${core.DEPLOYMENT_BLOCK}; chain shows ${treasury} at ${low}. Update and review before activating.`);
    }
    const logs = await collectLogs(logsProvider, treasury, low, block.number);
    const missing = smokeRoundTrips(logs, ledger.interface, owner);
    if (missing.length) {
      throw new Error(`Run the V2 ${missing.join(' and ')} smoke test first: node scripts/smoke-base.js --v2 ${treasury}${missing.includes('USDC') && !missing.includes('ETH') ? ' --usdc' : ''} --broadcast`);
    }

    writeJson('web/base-deployment.json', {
      chainId: 8453, chainName: 'Base', rpcUrl: config.rpcUrl, explorerUrl: config.explorerUrl,
      version: 2, contract: 'ProjectTreasuryV2', abiFile: 'treasury-v2-abi.json', historyFile: 'base-history.json',
      address: treasury, deploymentBlock: low, owner, ready: true,
      previous: { contract: 'ProjectTreasuryLedger', address: V1_ADDRESS, deploymentBlock: V1_DEPLOYMENT_BLOCK, status: 'retired' },
    });
    writeJson('payroll-assets.json', { ...readJson('payroll-assets.json'), treasuryAddress: treasury, deploymentBlock: low });
    writeJson('web/storefront-deployment.json', { ...readJson('web/storefront-deployment.json'), address: treasury, deploymentBlock: low, ready: true });
    const metadata = readJson('web/deployment-metadata.json');
    metadata.contracts.ProjectTreasuryLedger.description = 'Previous Base treasury (V1), retired after migration to ProjectTreasuryV2';
    metadata.contracts.ProjectTreasuryLedger.networks['8453'].status = 'retired';
    metadata.contracts.ProjectTreasuryV2 = {
      description: 'Green Tea Hut #1 - active Base treasury, ledger, USDC payroll and storefront',
      abiVersion: '4.0.0',
      sourceFile: 'contracts/ProjectTreasuryV2.sol',
      artifactFile: 'artifacts/ProjectTreasuryV2.json',
      compiler: 'solc 0.8.30',
      abiFile: 'web/treasury-v2-abi.json',
      deploymentConfig: 'web/base-deployment.json',
      networks: { 8453: { chainName: 'Base', address: treasury, deploymentBlock: low, status: 'active', explorerUrl: `${config.explorerUrl}/address/${treasury}` } },
      requiredSelectors: Object.fromEntries(['totalEntries()', 'getEntry(uint256)', 'owner()',
        'payPayroll(uint256,string,uint8,address,uint256)', 'availableUSDC()', 'buy(uint256,uint256,uint256,uint256,bytes32)']
        .map((signature) => [new Interface([`function ${signature}`]).getFunction(signature).selector, signature])),
    };
    writeJson('web/deployment-metadata.json', metadata);
    console.log(`V2 activated at ${treasury} (deployment block ${low}); verified runtime, ${snapshot.count} imported entries, empty V1 and both smoke round trips. No transaction sent.`);
    console.log('Review the config diff, commit and publish. The store stays closed until the owner calls setStoreOpen(true).');
  } finally {
    provider.destroy();
    logsProvider.destroy();
  }
}

if (require.main === module) activate().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
module.exports = { smokeRoundTrips };
