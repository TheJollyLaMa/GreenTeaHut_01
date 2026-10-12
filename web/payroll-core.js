(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GreenTeaPayroll = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const REPOSITORY = 'TheJollyLaMa/GreenTeaHut_01';
  const TREASURY = '0x757B1F856f2Faea5a661820f9da56af032B1F9a1';
  const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const ROLES = new Set(['contributor', 'implementer', 'idea-originator', 'tester']);
  const PAYMENT_ABI = [
    'event FundsPaid(uint256 indexed transferId,address indexed asset,address indexed recipient,address authorizedBy,uint256 amount,string referenceURI)',
    'function payToken(address asset,address recipient,uint256 amount,string referenceURI)',
    'function owner() view returns (address)',
    'function managers(address) view returns (bool)',
  ];
  const TOKEN_ABI = [
    'event Transfer(address indexed from,address indexed to,uint256 value)',
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
  ];

  function amountUnits(value, allowZero = false) {
    if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) {
      throw new Error('USDC amounts must be decimal strings with at most six decimal places');
    }
    const [whole, fraction = ''] = value.split('.');
    const units = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
    if ((!allowZero && units === 0n) || units >= 2n ** 256n) throw new Error('Invalid USDC amount');
    return units;
  }

  function formatUnits(units) {
    if (units < 0n) throw new Error('USDC balance cannot be negative');
    const fraction = (units % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
    return `${units / 1000000n}${fraction ? `.${fraction}` : ''}`;
  }

  function validAddress(value) {
    return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value) &&
      !/^0x0{40}$/i.test(value) && value.toLowerCase() !== TREASURY.toLowerCase();
  }

  function validateConfig(config) {
    if (config?.chainId !== 8453 || config.repository !== REPOSITORY ||
        config.treasuryAddress?.toLowerCase() !== TREASURY.toLowerCase() ||
        config.assets?.USDC?.address?.toLowerCase() !== USDC.toLowerCase() ||
        config.assets.USDC.decimals !== 6 || Object.keys(config.assets).length !== 1 ||
        config.deploymentBlock !== 52508544 || !/^https:\/\//.test(config.rpcUrl)) {
      throw new Error('Payroll must use the activated Green Tea Hut treasury and native Base USDC');
    }
  }

  function entryKey(entry) {
    if (!new RegExp(`^${REPOSITORY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}#[1-9]\\d*$`).test(entry.issueRef) ||
        !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(entry.contributorGithub || '') ||
        !ROLES.has(entry.role || 'contributor') || entry.currency !== 'USDC') {
      throw new Error('Invalid repository, contributor, role, or payroll currency');
    }
    return `${entry.issueRef}:${entry.contributorGithub.toLowerCase()}:${entry.role || 'contributor'}:USDC`;
  }

  function paymentReference(entry) {
    return `repo-payroll:${entryKey(entry)}`;
  }

  function validateData(queue, accounts, config) {
    validateConfig(config);
    if (!Array.isArray(queue?.pending) || !Array.isArray(queue?.settled) ||
        !Array.isArray(accounts?.contributors)) throw new Error('Invalid payroll queue or contributor registry');
    const registered = new Map();
    for (const account of accounts.contributors) {
      if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(account.github || '') || !validAddress(account.walletAddress)) {
        throw new Error('Contributor needs a GitHub username and nonzero recipient wallet');
      }
      const key = account.github.toLowerCase();
      if (registered.has(key)) throw new Error(`Duplicate contributor: ${account.github}`);
      amountUnits(account.usdcPending, true);
      amountUnits(account.usdcEarned, true);
      registered.set(key, account);
    }
    const seen = new Set();
    const proofs = new Set();
    const totals = new Map();
    for (const section of ['pending', 'settled']) {
      for (const entry of queue[section]) {
        const key = entryKey(entry);
        if (seen.has(key)) throw new Error(`Duplicate payroll entry: ${key}`);
        seen.add(key);
        const account = registered.get(entry.contributorGithub.toLowerCase());
        if (!account || !validAddress(entry.contributor) ||
            entry.contributor.toLowerCase() !== account.walletAddress.toLowerCase()) {
          throw new Error(`Payroll recipient does not match registered wallet: ${key}`);
        }
        const units = amountUnits(entry.amount);
        if (!entry.queuedBy || !Number.isFinite(Date.parse(entry.queuedAt))) throw new Error(`Missing queue audit fields: ${key}`);
        if (section === 'settled') {
          if (!entry.settledBy || !Number.isFinite(Date.parse(entry.settledAt)) ||
              !/^0x[0-9a-f]{64}$/i.test(entry.txHash || '') ||
              !Number.isSafeInteger(entry.paymentLogIndex) || entry.paymentLogIndex < 0) {
            throw new Error(`Missing verified settlement proof: ${key}`);
          }
          const proof = `${entry.txHash.toLowerCase()}:${entry.paymentLogIndex}`;
          if (proofs.has(proof)) throw new Error('A payment proof cannot settle multiple entries');
          proofs.add(proof);
        }
        const totalKey = `${account.github.toLowerCase()}:${section}`;
        totals.set(totalKey, (totals.get(totalKey) || 0n) + units);
      }
    }
    for (const [key, account] of registered) {
      if (amountUnits(account.usdcPending, true) !== (totals.get(`${key}:pending`) || 0n) ||
          amountUnits(account.usdcEarned, true) !== (totals.get(`${key}:settled`) || 0n)) {
        throw new Error(`USDC account totals do not reconcile with queue: ${account.github}`);
      }
    }
  }

  function verifyReceipt({ entry, config, receipt, ethers }) {
    validateConfig(config);
    const reference = paymentReference(entry);
    const amount = amountUnits(entry.amount);
    if (!receipt || receipt.status !== 1 || receipt.to?.toLowerCase() !== TREASURY.toLowerCase()) {
      throw new Error('Payment must be a successful transaction to the project treasury');
    }
    const payment = new ethers.Interface(PAYMENT_ABI);
    const token = new ethers.Interface(TOKEN_ABI);
    const paidTopic = payment.getEvent('FundsPaid').topicHash;
    const transferTopic = token.getEvent('Transfer').topicHash;
    const paid = receipt.logs.filter(log => log.address.toLowerCase() === TREASURY.toLowerCase() &&
      log.topics[0] === paidTopic).filter(log => {
      const { args } = payment.parseLog(log);
      return args.asset.toLowerCase() === USDC.toLowerCase() &&
        args.recipient.toLowerCase() === entry.contributor.toLowerCase() &&
        args.amount === amount && args.referenceURI === reference;
    });
    const transferred = receipt.logs.filter(log => log.address.toLowerCase() === USDC.toLowerCase() &&
      log.topics[0] === transferTopic).filter(log => {
      const { args } = token.parseLog(log);
      return args.from.toLowerCase() === TREASURY.toLowerCase() &&
        args.to.toLowerCase() === entry.contributor.toLowerCase() && args.value === amount;
    });
    if (paid.length !== 1 || transferred.length !== 1) throw new Error('No exact treasury USDC payout and token transfer proof');
    const paymentLogIndex = paid[0].index ?? paid[0].logIndex;
    if (!Number.isSafeInteger(paymentLogIndex) || paymentLogIndex < 0) throw new Error('Payment log index missing');
    return { txHash: receipt.hash, paymentLogIndex, paymentBlock: receipt.blockNumber };
  }

  async function verifyPayment({ entry, config, txHash, provider, ethers }) {
    if (!/^0x[0-9a-f]{64}$/i.test(txHash || '')) throw new Error('A confirmed transaction hash is required');
    if (Number(BigInt(await provider.send('eth_chainId', []))) !== 8453) throw new Error('Payment proof must be on Base');
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt && receipt.hash?.toLowerCase() !== txHash.toLowerCase()) throw new Error('Payment receipt hash does not match requested transaction');
    const proof = verifyReceipt({ entry, config, receipt, ethers });
    const [finalized, block] = await Promise.all([
      provider.getBlock('finalized'), provider.getBlock(receipt.blockNumber),
    ]);
    if (!finalized || receipt.blockNumber > finalized.number) throw new Error('Payment is not finalized on Base yet; retry settlement later');
    if (block?.hash !== receipt.blockHash) throw new Error('Payment is not on the canonical Base chain');
    return proof;
  }

  return { REPOSITORY, TREASURY, USDC, ROLES, PAYMENT_ABI, TOKEN_ABI, amountUnits, formatUnits,
    validAddress, validateConfig, entryKey, paymentReference, validateData, verifyReceipt, verifyPayment };
}));
