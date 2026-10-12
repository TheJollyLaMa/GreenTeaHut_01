'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  JsonRpcProvider, Wallet, Contract, getAddress, getCreateAddress, keccak256,
  parseEther, formatEther, Transaction,
} = require('ethers');
const { loadKey, checkBudget, fundingRequirement } = require('./deploy-base');
const { normalizeRuntime } = require('./activate-base');
const { V1_ADDRESS } = require('./base-snapshot');
const { buildV2Plan } = require('./prepare-v2');
const { verifyBaseSnapshot } = require('./verify-base-snapshot');

const root = path.resolve(__dirname, '..');
const stateFile = path.join(root, '.base-v2-deployment-state.json');
const CALL_GAS = { importHistory: 3000000n, finalizeMigration: 200000n };
class DeploymentError extends Error {}
let stage = 'loading local configuration';

async function validateV2Plan(artifact, plan, config, snapshot, opSnapshot) {
  if (plan.chainId !== 8453 || config.chainId !== 8453 || plan.contract !== 'ProjectTreasuryV2' ||
      getAddress(plan.owner) !== getAddress(config.owner)) throw new DeploymentError('Invalid Base chain, contract or owner in V2 plan');
  const expected = await buildV2Plan(artifact, snapshot, opSnapshot, config.owner);
  if (JSON.stringify(plan.constructorArguments) !== JSON.stringify(expected.constructorArguments) ||
      plan.deployment.data !== expected.deployment.data || plan.deployment.value !== '0') {
    throw new DeploymentError('V2 plan is stale or does not match the compiled artifact and V1 snapshot');
  }
  if (JSON.stringify(plan.afterDeployment) !== JSON.stringify(expected.afterDeployment)) {
    throw new DeploymentError('V2 deployment only imports history and finalizes; regenerate the plan with npm run prepare:v2');
  }
  return { data: plan.deployment.data };
}

function saveState(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}

