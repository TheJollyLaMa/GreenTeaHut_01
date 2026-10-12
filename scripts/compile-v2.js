'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compile } = require('./compile-treasury');

function compileV2(extraSources = {}) {
  const name = 'contracts/ProjectTreasuryV2.sol';
  const source = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  return compile({ [name]: { content: source }, ...extraSources });
}
if (require.main === module) {
  const { input, output } = compileV2();
  const contract = output.contracts['contracts/ProjectTreasuryV2.sol'].ProjectTreasuryV2;
  const bytes = contract.evm.deployedBytecode.object.length / 2;
  if (bytes > 24576) throw new Error(`V2 exceeds EIP-170 runtime limit: ${bytes}`);
  fs.writeFileSync(path.join(__dirname, '../artifacts/ProjectTreasuryV2.json'),
    JSON.stringify({ compiler: require('solc').version(), input, ...contract }, null, 2) + '\n');
  fs.writeFileSync(path.join(__dirname, '../web/treasury-v2-abi.json'), JSON.stringify(contract.abi, null, 2) + '\n');
  console.log(`Compiled ProjectTreasuryV2: ${bytes}/24576 runtime bytes. Not deployed.`);
}
module.exports = { compileV2 };
