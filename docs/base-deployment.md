# Base project treasury deployment

## Status and custody

**Retired.** Superseded by V2 (see below). V1 was deployed, migrated and tested on Base at
`0x757B1F856f2Faea5a661820f9da56af032B1F9a1`.
Optimism is historical provenance only.
Sourcify verified an exact creation/runtime source match:
https://repo.sourcify.dev/8453/0x757B1F856f2Faea5a661820f9da56af032B1F9a1
BaseScan also displays verified source:
https://basescan.org/address/0x757B1F856f2Faea5a661820f9da56af032B1F9a1#code

The public pages read Base through `https://base-rpc.publicnode.com` to avoid
the official public endpoint's rate limits. Activation uses
`https://mainnet.base.org` by default because its finalized historical code
queries require archive access. `BASE_RPC_URL` can override the script endpoint.

Live smoke-test evidence:
- ETH deposit: `0xbf4f7f0e95398661b75b4e9c2beab926e67694bf9a8cea3de234a5f1bd25324b`
- ETH return: `0xa2cfce0cbf8db8d826e75200355ced39f9031fd884c1728e201931ac33e1f392`
- USDC deposit: `0x505fefdac7c6a64bd937730492e7c9610e77a4946014b46d9471209e5f4e281a`
- USDC return: `0x4cea918f9a52fcce7e5a47acd5c406af01d6e8ef370cda5a3c92f96964afa736`

The remaining sections document reproduction and future redeployments; do not
redeploy this treasury or delete completed transaction state to repeat a test.

- Chain: Base mainnet, chain ID **8453**, not Optimism or Base Sepolia.
- Owner: `0x807061DF657A7697c04045dA7d16D941861cAABc`.
- Managers: none initially; the owner must explicitly approve them.
- Source: OP chain 10, `0x44500FFd99B621620f393FCdbcF55D5137A55A23`.
- Current export: **7 entries**, finalized OP block **158102414**.
- Contract: `contracts/ProjectTreasuryLedger.sol`.
- Compiler: pinned solc 0.8.30, optimizer 200 runs, EVM Paris.

Confirm that you control the owner wallet or Safe **on Base**, can sign transactions,
and have secure backup/recovery access. A public address does not prove control.
The owner can spend funds even if all managers are revoked. Ownership transfer is
two-step; renunciation and transfer to the treasury itself are blocked. Approved
manager permissions survive an ownership transfer until the new owner revokes them.
Managers can spend the entire balance: only approve fully trusted wallets.

ETH and ERC-20 payouts have reentrancy guards and revert atomically on failed
transfers. OpenZeppelin SafeERC20 supports ordinary and no-return tokens. No
allowlist prevents recovery of directly transferred ordinary ERC-20s. There is no
universal recovery guarantee for malicious, frozen, rebasing or restricted tokens,
NFTs, or funds sent on another network. Do not advertise support for such assets.

## Prepare and verify without sending transactions

```sh
npm ci
npm run compile
npm run test:treasury
node scripts/test-native-decimals.js
node scripts/test-payout-mvp.js
node scripts/validate-abi.js
npm run prepare:base -- 0x807061DF657A7697c04045dA7d16D941861cAABc
```

`artifacts/ProjectTreasuryLedger.json` contains the ABI, creation/runtime bytecode,
compiler version and complete standard-JSON compiler input for explorer
verification. `artifacts/base-deployment-plan.json` contains constructor arguments,
unsigned deployment data, and unsigned owner-only import/finalization calls.
Preparation scripts do not require a seed phrase or private key.

Optional manager addresses can follow the owner in `prepare:base`; they produce
additional unsigned `setManager` calls. Omitting them approves nobody.
Changing the planned owner requires updating and reviewing
`web/base-deployment.json` before regenerating the unsigned plan.

### Source cutover

Stop OP ledger writes before the final export; otherwise the two ledgers can
diverge. Open browser tabs and direct contract callers can still write to the
immutable legacy OP contract even after the UI cutover.

```sh
npm run export:optimism
node scripts/verify-source-snapshot.js
npm run prepare:base -- 0x807061DF657A7697c04045dA7d16D941861cAABc
```

