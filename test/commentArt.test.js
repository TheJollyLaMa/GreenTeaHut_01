const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ARTWORKS,
  PROJECT_LOGO_URL,
  artworkIndex,
  renderPayrollComment,
  renderArtworkTable,
  selectArtwork,
} = require('../scripts/commentArt');
const { buildMergedPayrollComment } = require('../scripts/processMergedBounty');
const { buildTestingComment } = require('../scripts/processTestingBounty');
const { buildSettlementComment } = require('../scripts/settlePayroll');

test('contains 25 unique visible 10x10 branded scenes', () => {
  assert.equal(ARTWORKS.length, 25);
  assert.equal(new Set(ARTWORKS.map(artwork => artwork.name)).size, 25);
  assert.equal(new Set(ARTWORKS.map(artwork => JSON.stringify(artwork.rows))).size, 25);
  for (const artwork of ARTWORKS) {
    assert.equal(artwork.rows.length, 10);
    for (const row of artwork.rows) assert.equal(row.length, 10);
    assert.ok(artwork.rows.flat().includes('🟢'));
    assert.ok(artwork.rows.flat().includes('💠'));
  }
});

test('selection is deterministic and rotates through all scenes', () => {
  assert.equal(selectArtwork(30, 'merged-payroll'), selectArtwork(30, 'merged-payroll'));
  const selected = new Set();
  for (let issueNumber = 1; issueNumber <= 100; issueNumber += 1) {
    selected.add(artworkIndex(issueNumber, `event-${issueNumber % 4}`));
  }
  assert.equal(selected.size, 25);
});

test('renders the project logo and Base USDC cells without external partner branding', () => {
  const rendered = renderPayrollComment('✅ Queued 25 USDC.', 30, 'merged-payroll');
  assert.match(rendered, new RegExp(PROJECT_LOGO_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(rendered, /alt="Green Tea Hut logo"/);
  assert.match(rendered, /title="Base USDC"/);
  assert.doesNotMatch(rendered, /ArtFi|Artizen|25 ART/);
  assert.doesNotMatch(rendered, /<details>|<summary>|```/);
  const table = renderArtworkTable(selectArtwork(30, 'merged-payroll'));
  assert.equal((table.match(/<tr>/g) || []).length, 10);
  assert.equal((table.match(/<td /g) || []).length, 100);
});

test('production comments retain their message and visible branded art', () => {
  const comments = [
    buildMergedPayrollComment({
      entries: [{ amount: '20', contributorGithub: 'builder', role: 'implementer' }],
      isManual: false,
      prNumber: 32,
      issueNumber: 30,
    }),
    buildTestingComment('✅ Testing payout queued.', 30, 'test-approved'),
    buildSettlementComment({ settledCount: 2, actor: 'TheJollyLaMa', txHash: '0x123', issueNumber: 30 }),
  ];

  assert.match(comments[0], /Payroll queued from merged PR #32/);
  assert.match(comments[1], /Testing payout queued/);
  assert.match(comments[2], /Settled 2 USDC payroll entries/);
  for (const comment of comments) {
    assert.match(comment, /Green Tea Hut logo/);
    assert.match(comment, /Base USDC/);
    assert.doesNotMatch(comment, /<details>|<summary>/);
  }
});