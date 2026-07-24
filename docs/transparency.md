# Transparency Policy

## What this ledger tracks
The public ledger tracks project funds moving in and out of Green Tea Hut #1. Each entry includes date, amount, category, description, status, and a proof/reference link when available.

## Statuses
- **PENDING**: manual/off-chain funds or expenses that have been announced but still need settlement proof.
- **REQUEST**: approved obligations or requested disbursements that have not yet been paid. These appear above the Total Spent figure as a ghostly preview and are deducted from the displayed Balance.
- **SETTLED**: funds or expenses that have been verified and recorded with supporting proof such as a redacted statement, receipt, or on-chain transaction link.

> **Note on smart-contract terminology**: the on-chain `ProjectLedger` contract uses `CONFIRMED` as its settled status. The frontend maps `CONFIRMED` → `SETTLED`. The `REQUEST` status is a frontend-only off-chain concept and has no direct contract equivalent.

## Update cadence
Ledger updates are published at least once per month, with additional updates whenever meaningful funding or spending activity occurs.

## Proof-link policy
PENDING and REQUEST entries may temporarily appear without a proof link. Settlement requires a proof/reference URL so the public can verify the recorded activity.
