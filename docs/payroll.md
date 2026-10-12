# Repo development payroll - native USDC on Base

## Scope and reference systems

The implementation follows the current DecentCanopy/DecentBusking patterns for
registered contributors, currency precision, role-specific deduplication and
on-chain payment evidence. Their shared router is **not** used here. Green Tea
Hut's already deployed treasury pays native Base USDC directly:

- Chain: Base mainnet, `8453`.
- Treasury: `0x757B1F856f2Faea5a661820f9da56af032B1F9a1`.
- USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, six decimals.
- Configuration: [payroll-assets.json](../payroll-assets.json).
- Public queue: [payroll-queue.json](../payroll-queue.json).
- Registry and exact decimal-string totals: [contributor-accounts.json](../contributor-accounts.json).

No new ART rewards or Artizen integration. The immutable OP archive retains
its original historical descriptions and proof links, including past Artizen
references; this is provenance, not a current partnership or funding link.

## Register and queue work

1. Submit a contributor request with a GitHub handle and wallet controlled on Base.
   A maintainer must register it; a request does not grant payment access.
2. Agree on a funded reward, then label a local issue `bounty: 12.5 USDC`.
   A merged PR closing that issue queues the whitelisted PR author, or a
   whitelisted issue assignee if the author is not registered.
3. Optional `idea-credit: @handle` creates separate implementer (80%) and
   idea-originator (20%) entries. A split must be exact in USDC micro-units.
4. Test rewards use `test-bounty: 5 USDC`. An assigned tester reports
   `/test-complete`; the registered owner reviews and posts `/test-approved`.
   If multiple registered testers are assigned, resolve assignment ambiguity
   before approving. Testing and implementation rewards have distinct roles.

The Bounty Bot manual recovery input accepts **merged** PRs only. It is
idempotent for an issue, contributor, role and currency. Unsupported ART labels
do not queue rewards. Malformed USDC amounts, duplicate USDC bounty labels,
unregistered recipients and inconsistent account totals fail validation.

A bounty is not a funded guarantee. No private keys belong in GitHub secrets,
workflow inputs or payroll files. On-chain treasury permissions and the GitHub
contributor whitelist are separate.

## Review, pay, settle

1. Open the project's **Labor & Services Payout** tab. Use its **Repository
   development payroll** section, not the shift-clock controls.
2. Fund the treasury with native USDC **on Base** if necessary using the funds
   page. The panel shows the actual USDC balance separately from accounting USD.
3. Connect the owner or approved manager wallet on Base. Review the queue's
   recipient, amount, issue and role. Click **Pay USDC from treasury**, review
   the explicit confirmation, then approve the wallet transaction.
4. The panel calls `payToken` with an exact six-decimal amount and the reference
   `repo-payroll:<issueRef>:<lowercase GitHub handle>:<role>:USDC`. It checks
   chain, current manager authority, available funds and existing payout history
   before requesting the signature. It never asks for a USDC allowance because
   the treasury, not the connected wallet, is paying.
5. After Base finalization, run the **Settle Payroll** workflow on main with
   the contributor, `TheJollyLaMa/GreenTeaHut_01#123`, role and payout hash.
   The workflow checks a canonical finalized successful Base receipt, the
   exact treasury `FundsPaid` event and native USDC `Transfer` event. Another
   reward's transaction, a direct wallet transfer, an OP transaction or the
   old smoke-test withdrawal cannot settle this work.
6. Settlement moves precisely one entry, stores the transaction and payment log
   index, and updates exact pending/earned totals. The public panel reflects
   the change after GitHub Pages rebuilds. Until then it marks existing chain
   payouts as paid and awaiting GitHub settlement, not payable again.

Queue-writing workflows explicitly request a Pages rebuild after the normal
push. This is necessary because pushes made using `GITHUB_TOKEN` do not
automatically trigger a Pages build. Manual recovery also requests a rebuild
when no queue changes are needed, so a failed publication can be retried without
paying or queueing work again.

Submitted transaction hashes are retained in browser storage to prevent
accidental resend during receipt/RPC failures. A refresh releases a reverted
transaction for retry; unresolved transactions stay blocked. Review replaced
or dropped transactions manually rather than clearing storage to retry.

**Concurrency limit:** this general-purpose treasury does not enforce unique
payroll work references on-chain. This UI locks payment operations across tabs
in the same browser and checks existing payouts, but cannot prevent two managers
on separate devices, or another direct contract caller, paying concurrently.
Coordinate a single payroll operator. Duplicate on-chain references halt panel
payments and require manual review; settlement cannot reuse one payment log.
An on-chain uniqueness guarantee would require a new contract deployment.

The on-site shift workflow is preserved: its USD accounting and proof
confirmation do not automatically transfer tokens or use the repo queue.
Repo USDC payouts emit treasury transfer events and GitHub settlement records;
they do not automatically create whole-USD accounting entries.

## Validation and recovery

```sh
node scripts/validatePayrollQueue.js
node --test test/payroll.test.js test/payroll-payment.test.js test/repo-payroll.test.js test/commentArt.test.js test/payroll-integration.test.js
```

Automated queue writers share one concurrency group. If another main-branch
push races the update, the normal push fails rather than rebasing unvalidated
accounting. Rerun the workflow against the latest queue. A successful payment
does not need to be sent again just because settlement failed.