Export uses a finalized block for every entry and captures all source event logs.
The snapshot preserves IDs, amounts, types, statuses, strings and timestamps.
The constructor commits to an ordered rolling ABI hash and source block/hash.
Import is atomic and verifies the entire commitment; a bad import reverts rather
than leaving an unrecoverable partial migration. Imported entries cannot be
modified, settled, or automatically paid. Original revision logs remain in the
OP archive/explorer, not fabricated Base events. Import does not bridge funds.

Preparation and activation both check that the latest finalized OP entry contents
still match the snapshot. If the old records changed, do not deploy stale data:
export and regenerate the deployment plan. If already deployed, do not activate
it with a changed export; prepare a replacement with the correct commitment.

## Sign the deployment and migration

### Local private-key deployment

A git-ignored `.env` file is provided with an empty
`BASE_DEPLOYER_PRIVATE_KEY`. Populate it in your local editor only. Never paste
the key into chat, a terminal command, screenshots, or any file under `web/`.
The value must be exactly 64 hexadecimal characters, with or without a leading
`0x`. Both common wallet-export formats are accepted; seed phrases are not.
Use a hardware wallet/Safe flow instead if you do not want to expose an owner
key to this computer. This CLI requires the key to match the planned owner;
it does not support a separate deployment signer or a Safe private key.

```sh
chmod 600 .env
npm run deploy:base:check
```

The check validates Base mainnet, signer/owner, snapshot freshness, compiled
deployment plan, balance and conservative execution fee ceilings without signing
or sending anything. `BASE_DEPLOY_MAX_FEE_ETH` is an execution-fee budget, **not
a guaranteed all-in cap**: Base also charges L1 data fees. Keep an additional
gas buffer in the owner wallet. Review the check output before broadcasting:
The minimum balance check uses the current execution-fee ceiling plus the Base
GasPriceOracle L1 data-fee quote, with a 2x buffer. It does **not** require the
wallet balance to equal the configured maximum budget. Fee quotes can change;
rerun the check immediately before broadcasting.

```sh
npm run deploy:base
```

This sends three owner-signed transactions: deployment, the seven-entry history
import, then migration finalization. It does not deposit funds, approve managers,
or activate/publish the frontend. Transaction hashes and resumable signed
transactions are stored locally in the git-ignored, mode-600
`.base-deployment-state.json` before broadcast. Protect this file too; do not
delete it during retries. Re-running the same command resumes the exact existing
transactions rather than creating another contract. Reverted transactions require
manual inspection, not a fresh retry.

After deployment, follow the source verification, controlled receive/send tests
and activation steps below. Remove the private key from `.env` when finished;
file deletion does not guarantee secure erasure on SSDs or from backups.

1. Before mainnet, exercise the same receive/send and import flows on a test
   deployment. Review the source and consider independent contract review before
   accepting significant funds. Local tests are not an audit or proof of key control.
2. In a trusted wallet/Remix/Safe deployment process, select **Base mainnet**.
   Deploy the exact compiled creation bytecode with the constructor arguments in
   the unsigned plan. The chosen owner may differ from the deployment signer.
   Gas estimates and the deployment fee must be reviewed at signing time.
3. Verify the source on BaseScan using the artifact's standard-JSON input and
   exact compiler/settings. Do not use a differently compiled contract.
4. From the **owner** wallet, call `importHistory` with all snapshot entries using
   the plan's calldata. Then call `finalizeMigration`. Empty snapshots only require
   finalization. The actual current seven-entry import is tested below 5 million
   gas. Larger future snapshots require review; the exporter caps at 200 entries.
5. Verify `owner`, `sourceLedger`, `sourceBlock`, `sourceBlockHash`,
   `historicalEntries`, `importedEntries`, `historyHash`, `importedHash`,
   `migrationFinalized`, and every `getEntry`. The import should not change
   treasury balances.
6. Approve only intended manager wallets with `setManager(manager, true)`.
   Retain owner recovery access; test manager revocation as well.
7. Using tiny controlled amounts, deposit and pay out ETH and each intended Base
   token. Verify recipient balance changes and transaction receipts, including
   recovery of a direct ERC-20 transfer. Do not test on the old OP contract.

## Activate the frontend

### Controlled ETH round-trip test

For the deployed treasury `0x757B1F856f2Faea5a661820f9da56af032B1F9a1`:

```sh
npm run smoke:base:check
npm run smoke:base
```

