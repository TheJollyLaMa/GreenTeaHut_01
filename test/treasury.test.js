'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ganache = require('ganache');
const { BrowserProvider, ContractFactory, ZeroAddress, parseEther } = require('ethers');
const { compile } = require('../scripts/compile-treasury');
const { hashEntries } = require('../scripts/ledger-snapshot');

const fixtures = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract TestToken is ERC20 {
    constructor() ERC20("Test","TST") { _mint(msg.sender, 1000000); }
}
contract FalseToken {
    function transfer(address,uint256) external pure returns(bool) { return false; }
}
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;
    constructor() { balanceOf[msg.sender] = 10000; }
    function transfer(address to,uint256 amount) external { balanceOf[msg.sender] -= amount; balanceOf[to] += amount; }
    function approve(address,uint256) external pure {}
    function transferFrom(address from,address to,uint256 amount) external { balanceOf[from] -= amount; balanceOf[to] += amount; }
}
contract RejectETH { receive() external payable { revert(); } }
interface ITreasury { function payETH(address payable,uint256,string calldata) external; }
contract Reenter {
    ITreasury public ledger;
    bool public blocked;
    constructor(address target) { ledger = ITreasury(target); }
    function attack() external { ledger.payETH(payable(address(this)), 1, "test"); }
    receive() external payable {
        try ledger.payETH(payable(address(this)), 1, "reentry") { blocked = false; }
        catch { blocked = true; }
    }
}`;

const history = [
  { id: '1', amount: '1500', entryType: 0, status: 1, category: 'Funding', description: 'Legacy income', referenceURI: 'https://example.org/receipt', createdAt: '123', settledAt: '124' },
  { id: '2', amount: '60', entryType: 1, status: 2, category: 'Labor', description: 'Legacy request', referenceURI: '', createdAt: '125', settledAt: '0' },
];
const { output } = compile({ 'fixtures.sol': { content: fixtures } });
const artifact = output.contracts['contracts/ProjectTreasuryLedger.sol'].ProjectTreasuryLedger;

test('treasury receipts, authorized payouts, recovery, migration and ownership on a local Base chain', async (t) => {
  const rpc = ganache.provider({ chain: { chainId: 8453 }, logging: { quiet: true }, wallet: { totalAccounts: 5 } });
  const provider = new BrowserProvider(rpc);
  provider.pollingInterval = 10;
  const [owner, manager, stranger, recipient, successor] = await Promise.all([0, 1, 2, 3, 4].map((id) => provider.getSigner(id)));
  const addresses = await Promise.all([owner, manager, stranger, recipient, successor].map((signer) => signer.getAddress()));
  const [ownerAddress, managerAddress, strangerAddress, recipientAddress, successorAddress] = addresses;
  const factory = new ContractFactory(artifact.abi, artifact.evm.bytecode.object, owner);
  const ledger = await factory.deploy(ownerAddress, 100, '0x' + 'ab'.repeat(32), history.length, hashEntries(history));
  await ledger.waitForDeployment();
  const address = await ledger.getAddress();
  const balance = async (who) => BigInt(await rpc.request({ method: 'eth_getBalance', params: [who, 'latest'] }));
  const sent = async (promise) => (await promise).wait();
  const deployFixture = async (name, args = []) => {
    const fixture = output.contracts['fixtures.sol'][name];
    const result = await new ContractFactory(fixture.abi, fixture.evm.bytecode.object, owner).deploy(...args);
    return result.waitForDeployment();
  };
  try {
    await t.test('ETH is receivable and recoverable even before import; invalid and unauthorized sends fail', async () => {
      await sent(stranger.sendTransaction({ to: address, value: parseEther('1') }));
      assert.equal(await balance(address), parseEther('1'));
      await assert.rejects(ledger.connect(stranger).payETH(recipientAddress, 1, 'receipt'));
      await assert.rejects(ledger.payETH(ZeroAddress, 1, 'receipt'));
      await assert.rejects(ledger.payETH(address, 1, 'receipt'));
      await assert.rejects(ledger.payETH(recipientAddress, 0, 'receipt'));
      await assert.rejects(ledger.payETH(recipientAddress, 1, ''));
      const previous = await balance(recipientAddress);
      await sent(ledger.payETH(recipientAddress, 100, 'recovery'));
      assert.equal(await balance(recipientAddress), previous + 100n);
    });
    await t.test('import preserves all fields; wrong commitment reverts atomically; imported requests cannot pay or mutate', async () => {
      await assert.rejects(ledger.createEntry(0, 0, 1, 'test', 'test', ''));
      await assert.rejects(ledger.connect(stranger).importHistory(history));
      await assert.rejects(ledger.importHistory([{ ...history[0], amount: '999' }, history[1]]));
      assert.equal(await ledger.importedEntries(), 0n);
      await sent(ledger.importHistory(history));
      await sent(ledger.finalizeMigration());
      assert.equal(await ledger.importedHash(), hashEntries(history));
      for (const original of history) {
        const imported = await ledger.getEntry(original.id);
        for (const [key, value] of Object.entries(original)) assert.equal(String(imported[key]), String(value));
      }
      await assert.rejects(ledger.importHistory(history));
      await assert.rejects(ledger.finalizeMigration());
      await assert.rejects(ledger.confirmEntry(2, 'proof'));
      await assert.rejects(ledger.updateStatus(2, 3));
      await assert.rejects(ledger.updatePendingAmount(2, 5, 'reason', ''));
      await assert.rejects(ledger.updateReferenceURI(1, 'proof'));
    });
    await t.test('approved managers can deposit/pay; revocation stops spending and role escalation', async () => {
      await assert.rejects(ledger.connect(stranger).setManager(strangerAddress, true));
      await sent(ledger.setManager(managerAddress, true));
      await sent(ledger.connect(stranger).depositETH('donation', { value: 50 }));
      const previous = await balance(recipientAddress);
      await sent(ledger.connect(manager).payETH(recipientAddress, 50, 'materials'));
      assert.equal(await balance(recipientAddress), previous + 50n);
      await assert.rejects(ledger.connect(manager).setManager(strangerAddress, true));
      await sent(ledger.setManager(managerAddress, false));
      await assert.rejects(ledger.connect(manager).payETH(recipientAddress, 1, 'revoked'));
    });
    await t.test('ERC20 approval/deposit/payout and directly transferred token recovery work', async () => {
      const token = await deployFixture('TestToken');
      const asset = await token.getAddress();
      await sent(token.approve(address, 1234));
      await sent(ledger.depositToken(asset, 1234, 'donation'));
      assert.equal(await token.balanceOf(address), 1234n);
      await sent(token.transfer(address, 200));
      await sent(ledger.payToken(asset, recipientAddress, 1434, 'including direct-transfer recovery'));
      assert.equal(await token.balanceOf(address), 0n);
      assert.equal(await token.balanceOf(recipientAddress), 1434n);
      await assert.rejects(ledger.payToken(asset, recipientAddress, 1, 'insufficient'));
      await assert.rejects(ledger.depositToken(strangerAddress, 10, 'EOA'));
      await assert.rejects(ledger.payToken(strangerAddress, recipientAddress, 10, 'EOA'));
      await assert.rejects(ledger.connect(stranger).payToken(asset, recipientAddress, 1, 'unauthorized'));
      const noReturn = await deployFixture('NoReturnToken');
      await sent(ledger.depositToken(await noReturn.getAddress(), 123, 'no return'));
      await sent(ledger.payToken(await noReturn.getAddress(), recipientAddress, 123, 'recovery'));
      assert.equal(await noReturn.balanceOf(recipientAddress), 123n);
      const falseToken = await deployFixture('FalseToken');
      const count = await ledger.transferCount();
      await assert.rejects(ledger.payToken(await falseToken.getAddress(), recipientAddress, 1, 'must fail'));
      assert.equal(await ledger.transferCount(), count);
    });
    await t.test('failed ETH and reentrant payouts do not lose funds or produce success events', async () => {
      const reject = await deployFixture('RejectETH');
      const before = await balance(address);
      const count = await ledger.transferCount();
      await assert.rejects(ledger.payETH(await reject.getAddress(), 10, 'reject'));
      await assert.rejects(ledger.payETH(recipientAddress, before + 1n, 'insufficient'));
      assert.equal(await balance(address), before);
      assert.equal(await ledger.transferCount(), count);
      const reenter = await deployFixture('Reenter', [address]);
      await sent(ledger.setManager(await reenter.getAddress(), true));
      await sent(reenter.attack());
      assert.equal(await reenter.blocked(), true);
      assert.equal(await balance(address), before - 1n);
    });
    await t.test('new accounting lifecycle does not move assets; finalized amounts cannot change', async () => {
      const before = await balance(address);
      await sent(ledger.createEntry(1, 2, 75, 'Labor', 'New shift', ''));
      assert.equal(await ledger.totalEntries(), 3n);
      await sent(ledger.updatePendingAmount(3, 80, 'adjustment', ''));
      await sent(ledger.updateStatus(3, 3));
      await sent(ledger.confirmEntry(3, 'https://example.org/proof'));
      assert.equal(await balance(address), before);
      await assert.rejects(ledger.confirmEntry(3, 'duplicate'));
      await assert.rejects(ledger.updatePendingAmount(3, 90, 'too late', ''));
      await assert.rejects(ledger.createEntry(0, 2, 1, 'bad', 'bad', ''));
    });
    await t.test('two-step ownership rotation cannot renounce or remove recovery access', async () => {
      await assert.rejects(ledger.renounceOwnership());
      await assert.rejects(ledger.transferOwnership(address));
      await sent(ledger.transferOwnership(successorAddress));
      assert.equal(await ledger.owner(), ownerAddress);
      await assert.rejects(ledger.connect(stranger).acceptOwnership());
      await sent(ledger.connect(successor).acceptOwnership());
      assert.equal(await ledger.owner(), successorAddress);
      await assert.rejects(ledger.payETH(recipientAddress, 1, 'former owner'));
      await sent(ledger.connect(successor).payETH(recipientAddress, 1, 'new owner'));
    });
    await t.test('all seven real OP entries import byte-for-byte and the compiled runtime matches', async () => {
      const snapshot = require('../web/optimism-history.json');
      const { normalizeRuntime } = require('../scripts/activate-base');
      const importedLedger = await factory.deploy(ownerAddress, snapshot.sourceBlock, snapshot.sourceBlockHash, snapshot.count, snapshot.historyHash);
      await importedLedger.waitForDeployment();
      const receipt = await sent(importedLedger.importHistory(snapshot.entries));
      assert.ok(receipt.gasUsed < 5000000n, `History import gas: ${receipt.gasUsed}`);
      await sent(importedLedger.finalizeMigration());
      assert.equal(await importedLedger.totalEntries(), 7n);
      assert.equal(await importedLedger.migrationFinalized(), true);
      for (const entry of snapshot.entries) {
        const actual = await importedLedger.getEntry(entry.id);
        for (const [key, value] of Object.entries(entry)) assert.equal(String(actual[key]), String(value));
      }
      const code = await provider.getCode(await importedLedger.getAddress());
      const deployed = artifact.evm.deployedBytecode;
      assert.equal(normalizeRuntime(code, deployed.immutableReferences), normalizeRuntime(deployed.object, deployed.immutableReferences));
      console.log(`Real 7-entry migration uses ${receipt.gasUsed} gas`);
    });
  } finally {
    provider.destroy();
    await rpc.disconnect();
  }
});
