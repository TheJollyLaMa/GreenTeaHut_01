'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AbiCoder, Interface } = require('ethers');
const root = path.resolve(__dirname, '..');
const address = '0x757B1F856f2Faea5a661820f9da56af032B1F9a1';

async function main() {
  const artifact = require('../artifacts/ProjectTreasuryLedger.json');
  const plan = require('../artifacts/base-deployment-plan.json');
  // Public compiler input only: no environment file, key, signed state or RPC credential.
  fs.writeFileSync(path.join(root, 'artifacts/base-verification-input.json'), JSON.stringify(artifact.input, null, 2) + '\n');
  const constructorArgs = AbiCoder.defaultAbiCoder().encode(new Interface(artifact.abi).deploy.inputs, plan.constructorArguments);
  fs.writeFileSync(path.join(root, 'artifacts/base-constructor-arguments.txt'), constructorArgs.slice(2) + '\n');
  const response = await fetch(`https://sourcify.dev/server/v2/contract/8453/${address}`);
  if (!response.ok) throw new Error(`Sourcify lookup HTTP ${response.status}`);
  const verified = await response.json();
  if (verified.creationMatch !== 'exact_match' || verified.runtimeMatch !== 'exact_match') throw new Error('Sourcify exact source match is not verified');
  fs.writeFileSync(path.join(root, 'artifacts/base-source-verification.json'), JSON.stringify(verified, null, 2) + '\n');
  console.log(`Exact creation and runtime source match: https://repo.sourcify.dev/8453/${address}`);
  console.log('BaseScan manual verification files: artifacts/base-verification-input.json and artifacts/base-constructor-arguments.txt');
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
