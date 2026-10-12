# Greenhouse storefront

## Current status

The fourth right-hand toolbar button opens the greenhouse storefront. Its small
cluster shows sunflower, seedlings, mushroom, and hyacinth. The catalog covers
seeds, starter plants, cuttings, and harvest.

**The storefront is currently a demo, not a live shop.** No purchase, token
approval, or product-publication transaction is enabled. The existing Base
treasury, funding page, accounting ledger, and USDC payroll remain unchanged.
[storefront-deployment.json](../web/storefront-deployment.json) deliberately has
`ready: false` and no replacement address.

## Enter your own goods

Open **Manage greenhouse goods** in the storefront:

1. Choose **Add a new product**, or select an existing product to edit it.
2. Enter its category, name, public description, USDC price per unit, available
   units, public pickup instructions, and listing visibility.
3. Save the demo product. Changes survive reloads in this browser only; they are
   not shared with other visitors, uploaded, or added to the chain.
4. Select a product and set **Hidden / paused** to remove it from browsing.
   **Reset sample catalog** explicitly discards browser-local demo changes.
5. **Download product JSON** exports its descriptive metadata. Save your own
   metadata before clearing browser storage; local edits are not a backup.

Prices use exact USDC micro-units, not floating point, with at most six decimal
places. The editor accepts stock from zero through 1,000,000 units. Stock means
units currently available for purchase, not total stock including pending orders.
Zero-stock listings cannot be purchased. Demo visibility never enables sales.
Demo listings are **not automatically promoted to live inventory**.

## Publishing real goods after verified activation

The live editor is already wired to the replacement contract. Only its owner
and approved managers can publish listings; only the owner opens or pauses sales.
There is no separate upload service or hosting account in this application.

1. Start a fresh live listing with your actual goods and stock.
2. Download its JSON and host it at a public HTTPS URL permitting browser
   cross-origin reads. GitHub Pages is one possible host.
3. Enter that URL and click **Publish product on Base**.
4. The editor checks that the hosted metadata matches the form, then requests
   the wallet transaction. The chain stores category, metadata URL/content hash,
   USDC price, available inventory, visibility, and revision.
5. Refresh and review your listings before the owner explicitly opens the store.

Descriptive metadata uses this schema:

```json
{
  "schemaVersion": 1,
  "kind": 0,
  "name": "Our tomato seeds",
  "description": "One packet of greenhouse-grown seeds.",
  "pickup": "Arrange local pickup at the greenhouse."
}
```

Categories are seeds `0`, starter plants `1`, cuttings `2`, harvest `3`. The
commitment is `keccak256` of UTF-8 `JSON.stringify` of the validated metadata,
with the field order shown above and outer whitespace trimmed from text fields.
Formatting or JSON property order does not affect it. Price and stock are
authoritative on-chain and are not part of this descriptive file.

Changing descriptive content requires another on-chain listing revision. A
changed file, inaccessible URL, mismatched category, or wrong content hash
disables the catalog rather than silently showing substituted goods.
Use distinct URLs for successive revisions to preserve old order descriptions.
Listing updates also check the inventory/revision originally loaded into the
editor; refresh and reselect a product if a purchase or another manager changed
it meanwhile. This prevents accidentally restoring already-sold stock.

The first UI supports up to 200 products and 200 visible orders. It fails
explicitly if those limits are exceeded; pagination is required before growing
beyond them. Refund restocking can increase inventory beyond the editor's normal
entry limit; refunds themselves are not capped.

## USDC purchases, pickup, and refunds

