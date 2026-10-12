'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { JsonRpcProvider, Wallet, Contract, Transaction, getAddress, keccak256, parseEther, formatEther, formatUnits, ZeroAddress } = require('ethers');
const { loadKey } = require('./deploy-base');
const { normalizeRuntime } = require('./activate-base');
const { hashEntries, serializeEntry, validateSnapshot } = require('./ledger-snapshot');
const { V1_ADDRESS, validateBaseSnapshot } = require('./base-snapshot');

const ADDRESS = V1_ADDRESS;
const AMOUNT = parseEther('0.000001');
const PURPOSE = 'Green Tea Hut ETH receive/withdraw smoke test';
const root = path.resolve(__dirname, '..');
// Circle native USDC on Base, not bridged USDbC.
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_AMOUNT = 10000n;
const USDC_PURPOSE = 'Green Tea Hut USDC receive/withdraw smoke test';
const TOKEN_ABI = [
  'function decimals() view returns(uint8)',
  'function symbol() view returns(string)',
  'function balanceOf(address) view returns(uint256)',
  'function allowance(address,address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
  'event Approval(address indexed owner,address indexed spender,uint256 value)',
];
class SmokeError extends Error {}
let stage = 'loading local configuration';

function verifyMovement(receipt, iface, name, owner, amount, asset = ZeroAddress, purpose = PURPOSE, treasury = ADDRESS) {
  const events = receipt.logs
    .filter((log) => log.address.toLowerCase() === treasury.toLowerCase())
    .map((log) => iface.parseLog(log))
    .filter((event) => event?.name === name);
  if (receipt.status !== 1 || events.length !== 1) throw new SmokeError('Missing successful treasury movement receipt');
  const args = events[0].args;
  const actor = name === 'FundsReceived' ? args.sender : args.recipient;
  if (getAddress(actor) !== getAddress(owner) || getAddress(args.asset) !== getAddress(asset) ||
      args.amount !== amount || args.referenceURI !== purpose ||
      (name === 'FundsPaid' && getAddress(args.manager) !== getAddress(owner))) {
    throw new SmokeError('Treasury movement receipt does not match the test');
  }
}

function verifyTokenTransfer(receipt, iface, from, to, amount) {
  const transfers = receipt.logs.filter((log) => log.address.toLowerCase() === USDC.toLowerCase())
    .map((log) => iface.parseLog(log)).filter((event) => event?.name === 'Transfer');
  if (receipt.status !== 1 || transfers.length !== 1 ||
      getAddress(transfers[0].args.from) !== getAddress(from) ||
      getAddress(transfers[0].args.to) !== getAddress(to) ||
      transfers[0].args.value !== amount) throw new SmokeError('USDC Transfer event does not match exact test movement');
}

