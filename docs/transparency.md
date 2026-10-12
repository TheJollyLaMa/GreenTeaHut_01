# Transparency Policy

## What this ledger tracks
The public ledger tracks project funds moving in and out of Green Tea Hut #1. Each entry includes date, amount, category, description, status, and a proof/reference link when available.

## Status lifecycle

| Status | Description |
|---|---|
| **PENDING** | Soft incoming entry — expected inflow announced but not yet verified (e.g. a pledge). Amount may be revised before settlement. |
| **REQUESTED** | Soft outgoing entry — expected outflow requested but not yet approved or executed (e.g. labor or materials request). Amount may be revised before settlement. |
| **COMMITTED** | Approved and awaiting execution — funds or work authorized but not yet transferred. Amount may still be revised. |
| **CONFIRMED** | Finalized — verified and recorded with supporting proof (receipt, bank statement, or on-chain transaction link). No further revisions allowed. |
| **CANCELED** | Invalidated — entry is no longer active and will not be settled. |

## Amount revisions
While an entry is PENDING, REQUESTED, or COMMITTED, its estimated amount can be revised on-chain by an admin.  Each revision emits an `AmountUpdated` event with the old amount, new amount, the wallet that made the change, a mandatory reason, and an optional reference URL — creating a complete audit trail.

Once an entry reaches CONFIRMED or CANCELED status, amount revisions are blocked.

## Balances and totals
- **Confirmed totals** — confirmed hard financial truth (CONFIRMED entries only).
- **Projected totals** — ghostly numbers shown above the confirmed figures. They include PENDING incoming and REQUESTED/COMMITTED outgoing entries as expected future flows.

Balance displays clearly indicate whether pending/requested values are included.

## Base treasury and historical migration

The original Optimism contract is accounting-only, not a receiving wallet.
Never send funds to it.

The active Base `ProjectTreasuryV2` at
`0xf75d1688D01fE29235B3bde450B615e4f3d2254A` can hold native ETH and
native Base USDC. Its owner and owner-approved project managers can send funds.
Every treasury-mediated receipt and payout emits an asset-specific event.
Payroll payouts have unique on-chain work references and can use only USDC
available after excluding storefront escrow. Customer USDC remains reserved
until pickup confirmation or refund. The store remains closed until the owner
lists actual products and opens it.
The previous Base `ProjectTreasuryLedger`
(`0x757B1F856f2Faea5a661820f9da56af032B1F9a1`) is retired; do not deposit
funds to it.
USD accounting entries do not move assets; a confirmed accounting entry is not
proof of the treasury's current balance. Consult the actual on-chain ETH or token
balance, not the accounting totals, before spending.

All imported Optimism and previous-Base entries are read-only history, including
entries whose original status is PENDING or REQUESTED. Importing records neither
transfers nor bridges funds. Original Optimism source event logs (including
amount revisions) are preserved in `web/optimism-history.json`; they are not
re-emitted as Base payments. V2 commits to the complete entry snapshot and its
Optimism and previous-Base provenance.

Direct ERC-20 transfers and forced ETH receipts may not emit treasury events.
The UI explicitly separates event history from actual balances. Unsupported,
malicious, frozen, or restricted tokens may be impossible to transfer; supporting
ERC-20 does not guarantee that every arbitrary token is recoverable. Do not send
NFTs or assets on other chains to the treasury.

V2 deployment, full history migration, and live ETH/native Base USDC receive/send
round trips are verified. Its source has an exact Sourcify creation/runtime match.
See [Base deployment record and checklist](base-deployment.md).

## Update cadence
Ledger updates are published at least once per month, with additional updates whenever meaningful funding or spending activity occurs.

## Proof-link policy
PENDING and REQUESTED entries may temporarily appear without a proof link. Settlement requires a proof/reference URL so the public can verify the recorded activity.
