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
- **Address:** `0x942CcE8384a9d9bd2842365395d7a912e1a5322c`
- **Network:** Sepolia (Chain ID `11155111`)
- **Explorer:** https://sepolia.etherscan.io/address/0x942CcE8384a9d9bd2842365395d7a912e1a5322c

### Run frontend with the live contract
1. Open the live frontend link above (or serve `/web` locally with any static file server).
2. Use MetaMask on **Sepolia** to avoid wrong-network errors.
3. Admin writes are enabled for the deployed contract owner wallet and this allowlisted admin wallet:
   - `0x807061DF657A7697c04045dA7d16D941861cAABc`
4. Use **Add Entry to the Books** to create a `PENDING` on-chain entry.
5. Use **Confirm/Settle** in the ledger table with a proof URL to settle entries.

### Goals
1. Transparent accounting
2. Traceable spending by milestone
3. Public proof links (receipts/photos/docs)
4. Ongoing monthly updates

### Settlement flow
- New ledger entries begin on-chain as `PENDING`.
- Entries move to `SETTLED` once a proof/reference URL is available.
- On-chain contract logic uses `CONFIRMED` as its settled status (displayed in the frontend as `SETTLED`). See `contracts/ProjectLedger.sol`.
