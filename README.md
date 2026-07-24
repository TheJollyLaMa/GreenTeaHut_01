# ⚸ 🍵 🫖🦧 🛖 🦚📜🧞‍♂️
## Green Tea Hut #1 — Public Accountability Ledger
The Green Tea Party's first project, Green tea Hut #1. 

Project funding and spending are tracked alongside milestone progress and displayed publicly for donors, sponsors, and fans to follow along with where their energy and attention is going.

### 🌐 Live Frontend
**[https://thejollylama.github.io/GreenTeaHut_01/web/](https://thejollylama.github.io/GreenTeaHut_01/web/)**

- Campaign page: https://artizen.fund/index/p/green-tea-hut-1?season=7
- Public ledger (GitHub Pages): https://thejollylama.github.io/GreenTeaHut_01/web/

### Goals
1. Transparent accounting
2. Traceable spending by milestone
3. Public proof links (receipts/photos/docs)
4. Ongoing monthly updates

### Settlement flow
- New ledger entries begin as `PENDING`.
- Entries move to `CONFIRMED` once a proof/reference URL is available.
- Contract logic for the pending → confirmed flow lives in `contracts/ProjectLedger.sol`.
