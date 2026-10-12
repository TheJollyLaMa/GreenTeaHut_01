'use strict';

const $ = (id) => document.getElementById(id);
const TOKEN_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];
const ENTRY_STATES = ['PENDING', 'CONFIRMED', 'REQUESTED', 'COMMITTED', 'CANCELED'];
let config;
let abi;
let snapshot;
let reader;
let ledger;
let account = '';
let canPay = false;
let isOwner = false;
let busy = false;
let verified = false;

function status(message, error = false) {
  $('treasury-status').textContent = message;
  $('treasury-status').className = error ? 'tx-status error' : 'tx-status info';
}

function link(url, text) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.textContent = text;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  return anchor;
}

function controls() {
  $('funds-controls').disabled = !verified || !account || busy;
  $('send-funds').disabled = !canPay || busy;
  $('accounting-controls').disabled = !canPay || busy;
  $('manager-controls').disabled = !isOwner || busy;
  $('ownership-controls').disabled = !isOwner || busy;
  $('connect-treasury').disabled = !verified || busy;
  $('accept-ownership').disabled = true;
}

async function json(file) {
  const response = await fetch(file, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to load ${file}: HTTP ${response.status}`);
  return response.json();
}

async function walletContract() {
  if (!verified || !window.ethereum) throw new Error('A verified Base deployment and connected wallet are required');
  const provider = new ethers.BrowserProvider(window.ethereum);
  if (Number((await provider.getNetwork()).chainId) !== 8453) throw new Error('Switch your wallet to Base mainnet (8453)');
  const signer = await provider.getSigner();
  return new ethers.Contract(config.address, abi, signer);
}

async function updateAccess() {
  canPay = false;
  isOwner = false;
  account = '';
  controls();
  if (!verified || !window.ethereum) return;
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  const chain = await window.ethereum.request({ method: 'eth_chainId' });
  if (Number(BigInt(chain)) !== 8453) {
    $('treasury-access').textContent = 'Switch your wallet to Base mainnet (8453).';
    return;
  }
  if (!accounts.length) {
    $('treasury-access').textContent = 'Connect a wallet to deposit. Only approved managers or the owner can pay out.';
    return;
  }
  account = ethers.getAddress(accounts[0]);
  const [owner, manager, pending] = await Promise.all([ledger.owner(), ledger.managers(account), ledger.pendingOwner()]);
  isOwner = owner.toLowerCase() === account.toLowerCase();
  canPay = isOwner || manager;
  $('treasury-access').textContent = `${account}: ${isOwner ? 'owner' : manager ? 'approved manager' : 'deposits only'}`;
  controls();
  $('accept-ownership').disabled = busy || pending.toLowerCase() !== account.toLowerCase();
}

async function assetInfo(contract = ledger) {
  if ($('funds-asset').value === 'ETH') return { address: ethers.ZeroAddress, decimals: 18, token: null };
  const address = ethers.getAddress($('funds-token').value.trim());
  if (address === ethers.ZeroAddress || address.toLowerCase() === config.address.toLowerCase() ||
      await reader.getCode(address) === '0x') throw new Error('Enter a deployed ERC-20 token address on Base');
  const token = new ethers.Contract(address, TOKEN_ABI, contract.runner);
  const decimals = Number(await token.decimals());
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Unsupported token decimals (expected 0-36)');
  return { address, decimals, token };
}

async function updateBalance() {
  if (!verified) return;
  const asset = await assetInfo();
  const balance = asset.token ? await asset.token.balanceOf(config.address) : await reader.getBalance(config.address);
  $('treasury-balance').textContent = `Actual treasury balance: ${ethers.formatUnits(balance, asset.decimals)} ${asset.token ? `token (${asset.address})` : 'ETH'} on Base`;
}

async function transact(label, action) {
  if (busy) return;
  busy = true;
  controls();
  let hash;
  try {
    status(`${label}: waiting for your wallet.`);
    const transaction = await action();
    hash = transaction.hash;
    status(`${label}: submitted ${hash}; waiting for confirmation.`);
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) throw new Error('Transaction did not succeed');
    status(`${label} confirmed: ${hash}`);
  } catch (error) {
    status(error.shortMessage || error.message, true);
    return;
  } finally {
    busy = false;
    controls();
  }
  try {
    await refresh();
    status(`${label} confirmed. Explorer: ${config.explorerUrl}/tx/${hash}`);
  } catch (error) {
    status(`${label} confirmed (${hash}), but refresh failed: ${error.message}`, true);
  }
}

function cell(row, text) {
  const td = document.createElement('td');
  td.textContent = text;
  row.append(td);
  return td;
}

function actionButton(container, label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.disabled = !canPay || busy;
  button.addEventListener('click', () => action().catch((error) => status(error.message, true)));
  container.append(button);
}

function renderEntries(entries) {
  $('treasury-entries').replaceChildren();
  for (const entry of entries) {
    const row = document.createElement('tr');
    const historical = BigInt(entry.id) <= BigInt(snapshot.count);
    cell(row, `${entry.id} / ${historical ? 'OP history (read-only)' : 'Base'}`);
    cell(row, String(entry.amount));
    cell(row, `${Number(entry.entryType) === 0 ? 'INCOMING' : 'OUTGOING'} / ${ENTRY_STATES[Number(entry.status)]}`);
    cell(row, `${entry.category}: ${entry.description}\nCreated: ${new Date(Number(entry.createdAt) * 1000).toISOString()}${BigInt(entry.settledAt) ? `; confirmed: ${new Date(Number(entry.settledAt) * 1000).toISOString()}` : ''}`);
    const proof = cell(row, '');
    if (/^https?:\/\//i.test(entry.referenceURI)) proof.append(link(entry.referenceURI, 'Reference'));
    else proof.textContent = entry.referenceURI;
    const actions = cell(row, '');
    if (!historical && ![1, 4].includes(Number(entry.status))) {
      actionButton(actions, 'Record external payment proof', async () => {
        const reference = window.prompt('Completed payment proof URL (this does NOT send funds):');
        if (reference === null) return;
        if (!/^https?:\/\/\S+$/i.test(reference)) throw new Error('HTTP(S) proof URL required');
        const signer = await walletContract();
        await transact('Accounting confirmation', () => signer.confirmEntry(entry.id, reference));
      });
      if (Number(entry.status) === 2) actionButton(actions, 'Commit', async () => {
        const signer = await walletContract();
        await transact('Commit entry', () => signer.updateStatus(entry.id, 3));
      });
      actionButton(actions, 'Cancel', async () => {
        const signer = await walletContract();
        await transact('Cancel entry', () => signer.updateStatus(entry.id, 4));
      });
      actionButton(actions, 'Revise USD amount', async () => {
        const amount = window.prompt('New whole USD amount:');
        if (amount === null) return;
        if (!/^[1-9]\d*$/.test(amount)) throw new Error('Positive whole USD amount required');
        const reason = window.prompt('Reason for revision:');
        if (reason === null) return;
        if (!reason.trim()) throw new Error('Revision reason required');
        const signer = await walletContract();
        await transact('Revise entry', () => signer.updatePendingAmount(entry.id, BigInt(amount), reason.trim(), ''));
      });
    }
    if (!historical) actionButton(actions, 'Update proof', async () => {
      const reference = window.prompt('Updated HTTP(S) reference URL:', entry.referenceURI);
      if (reference === null) return;
      if (!/^https?:\/\/\S+$/i.test(reference)) throw new Error('HTTP(S) reference URL required');
      const signer = await walletContract();
      await transact('Update reference', () => signer.updateReferenceURI(entry.id, reference));
    });
    $('treasury-entries').append(row);
  }
}

async function renderTransfers() {
  const logs = await reader.getLogs({ address: config.address, fromBlock: config.deploymentBlock, toBlock: 'latest' });
  $('treasury-transfers').replaceChildren();
  for (const log of logs) {
    const event = ledger.interface.parseLog(log);
    if (!event || !['FundsReceived', 'FundsPaid'].includes(event.name)) continue;
    const received = event.name === 'FundsReceived';
    const row = document.createElement('tr');
    cell(row, received ? 'Deposit' : 'Payout');
    cell(row, event.args.asset === ethers.ZeroAddress ? 'ETH' : event.args.asset);
    cell(row, String(event.args.amount));
    cell(row, received ? event.args.sender : event.args.recipient);
    cell(row, event.args.referenceURI);
    cell(row, '').append(link(`${config.explorerUrl}/tx/${log.transactionHash}`, 'Transaction'));
    $('treasury-transfers').prepend(row);
  }
}

async function refresh() {
  if (!verified) return;
  await updateAccess();
  await updateBalance();
  const count = Number(await ledger.totalEntries());
  const entries = [];
  for (let id = 1; id <= count; id++) entries.push(await ledger.getEntry(id));
  renderEntries(entries.reverse());
  await renderTransfers();
}

$('connect-treasury').addEventListener('click', async () => {
  try {
    if (!window.ethereum) throw new Error('Install an Ethereum wallet to connect');
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] });
    await refresh();
  } catch (error) { status(error.message, true); }
});
$('refresh-treasury').addEventListener('click', () => refresh().catch((error) => status(error.message, true)));
for (const id of ['funds-asset', 'funds-token']) $(id).addEventListener('change', () => {
  $('treasury-balance').textContent = 'Loading selected asset balance...';
  updateBalance().catch((error) => {
    $('treasury-balance').textContent = 'Selected asset balance unavailable.';
    status(error.message, true);
  });
});

$('funds-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    if (busy) return;
    const paying = event.submitter?.value === 'payout';
    const signer = await walletContract();
    const asset = await assetInfo(signer);
    const input = $('funds-amount').value.trim();
    if (!/^\d+(\.\d+)?$/.test(input)) throw new Error('Enter a positive asset amount without exponent notation');
    const amount = ethers.parseUnits(input, asset.decimals);
    if (amount <= 0n) throw new Error('Amount must be positive');
    const reference = $('funds-reference').value.trim();
    if (!reference) throw new Error('Purpose / reference required');
    if (paying) {
      if (!canPay) throw new Error('Only the owner and approved managers can send funds');
      const recipient = ethers.getAddress($('funds-recipient').value.trim());
      if (recipient === ethers.ZeroAddress || recipient.toLowerCase() === config.address.toLowerCase()) throw new Error('Recipient cannot be zero or the treasury itself');
      if (!window.confirm(`Send ${input} ${asset.token ? `token ${asset.address}` : 'ETH'} on Base to ${recipient}?\nPurpose: ${reference}\nThis moves real funds and is irreversible.`)) return;
      await transact('Payout', () => asset.token
        ? signer.payToken(asset.address, recipient, amount, reference)
        : signer.payETH(recipient, amount, reference));
    } else {
      await transact('Deposit', async () => {
        if (!asset.token) return signer.depositETH(reference, { value: amount });
        const allowance = await asset.token.allowance(await signer.runner.getAddress(), config.address);
        if (allowance < amount) {
          if (allowance > 0n) {
            status('Resetting token allowance to zero. Deposit is not complete.');
            await (await asset.token.approve(config.address, 0)).wait();
          }
          status('Approve the exact token amount. A separate deposit transaction follows.');
          await (await asset.token.approve(config.address, amount)).wait();
        }
        return signer.depositToken(asset.address, amount, reference);
      });
    }
  } catch (error) { status(error.shortMessage || error.message, true); }
});

$('accounting-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const amount = $('accounting-amount').value;
    if (!/^[1-9]\d*$/.test(amount)) throw new Error('Enter a positive whole USD amount');
    const signer = await walletContract();
    const type = Number($('accounting-type').value);
    await transact('Create accounting entry', () => signer.createEntry(type, type === 0 ? 0 : 2, BigInt(amount),
      $('accounting-category').value.trim(), $('accounting-description').value.trim(), $('accounting-reference').value.trim()));
  } catch (error) { status(error.message, true); }
});
$('manager-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const manager = ethers.getAddress($('manager-address').value.trim());
    const approve = $('manager-approved').value === 'true';
    if (approve && !window.confirm(`Authorize ${manager} to spend ALL treasury funds on Base?`)) return;
    const signer = await walletContract();
    await transact('Manager update', () => signer.setManager(manager, approve));
  } catch (error) { status(error.message, true); }
});
$('ownership-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const owner = ethers.getAddress($('next-owner').value.trim());
    if (owner === ethers.ZeroAddress || owner.toLowerCase() === config.address.toLowerCase()) throw new Error('Use a controlled wallet or Safe as owner');
    if (!window.confirm(`Propose transfer of treasury ownership to ${owner}? The new owner must accept.`)) return;
    const signer = await walletContract();
    await transact('Propose ownership transfer', () => signer.transferOwnership(owner));
  } catch (error) { status(error.message, true); }
});
$('accept-ownership').addEventListener('click', async () => {
  try {
    const signer = await walletContract();
    await transact('Accept ownership', () => signer.acceptOwnership());
  } catch (error) { status(error.message, true); }
});

async function initialize() {
  controls();
  [config, abi, snapshot] = await Promise.all([json('base-deployment.json'), json('treasury-abi.json'), json('optimism-history.json')]);
  $('history-provenance').append(
    document.createTextNode(`Preserving ${snapshot.count} Optimism entries at block ${snapshot.sourceBlock}. `),
    link('optimism-history.json', 'Original entries and event archive'),
  );
  renderEntries([...snapshot.entries].reverse());
  if (!config.ready || !config.address) {
    $('deployment-status').textContent = 'NOT DEPLOYED: deposits and payouts are disabled. There is no Base funding address yet.';
    return;
  }
  if (!window.ethers) throw new Error('Unable to load ethers.js');
  if (config.chainId !== 8453 || !Number.isSafeInteger(config.deploymentBlock) || config.deploymentBlock < 0) throw new Error('Invalid Base deployment configuration');
  reader = new ethers.JsonRpcProvider(config.rpcUrl, 8453, { staticNetwork: true });
  if (Number(BigInt(await reader.send('eth_chainId', []))) !== 8453 || await reader.getCode(config.address) === '0x') throw new Error('Base chain or deployed code verification failed');
  ledger = new ethers.Contract(config.address, abi, reader);
  if (!(await ledger.migrationFinalized()) || await ledger.historyHash() !== snapshot.historyHash ||
      await ledger.importedHash() !== snapshot.historyHash ||
      Number(await ledger.historicalEntries()) !== snapshot.count ||
      Number(await ledger.sourceBlock()) !== snapshot.sourceBlock ||
      await ledger.sourceBlockHash() !== snapshot.sourceBlockHash ||
      Number(await ledger.sourceChainId()) !== 10 ||
      (await ledger.sourceLedger()).toLowerCase() !== snapshot.sourceAddress.toLowerCase()) {
    throw new Error('Base treasury history verification failed. Funding is disabled.');
  }
  verified = true;
  $('deployment-status').replaceChildren(document.createTextNode('Verified Base treasury: '), link(`${config.explorerUrl}/address/${config.address}`, config.address));
  await refresh();
  if (window.ethereum?.on) {
    for (const event of ['chainChanged', 'accountsChanged']) window.ethereum.on(event, () => {
      canPay = false;
      isOwner = false;
      account = '';
      controls();
      refresh().catch((error) => status(error.message, true));
    });
  }
}

initialize().catch((error) => {
  verified = false;
  controls();
  $('deployment-status').textContent = 'Treasury verification failed. Funding is disabled.';
  status(error.message, true);
});
