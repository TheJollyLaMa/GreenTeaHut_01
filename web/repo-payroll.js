(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GreenTeaRepoPayroll = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  async function scanPayments({ provider, config, core, ethers }) {
    const iface = new ethers.Interface(core.PAYMENT_ABI);
    const latest = await provider.getBlockNumber();
    const payments = new Map();
    for (let from = config.deploymentBlock; from <= latest; from += 9000) {
      const logs = await provider.getLogs({
        address: config.treasuryAddress,
        topics: [iface.getEvent('FundsPaid').topicHash, null, ethers.zeroPadValue(core.USDC, 32)],
        fromBlock: from,
        toBlock: Math.min(from + 8999, latest),
      });
      for (const log of logs) {
        const event = iface.parseLog(log);
        const reference = event.args.referenceURI;
        if (!reference.startsWith('repo-payroll:')) continue;
        if (payments.has(reference)) throw new Error(`Duplicate on-chain payroll reference: ${reference}. Review payments before continuing.`);
        payments.set(reference, { ...log, args: event.args });
      }
    }
    return payments;
  }

  async function sendPayment({ entry, config, core, ethers, reader, wallet, deploymentReady,
    checkUnpaid, confirm, recordSubmission }) {
    if (!deploymentReady()) throw new Error('Base deployment verification must complete before payment');
    core.validateConfig(config);
    if (Number(BigInt(await reader.send('eth_chainId', []))) !== 8453 ||
        Number((await wallet.getNetwork()).chainId) !== 8453) throw new Error('Switch your wallet to Base mainnet (8453)');
    const signer = await wallet.getSigner();
    const address = await signer.getAddress();
    const treasury = new ethers.Contract(config.treasuryAddress, core.PAYMENT_ABI, signer);
    const [owner, manager] = await Promise.all([treasury.owner(), treasury.managers(address)]);
    if (address.toLowerCase() !== owner.toLowerCase() && !manager) throw new Error('Only the owner or an approved treasury manager can pay');
    const token = new ethers.Contract(core.USDC, core.TOKEN_ABI, reader);
    const call = core.payrollCall(entry);
    const work = core.workReference(entry, ethers);
    const [decimals, available] = await Promise.all([token.decimals(), treasury.availableUSDC()]);
    if (Number(decimals) !== 6) throw new Error('Native Base USDC decimals verification failed');
    // Store escrow is reserved for buyers; payroll may only spend the unreserved USDC.
    if (available < call.amount) throw new Error('Project treasury has insufficient unreserved USDC. Fund it first.');
    const unpaidOnChain = async () => {
      await checkUnpaid();
      if (await treasury.paidPayrollReferences(work)) throw new Error('The treasury already recorded this payroll reference as paid. Do not resend.');
    };
    await unpaidOnChain();
    const args = [call.issueId, call.contributorGithub, call.role, call.recipient, call.amount];
    await treasury.payPayroll.staticCall(...args);
    if (!confirm(`Send ${entry.amount} USDC on Base from the project treasury to ${entry.contributor} (@${entry.contributorGithub}) for ${entry.issueRef}, role ${entry.role || 'contributor'}? The treasury records this work reference once and rejects duplicates. This is a real, irreversible token transfer.`)) return null;
    // Recheck after the review dialog; another client may have paid while it was open.
    await unpaidOnChain();
    if (Number((await wallet.getNetwork()).chainId) !== 8453) throw new Error('Wallet network changed; switch back to Base before payment');
    const tx = await treasury.payPayroll(...args);
    recordSubmission(tx.hash);
    const receipt = await tx.wait();
    return core.verifyReceipt({ entry, config, receipt, ethers });
  }

  function mount({ deploymentReady, connectWallet }) {
    const core = window.GreenTeaPayroll;
    const ethers = window.ethers;
    const body = document.getElementById('repo-payroll-body');
    const accountBody = document.getElementById('repo-payroll-accounts');
    const status = document.getElementById('repo-payroll-status');
    const balance = document.getElementById('repo-payroll-balance');
    const refreshButton = document.getElementById('repo-payroll-refresh');
    let busy = false;
    let snapshot = null;
    let authorized = false;
    const submissions = new Map();
    const reader = new ethers.JsonRpcProvider('https://base-rpc.publicnode.com', 8453, { staticNetwork: true });
    const storageKey = entry => `gth-repo-payroll:${core.entryKey(entry)}`;
    const message = (text, error = false) => {
      status.textContent = text;
      status.classList.toggle('error', error);
    };
    function cell(row, text) {
      const td = document.createElement('td');
      td.textContent = text;
      row.appendChild(td);
      return td;
    }
    function link(parent, text, href) {
      const a = document.createElement('a');
      a.textContent = text;
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      parent.appendChild(a);
    }
    function submittedHash(entry) {
      const hash = submissions.get(core.entryKey(entry)) || window.localStorage.getItem(storageKey(entry));
      if (hash && !/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('Invalid saved payroll transaction; review browser storage before payment');
      return hash;
    }
    async function load() {
      const names = ['payroll-queue.json', 'contributor-accounts.json', 'payroll-assets.json'];
      const data = await Promise.all(names.map(async name => {
        const response = await window.fetch(`../${name}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Unable to load ${name}`);
        return response.json();
      }));
      core.validateData(...data);
      const [queue, accounts, config] = data;
      if (Number(BigInt(await reader.send('eth_chainId', []))) !== 8453) throw new Error('Payroll RPC is not on Base');
      const token = new ethers.Contract(core.USDC, core.TOKEN_ABI, reader);
      const treasury = new ethers.Contract(config.treasuryAddress, core.PAYMENT_ABI, reader);
      const [units, decimals, payments] = await Promise.all([
        treasury.availableUSDC(), token.decimals(),
        scanPayments({ provider: reader, config, core, ethers }),
      ]);
      if (Number(decimals) !== 6) throw new Error('USDC decimals verification failed');
      for (const entry of [...queue.pending, ...queue.settled]) {
        if (!entry.txHash) {
          const hash = submittedHash(entry);
          if (hash) submissions.set(core.entryKey(entry), hash);
        }
        const payment = payments.get(core.paymentReference(entry));
        if (payment && (payment.args.recipient.toLowerCase() !== entry.contributor.toLowerCase() ||
            payment.args.amount !== core.amountUnits(entry.amount))) {
          throw new Error(`Existing payment does not match queue amount or wallet: ${core.entryKey(entry)}`);
        }
        if (entry.txHash && payment?.transactionHash.toLowerCase() !== entry.txHash.toLowerCase()) {
          throw new Error(`Settled payout is missing from chain history: ${core.entryKey(entry)}`);
        }
      }
      return { queue, accounts, config, units, payments };
    }
    async function updateAccess() {
      authorized = false;
      if (!window.ethereum || !deploymentReady()) return;
      const [chain, accounts] = await Promise.all([
        window.ethereum.request({ method: 'eth_chainId' }),
        window.ethereum.request({ method: 'eth_accounts' }),
      ]);
      if (Number(BigInt(chain)) !== 8453 || !accounts[0]) return;
      const treasury = new ethers.Contract(core.TREASURY, core.PAYMENT_ABI, reader);
      const [owner, manager] = await Promise.all([treasury.owner(), treasury.managers(accounts[0])]);
      authorized = owner.toLowerCase() === accounts[0].toLowerCase() || manager;
    }
    function render() {
      body.replaceChildren();
      accountBody.replaceChildren();
      if (!snapshot) return;
      const { queue, accounts, units, payments } = snapshot;
      balance.textContent = `Project treasury: ${core.formatUnits(units)} USDC available on Base (store escrow excluded). Pending repo rewards: ${core.formatUnits(queue.pending.reduce((total, entry) => total + core.amountUnits(entry.amount), 0n))} USDC.`;
      for (const account of accounts.contributors) {
        const row = document.createElement('tr');
        cell(row, account.github);
        cell(row, account.usdcPending);
        cell(row, account.usdcEarned);
        accountBody.appendChild(row);
      }
      for (const entry of [...queue.pending, ...queue.settled]) {
        const row = document.createElement('tr');
        cell(row, `${entry.contributorGithub} / ${entry.contributor}`);
        const work = cell(row, '');
        link(work, entry.issueRef, `https://github.com/${entry.issueRef.replace('#', '/issues/')}`);
        work.appendChild(document.createTextNode(` / ${entry.role || 'contributor'}`));
        cell(row, entry.amount);
        const action = cell(row, '');
        const payment = payments.get(core.paymentReference(entry));
        const hash = entry.txHash || payment?.transactionHash || submissions.get(core.entryKey(entry));
        if (hash) {
          action.appendChild(document.createTextNode(entry.txHash ? 'Settled: ' : payment ? 'Paid; GitHub settlement pending: ' : 'Submitted; do not resend: '));
          link(action, hash, `https://basescan.org/tx/${hash}`);
        } else {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'entry-submit';
          button.textContent = 'Pay USDC from treasury';
          button.disabled = busy || !authorized || units < core.amountUnits(entry.amount) || !navigator.locks;
          button.addEventListener('click', () => pay(core.entryKey(entry)));
          action.appendChild(button);
        }
        body.appendChild(row);
      }
      if (!queue.pending.length && !queue.settled.length) {
        const row = document.createElement('tr');
        cell(row, 'No repo development rewards queued yet.').colSpan = 4;
        body.appendChild(row);
      }
    }
    async function refresh() {
      if (busy) return;
      busy = true;
      refreshButton.disabled = true;
      render();
      try {
        snapshot = await load();
        await updateAccess();
        // A reverted submitted transaction is safe to retry; unmined ones remain blocked.
        for (const entry of snapshot.queue.pending) {
          const hash = submittedHash(entry);
          if (!hash || snapshot.payments.has(core.paymentReference(entry))) continue;
          const receipt = await reader.getTransactionReceipt(hash);
          if (receipt?.status === 0) {
            window.localStorage.removeItem(storageKey(entry));
            submissions.delete(core.entryKey(entry));
            throw new Error(`Payroll transaction reverted: ${hash}. Review it before retrying.`);
          }
        }
        message(authorized ? 'Treasury payment access verified. Review rewards before signing.' : 'Read-only payroll. Connect an authorized wallet on Base to pay.');
      } catch (error) {
        snapshot = null;
        authorized = false;
        balance.textContent = 'USDC treasury balance unavailable.';
        message(`Repo payroll unavailable: ${error.message}`, true);
      } finally {
        busy = false;
        refreshButton.disabled = false;
        render();
      }
    }
    async function pay(key) {
      if (busy) return;
      busy = true;
      refreshButton.disabled = true;
      render();
      try {
        if (!navigator.locks) throw new Error('This browser does not support safe cross-tab payment locking');
        await navigator.locks.request('gth-repo-payroll-payment', { ifAvailable: true }, async lock => {
          if (!lock) throw new Error('Another browser tab is processing payroll; wait for it to finish');
          snapshot = await load();
          const entry = snapshot.queue.pending.find(item => core.entryKey(item) === key);
          if (!entry) throw new Error('Reward is no longer pending; refresh the queue');
          const checkUnpaid = async () => {
            const payments = await scanPayments({ provider: reader, config: snapshot.config, core, ethers });
            if (payments.has(core.paymentReference(entry)) || submittedHash(entry)) throw new Error('This reward already has a paid or submitted transaction. Settle or review it; do not resend.');
          };
          // Verify storage is writable before asking the wallet to send.
          window.localStorage.setItem('gth-repo-payroll-storage-check', '1');
          window.localStorage.removeItem('gth-repo-payroll-storage-check');
          const proof = await sendPayment({
            entry, config: snapshot.config, core, ethers, reader,
            wallet: new ethers.BrowserProvider(window.ethereum, 8453), deploymentReady,
            checkUnpaid, confirm: text => window.confirm(text),
            recordSubmission: hash => {
              submissions.set(key, hash);
              message(`Submitted ${hash}. Do not resend; waiting for confirmation.`);
              window.localStorage.setItem(storageKey(entry), hash);
            },
          });
          if (proof) {
            snapshot.payments.set(core.paymentReference(entry), { transactionHash: proof.txHash });
            snapshot.units -= core.amountUnits(entry.amount);
            message(`Paid ${entry.amount} USDC. Run Settle Payroll after Base finalization with contributor ${entry.contributorGithub}, issue ${entry.issueRef}, role ${entry.role || 'contributor'}, tx ${proof.txHash}.`);
          } else message('Payment cancelled; no funds sent.');
        });
      } catch (error) {
        message(`Payroll payment stopped: ${error.shortMessage || error.message}. Any submitted hash remains blocked from resend.`, true);
      } finally {
        busy = false;
        refreshButton.disabled = false;
        render();
      }
    }
    refreshButton.addEventListener('click', refresh);
    document.getElementById('repo-payroll-connect').addEventListener('click', async () => {
      try { await connectWallet(); await refresh(); } catch (error) { message(error.message, true); }
    });
    if (window.ethereum?.on) {
      window.ethereum.on('accountsChanged', refresh);
      window.ethereum.on('chainChanged', refresh);
    }
    return { refresh };
  }
  return { scanPayments, sendPayment, mount };
}));