The replacement uses only native USDC on Base
(`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) for storefront orders:

- One product and a positive whole quantity per transaction, not a multi-item
  cart. A purchase checks the quoted revision and total, and decrements stock
  atomically. Competing buyers cannot purchase more stock than is available.
- Customers authorize their own USDC. If an allowance is needed, the UI requests
  only the exact purchase amount, not an unlimited allowance. Approval is a
  separate transaction and does not place an order.
- Checkout uses persistent buyer-scoped references and same-browser Web Locks.
  Uncertain submissions are not silently turned into new purchases. A verified
  prior purchase requires a separate explicit confirmation to buy again.
  Different browsers/devices may intentionally place different orders; inventory
  and reference uniqueness remain contract-enforced.
- Customer payments remain **reserved**. Treasury withdrawals and payroll cannot
  spend the reserved USDC. Direct donations are not refundable orders.
- Owner/managers mark an order ready. **Only its buyer** can confirm goods
  collected, and only after readiness. This releases proceeds to the project
  and ends the refund option. Collect the actual goods before confirming.
- Before collection, buyers can cancel for a full refund; owner/managers can
  also cancel. Refunds always return to the original buyer and restore stock.
- Uncollected orders expire 14 days after purchase. Anyone may trigger their
  full refund after expiry. Refunds and collection remain available while sales
  are paused, but expired orders cannot be collected.
- Issuer freezes, token restrictions, RPC outages, or network fees can still
  affect transactions. Local tests do not guarantee universal fund recovery.

All wallet/order activity and descriptive metadata are public. Never publish
personal contact details, home addresses, private pickup codes, or customer
messages in metadata or on-chain fields. Coordinate private pickup details
separately. Managers remain trusted treasury operators; escrow protection does
not make arbitrary operators trustworthy.

## Replacement contract and remaining deployment work

[ProjectTreasuryV2.sol](../contracts/ProjectTreasuryV2.sol) is deployed at
`0xf75d1688D01fE29235B3bde450B615e4f3d2254A` and is the active treasury; it is a new contract, not an upgrade of V1. It preserves accounting methods,
supports ETH/ERC-20 recovery, and imports a committed snapshot of the Base
predecessor as immutable history.

`payPayroll(issueId, lowercaseGithub, role, recipient, amountUSDC)` constructs
the canonical repository reference and enforces a single successful payout for
that work key. Role indices are contributor `0`, implementer `1`,
idea-originator `2`, tester `3`. Changing recipient or amount cannot repay the
same key. Generic token payouts cannot use the `repo-payroll:` namespace.
Trusted managers can still make other generic transfers under other descriptions;
this is not a guarantee against a manager deliberately disguising payroll.

### Cutover tooling

V1 at `0x757B1F856f2Faea5a661820f9da56af032B1F9a1` held the 7 imported
OP entries, plus two smoke-test round trips that left a zero balance. It has
**no** `repo-payroll:` payouts, so V2 needs no payroll-flag import. The
tooling refuses to continue if that ever changes.

| Step | Command | Sends transactions? |
| --- | --- | --- |
| Export finalized V1 history and logs to [base-history.json](../web/base-history.json) | `npm run export:base` | No |
| Re-prove V1 is unchanged and payroll-free | `npm run verify:base-snapshot` | No |
| Build the unsigned plan `artifacts/base-v2-deployment-plan.json` | `npm run prepare:v2` | No |
| Fee/balance/owner dry run | `npm run deploy:v2:check` | No |
| Deploy, import history, finalize (resumable) | `npm run deploy:v2` | Yes, 3 owner transactions |
| ETH and USDC round trips against V2 | `node scripts/smoke-base.js --v2 <address> [--usdc] --broadcast` | Yes |
| Verify V2 source on Sourcify | `node scripts/verify-v2-source.js <address>` | No |
| Gate and switch every site config to V2 | `npm run activate:v2 -- <address>` | No |

The export keeps the OP archive as the required, unaltered prefix of the
Base history and records the OP snapshot it descends from. Block-pinned state
reads use `BASE_RPC_URL` (default `https://mainnet.base.org`). Log scans use
`BASE_LOGS_RPC_URL` (default publicnode), because each public endpoint
supports only one of those reliably.

**Freeze V1 writes during cutover.** Do not create or edit V1 entries or pay
from V1 between export and activation. Plan preparation, deployment, and the
pre-deploy checks re-verify V1 at the latest finalized block. If anything
changed, they stop and ask you to export and prepare again.

V2 deployment state is kept in `.base-v2-deployment-state.json` (git-ignored,
mode 600). It is separate from V1's state; never delete it to retry. The deploy
script verifies the deployed runtime, owner, predecessor, and imported history
hash. It never creates products, approves managers, or opens the store.

### Going live with sales

The ledger, treasury page, payroll panel and storefront all switch to V2 in one
activation. Activation writes `base-deployment.json`, `storefront-deployment.json`,
`deployment-metadata.json` and `payroll-assets.json`; the page code pins the same
address and deployment block and refuses mismatches. After activation:

1. Enter **real** products in the editor, publish their metadata, and list them
   with `setProduct`.
2. Separately open sales with `setStoreOpen(true)`.

Importing the accounting history does not transfer funds. Never make sample
products saleable.

## Local validation

```sh
npm run compile:v2
npm run test:storefront
node --test test/deploy-v2.test.js
npm test
```

The V2 artifact and ABI are separate from the already deployed V1 artifacts.
CI recompiles both and checks their reproducibility. Tests use an in-process
Base-shaped chain and test-token code at the native-USDC address; they do not
send public-chain transactions.
