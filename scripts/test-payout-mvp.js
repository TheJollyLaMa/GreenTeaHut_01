#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP_JS = path.join(ROOT, 'web', 'app.js');
const INDEX_HTML = path.join(ROOT, 'web', 'index.html');
const README = path.join(ROOT, 'README.md');

const appSource = fs.readFileSync(APP_JS, 'utf8');
const htmlSource = fs.readFileSync(INDEX_HTML, 'utf8');
const readmeSource = fs.readFileSync(README, 'utf8');

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

console.log('\n=== 1. Existing payout view upgraded in place ===');
assert(htmlSource.includes('id="toolbar-payout"'), 'Toolbar still points to the existing 🎖️ payout view');
assert(htmlSource.includes('id="payout-view"'), 'Existing payout view container remains in use');
assert(htmlSource.includes('id="payout-clock-in-form"'), 'Payout view now includes QR clock-in controls');
assert(htmlSource.includes('id="payout-review-form"'), 'Payout view now includes reviewer settlement controls');
assert(htmlSource.includes('Payments are recorded here; transfer is executed externally in MVP.'), 'Payout UI explains that MVP transfers are external');
assert(htmlSource.includes('COMMITTED</code> = approved, awaiting transfer.'), 'Payout UI defines COMMITTED as approved and awaiting transfer');
assert(htmlSource.includes('CONFIRMED</code> = transfer completed + proof attached.'), 'Payout UI defines CONFIRMED as transfer completed with proof');

console.log('\n=== 2. QR freshness and signature guards are present ===');
assert(appSource.includes('const QR_EXPIRATION_WINDOW_MS = 10 * 60 * 1000'), 'QR expiration window is defined');
assert(appSource.includes('const ACCRUAL_BUCKETS_PER_HOUR = 4'), 'Accrual bucket divisor is defined');
assert(appSource.includes('function buildQrMessage(payload)'), 'Signed QR payload message builder exists');
assert(appSource.includes('window.ethers.verifyMessage'), 'QR signature verification uses ethers.verifyMessage');
assert(appSource.includes('payoutState.usedNonces'), 'QR nonce replay protection is stored in payout state');

console.log('\n=== 3. Anti-double-pay and overlap guards are present ===');
assert(appSource.includes('getActiveShiftForWorkerSite'), 'Worker/site overlap guard helper exists');
assert(appSource.includes('This worker already has an active shift'), 'Duplicate active shift UI guard message exists');
assert(appSource.includes('settlementIdempotencyKey'), 'Per-shift settlement idempotency key is stored');
assert(appSource.includes('Duplicate transfer confirmation is blocked'), 'Duplicate transfer confirmation guard message exists');

console.log('\n=== 4. Reviewer + ledger sync workflow is present ===');
assert(appSource.includes('async function syncRequestedLedger('), 'Reviewer can sync requested payout state to ProjectLedger');
assert(appSource.includes('ENTRY_STATUS_REQUESTED'), 'Requested ledger lifecycle is used');
assert(appSource.includes('ENTRY_STATUS_COMMITTED'), 'Committed ledger lifecycle is used');
assert(appSource.includes('confirmEntry(shift.ledgerEntryId, proofUrl)'), 'Settlement confirmation writes proof to ProjectLedger');
assert(appSource.includes("confirmButton.textContent = 'Confirm Transfer'"), 'Ledger actions use transfer confirmation wording');
assert(appSource.includes('Awaiting proof'), 'Unconfirmed payout records avoid paid/settled wording before proof exists');

console.log('\n=== 5. Public documentation names Option 1 and Option 2 ===');
assert(readmeSource.includes('Option 1 — recommended for this MVP'), 'README recommends Option 1');
assert(readmeSource.includes('Option 2 — future upgrade path'), 'README documents Option 2');
assert(readmeSource.includes('no contract or ABI changes are required'), 'README states that this MVP does not require a deploy');
assert(readmeSource.includes('COMMITTED` (approved, awaiting transfer)'), 'README documents COMMITTED as approved and awaiting transfer');
assert(readmeSource.includes('CONFIRMED` (transfer completed + proof attached)'), 'README documents CONFIRMED as transfer completed with proof');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