async function main() {
  const flags = process.argv.slice(2);
  if (flags.length > 1 || flags.some((flag) => flag !== '--broadcast')) throw new DeploymentError('Usage: node scripts/deploy-v2.js [--broadcast]');
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
  const artifact = read('artifacts/ProjectTreasuryV2.json');
  const plan = read('artifacts/base-v2-deployment-plan.json');
  const config = read('web/base-deployment.json');
  const storefront = read('web/storefront-deployment.json');
  const snapshot = read('web/base-history.json');
  const opSnapshot = read('web/optimism-history.json');
  const deployment = await validateV2Plan(artifact, plan, config, snapshot, opSnapshot);
  stage = 'verifying the V1 snapshot is still current';
  await verifyBaseSnapshot(snapshot, opSnapshot);
  stage = 'connecting to Base';
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL || 'https://mainnet.base.org', 8453, { staticNetwork: true });
  try {
    if (Number(BigInt(await provider.send('eth_chainId', []))) !== 8453) throw new DeploymentError('RPC must be Base mainnet (8453)');
    const wallet = new Wallet(key, provider);
    if (getAddress(wallet.address) !== getAddress(config.owner)) {
      throw new DeploymentError('The local key does not control the planned owner. No transaction sent.');
    }
    console.log(`Chain: Base mainnet (8453). Owner/signer: ${wallet.address}. Predecessor: ${V1_ADDRESS}`);
    stage = 'estimating fees and deployment gas';
    const fees = await provider.getFeeData();
    if (fees.maxFeePerGas === null || fees.maxPriorityFeePerGas === null) throw new DeploymentError('RPC did not provide EIP-1559 fee estimates');
    const gas = await provider.estimateGas({ ...deployment, from: wallet.address });
    const deploymentLimit = gas * 120n / 100n;
    const callLimits = plan.afterDeployment.map((call) => CALL_GAS[call.function]);
    const estimatedCeiling = (deploymentLimit + callLimits.reduce((sum, limit) => sum + limit, 0n)) * fees.maxFeePerGas;
    checkBudget(0n, estimatedCeiling, cap);
    const nonce = await provider.getTransactionCount(wallet.address, 'pending');
    const predictedAddress = getCreateAddress({ from: wallet.address, nonce });
    const oracle = new Contract('0x420000000000000000000000000000000000000F', ['function getL1Fee(bytes) view returns (uint256)'], provider);
    const requests = [
      { ...deployment, gasLimit: deploymentLimit },
      ...plan.afterDeployment.map((call, index) => ({ to: predictedAddress, data: call.data, gasLimit: callLimits[index] })),
    ];
    stage = 'estimating Base L1 data fees';
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
    console.log(`V2 deployment gas estimate: ${gas}; conservative execution fee ceiling for all steps: ${formatEther(estimatedCeiling)} ETH.`);
    console.log(`Current L1 data fee estimate for all steps: ${formatEther(l1Estimate)} ETH.`);
    console.log(`Suggested minimum balance, including 2x quote buffer: ${formatEther(required)} ETH.`);
    if (balance < required) throw new DeploymentError(`Insufficient Base gas balance. Add at least ${formatEther(required - balance)} ETH on Base, then rerun the check. No transaction sent.`);
    if (!broadcast) {
      console.log('Dry run passed. Nothing signed or broadcast. Run npm run deploy:v2 to send deployment, import, and finalization.');
      return;
    }
    stage = 'sending deployment steps';
    const fingerprint = keccak256(plan.deployment.data);
    const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {
      chainId: 8453, signer: wallet.address, fingerprint, steps: {}, feeCeilingWei: '0',
    };
    if (state.chainId !== 8453 || state.signer !== wallet.address || state.fingerprint !== fingerprint) {
      throw new DeploymentError('Existing V2 deployment state belongs to a different signer or plan. Do not delete it to retry; review its transactions first.');
    }
    if (storefront.ready && storefront.address?.toLowerCase() !== state.address?.toLowerCase()) throw new DeploymentError('A different V2 treasury is already activated');

    async function sendStep(label, request, gasLimit) {
      let step = state.steps[label];
      if (!step) {
        const total = checkBudget(BigInt(state.feeCeilingWei), gasLimit * fees.maxFeePerGas, cap);
        const stepNonce = await provider.getTransactionCount(wallet.address, 'pending');
        const signed = await wallet.signTransaction({
          ...request, value: 0n, chainId: 8453, nonce: stepNonce, type: 2, gasLimit,
          maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        });
        step = { hash: keccak256(signed), raw: signed };
        if (label === 'deploy') state.address = getCreateAddress({ from: wallet.address, nonce: stepNonce });
        state.steps[label] = step;
        state.feeCeilingWei = total.toString();
        // Persist before broadcast so interruption never causes an accidental second deployment.
        saveState(state);
      }
      const parsed = Transaction.from(step.raw);
      if (parsed.hash !== step.hash || parsed.from !== wallet.address || parsed.chainId !== 8453n ||
          parsed.data !== request.data || parsed.value !== 0n ||
          (parsed.to || '').toLowerCase() !== (request.to || '').toLowerCase()) {
        throw new DeploymentError('Persisted transaction does not match this V2 deployment step');
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
    if (receipt.contractAddress?.toLowerCase() !== state.address.toLowerCase()) throw new DeploymentError('V2 deployment address mismatch');
    const runtime = artifact.evm.deployedBytecode;
    if (normalizeRuntime(await provider.getCode(state.address), runtime.immutableReferences) !==
        normalizeRuntime(runtime.object, runtime.immutableReferences)) throw new DeploymentError('Deployed V2 runtime mismatch; do not import or fund');
    const treasury = new Contract(state.address, artifact.abi, provider);
    if (getAddress(await treasury.owner()) !== getAddress(config.owner) || getAddress(await treasury.sourceLedger()) !== V1_ADDRESS ||
        await treasury.historyHash() !== snapshot.historyHash) throw new DeploymentError('Deployed V2 owner or snapshot mismatch');
    for (const call of plan.afterDeployment) {
      await sendStep(call.function, { to: state.address, data: call.data }, CALL_GAS[call.function]);
    }
    if (!(await treasury.migrationFinalized()) || await treasury.importedHash() !== snapshot.historyHash) throw new DeploymentError('V2 migration verification failed');
    console.log(`V2 deployed and V1 history imported: ${state.address}`);
    console.log('The store stays closed and the site still uses V1. Verify source, then smoke-test with:');
    console.log(`  node scripts/smoke-base.js --v2 ${state.address} --broadcast`);
    console.log(`  node scripts/smoke-base.js --v2 ${state.address} --usdc --broadcast`);
    console.log('Activation switches ledger, payroll and storefront together in a reviewed site update.');
  } finally {
    provider.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    // RPC errors can embed request data or credential-bearing URLs. Never dump them with a key loaded.
    // Shared helpers throw their own DeploymentError class with reviewed, credential-free messages.
    console.error(error?.constructor?.name === 'DeploymentError' ? error.message :
      `V2 deployment stopped while ${stage} (${typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'validation or RPC failure'}). Error payload suppressed to protect local credentials.`);
    process.exitCode = 1;
  });
}
module.exports = { validateV2Plan };
