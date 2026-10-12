'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Interface, ZeroAddress } = require('ethers');
const { verifyMovement, verifyTokenTransfer, ADDRESS, AMOUNT, PURPOSE, USDC, USDC_AMOUNT, USDC_PURPOSE, TOKEN_ABI } = require('../scripts/smoke-base');
const iface = new Interface(require('../web/treasury-abi.json'));
const owner = '0x807061DF657A7697c04045dA7d16D941861cAABc';

function receipt(name, amount = AMOUNT, asset = ZeroAddress) {
  const args = name === 'FundsReceived' ? [1, asset, owner, amount, PURPOSE] : [2, asset, owner, owner, amount, PURPOSE];
  const event = iface.encodeEventLog(iface.getEvent(name), args);
  return { status: 1, logs: [{ address: ADDRESS, ...event }] };
}

test('ETH smoke test verifies exact asset, amount, sender, recipient and treasury receipt', () => {
  for (const name of ['FundsReceived', 'FundsPaid']) {
    assert.doesNotThrow(() => verifyMovement(receipt(name), iface, name, owner, AMOUNT));
    assert.throws(() => verifyMovement(receipt(name, AMOUNT + 1n), iface, name, owner, AMOUNT));
    assert.throws(() => verifyMovement(receipt(name, AMOUNT, owner), iface, name, owner, AMOUNT));
    assert.throws(() => verifyMovement({ ...receipt(name), status: 0 }, iface, name, owner, AMOUNT));
    assert.throws(() => verifyMovement({ status: 1, logs: [] }, iface, name, owner, AMOUNT));
    const duplicate = receipt(name);
    duplicate.logs.push(duplicate.logs[0]);
    assert.throws(() => verifyMovement(duplicate, iface, name, owner, AMOUNT));
  }
});

test('native USDC smoke test requires exact 6-decimal amount, token and purpose', () => {
  assert.equal(USDC_AMOUNT, 10000n);
  for (const name of ['FundsReceived', 'FundsPaid']) {
    const valid = receipt(name, USDC_AMOUNT, USDC);
    const args = name === 'FundsReceived'
      ? [1, USDC, owner, USDC_AMOUNT, USDC_PURPOSE]
      : [2, USDC, owner, owner, USDC_AMOUNT, USDC_PURPOSE];
    valid.logs[0] = { address: ADDRESS, ...iface.encodeEventLog(iface.getEvent(name), args) };
    assert.doesNotThrow(() => verifyMovement(valid, iface, name, owner, USDC_AMOUNT, USDC, USDC_PURPOSE));
    assert.throws(() => verifyMovement(valid, iface, name, owner, USDC_AMOUNT, ZeroAddress, USDC_PURPOSE));
    assert.throws(() => verifyMovement(valid, iface, name, owner, USDC_AMOUNT + 1n, USDC, USDC_PURPOSE));
    assert.throws(() => verifyMovement(valid, iface, name, owner, USDC_AMOUNT, USDC, PURPOSE));
  }
});

test('USDC balance evidence requires a successful exact token Transfer event', () => {
  const tokenIface = new Interface(TOKEN_ABI);
  for (const [from, to] of [[owner, ADDRESS], [ADDRESS, owner]]) {
    const valid = { status: 1, logs: [{ address: USDC, ...tokenIface.encodeEventLog(tokenIface.getEvent('Transfer'), [from, to, USDC_AMOUNT]) }] };
    assert.doesNotThrow(() => verifyTokenTransfer(valid, tokenIface, from, to, USDC_AMOUNT));
    assert.throws(() => verifyTokenTransfer(valid, tokenIface, to, from, USDC_AMOUNT));
    assert.throws(() => verifyTokenTransfer(valid, tokenIface, from, to, USDC_AMOUNT + 1n));
    assert.throws(() => verifyTokenTransfer({ ...valid, status: 0 }, tokenIface, from, to, USDC_AMOUNT));
    assert.throws(() => verifyTokenTransfer({ status: 1, logs: [] }, tokenIface, from, to, USDC_AMOUNT));
  }
});
