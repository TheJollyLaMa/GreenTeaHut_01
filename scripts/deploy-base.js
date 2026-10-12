'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  JsonRpcProvider, Wallet, Contract, ContractFactory, getAddress,
  getCreateAddress, keccak256, parseEther, formatEther, Transaction,
} = require('ethers');
const { validateSnapshot } = require('./ledger-snapshot');
const { verifySourceSnapshot } = require('./verify-source-snapshot');
const { normalizeRuntime } = require('./activate-base');

const root = path.resolve(__dirname, '..');
const stateFile = path.join(root, '.base-deployment-state.json');
class DeploymentError extends Error {}

function loadKey(value) {
  if (typeof value !== 'string' || !/^(?:0x)?[0-9a-fA-F]{64}$/.test(value)) {
    throw new DeploymentError('Set BASE_DEPLOYER_PRIVATE_KEY locally in .env to exactly 64 hexadecimal characters, optionally prefixed with 0x. Do not share it.');
  }
  const normalized = value.startsWith('0x') ? value : `0x${value}`;
  try {
    new Wallet(normalized);
  } catch {
    throw new DeploymentError('BASE_DEPLOYER_PRIVATE_KEY is not a valid secp256k1 private key. Check the local value; do not share it.');
  }
  return normalized;
}

async function validatePlan(artifact, plan, config, snapshot) {
  validateSnapshot(snapshot);
  if (plan.chainId !== 8453 || config.chainId !== 8453 ||
      getAddress(plan.owner) !== getAddress(config.owner)) throw new DeploymentError('Invalid Base chain or owner in deployment plan');
  const args = [getAddress(config.owner), snapshot.sourceBlock, snapshot.sourceBlockHash, snapshot.count, snapshot.historyHash];
  const factory = new ContractFactory(artifact.abi, artifact.evm.bytecode.object);
  const transaction = await factory.getDeployTransaction(...args);
  if (JSON.stringify(plan.constructorArguments) !== JSON.stringify(args) ||
      transaction.data !== plan.deployment.data || plan.deployment.value !== '0') {
    throw new DeploymentError('Deployment plan is stale or does not match compiled artifact and OP history');
  }
  const calls = [
    ...(snapshot.count ? [{ function: 'importHistory', data: factory.interface.encodeFunctionData('importHistory', [snapshot.entries]), value: '0' }] : []),
    { function: 'finalizeMigration', data: factory.interface.encodeFunctionData('finalizeMigration'), value: '0' },
  ];
  // Approve managers through the UI separately, not incidentally during deployment.
  if (JSON.stringify(plan.afterDeployment) !== JSON.stringify(calls)) {
    throw new DeploymentError('This deployment script only imports history and finalizes; regenerate the plan without manager arguments');
  }
  return transaction;
}

function checkBudget(total, amount, cap) {
  if (cap <= 0n || total + amount > cap) throw new DeploymentError('Transaction fee ceilings exceed BASE_DEPLOY_MAX_FEE_ETH; review fees and budget before signing');
  return total + amount;
}

function fundingRequirement(executionCeiling, l1Estimate) {
  if (executionCeiling < 0n || l1Estimate < 0n) throw new DeploymentError('Invalid fee estimate');
  // Reserve twice the quote for fee changes and data-fee estimation uncertainty.
  return (executionCeiling + l1Estimate) * 2n;
}

function saveState(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}

