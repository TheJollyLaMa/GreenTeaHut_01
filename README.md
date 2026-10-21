# ⚸ 🍵 🫖🦧 🛖 🦚📜🧞‍♂️
## Green Tea Hut #1 — Public Accountability Ledger
The Green Tea Party's first project, Green tea Hut #1. 

Project funding and spending are tracked alongside milestone progress and displayed publicly for donors, sponsors, and fans to follow along with where their energy and attention is going.

### 🌐 Live Frontend
**[https://thejollylama.github.io/GreenTeaHut_01/web/](https://thejollylama.github.io/GreenTeaHut_01/web/)**

- Fund the Base treasury: https://thejollylama.github.io/GreenTeaHut_01/web/treasury.html
- Public ledger (GitHub Pages): https://thejollylama.github.io/GreenTeaHut_01/web/

### Contributor Payroll

Repo development payroll uses **native USDC on Base**, funded by Green Tea Hut's
own project treasury, not ART, Artizen, or the shared payroll router. In the
**Labor & Services Payout** tab, the **Repository development payroll** section
shows the public queue, contributor totals, actual USDC funds, and authorized
wallet payment controls. Existing on-site labor records remain a separate flow.

Merged PRs queue rewards from local issues labeled `bounty: <amount> USDC`.
`idea-credit: @username` splits rewards 80/20; both contributors must be registered.
Testing uses `test-bounty: <amount> USDC`, `/test-complete`, and owner-only
`/test-approved`. Multiple USDC labels and amounts over six decimals are rejected.
Splits must be exact at six decimals; no rounding or floating-point accounting.

Only wallets in `contributor-accounts.json` are eligible. The owner or an
approved treasury manager signs each payout in the panel. **Settle Payroll**
requires the contributor, local issue reference, exact role, and finalized
Base transaction hash. It checks both the treasury payout event and USDC
transfer for the exact wallet, amount, and deterministic work reference.
Settlement does not send money. See [the payroll guide](docs/payroll.md).

### Active contract deployment
- **Contract:** `ProjectTreasuryV2` (`contracts/ProjectTreasuryV2.sol`)
- **Address:** `0xf75d1688D01fE29235B3bde450B615e4f3d2254A`
- **Network:** Base (Chain ID `8453`), deployment block `52513179`
- **Explorer:** https://basescan.org/address/0xf75d1688D01fE29235B3bde450B615e4f3d2254A
- **Verified source:** https://repo.sourcify.dev/8453/0xf75d1688D01fE29235B3bde450B615e4f3d2254A
- **Owner:** `0x807061DF657A7697c04045dA7d16D941861cAABc`
- **Previous Base treasury (retired, history imported):** `0x757B1F856f2Faea5a661820f9da56af032B1F9a1`
- **Original prototype:** the Optimism ledger described under *Legacy prototype*

### Greenhouse storefront

The new clustered-plant toolbar tab opens a storefront for seeds, starter
plants, cuttings, and harvest. **Manage greenhouse goods** lets you enter your
own names, descriptions, USDC prices, stock, pickup instructions, and listing
visibility now. Demo edits persist only in your browser; samples are clearly
marked **not for sale** and cannot request token approvals or payments.

The live editor targets the active V2 treasury, which adds stock/orders,
refundable USDC reserved until buyer-confirmed pickup, and unique payroll work
references enforced on-chain. The store stays **closed** until the owner lists
real products and calls `setStoreOpen(true)`. See the
[storefront guide](docs/storefront.md) for editing, metadata publishing, escrow
rules, validation, and the required deployment/cutover steps.

### Run frontend with the live contract
1. Open the live frontend link above (or serve `/web` locally with any static file server).
2. Use MetaMask on **Base** (chain ID `8453`) to avoid wrong-network errors.
3. Accounting writes and payouts are available to the owner and owner-approved managers.
4. Use **Add Entry to the Books** to create a `PENDING` or `REQUESTED` on-chain entry.
5. Use **Confirm Transfer** in the ledger table only after the transfer is complete and a proof URL is available.
6. Use **→ Committed** / **→ Cancel** buttons to transition requested entries.
7. Use **Revise Amount** to update an estimate before confirmation (requires a reason).
8. Use the **Base treasury** link to receive ETH/native USDC, send funds, inspect actual
   balances and manage access. Accounting confirmation itself does not move funds.
9. The seven imported entries are immutable history. Their original statuses do
   not make them eligible for payment or editing.

### Goals
1. Transparent accounting
2. Traceable spending by milestone
3. Public proof links (receipts/photos/docs)
4. Ongoing monthly updates

### Settlement flow
- New incoming entries begin as `PENDING`; new outgoing entries begin as `REQUESTED`.
- Outgoing entries can be moved to `COMMITTED` (approved, awaiting transfer) or `CANCELED` (voided).
- Any soft entry can be `CONFIRMED` (transfer completed + proof attached) once a proof/reference URL is available.
- Balances distinguish **projected** (includes soft entries) from **confirmed** totals.

### Labor & Services Payout MVP
- The existing `🎖️` toolbar view now supports signed QR clock-in payloads, 15-minute accrual tracking, reviewer approval, single-confirmation guards, and payout proof links.
- Shift records are stored locally in the browser and can be synced into the Base
  ledger as outgoing labor entries using `REQUESTED → COMMITTED → CONFIRMED`.
- Reviewer-led adjustments should include a reason note before transfer confirmation, with downward adjustments enforced as mandatory.
- This flow records payment proof; execute treasury payouts separately through
  the treasury page. Old OP browser shift records remain under the old storage
  key and are not automatically resynced or paid.

### Legacy prototype

The original accounting-only `ProjectLedger` on **Optimism (10)** at
`0x44500FFd99B621620f393FCdbcF55D5137A55A23` is retained for provenance.
Do not send funds to it: it has no withdrawal function.
Its seven records and original revision logs are archived and imported as
read-only history. The main project page now reads and writes Base, not OP.
The old contract itself cannot be disabled, so do not continue writing to it.

### Updating the frontend ABI
The frontend ABI in `web/app.js` (`PROJECT_LEDGER_ABI`) must stay in sync with the deployed contract.

If the contract is redeployed or updated:
1. Compile `contracts/ProjectTreasuryLedger.sol` with `npm run compile`.
2. Update `PROJECT_LEDGER_ABI` in `web/app.js` with the new function signatures.
3. Update `LEDGER_CONFIG.contractAddress` with the new deployed address.
4. Update `web/deployment-metadata.json` with the new network entry and `requiredSelectors`.
5. Update the contract address in this README and in `docs/transparency.md`.
6. Commit `artifacts/ProjectTreasuryLedger.json` and `web/treasury-abi.json`
   alongside the source. Keep secrets and resumable signed state out of Git.
7. Run `node scripts/validate-abi.js` to confirm address and selector consistency.

The frontend runs a startup interface check (`validateContractInterface`) on every page load.
It verifies bytecode is present at the configured address and that each required function
selector responds on-chain. If the ABI drifts from the deployed contract, the error message
in the ledger table will name the specific selector that is missing.

### Legacy contract compatibility matrix

| Network  | Chain ID | Contract address                             | Compiler  | ABI version | Artifact                                         |
|----------|----------|----------------------------------------------|-----------|-------------|--------------------------------------------------|
| Optimism | 10       | `0x44500FFd99B621620f393FCdbcF55D5137A55A23` | solc 0.8.20 | 2.0.0     | `contracts_ProjectLedger_sol_ProjectLedger.bin`  |

ABI provenance: `web/deployment-metadata.json` records the canonical address, compiler version, and required function selectors for each network. `scripts/validate-abi.js` cross-checks `web/app.js` against this file and can be run in CI.

### Base treasury (deployed and tested)

The new `ProjectTreasuryLedger` receives and sends native ETH and ordinary ERC-20
tokens on **Base mainnet (8453)**. The owner approves/revokes project managers;
the owner and approved managers can pay out. Managers have full spending access,
not a per-project allowance. Ownership uses two-step acceptance and cannot be
renounced. The owner is `0x807061DF657A7697c04045dA7d16D941861cAABc`.

- Contract: [contracts/ProjectTreasuryLedger.sol](contracts/ProjectTreasuryLedger.sol)
- Treasury UI: [web/treasury.html](web/treasury.html)
- Deployment instructions: [docs/base-deployment.md](docs/base-deployment.md)
- Original OP entries and event archive: [web/optimism-history.json](web/optimism-history.json)

Seven OP entries are preserved with their original IDs, amounts, types, statuses,
descriptions, reference links and timestamps. Imported entries are immutable
history, not Base balances or payable requests. No funds are bridged by importing.
Accounting amounts remain whole USD; actual ETH/token balances and transfers are
separate, in the asset's units. Labor tracking stays in the project UI and does
not automatically authorize or execute treasury payments.

The deployed bytecode, owner and complete history import passed finalized
read-only verification. Live ETH and native Base USDC round-trip tests passed.
Sourcify verified an exact creation/runtime source match. The treasury UI uses
the activated Base address; old accounting balances are not treasury cash.

```sh
npm ci
npm run compile
npm run test:treasury
npm run prepare:base -- 0x807061DF657A7697c04045dA7d16D941861cAABc
```

Preparation creates unsigned transactions only; it does not deploy or use a
private key. Compiled artifacts include compiler settings and complete
standard-JSON sources for explorer verification.

## License

Code: [Apache-2.0](LICENSE) · Art and docs: [CC BY 4.0](LICENSES/CC-BY-4.0.txt) · Please keep the [NOTICE](NOTICE) and give The Jolly LaMa / A Decent Agency a head nod when you reuse this work.
Support the work with a [Supporter DNFT](https://thejollylama.github.io/DecentMarket/).
