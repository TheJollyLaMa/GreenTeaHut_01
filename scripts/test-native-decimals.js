#!/usr/bin/env node
/**
 * test-native-decimals.js
 *
 * Regression tests for native-asset ledger entry logic:
 *   - NATIVE_ASSET_DECIMALS must equal 18
 *   - Amount conversion from ETH to wei (parseEther equivalent)
 *   - Error message extraction prioritises decoded revert reason
 *   - Form validation: decimal amounts accepted, non-positive amounts rejected
 *
 * Usage:
 *   node scripts/test-native-decimals.js
 *
 * Exit code 0 = all tests passed, non-zero = failure.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_JS = path.join(__dirname, '..', 'web', 'app.js');

let passed = 0;
let failed = 0;

function assert(condition, description) {
  if (condition) {
    console.log(`  OK   ${description}`);
    passed += 1;
  } else {
    console.error(`  FAIL ${description}`);
    failed += 1;
  }
}

// ---------------------------------------------------------------------------
// 1. Verify NATIVE_ASSET_DECIMALS constant is present and set to 18
// ---------------------------------------------------------------------------
console.log('\n=== 1. NATIVE_ASSET_DECIMALS constant ===');
const source = fs.readFileSync(APP_JS, 'utf8');

const decimalsMatch = source.match(/const NATIVE_ASSET_DECIMALS\s*=\s*(\d+)/);
assert(decimalsMatch !== null, 'NATIVE_ASSET_DECIMALS constant is defined in app.js');
if (decimalsMatch) {
  assert(
    Number(decimalsMatch[1]) === 18,
    `NATIVE_ASSET_DECIMALS === 18 (found ${decimalsMatch[1]})`,
  );
}

// ---------------------------------------------------------------------------
// 2. Verify handleEntrySubmit uses NATIVE_ASSET_DECIMALS (not literal 0)
// ---------------------------------------------------------------------------
console.log('\n=== 2. handleEntrySubmit uses NATIVE_ASSET_DECIMALS ===');
// The old bug: assetDecimals = 0 was hardcoded.
// The fix: assetDecimals = NATIVE_ASSET_DECIMALS.
assert(
  !source.includes('const assetDecimals = 0'),
  'handleEntrySubmit does not hardcode assetDecimals = 0',
);
assert(
  source.includes('assetDecimals = NATIVE_ASSET_DECIMALS'),
  'handleEntrySubmit assigns assetDecimals = NATIVE_ASSET_DECIMALS',
);

// ---------------------------------------------------------------------------
// 3. Verify parseEther is used to convert the user amount to wei
// ---------------------------------------------------------------------------
console.log('\n=== 3. Amount converted to wei with parseEther ===');
assert(
  source.includes('parseEther'),
  'app.js calls ethers.parseEther() to convert ETH amount to wei',
);

// ---------------------------------------------------------------------------
// 4. Verify the integer-only form validation was removed
// ---------------------------------------------------------------------------
console.log('\n=== 4. Decimal amounts allowed (no Number.isInteger guard) ===');
// The old validation rejected non-integer amounts:
//   "Amount must be a whole number."
// The fix removes this so decimal ETH values (e.g. 1.5 ETH) are accepted.
assert(
  !source.includes('Number.isInteger(amount)'),
  'parseSubmissionValues no longer rejects non-integer amounts',
);
// The "whole number" restriction was removed from the entry creation form (parseSubmissionValues).
// It still exists in handleReviseAmount (a separate prompt for revising existing entries).
// Check that parseSubmissionValues itself no longer contains the old rejection string.
const parseFnMatch = source.match(/function parseSubmissionValues\(\)[\s\S]*?^}/m);
const parseFnSource = parseFnMatch ? parseFnMatch[0] : '';
assert(
  !parseFnSource.includes('whole number'),
  'parseSubmissionValues function body does not contain whole-number rejection',
);

// ---------------------------------------------------------------------------
// 5. Verify non-positive amounts are still rejected
// ---------------------------------------------------------------------------
console.log('\n=== 5. Non-positive amount validation still present ===');
assert(
  source.includes('amount <= 0'),
  'parseSubmissionValues still rejects amounts <= 0',
);

// ---------------------------------------------------------------------------
// 6. Verify error message extraction includes error.reason
// ---------------------------------------------------------------------------
console.log('\n=== 6. getErrorMessage surfaces error.reason ===');
// Inline the getErrorMessage logic for testing without DOM.
function getErrorMessage(error, fallback) {
  return (
    error?.reason ||
    error?.shortMessage ||
    error?.info?.error?.message ||
    error?.message ||
    (fallback || 'An unexpected error occurred.')
  );
}

const revertError = { reason: 'Native must use 18 decimals' };
assert(
  getErrorMessage(revertError) === 'Native must use 18 decimals',
  'getErrorMessage returns error.reason for on-chain revert',
);

const shortMsgError = { shortMessage: 'execution reverted: "Some reason"' };
assert(
  getErrorMessage(shortMsgError) === 'execution reverted: "Some reason"',
  'getErrorMessage falls back to shortMessage when reason is absent',
);

const rpcError = { info: { error: { message: 'Internal JSON-RPC error.' } } };
assert(
  getErrorMessage(rpcError) === 'Internal JSON-RPC error.',
  'getErrorMessage falls back to info.error.message for JSON-RPC errors',
);

const plainError = { message: 'generic error' };
assert(
  getErrorMessage(plainError) === 'generic error',
  'getErrorMessage falls back to error.message',
);

assert(
  getErrorMessage(null, 'fallback text') === 'fallback text',
  'getErrorMessage uses fallback when error is null',
);

// Verify app.js source also has the reason check.
assert(
  source.includes('error?.reason'),
  'getErrorMessage in app.js includes error?.reason extraction',
);

// ---------------------------------------------------------------------------
// 7. ETH-to-wei conversion correctness (pure arithmetic, no ethers dependency)
// ---------------------------------------------------------------------------
console.log('\n=== 7. ETH-to-wei conversion correctness ===');
// Replicate what ethers.parseEther does for simple values.
function parseEtherSimple(ethString) {
  const [whole = '0', fraction = ''] = ethString.split('.');
  const paddedFraction = fraction.padEnd(18, '0').slice(0, 18);
  return BigInt(whole) * BigInt(10 ** 18) + BigInt(paddedFraction);
}

assert(
  parseEtherSimple('1') === BigInt('1000000000000000000'),
  'parseEther("1") == 1e18 wei',
);
assert(
  parseEtherSimple('1.5') === BigInt('1500000000000000000'),
  'parseEther("1.5") == 1.5e18 wei',
);
assert(
  parseEtherSimple('100') === BigInt('100000000000000000000'),
  'parseEther("100") == 1e20 wei',
);

// Verify that dividing wei back by 10^18 restores the human-readable amount
// (as normalizeEntry does for display).
const weiFor1Eth = BigInt('1000000000000000000');
const displayAmount = Number(weiFor1Eth.toString()) / 10 ** 18;
assert(
  displayAmount === 1,
  'normalizeEntry display: 1e18 wei / 10^18 === 1 (ETH)',
);

const weiFor1_5 = BigInt('1500000000000000000');
const display1_5 = Number(weiFor1_5.toString()) / 10 ** 18;
assert(
  Math.abs(display1_5 - 1.5) < 1e-9,
  'normalizeEntry display: 1.5e18 wei / 10^18 === 1.5 (ETH)',
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(40)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nSome tests FAILED. Fix the issues above.');
  process.exit(1);
}
console.log('\nAll tests passed.');
process.exit(0);
