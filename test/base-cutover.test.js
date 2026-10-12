'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Interface } = require('ethers');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'web/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
const metadata = require('../web/deployment-metadata.json');
const config = require('../web/base-deployment.json');
const abi = require('../web/treasury-abi.json');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const brace = source.indexOf('{', start);
  let depth = 1;
  let end = brace + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}') depth--;
    end++;
  }
  return source.slice(start, end);
}

test('main project page uses only the activated Base contract; metadata has separate legacy and active entries', () => {
  assert.equal(config.ready, true);
  assert.equal(config.chainId, 8453);
  assert.equal(config.address, '0x757B1F856f2Faea5a661820f9da56af032B1F9a1');
  const parsed = vm.runInNewContext(`(${source.match(/const LEDGER_CONFIG = (\{[\s\S]*?\});/)[1]})`);
  assert.equal(parsed.contractAddress, config.address);
  assert.equal(parsed.targetChainId, config.chainId);
  assert.equal(parsed.deploymentBlock, config.deploymentBlock);
  assert.equal(metadata.contracts.ProjectTreasuryLedger.networks['8453'].address, config.address);
  assert.equal(metadata.contracts.ProjectLedger.networks['10'].status, 'legacy-accounting-only');
  assert.ok(!source.includes('legacyArchived'));
  assert.match(html, /Live on Base/);
  assert.match(html, /actual asset balances are shown in the treasury/);
});

test('all main page functions and events are compatible with the treasury artifact', () => {
  const literals = [...source.match(/const PROJECT_LEDGER_ABI = \[([\s\S]*?)\];/)[1].matchAll(/'((?:function|event) [^']+)'/g)].map((match) => match[1]);
  const frontend = new Interface(literals);
  const deployed = new Interface(abi);
  frontend.forEachFunction((fn) => assert.equal(deployed.getFunction(fn.format('sighash')).selector, fn.selector));
  frontend.forEachEvent((event) => assert.equal(deployed.getEvent(event.format('sighash')).topicHash, event.topicHash));
});

test('imported pending/requested entries render no mutable or payout actions', () => {
  const context = {
    document: { createElement: () => ({ appendChild() {}, className: '', textContent: '' }) },
  };
  vm.createContext(context);
  vm.runInContext(`${extractFunction('createActionsCell')}; result = createActionsCell({historical:true,status:'REQUESTED'});`, context);
  assert.equal(context.result.textContent, 'Imported history (read-only)');
});

test('Base labor IDs are parsed from receipts and legacy shifts stay in their old namespace', () => {
  assert.match(source, /PAYOUT_STORAGE_KEY = 'gth-payout-base-v1'/);
  assert.ok(!source.includes('previousTotal + 1'));
  assert.match(source, /shift\.ledgerEntryId = toNumeric\(event\.args\.id\)/);
  assert.match(source, /explorerBaseUrl: 'https:\/\/optimistic\.etherscan\.io\/tx\/'/);
  assert.match(source, /contract\.queryFilter\(filter, LEDGER_CONFIG\.deploymentBlock\)/);
});
