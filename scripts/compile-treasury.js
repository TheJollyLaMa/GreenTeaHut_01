'use strict';

const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');

const root = path.resolve(__dirname, '..');

function compile(extraSources = {}) {
  const source = 'contracts/ProjectTreasuryLedger.sol';
  const input = {
    language: 'Solidity',
    sources: { [source]: { content: fs.readFileSync(path.join(root, source), 'utf8') }, ...extraSources },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'paris',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), {
    import: (name) => {
      const file = path.join(root, 'node_modules', name);
      if (!fs.existsSync(file)) return { error: `Missing import: ${name}` };
      const content = fs.readFileSync(file, 'utf8');
      input.sources[name] = { content };
      return { contents: content };
    },
  }));
  for (const error of output.errors || []) {
    if (error.severity === 'error') throw new Error(error.formattedMessage);
    console.warn(error.formattedMessage);
  }
  return { input, output };
}

if (require.main === module) {
  const { input, output } = compile();
  const contract = output.contracts['contracts/ProjectTreasuryLedger.sol'].ProjectTreasuryLedger;
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts/ProjectTreasuryLedger.json'), JSON.stringify({
    compiler: solc.version(), input, ...contract,
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'web/treasury-abi.json'), JSON.stringify(contract.abi, null, 2) + '\n');
  console.log(`Compiled ProjectTreasuryLedger: ${contract.evm.deployedBytecode.object.length / 2} runtime bytes`);
}

module.exports = { compile };
