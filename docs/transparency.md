# Transparency Policy

## What this ledger tracks
The public ledger tracks project funds moving in and out of Green Tea Hut #1. Each entry includes date, amount, category, description, status, and a proof/reference link when available.

## Status lifecycle

| Status | Description |
|---|---|
| **PENDING** | Soft incoming entry — expected inflow announced but not yet verified (e.g. Artizen match accrual, pledge). Amount may be revised before settlement. |
| **REQUESTED** | Soft outgoing entry — expected outflow requested but not yet approved or executed (e.g. labor or materials request). Amount may be revised before settlement. |
| **COMMITTED** | Approved and awaiting execution — funds or work authorized but not yet transferred. Amount may still be revised. |
| **SETTLED** | Finalized — verified and recorded with supporting proof (receipt, bank statement, or on-chain transaction link). No further revisions allowed. |
| **CANCELED** | Invalidated — entry is no longer active and will not be settled. |

> **Note on smart-contract terminology**: the on-chain `ProjectLedger` contract uses `CONFIRMED` as its settled status. The frontend maps `CONFIRMED` → `SETTLED`.

## Amount revisions
While an entry is PENDING, REQUESTED, or COMMITTED, its estimated amount can be revised on-chain by an admin.  Each revision emits an `AmountUpdated` event with the old amount, new amount, the wallet that made the change, a mandatory reason, and an optional reference URL — creating a complete audit trail.

Once an entry reaches SETTLED or CANCELED status, amount revisions are blocked.

## Balances and totals
- **Settled totals** — confirmed hard financial truth (SETTLED entries only).
- **Projected totals** — ghostly numbers shown above the settled figures. They include PENDING incoming and REQUESTED/COMMITTED outgoing entries as expected future flows.

Balance displays clearly indicate whether pending/requested values are included.

## Update cadence
Ledger updates are published at least once per month, with additional updates whenever meaningful funding or spending activity occurs.

## Proof-link policy
PENDING and REQUESTED entries may temporarily appear without a proof link. Settlement requires a proof/reference URL so the public can verify the recorded activity.