async function main() {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== '--broadcast') || flags.length > 1) throw new DeploymentError('Usage: node scripts/deploy-base.js [--broadcast]');
  const broadcast = flags.includes('--broadcast');
  const envPath = path.join(root, '.env');
  if (fs.existsSync(envPath)) {
    if ((fs.statSync(envPath).mode & 0o077) !== 0) throw new DeploymentError('Protect your local key file first: chmod 600 .env');
    process.loadEnvFile(envPath);
  }
  const key = loadKey(process.env.BASE_DEPLOYER_PRIVATE_KEY);
  const cap = parseEther(process.env.BASE_DEPLOY_MAX_FEE_ETH || '0');
  if (cap <= 0n) throw new DeploymentError('Set a positive BASE_DEPLOY_MAX_FEE_ETH fee budget');
  const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const artifact = read('artifacts/ProjectTreasuryLedger.json');
  const plan = read('artifacts/base-deployment-plan.json');
  const config = read('web/base-deployment.json');
  const snapshot = read('web/optimism-history.json');
  const deployment = await validatePlan(artifact, plan, config, snapshot);
  await verifySourceSnapshot(snapshot);
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL || config.rpcUrl);
  try {
    if (Number((await provider.getNetwork()).chainId) !== 8453) throw new DeploymentError('RPC must be Base mainnet (8453)');
    const wallet = new Wallet(key, provider);
    if (getAddress(wallet.address) !== getAddress(config.owner)) {
      throw new DeploymentError('The local key does not control the planned owner. No transaction sent. Use the owner key or the documented wallet/Safe process.');
    }
    console.log(`Chain: Base mainnet (8453). Owner/signer: ${wallet.address}`);
    const fees = await provider.getFeeData();
    if (fees.maxFeePerGas === null || fees.maxPriorityFeePerGas === null) throw new DeploymentError('RPC did not provide EIP-1559 fee estimates');
    const gas = await provider.estimateGas({ ...deployment, from: wallet.address });
    const deploymentLimit = gas * 120n / 100n;
    // Conservative local-tested import allowance, plus finalization gas.
    const callLimits = plan.afterDeployment.map((call) => call.function === 'importHistory' ? 3000000n : 200000n);
    const estimatedCeiling = (deploymentLimit + callLimits.reduce((sum, limit) => sum + limit, 0n)) * fees.maxFeePerGas;
    checkBudget(0n, estimatedCeiling, cap);
    const nonce = await provider.getTransactionCount(wallet.address, 'pending');
    const predictedAddress = getCreateAddress({ from: wallet.address, nonce });
    const oracle = new Contract('0x420000000000000000000000000000000000000F',
      ['function getL1Fee(bytes) view returns (uint256)'], provider);
    const requests = [
      { ...deployment, gasLimit: deploymentLimit },
      ...plan.afterDeployment.map((call, index) => ({ to: predictedAddress, data: call.data, gasLimit: callLimits[index] })),
    ];
    let l1Estimate = 0n;
    for (let index = 0; index < requests.length; index++) {
      const unsigned = Transaction.from({
        ...requests[index], value: 0n, chainId: 8453, nonce: nonce + index, type: 2,
        maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      }).unsignedSerialized;
      l1Estimate += await oracle.getL1Fee(unsigned);
    }
    const required = fundingRequirement(estimatedCeiling, l1Estimate);
    const balance = await provider.getBalance(wallet.address);
    console.log(`Signer balance: ${formatEther(balance)} ETH. Maximum execution-fee budget: ${formatEther(cap)} ETH (not a funding requirement).`);
    console.log(`Deployment gas estimate: ${gas}; conservative execution fee ceiling for all steps: ${formatEther(estimatedCeiling)} ETH.`);
    console.log(`Current L1 data fee estimate for all steps: ${formatEther(l1Estimate)} ETH.`);
    console.log(`Suggested minimum balance, including 2x quote buffer: ${formatEther(required)} ETH.`);
    console.log('Fee quotes can change. The budget guard covers execution fees, not a guaranteed all-in network fee cap.');
    if (balance < required) throw new DeploymentError(`Insufficient Base gas balance for the buffered current quote. Add at least ${formatEther(required - balance)} ETH on Base, then rerun the check. No transaction sent.`);
    if (!broadcast) {
      console.log('Dry run passed. Nothing signed or broadcast. Run npm run deploy:base to send deployment, import, and finalization.');
      return;
    }
    const fingerprint = keccak256(plan.deployment.data);
    const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {
      chainId: 8453, signer: wallet.address, fingerprint, steps: {}, feeCeilingWei: '0',
    };
    if (state.chainId !== 8453 || state.signer !== wallet.address || state.fingerprint !== fingerprint) {
      throw new DeploymentError('Existing deployment state belongs to a different signer or plan. Do not delete it to retry; review its transactions first.');
    }
    if (config.ready && config.address?.toLowerCase() !== state.address?.toLowerCase()) throw new DeploymentError('A different Base treasury is already activated');

    async function sendStep(label, request, gasLimit) {
      let step = state.steps[label];
      if (!step) {
        const feeCeiling = gasLimit * fees.maxFeePerGas;
        const total = checkBudget(BigInt(state.feeCeilingWei), feeCeiling, cap);
        const nonce = await provider.getTransactionCount(wallet.address, 'pending');
        const signed = await wallet.signTransaction({
          ...request, value: 0n, chainId: 8453, nonce, type: 2, gasLimit,
          maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        });
        step = { hash: keccak256(signed), raw: signed };
        if (label === 'deploy') state.address = getCreateAddress({ from: wallet.address, nonce });
        state.steps[label] = step;
        state.feeCeilingWei = total.toString();
        // Persist before broadcast so interruption never causes an accidental second deployment.
        saveState(state);
      }
      const parsed = Transaction.from(step.raw);
      if (parsed.hash !== step.hash || parsed.from !== wallet.address || parsed.chainId !== 8453n ||
          parsed.data !== request.data || parsed.value !== 0n ||
          (parsed.to || '').toLowerCase() !== (request.to || '').toLowerCase()) {
        throw new DeploymentError('Persisted transaction does not match this deployment step');
      }
      let receipt = await provider.getTransactionReceipt(step.hash);
      if (!receipt) {
        if (!(await provider.getTransaction(step.hash))) await provider.broadcastTransaction(step.raw);
        console.log(`${label}: ${step.hash}`);
        receipt = await provider.waitForTransaction(step.hash, 2, 180000);
      }
      if (!receipt) throw new DeploymentError(`${label} is still pending. Re-run the same command to resume; do not delete deployment state.`);
      if (receipt.status !== 1) throw new DeploymentError(`${label} reverted: ${step.hash}. Stop and inspect it; do not blindly redeploy.`);
      console.log(`${label} confirmed: https://basescan.org/tx/${step.hash}`);
      return receipt;
    }

    const receipt = await sendStep('deploy', deployment, deploymentLimit);
    if (receipt.contractAddress?.toLowerCase() !== state.address.toLowerCase()) throw new DeploymentError('Deployment address mismatch');
    const code = await provider.getCode(state.address);
    const runtime = artifact.evm.deployedBytecode;
    if (normalizeRuntime(code, runtime.immutableReferences) !== normalizeRuntime(runtime.object, runtime.immutableReferences)) throw new DeploymentError('Deployed runtime mismatch; do not import or fund');
    const ledger = new Contract(state.address, artifact.abi, provider);
    if (getAddress(await ledger.owner()) !== getAddress(config.owner) || await ledger.historyHash() !== snapshot.historyHash) {
      throw new DeploymentError('Deployed owner or snapshot mismatch');
    }
    for (const call of plan.afterDeployment) {
      await sendStep(call.function, { to: state.address, data: call.data },
        call.function === 'importHistory' ? 3000000n : 200000n);
    }
    if (!(await ledger.migrationFinalized()) || await ledger.importedHash() !== snapshot.historyHash) throw new DeploymentError('Migration verification failed');
    console.log(`Deployed and history imported: ${state.address}`);
    console.log('Funding UI remains disabled. Verify source on BaseScan and run controlled deposit/payout tests first.');
    console.log(`After finalization, activate with: node scripts/activate-base.js ${state.address}`);
  } finally {
    provider.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    // RPC errors can embed request data or credential-bearing URLs. Never dump them with a key loaded.
    console.error(error instanceof DeploymentError ? error.message :
      `Deployment stopped (${typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'validation or RPC failure'}). Check Base RPC, source snapshot and pending transaction hashes. Error payload suppressed to protect local credentials.`);
    process.exitCode = 1;
  });
}
module.exports = { loadKey, validatePlan, checkBudget, fundingRequirement };
