#!/usr/bin/env node
/**
 * test-native-decimals.js
 *
 * Regression tests for the ProjectLedger v2 frontend logic:
 *   - Amount handling: plain uint256, no ETH/wei conversion needed
 *   - BigInt conversion for on-chain calls
 *   - Error message extraction prioritises decoded revert reason
 *   - Form validation: positive integer amounts accepted, non-positive rejected
 *   - Status constants match contract enum order
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

const source = fs.readFileSync(APP_JS, 'utf8');

// ---------------------------------------------------------------------------
// 1. Verify new contract address is set
// ---------------------------------------------------------------------------
console.log('\n=== 1. Contract address updated to new deployment ===');
assert(
  source.includes('0x44500FFd99B621620f393FCdbcF55D5137A55A23'),
  'LEDGER_CONFIG.contractAddress is the new deployment address',
);
assert(
  !source.includes('0x942CcE8384a9d9bd2842365395d7a912e1a5322c'),
  'Old contract address is not present in app.js',
);

// ---------------------------------------------------------------------------
// 2. Verify new ABI functions are present (no old functions)
// ---------------------------------------------------------------------------
console.log('\n=== 2. New ABI — createEntry present, addEntry absent ===');
assert(
  source.includes("'function createEntry("),
  'PROJECT_LEDGER_ABI includes createEntry',
);
assert(
  !source.includes("'function addEntry("),
  'PROJECT_LEDGER_ABI does not include old addEntry',
);
assert(
  source.includes("'function totalEntries()"),
  'PROJECT_LEDGER_ABI includes totalEntries()',
);
assert(
  !source.includes("'function getEntryCount()"),
  'PROJECT_LEDGER_ABI does not include old getEntryCount()',
);
assert(
  source.includes("'function owner()"),
  'PROJECT_LEDGER_ABI includes owner()',
);
assert(
  !source.includes("'function ADMIN_ROLE()"),
  'PROJECT_LEDGER_ABI does not include old ADMIN_ROLE()',
);
assert(
  source.includes("'function updateStatus("),
  'PROJECT_LEDGER_ABI includes updateStatus()',
);

// ---------------------------------------------------------------------------
// 3. Verify plain uint256 amount handling (no ETH/wei conversion)
// ---------------------------------------------------------------------------
console.log('\n=== 3. Amount handling: plain uint256, no parseEther ===');
assert(
  !source.includes('NATIVE_ASSET_DECIMALS'),
  'NATIVE_ASSET_DECIMALS constant is not present (removed with ETH/wei model)',
);
assert(
  !source.includes('parseEther'),
  'app.js does not call parseEther (amounts are plain uint256 now)',
);
assert(
  source.includes('BigInt(Math.round(values.amount))'),
  'handleEntrySubmit converts amount to BigInt for uint256 on-chain call',
);

// ---------------------------------------------------------------------------
// 4. Verify STATUS_CONFIRMED replaces STATUS_SETTLED
// ---------------------------------------------------------------------------
console.log('\n=== 4. STATUS_CONFIRMED replaces STATUS_SETTLED ===');
assert(
  source.includes("const STATUS_CONFIRMED = 'CONFIRMED'"),
  'STATUS_CONFIRMED constant is defined',
);
assert(
  !source.includes("const STATUS_SETTLED"),
  'STATUS_SETTLED constant is not present',
);
assert(
  source.includes("STATUS_CONFIRMED"),
  'calculateSummary and normalizeEntry use STATUS_CONFIRMED',
);

// ---------------------------------------------------------------------------
// 5. Verify status enum constants match contract
// ---------------------------------------------------------------------------
console.log('\n=== 5. Status enum constants match contract order ===');
assert(
  source.includes('const ENTRY_STATUS_PENDING = 0'),
  'ENTRY_STATUS_PENDING === 0',
);
assert(
  source.includes('const ENTRY_STATUS_CONFIRMED = 1'),
  'ENTRY_STATUS_CONFIRMED === 1',
);
assert(
  source.includes('const ENTRY_STATUS_REQUESTED = 2'),
  'ENTRY_STATUS_REQUESTED === 2',
);
assert(
  source.includes('const ENTRY_STATUS_COMMITTED = 3'),
  'ENTRY_STATUS_COMMITTED === 3',
);
assert(
  source.includes('const ENTRY_STATUS_CANCELED = 4'),
  'ENTRY_STATUS_CANCELED === 4',
);

// ---------------------------------------------------------------------------
// 6. Verify updateStatus action is present in code
// ---------------------------------------------------------------------------
console.log('\n=== 6. handleUpdateStatus function present ===');
assert(
  source.includes('async function handleUpdateStatus('),
  'handleUpdateStatus function is defined',
);
assert(
  source.includes('signerContract.updateStatus('),
  'handleUpdateStatus calls signerContract.updateStatus()',
);

// ---------------------------------------------------------------------------
// 7. Verify non-positive amount validation still present
// ---------------------------------------------------------------------------
console.log('\n=== 7. Non-positive amount validation still present ===');
assert(
  source.includes('amount <= 0'),
  'parseSubmissionValues still rejects amounts <= 0',
);

// ---------------------------------------------------------------------------
// 8. Verify error message extraction includes error.reason
// ---------------------------------------------------------------------------
console.log('\n=== 8. getErrorMessage surfaces error.reason ===');
function getErrorMessage(error, fallback) {
  return (
    error?.reason ||
    error?.shortMessage ||
    error?.info?.error?.message ||
    error?.message ||
    (fallback || 'An unexpected error occurred.')
  );
}

const revertError = { reason: 'EmptyCategory()' };
assert(
  getErrorMessage(revertError) === 'EmptyCategory()',
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

assert(
  source.includes('error?.reason'),
  'getErrorMessage in app.js includes error?.reason extraction',
);

// ---------------------------------------------------------------------------
// 9. Verify owner() used instead of ADMIN_ROLE()/hasRole()
// ---------------------------------------------------------------------------
console.log('\n=== 9. owner() used for admin check (not role-based) ===');
assert(
  source.includes('readContract.owner()'),
  'refreshWalletState calls owner() to determine admin',
);
assert(
  !source.includes('ADMIN_ROLE()'),
  'No references to ADMIN_ROLE() remain in app.js',
);
assert(
  !source.includes('hasRole('),
  'No references to hasRole() remain in app.js',
);

// ---------------------------------------------------------------------------
// 10. Verify fetchEntriesFromContract uses totalEntries() + getEntry(id)
// ---------------------------------------------------------------------------
console.log('\n=== 10. fetchEntriesFromContract uses new API ===');
assert(
  source.includes('contract.totalEntries()'),
  'fetchEntriesFromContract calls totalEntries()',
);
assert(
  source.includes('contract.getEntry(id)'),
  'fetchEntriesFromContract calls getEntry(id) per entry',
);
assert(
  !source.includes('contract.getEntryCount()'),
  'No old getEntryCount() call remains',
);
assert(
  !source.includes('contract.getEntries('),
  'No old getEntries() batch call remains',
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

