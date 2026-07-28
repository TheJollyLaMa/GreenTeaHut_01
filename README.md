# ⚸ 🍵 🫖🦧 🛖 🦚📜🧞‍♂️
## Green Tea Hut #1 — Public Accountability Ledger
The Green Tea Party's first project, Green tea Hut #1. 

Project funding and spending are tracked alongside milestone progress and displayed publicly for donors, sponsors, and fans to follow along with where their energy and attention is going.

### 🌐 Live Frontend
**[https://thejollylama.github.io/GreenTeaHut_01/web/](https://thejollylama.github.io/GreenTeaHut_01/web/)**

- Campaign page: https://artizen.fund/index/p/green-tea-hut-1?season=7
- Public ledger (GitHub Pages): https://thejollylama.github.io/GreenTeaHut_01/web/

### Contract Deployment
- **Contract:** `ProjectLedger` (`contracts/ProjectLedger.sol`)
- **Address:** `0x44500FFd99B621620f393FCdbcF55D5137A55A23`
- **Network:** Optimism (Chain ID `10`)
- **Explorer:** https://optimistic.etherscan.io/address/0x44500FFd99B621620f393FCdbcF55D5137A55A23

### Run frontend with the live contract
1. Open the live frontend link above (or serve `/web` locally with any static file server).
2. Use MetaMask on **Optimism** (chain ID `10`) to avoid wrong-network errors.
3. Admin writes are enabled for the deployed contract **owner** wallet only.
4. Use **Add Entry to the Books** to create a `PENDING` or `REQUESTED` on-chain entry.
5. Use **Confirm/Settle** in the ledger table with a proof URL to settle entries.
6. Use **→ Committed** / **→ Cancel** buttons to transition requested entries.
7. Use **Revise Amount** to update an estimate before settlement (requires a reason).

### Goals
1. Transparent accounting
2. Traceable spending by milestone
3. Public proof links (receipts/photos/docs)
4. Ongoing monthly updates

### Settlement flow
- New incoming entries begin as `PENDING`; new outgoing entries begin as `REQUESTED`.
- Outgoing entries can be moved to `COMMITTED` (approved) or `CANCELED` (voided).
- Any soft entry can be `CONFIRMED` (settled) once a proof/reference URL is available.
- Balances distinguish **projected** (includes soft entries) from **confirmed/settled** totals.

### Labor & Services Payout MVP
- The existing `🎖️` toolbar view now supports signed QR clock-in payloads, 15-minute accrual tracking, reviewer approval, single-settlement guards, and payout proof links.
- Shift records are stored locally in the browser for this MVP and can be synced into `ProjectLedger` as outgoing labor entries using the existing `REQUESTED → COMMITTED → CONFIRMED` lifecycle.
- Reviewer-led downward adjustments require a reason note before settlement.

### Payout deployment recommendation
- **Option 1 — recommended for this MVP:** keep the existing `ProjectLedger` contract and use it as the public record for requested, approved, and confirmed labor payouts while actual payout execution happens off-chain.
- **Option 2 — future upgrade path:** deploy a dedicated `PayoutEscrow` contract only if per-shift on-chain accrual, replay-proof attestations, or immutable settlement guards must move on-chain.
- **Current PR impact:** no contract or ABI changes are required for the MVP shipped in this repository, so there is no manual deploy step for this change.

### Updating the frontend ABI
The frontend ABI in `web/app.js` (`PROJECT_LEDGER_ABI`) must stay in sync with the deployed contract.

If the contract is redeployed or updated:
1. Compile the new `contracts/ProjectLedger.sol` (e.g. with Hardhat or Remix).
2. Update `PROJECT_LEDGER_ABI` in `web/app.js` with the new function signatures.
3. Update `LEDGER_CONFIG.contractAddress` with the new deployed address.
4. Update `web/deployment-metadata.json` with the new network entry and `requiredSelectors`.
5. Update the contract address in this README and in `docs/transparency.md`.
6. Commit the compiled `.bin` file alongside the `.sol` source.
7. Run `node scripts/validate-abi.js` to confirm address and selector consistency.

The frontend runs a startup interface check (`validateContractInterface`) on every page load.
It verifies bytecode is present at the configured address and that each required function
selector responds on-chain. If the ABI drifts from the deployed contract, the error message
in the ledger table will name the specific selector that is missing.

### Contract compatibility matrix

| Network  | Chain ID | Contract address                             | Compiler  | ABI version | Artifact                                         |
|----------|----------|----------------------------------------------|-----------|-------------|--------------------------------------------------|
| Optimism | 10       | `0x44500FFd99B621620f393FCdbcF55D5137A55A23` | solc 0.8.20 | 2.0.0     | `contracts_ProjectLedger_sol_ProjectLedger.bin`  |

ABI provenance: `web/deployment-metadata.json` records the canonical address, compiler version, and required function selectors for each network. `scripts/validate-abi.js` cross-checks `web/app.js` against this file and can be run in CI.
