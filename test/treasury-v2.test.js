const test = require('node:test');
const assert = require('node:assert/strict');
const ganache = require('ganache');
const ethers = require('ethers');
const { compileV2 } = require('../scripts/compile-v2');
const { hashEntries } = require('../scripts/ledger-snapshot');
const core = require('../web/payroll-core');

const fixtureSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract StoreUSDC is ERC20 {
    bool public rejectTransfers;
    constructor() ERC20("Local USDC", "USDC") {}
    function decimals() public pure override returns(uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setReject(bool value) external { rejectTransfers = value; }
    function _update(address from, address to, uint256 value) internal override {
        require(!rejectTransfers || from == address(0), "Transfer frozen");
        super._update(from, to, value);
    }
}
contract RejectV2ETH { receive() external payable { revert(); } }`;
const { output } = compileV2({ 'V2Fixtures.sol': { content: fixtureSource } });
const artifact = output.contracts['contracts/ProjectTreasuryV2.sol'].ProjectTreasuryV2;
const history = require('../web/optimism-history.json').entries;

test('replacement treasury preserves history, enforces payroll uniqueness, and protects pickup escrow', async t => {
  assert.ok(artifact.evm.deployedBytecode.object.length / 2 <= 24576);
  const rpc = ganache.provider({ chain: { chainId: 8453 }, logging: { quiet: true }, wallet: { totalAccounts: 5 } });
  const provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  const signers = await Promise.all([0, 1, 2, 3, 4].map(i => provider.getSigner(i)));
  const [owner, manager, buyer, otherBuyer, recipient] = signers;
  const addresses = await Promise.all(signers.map(s => s.getAddress()));
  const [ownerAddress, managerAddress, buyerAddress, otherBuyerAddress, recipientAddress] = addresses;
  const send = async tx => (await tx).wait();
  const deploy = async (a, args = []) => {
    const contract = await new ethers.ContractFactory(a.abi, a.evm.bytecode.object, owner).deploy(...args);
    return contract.waitForDeployment();
  };
  try {
    const treasury = await deploy(artifact, [ownerAddress, core.PREVIOUS_TREASURY, 100, '0x' + 'ab'.repeat(32), history.length, hashEntries(history)]);
    const address = await treasury.getAddress();
    const localToken = await deploy(output.contracts['V2Fixtures.sol'].StoreUSDC);
    await provider.send('evm_setAccountCode', [core.USDC, await provider.getCode(await localToken.getAddress())]);
    const token = new ethers.Contract(core.USDC, localToken.interface, owner);
    await send(token.mint(buyerAddress, 100000000));
    await send(token.mint(otherBuyerAddress, 100000000));
    await send(token.connect(buyer).approve(address, 100000000));
    await send(token.connect(otherBuyer).approve(address, 100000000));
    await send(treasury.setManager(managerAddress, true));

    await t.test('history import is exact and atomic; imported entries stay read-only', async () => {
      await assert.rejects(treasury.setStoreOpen(true));
      await assert.rejects(treasury.payPayroll(1, 'builder', 0, recipientAddress, 1));
      const wrong = structuredClone(history);
      wrong[0].amount = '1';
      await assert.rejects(treasury.importHistory(wrong));
      assert.equal(await treasury.importedEntries(), 0n);
      await send(treasury.importHistory(history));
      await send(treasury.finalizeMigration());
      assert.equal(await treasury.totalEntries(), BigInt(history.length));
      for (const entry of history) {
        const loaded = await treasury.getEntry(entry.id);
        for (const [key, value] of Object.entries(entry)) assert.equal(String(loaded[key]), String(value));
      }
      await assert.rejects(treasury.updatePendingAmount(1, 2, 'test', ''));
      await assert.rejects(treasury.confirmEntry(1, 'test'));
      await assert.rejects(treasury.importHistory(history));
      await send(treasury.createEntry(1, 2, 20, 'Labor', 'New accounting', ''));
      await send(treasury.updatePendingAmount(8, 19, 'Updated quote', ''));
      await send(treasury.updateStatus(8, 3));
      await send(treasury.confirmEntry(8, 'proof'));
      assert.equal((await treasury.getEntry(8)).status, 1n);
    });
    await t.test('payroll work key is canonical, unique across managers and recipients, and rolls back on failed transfer', async () => {
      const reference = core.paymentReference({ issueRef: `${core.REPOSITORY}#12`, contributorGithub: 'builder', role: 'tester', currency: 'USDC' });
      assert.equal(await treasury.payrollReference(12, 'builder', 3), reference);
      await assert.rejects(treasury.payPayroll(12, 'Builder', 3, recipientAddress, 1));
      await assert.rejects(treasury.payPayroll(12, 'builder', 4, recipientAddress, 1));
      await assert.rejects(treasury.payPayroll(0, 'builder', 3, recipientAddress, 1));
      await assert.rejects(treasury.payPayroll(12, 'builder', 3, recipientAddress, 1));
      assert.equal(await treasury.paidPayrollReferences(ethers.id(reference)), false);
      await send(token.mint(address, 10000000));
      await send(token.setReject(true));
      await assert.rejects(treasury.payPayroll(12, 'builder', 3, recipientAddress, 1000000));
      assert.equal(await treasury.paidPayrollReferences(ethers.id(reference)), false);
      await send(token.setReject(false));
      await send(treasury.payPayroll(12, 'builder', 3, recipientAddress, 1000000));
      await assert.rejects(treasury.connect(manager).payPayroll(12, 'builder', 3, buyerAddress, 2000000));
      await assert.rejects(treasury.payToken(core.USDC, recipientAddress, 1, reference));
      await assert.rejects(treasury.connect(buyer).payPayroll(13, 'builder', 0, recipientAddress, 1));
      await send(treasury.connect(manager).payPayroll(12, 'builder', 0, recipientAddress, 1));
      assert.equal(await token.balanceOf(recipientAddress), 1000001n);
    });
    await t.test('stock, quoted revision and price, order idempotency, and customer reserve are enforced atomically', async () => {
      await send(treasury.setProduct(0, 0, 'https://example.org/seeds.json', ethers.id('metadata'), 2000000, 3, true, 0, 0));
      await assert.rejects(treasury.connect(buyer).setProduct(1, 0, 'https://example.org/test', ethers.id('metadata'), 1, 100, true, 1, 3));
      await assert.rejects(treasury.connect(manager).setStoreOpen(true));
      await send(treasury.setStoreOpen(true));
      const ref = ethers.id('buyer-order-1');
      await assert.rejects(treasury.connect(buyer).buy(1, 1, 2, 2000000, ref));
      await assert.rejects(treasury.connect(buyer).buy(1, 1, 1, 1, ref));
      await send(token.setReject(true));
      await assert.rejects(treasury.connect(buyer).buy(1, 2, 1, 4000000, ref));
      assert.equal((await treasury.getProduct(1)).available, 3n);
      assert.equal(await treasury.reservedUSDC(), 0n);
      assert.equal(await treasury.usedOrderReferences(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address', 'bytes32'], [buyerAddress, ref]))), false);
      await send(token.setReject(false));
      await send(treasury.connect(buyer).buy(1, 2, 1, 4000000, ref));
      assert.equal(await treasury.reservedUSDC(), 4000000n);
      assert.equal((await treasury.getProduct(1)).available, 1n);
      await assert.rejects(treasury.setProduct(1, 0, 'https://example.org/seeds.json', ethers.id('metadata'), 2000000, 3, true, 1, 3));
      await assert.rejects(treasury.connect(buyer).buy(1, 1, 1, 2000000, ref));
      await assert.rejects(treasury.connect(otherBuyer).buy(1, 2, 1, 4000000, ethers.id('oversell')));
      await send(treasury.connect(otherBuyer).buy(1, 1, 1, 2000000, ref));
      assert.equal((await treasury.getProduct(1)).available, 0n);
      const available = await treasury.availableUSDC();
      await assert.rejects(treasury.payToken(core.USDC, recipientAddress, available + 1n, 'Spend customer funds'));
      await assert.rejects(treasury.payPayroll(99, 'builder', 0, recipientAddress, available + 1n));
      await send(treasury.payToken(core.USDC, recipientAddress, available, 'Spend unrestricted donation'));
      assert.equal(await treasury.availableUSDC(), 0n);
      assert.equal(await token.balanceOf(address), 6000000n);
    });
    await t.test('only buyer confirms receipt after ready; fulfilled funds release and refund becomes impossible', async () => {
      await assert.rejects(treasury.confirmPickup(1));
      await assert.rejects(treasury.connect(buyer).confirmPickup(1));
      await send(treasury.connect(manager).markReady(1));
      await assert.rejects(treasury.connect(otherBuyer).confirmPickup(1));
      await send(treasury.connect(buyer).confirmPickup(1));
      assert.equal(await treasury.reservedUSDC(), 2000000n);
      assert.equal(await treasury.availableUSDC(), 4000000n);
      await assert.rejects(treasury.refundOrder(1));
      await assert.rejects(treasury.connect(buyer).confirmPickup(1));
      await send(treasury.payPayroll(100, 'builder', 0, recipientAddress, 4000000));
    });
    await t.test('full cancellation restores stock and buyer funds even while store is paused; refund cannot repeat', async () => {
      await send(treasury.setStoreOpen(false));
      const before = await token.balanceOf(otherBuyerAddress);
      await assert.rejects(treasury.connect(buyer).refundOrder(2));
      await send(token.setReject(true));
      await assert.rejects(treasury.connect(otherBuyer).refundOrder(2));
      assert.equal(await treasury.reservedUSDC(), 2000000n);
      assert.equal((await treasury.getOrder(2)).status, 0n);
      await send(token.setReject(false));
      await send(treasury.connect(otherBuyer).refundOrder(2));
      assert.equal(await token.balanceOf(otherBuyerAddress), before + 2000000n);
      assert.equal(await treasury.reservedUSDC(), 0n);
      assert.equal((await treasury.getProduct(1)).available, 1n);
      await assert.rejects(treasury.refundOrder(2));
      await assert.rejects(treasury.connect(buyer).buy(1, 1, 1, 2000000, ethers.id('paused')));
    });
    await t.test('expired uncollected order refunds to original buyer without manager permission', async () => {
      await send(treasury.setStoreOpen(true));
      await send(treasury.connect(buyer).buy(1, 1, 1, 2000000, ethers.id('expiry')));
      await provider.send('evm_increaseTime', [14 * 86400 + 1]);
      await provider.send('evm_mine', []);
      await assert.rejects(treasury.markReady(3));
      await send(treasury.connect(otherBuyer).refundOrder(3));
      assert.equal((await treasury.getOrder(3)).status, 3n);
      assert.equal(await treasury.reservedUSDC(), 0n);
    });
    await t.test('ETH recovery, manager revocation and two-step ownership remain functional', async () => {
      await send(treasury.depositETH('donation', { value: 1000 }));
      await send(treasury.payETH(recipientAddress, 1000, 'Recover ETH'));
      await send(treasury.setManager(managerAddress, false));
      await assert.rejects(treasury.connect(manager).setProduct(1, 0, 'https://example.org/test', ethers.id('metadata'), 1, 1, true, 1, 1));
      await assert.rejects(treasury.renounceOwnership());
      await assert.rejects(treasury.transferOwnership(address));
      await send(treasury.transferOwnership(buyerAddress));
      await assert.rejects(treasury.connect(otherBuyer).acceptOwnership());
      await send(treasury.connect(buyer).acceptOwnership());
      assert.equal(await treasury.owner(), buyerAddress);
    });
  } finally { await rpc.disconnect(); }
});
