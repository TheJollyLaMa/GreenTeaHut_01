'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AbiCoder, Interface, getAddress, isAddress } = require('ethers');

const root = path.resolve(__dirname, '..');
const SOURCIFY = 'https://sourcify.dev/server';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function lookup(address) {
  const response = await fetch(`${SOURCIFY}/v2/contract/8453/${address}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Sourcify lookup HTTP ${response.status}`);
  return response.json();
}

// Submits only the public standard-JSON compiler input; no environment file, key or signed state.
async function main() {
  const address = process.argv[2];
  if (!isAddress(address || '')) throw new Error('Usage: node scripts/verify-v2-source.js <V2-address>');
  const target = getAddress(address);
  const artifact = require('../artifacts/ProjectTreasuryV2.json');
  const plan = require('../artifacts/base-v2-deployment-plan.json');
  fs.writeFileSync(path.join(root, 'artifacts/base-v2-verification-input.json'), JSON.stringify(artifact.input, null, 2) + '\n');
  const constructorArgs = AbiCoder.defaultAbiCoder().encode(new Interface(artifact.abi).deploy.inputs, plan.constructorArguments);
  fs.writeFileSync(path.join(root, 'artifacts/base-v2-constructor-arguments.txt'), constructorArgs.slice(2) + '\n');
  let verified = await lookup(target);
  if (!verified?.runtimeMatch) {
    const compilerVersion = artifact.compiler.match(/^\d+\.\d+\.\d+\+commit\.[0-9a-f]+/)?.[0];
    if (!compilerVersion) throw new Error('Cannot read the compiler version from the artifact');
    const response = await fetch(`${SOURCIFY}/v2/verify/8453/${target}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stdJsonInput: artifact.input, compilerVersion,
        contractIdentifier: 'contracts/ProjectTreasuryV2.sol:ProjectTreasuryV2',
      }),
    });
    if (!response.ok) throw new Error(`Sourcify submission HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const { verificationId } = await response.json();
    for (let attempt = 0; attempt < 40; attempt++) {
      await pause(5000);
      const job = await (await fetch(`${SOURCIFY}/v2/verify/${verificationId}`)).json();
      if (job.error) throw new Error(`Sourcify verification failed: ${job.error.message || job.error.customCode}`);
      if (job.isJobCompleted) break;
    }
    verified = await lookup(target);
  }
  if (verified?.creationMatch !== 'exact_match' || verified?.runtimeMatch !== 'exact_match') throw new Error('Sourcify exact source match is not verified');
  fs.writeFileSync(path.join(root, 'artifacts/base-v2-source-verification.json'), JSON.stringify(verified, null, 2) + '\n');
  console.log(`Exact creation and runtime source match: https://repo.sourcify.dev/8453/${target}`);
  console.log('BaseScan manual verification files: artifacts/base-v2-verification-input.json and artifacts/base-v2-constructor-arguments.txt');
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
