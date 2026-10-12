const fs = require('fs');
const path = require('path');

const { renderPayrollComment } = require('./commentArt');
const { postIssueComment, repositoryCoordinates } = require('./githubApi');
const { settleEntries } = require('./payroll');
const { entryKey, validateData, verifyPayment } = require('../web/payroll-core');
const config = require('../payroll-assets.json');

const ROOT = path.resolve(__dirname, '..');
const QUEUE_PATH = path.join(ROOT, 'payroll-queue.json');
const ACCOUNTS_PATH = path.join(ROOT, 'contributor-accounts.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function buildSettlementComment({ settledCount, actor, txHash, issueNumber }) {
  const body = [
    `✅ Settled ${settledCount} USDC payroll entr${settledCount === 1 ? 'y' : 'ies'} by @${actor}.`,
    `🔗 Base payout: https://basescan.org/tx/${txHash}`,
  ].filter(Boolean).join('\n');
  return renderPayrollComment(body, issueNumber, 'settlement');
}

async function settleVerifiedPayment({ queue, accounts, contributorGithub, issueRef, role, txHash,
  provider, ethers, settledAt, settledBy }) {
  validateData(queue, accounts, config);
  const key = entryKey({ contributorGithub, issueRef, role, currency: 'USDC' });
  const selected = queue.pending.filter(entry => entryKey(entry) === key);
  if (selected.length !== 1) throw new Error('Exactly one pending payroll entry must match contributor, issue, and role');
  const entry = selected[0];
  const proof = await verifyPayment({ entry, config, txHash, provider, ethers });
  const settled = settleEntries({ queue, accounts, entry, proof, settledAt, settledBy });
  validateData(queue, accounts, config);
  return settled;
}

async function main() {
  const { owner, repo } = repositoryCoordinates();
  const contributorGithub = String(process.env.INPUT_CONTRIBUTOR_GITHUB || '').trim();
  const issueRef = String(process.env.INPUT_ISSUE_REF || '').trim();
  const txHash = String(process.env.INPUT_TX_HASH || '').trim();
  const role = String(process.env.INPUT_ROLE || '').trim();
  if (!contributorGithub || !issueRef || !role || !txHash) throw new Error('Contributor, issue, role and confirmed Base payout hash are required');
  const queue = readJson(QUEUE_PATH);
  const accounts = readJson(ACCOUNTS_PATH);
  const ethers = require('ethers');
  const provider = new ethers.JsonRpcProvider(config.rpcUrl, 8453, { staticNetwork: true });
  const settled = await settleVerifiedPayment({
    queue,
    accounts,
    contributorGithub,
    issueRef,
    role,
    txHash,
    provider,
    ethers,
    settledAt: new Date().toISOString(),
    settledBy: process.env.GITHUB_ACTOR || 'github-actions[bot]',
  });

  writeJson(QUEUE_PATH, queue);
  writeJson(ACCOUNTS_PATH, accounts);

  const issueMatch = issueRef.match(/#(\d+)$/);
  if (issueMatch) {
    const issueNumber = Number(issueMatch[1]);
    await postIssueComment(owner, repo, issueNumber, buildSettlementComment({
      settledCount: settled.length,
      actor: process.env.GITHUB_ACTOR,
      txHash,
      issueNumber,
    }));
  }
  console.log(`Settled ${settled.length} payroll entries.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { buildSettlementComment, settleVerifiedPayment };