The first command is read-only. The second deposits **0.000001 ETH** and pays
exactly that amount back to the owner using two real Base transactions. Gas is
spent and not returned. The script verifies deployed code, ownership and history,
receipt events, the restored treasury balance, and the owner's balance delta
after execution/data fees. Avoid other owner/treasury transactions while it runs.

It persists signed transactions before broadcasting in the git-ignored,
mode-600 `.base-smoke-state.json`. If interrupted, run the same command again;
do not delete the state or make another deposit. This checks ETH only, not
ERC-20 transfer behavior, explorer source verification, or public activation.
Test the specific Base tokens you intend to accept separately.

### Native Base USDC round-trip test

```sh
npm run smoke:base:usdc:check
npm run smoke:base:usdc
```

Uses Circle's [native Base USDC](https://developers.circle.com/stablecoins/usdc-contract-addresses),
`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, with six decimals; not bridged
USDbC or testnet USDC. The owner needs **0.01 USDC on Base** and ETH for gas.
The check does not sign or broadcast. Deposit gas cannot be simulated before
allowance exists; it is estimated again after approval, before sending a deposit.

The broadcast command signs three real transactions: approve exactly 0.01 USDC,
deposit it into the treasury, and pay it back to the owner. It validates treasury
events and the token's Transfer events, restores owner/treasury token balances,
and verifies the spent allowance is zero. An existing nonzero allowance blocks
a fresh test; revoke it in your wallet first. If interrupted after approval,
the allowance remains until the deposit consumes it or you revoke it.

Resume using the same command and preserve `.base-usdc-smoke-state.json`. This
state is separate from the ETH test so completed ETH tests are not replayed.
Avoid concurrent owner/treasury/token activity. A passed USDC test does not
guarantee that other tokens or future frozen USDC balances can be transferred.

After Base finalization and migration, run:

```sh
node scripts/activate-base.js 0xYOUR_DEPLOYED_BASE_CONTRACT
```

This is read-only on chain. It verifies Base mainnet, exact runtime (normalizing
only compiler-declared immutable slots), planned owner, snapshot provenance,
completed import and all imported entry contents. It locates the deployment
block and only then updates `web/base-deployment.json` with `ready: true`.
It also records the deployed Base address in `web/deployment-metadata.json`.
If it fails, no address is activated. Wait for chain finalization if necessary.

Publish the frontend files through the existing GitHub Pages process only after
checking the activation diff. The new `web/treasury.html` shows the Base treasury,
manager/owner controls, actual per-asset balances, money movement events and
historical/new USD entries. The main project page retains the roadmap, USD summary and labor workflow but
uses the activated Base contract. Imported rows are read-only, original revision
links still point to OP, and new labor records use a separate local storage
namespace to avoid reusing legacy ledger IDs.

Token amounts use the token's decimals, never whole-USD accounting amounts.
Payouts are explicit transactions, not automatic consequences of accounting
status changes. The old labor MVP remains an external-payment recording workflow;
it does not automatically pay shifts through the new treasury or deduplicate
manager payments. Operators must reconcile each payment and its transaction proof.

Direct ERC-20 transfers may not emit treasury events, but are included in the
selected token balance and can be paid out if the token permits transfers.
If an event query or asset metadata query fails, the frontend surfaces an error
rather than inventing balances or confirming a payment.

Decent Canopy's project treasury metadata uses the verified Base address and
deployment status. Its Optimism entry remains historical provenance, never a
receiving address.

## Replacement treasury V2 (active)

`ProjectTreasuryV2` at `0xf75d1688D01fE29235B3bde450B615e4f3d2254A` (block `52513179`, Sourcify exact match) adds
on-chain unique payroll references and the greenhouse storefront escrow. It
replaced the V1 treasury above by importing V1's finalized history; it does not
upgrade V1. V1 is **retired**: the site no longer reads or pays from it, and it
must not receive funds. Activation (`npm run activate:v2 -- <address>`) is
read-only and refuses to switch unless V1 is unchanged and empty, V2's runtime,
owner, predecessor and imported history match, and finalized ETH and USDC smoke
round trips exist on V2. See
[storefront.md](storefront.md#cutover-tooling-prepared-nothing-sent) for the
export, plan, dry-run, deploy, and smoke commands. The V1 smoke script accepts
`--v2 <address>`, which uses separate state files:
`.base-v2-smoke-state.json` and `.base-v2-usdc-smoke-state.json`.