async function main() {
  const args = process.argv.slice(2);
  const v2Index = args.indexOf('--v2');
  const v2 = v2Index >= 0;
  const target = v2 ? args[v2Index + 1] : ADDRESS;
  const flags = v2 ? args.filter((_, index) => index !== v2Index && index !== v2Index + 1) : args;
  if (new Set(flags).size !== flags.length || flags.some((flag) => !['--broadcast', '--usdc'].includes(flag)) ||
      !/^0x[0-9a-fA-F]{40}$/.test(target || '') || (v2 && getAddress(target) === ADDRESS)) {
    throw new SmokeError('Usage: node scripts/smoke-base.js [--v2 <V2-address>] [--usdc] [--broadcast]');
  }
  const TREASURY = getAddress(target);
  const broadcast = flags.includes('--broadcast');
  const usdc = flags.includes('--usdc');
  const asset = usdc ? USDC : ZeroAddress;
  const amount = usdc ? USDC_AMOUNT : AMOUNT;
  const purpose = usdc ? USDC_PURPOSE : PURPOSE;
  const stateFile = path.join(root, `.base-${v2 ? 'v2-' : ''}${usdc ? 'usdc-' : ''}smoke-state.json`);
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath) || (fs.statSync(envPath).mode & 0o077) !== 0) throw new SmokeError('Create the local .env and protect it with chmod 600 .env');
  process.loadEnvFile(envPath);
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL || 'https://mainnet.base.org');
  try {
    stage = 'checking Base RPC network';
    if (Number((await provider.getNetwork()).chainId) !== 8453) throw new SmokeError('RPC is not Base mainnet');
    const wallet = new Wallet(loadKey(process.env.BASE_DEPLOYER_PRIVATE_KEY), provider);
    stage = 'checking deployed owner and runtime';
    const artifact = require(v2 ? '../artifacts/ProjectTreasuryV2.json' : '../artifacts/ProjectTreasuryLedger.json');
    const snapshot = v2 ? validateBaseSnapshot(require('../web/base-history.json'), require('../web/optimism-history.json'))
      : validateSnapshot(require('../web/optimism-history.json'));
    const config = require('../web/base-deployment.json');
    const ledger = new Contract(TREASURY, artifact.abi, provider);
    if (getAddress(wallet.address) !== getAddress(config.owner) ||
        getAddress(await ledger.owner()) !== getAddress(wallet.address)) throw new SmokeError('Local key must control the treasury owner');
    const runtime = artifact.evm.deployedBytecode;
    if (normalizeRuntime(await provider.getCode(TREASURY), runtime.immutableReferences) !==
        normalizeRuntime(runtime.object, runtime.immutableReferences)) throw new SmokeError('Deployed bytecode mismatch');
    if (v2 && (getAddress(await ledger.sourceLedger()) !== ADDRESS || await ledger.storeOpen() || await ledger.reservedUSDC() !== 0n)) {
      throw new SmokeError('V2 predecessor, closed store or zero escrow precondition failed');
    }
    if (!(await ledger.migrationFinalized()) || await ledger.historyHash() !== snapshot.historyHash ||
        await ledger.importedHash() !== snapshot.historyHash ||
        Number(await ledger.historicalEntries()) !== snapshot.count) throw new SmokeError('Migration verification failed');
    const entries = [];
    stage = 'checking imported entries';
    for (let id = 1; id <= snapshot.count; id++) entries.push(serializeEntry(await ledger.getEntry(id)));
    if (hashEntries(entries) !== snapshot.historyHash) throw new SmokeError('Historical entries differ from snapshot');
    let token;
    let allowance = 0n;
    const savedState = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
    if (savedState && (fs.statSync(stateFile).mode & 0o077) !== 0) throw new SmokeError('Protect the local smoke-test state with chmod 600 before resuming');
    if (savedState && (savedState.chainId !== 8453 || savedState.address !== TREASURY ||
        savedState.owner !== wallet.address || savedState.amountWei !== amount.toString() ||
        (savedState.asset || ZeroAddress) !== asset)) throw new SmokeError('Existing smoke-test state does not match; do not delete it or start a second deposit');
    if (usdc) {
      stage = 'checking native Base USDC and owner token balance';
      token = new Contract(USDC, TOKEN_ABI, provider);
      if (await provider.getCode(USDC) === '0x' || Number(await token.decimals()) !== 6 ||
          await token.symbol() !== 'USDC') throw new SmokeError('Native Base USDC contract verification failed');
      const tokenBalance = await token.balanceOf(wallet.address);
      allowance = await token.allowance(wallet.address, TREASURY);
      console.log(`Native Base USDC: ${USDC}; owner balance: ${formatUnits(tokenBalance, 6)} USDC.`);
      if (!savedState?.steps.deposit && tokenBalance < amount) throw new SmokeError('Owner wallet needs at least 0.01 native USDC on Base. No token purchase or bridge is performed.');
      if (!savedState && allowance !== 0n) throw new SmokeError('Existing USDC allowance is nonzero. Revoke it in your wallet before this exact-allowance test.');
    }
    const treasuryBalance = (block = 'latest') => token ? token.balanceOf(TREASURY, { blockTag: block }) : provider.getBalance(TREASURY, block);
    const fees = await provider.getFeeData();
    stage = 'estimating test fees and deposit';
    if (fees.maxFeePerGas === null || fees.maxPriorityFeePerGas === null) throw new SmokeError('No EIP-1559 fee quote available');
    const requests = {
      ...(usdc ? { approve: { to: USDC, value: 0n, data: token.interface.encodeFunctionData('approve', [TREASURY, amount]) } } : {}),
      deposit: { to: TREASURY, value: usdc ? 0n : amount, data: usdc
        ? ledger.interface.encodeFunctionData('depositToken', [USDC, amount, purpose])
        : ledger.interface.encodeFunctionData('depositETH', [purpose]) },
      withdraw: { to: TREASURY, value: 0n, data: usdc
        ? ledger.interface.encodeFunctionData('payToken', [USDC, wallet.address, amount, purpose])
        : ledger.interface.encodeFunctionData('payETH', [wallet.address, amount, purpose]) },
    };
    const gasLimit = 150000n;
    const executionCeiling = gasLimit * fees.maxFeePerGas * BigInt(usdc ? 3 : 2);
    const cap = parseEther(process.env.BASE_DEPLOY_MAX_FEE_ETH || '0');
    if (cap <= 0n || executionCeiling > cap) throw new SmokeError('Smoke-test execution fee ceiling exceeds configured budget');
    const balance = await provider.getBalance(wallet.address);
    console.log(`Base treasury: ${TREASURY}; owner: ${wallet.address}`);
    console.log(`Test: deposit ${usdc ? '0.01 USDC' : '0.000001 ETH'}, then return exactly that amount to the owner.`);
    console.log(`${usdc ? 'Three' : 'Two'}-transaction execution fee ceiling: ${formatEther(executionCeiling)} ETH; L1 fees are additional.`);
    // Reserve extra funds for data fees; this is not a prediction of actual cost.
    const required = (usdc ? 0n : amount) + executionCeiling * 2n + parseEther('0.00001');
    if (balance < required) throw new SmokeError(`Insufficient gas buffer; current test requires ${formatEther(required)} ETH on Base`);
    if (usdc && allowance < amount && !savedState?.steps.deposit) {
      await provider.estimateGas({ ...requests.approve, from: wallet.address });
      console.log('Deposit gas estimation follows the exact-amount approval; the approval is not sent during preflight.');
    } else if (!savedState?.steps.deposit) await provider.estimateGas({ ...requests.deposit, from: wallet.address });
    if (!broadcast) {
      console.log(`Dry run passed. Nothing signed or sent. Run the same command with --broadcast for the real transactions.`);
      return;
    }
    stage = 'loading resumable test state';
    const state = savedState || {
      chainId: 8453, address: TREASURY, owner: wallet.address, amountWei: amount.toString(), asset,
      baselineWei: (await treasuryBalance()).toString(),
      ...(usdc ? { ownerBaselineUnits: (await token.balanceOf(wallet.address)).toString() } : {}), steps: {},
    };
    const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });

    async function step(label) {
      stage = `${label} transaction`;
      const request = requests[label];
      let saved = state.steps[label];
      if (!saved) {
        const gas = await provider.estimateGas({ ...request, from: wallet.address });
        if (gas > gasLimit) throw new SmokeError('Estimated test gas exceeds reviewed gas limit');
        const raw = await wallet.signTransaction({
          ...request, chainId: 8453, nonce: await provider.getTransactionCount(wallet.address, 'pending'),
          type: 2, gasLimit, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        });
        saved = { hash: keccak256(raw), raw };
        state.steps[label] = saved;
        save();
      }
      const parsed = Transaction.from(saved.raw);
      if (parsed.hash !== saved.hash || parsed.from !== wallet.address || parsed.chainId !== 8453n ||
          getAddress(parsed.to) !== getAddress(request.to) || parsed.value !== request.value || parsed.data !== request.data ||
          parsed.gasLimit > gasLimit || parsed.maxFeePerGas * parsed.gasLimit > cap) throw new SmokeError('Persisted signed test transaction mismatch');
      let receipt = await provider.getTransactionReceipt(saved.hash);
      if (!receipt) {
        if (!(await provider.getTransaction(saved.hash))) await provider.broadcastTransaction(saved.raw);
        console.log(`${label}: https://basescan.org/tx/${saved.hash}`);
        receipt = await provider.waitForTransaction(saved.hash, 2, 180000);
      }
      if (!receipt) throw new SmokeError('Test transaction is pending. Resume the same script; do not delete state.');
      if (receipt.status !== 1) throw new SmokeError(`${label} reverted. Inspect its transaction before continuing; do not delete state.`);
      if (label === 'approve') {
        const approvals = receipt.logs.filter((log) => log.address.toLowerCase() === USDC.toLowerCase())
          .map((log) => token.interface.parseLog(log)).filter((event) => event?.name === 'Approval');
        if (approvals.length !== 1 || getAddress(approvals[0].args.owner) !== wallet.address ||
            getAddress(approvals[0].args.spender) !== TREASURY || approvals[0].args.value !== amount) throw new SmokeError('Exact USDC approval receipt mismatch');
      } else {
        verifyMovement(receipt, ledger.interface, label === 'deposit' ? 'FundsReceived' : 'FundsPaid', wallet.address, amount, asset, purpose, TREASURY);
        if (usdc) verifyTokenTransfer(receipt, token.interface, label === 'deposit' ? wallet.address : TREASURY,
          label === 'deposit' ? TREASURY : wallet.address, amount);
      }
      console.log(`${label} verified: https://basescan.org/tx/${saved.hash}`);
      return receipt;
    }

    if (usdc) {
      await step('approve');
      if (!state.steps.deposit && await token.allowance(wallet.address, TREASURY) !== amount) throw new SmokeError('USDC allowance is not exactly the test amount; inspect before deposit');
    }
    const deposited = await step('deposit');
    if (!state.steps.withdraw && await treasuryBalance(deposited.blockNumber) !== BigInt(state.baselineWei) + amount) {
      throw new SmokeError('Treasury balance changed unexpectedly after deposit. Inspect before recovery; do not deposit again.');
    }
    const paid = await step('withdraw');
    const after = await treasuryBalance(paid.blockNumber);
    stage = 'reconciling treasury and owner balances';
    if (after !== BigInt(state.baselineWei)) throw new SmokeError('Treasury balance did not return to its baseline; inspect concurrent activity');
    if (usdc) {
      if (await token.balanceOf(wallet.address, { blockTag: paid.blockNumber }) !== BigInt(state.ownerBaselineUnits)) throw new SmokeError('Owner USDC balance was not restored; inspect concurrent token activity');
      if (await token.allowance(wallet.address, TREASURY, { blockTag: paid.blockNumber }) !== 0n) throw new SmokeError('USDC allowance remains after deposit');
    } else {
      // Compare the owner's change against its exact total transaction fee, including Base data fees.
      const rawReceipt = await provider.send('eth_getTransactionReceipt', [paid.hash]);
      if (rawReceipt.l1Fee === undefined) throw new SmokeError('RPC omitted the Base L1 fee; recipient balance reconciliation is incomplete');
      const txFee = BigInt(rawReceipt.gasUsed) * BigInt(rawReceipt.effectiveGasPrice) + BigInt(rawReceipt.l1Fee);
      const beforeOwner = await provider.getBalance(wallet.address, paid.blockNumber - 1);
      const afterOwner = await provider.getBalance(wallet.address, paid.blockNumber);
      if (afterOwner - beforeOwner !== amount - txFee) throw new SmokeError('Owner balance delta does not reconcile with payout minus fees; inspect concurrent transactions');
    }
    state.complete = true;
    save();
    console.log(`PASS: ${usdc ? '0.01 USDC' : '0.000001 ETH'} received and returned to owner; treasury baseline restored and owner balance reconciled.${usdc ? ' USDC allowance is zero.' : ''}`);
    console.log(`This tests ${usdc ? 'native Base USDC' : 'ETH'} only. It does not verify ${usdc ? 'other tokens' : 'ERC-20s'}, BaseScan source, or activate/publish public funding.`);
  } finally {
    provider.destroy();
  }
}

if (require.main === module) main().catch((error) => {
  console.error(error instanceof SmokeError ? error.message :
    `Smoke test stopped while ${stage} (${typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'validation or RPC failure'}). Credential-bearing error payload suppressed. Inspect printed transaction hashes and resume without deleting state.`);
  process.exitCode = 1;
});

module.exports = { verifyMovement, verifyTokenTransfer, ADDRESS, AMOUNT, PURPOSE, USDC, USDC_AMOUNT, USDC_PURPOSE, TOKEN_ABI };
