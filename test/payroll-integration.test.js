const test = require('node:test');
const assert = require('node:assert/strict');
const ganache = require('ganache');
const ethers = require('ethers');
const { compileV2 } = require('../scripts/compile-v2');
const { hashEntries } = require('../scripts/ledger-snapshot');
const core = require('../web/payroll-core');
const config = require('../payroll-assets.json');
const { createBountyEntries, applyAccountAccrual } = require('../scripts/payroll');
const { settleVerifiedPayment } = require('../scripts/settlePayroll');
const { sendPayment } = require('../web/repo-payroll');

test('queued six-decimal reward moves real local tokens through the V2 treasury once and settles verified receipt', async () => {
  const rpc = ganache.provider({ chain: { chainId: 8453 }, logging: { quiet: true } });
  const provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  try {
    const [owner, recipient] = await Promise.all([provider.getSigner(0), provider.getSigner(1)]);
    const { output } = compileV2({ 'PayrollUSDC.sol': { content: `
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.20;
      import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
      contract PayrollUSDC is ERC20 {
        constructor() ERC20("Local USDC", "USDC") {}
        function decimals() public pure override returns(uint8) { return 6; }
        function mint(address to, uint256 amount) external { _mint(to, amount); }
      }` } });
    const deploy = async (artifact, args = []) => {
      const contract = await new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, owner).deploy(...args);
      return contract.waitForDeployment();
    };
    const history = require('../web/base-history.json').entries;
    const ledger = await deploy(output.contracts['contracts/ProjectTreasuryV2.sol'].ProjectTreasuryV2,
      [await owner.getAddress(), core.PREVIOUS_TREASURY, 1, '0x' + 'ab'.repeat(32), history.length, hashEntries(history)]);
    await (await ledger.importHistory(history)).wait();
    await (await ledger.finalizeMigration()).wait();
    const token = await deploy(output.contracts['PayrollUSDC.sol'].PayrollUSDC);
    // Only the in-process test chain uses mainnet addresses; no public RPC or signer is used.
    for (const [contract, address] of [[ledger, core.TREASURY], [token, core.USDC]]) {
      const original = await contract.getAddress();
      await provider.send('evm_setAccountCode', [address, await provider.getCode(original)]);
      for (let slot = 0; slot < 32; slot += 1) {
        const storage = await provider.getStorage(original, slot);
        await provider.send('evm_setAccountStorageAt', [address, ethers.toBeHex(slot, 32),
          ethers.zeroPadValue(storage === '0x' ? '0x00' : storage, 32)]);
      }
    }
    const localToken = new ethers.Contract(core.USDC, token.interface, owner);
    await (await localToken.mint(core.TREASURY, 20000000)).wait();
    const accounts = { contributors: [{ github: 'builder', walletAddress: await recipient.getAddress(),
      usdcPending: '0', usdcEarned: '0' }] };
    const queue = { pending: [], settled: [] };
    const { entries } = createBountyEntries({
      issue: { number: 123, labels: ['bounty: 12.345678 USDC'] },
      pr: { number: 124, user: { login: 'builder' } }, accounts, queue,
      repoSlug: config.repository, queuedAt: '2026-10-12T12:00:00Z', queuedBy: 'maintainer',
    });
    queue.pending.push(...entries);
    applyAccountAccrual(accounts, entries);
    core.validateData(queue, accounts, config);
    let txHash;
    const proof = await sendPayment({
      entry: entries[0], config, core, ethers, reader: provider, wallet: provider,
      deploymentReady: () => true, checkUnpaid: async () => {}, confirm: () => true,
      recordSubmission: hash => { txHash = hash; },
    });
    assert.equal(proof.txHash, txHash);
    assert.equal(await localToken.balanceOf(await recipient.getAddress()), 12345678n);
    assert.equal(await localToken.balanceOf(core.TREASURY), 7654322n);
    const treasury = new ethers.Contract(core.TREASURY, ledger.interface, owner);
    assert.equal(await treasury.paidPayrollReferences(core.workReference(entries[0], ethers)), true);
    await assert.rejects(treasury.payPayroll(123, 'builder', 0, await recipient.getAddress(), 1));
    // Ganache has no consensus finality; latest is the finalized test checkpoint.
    const finalityProvider = {
      send: (...args) => provider.send(...args),
      getTransactionReceipt: hash => provider.getTransactionReceipt(hash),
      getBlock: tag => provider.getBlock(tag === 'finalized' ? 'latest' : tag),
    };
    await settleVerifiedPayment({ queue, accounts, contributorGithub: 'builder',
      issueRef: entries[0].issueRef, role: 'contributor', txHash, provider: finalityProvider, ethers,
      settledAt: '2026-10-12T12:05:00Z', settledBy: 'maintainer' });
    assert.equal(queue.pending.length, 0);
    assert.equal(accounts.contributors[0].usdcEarned, '12.345678');
    core.validateData(queue, accounts, config);
  } finally { await rpc.disconnect(); }
});
