const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = require('../web/payroll-core');
const store = require('../web/storefront');
const catalog = require('../web/storefront-catalog.json');
const config = require('../web/storefront-deployment.json');
const ethers = require('ethers');
const demoConfig = { ...config, ready: false, address: null, deploymentBlock: null };

test('sample catalog contains every goods category, is explicitly not live, and supports valid owner-entered goods', () => {
  assert.equal(catalog.sample, true);
  assert.equal(config.ready, true);
  assert.equal(config.address, core.TREASURY);
  assert.equal(config.deploymentBlock, core.DEPLOYMENT_BLOCK);
  assert.deepEqual(new Set(catalog.products.map(p => p.kind)), new Set([0, 1, 2, 3]));
  for (const p of catalog.products) store.validateProduct(p, core);
  const own = store.validateProduct({ ...catalog.products[0], name: 'My greenhouse seeds', price: '0.000001', available: '100' }, core);
  assert.equal(own.name, 'My greenhouse seeds');
  assert.deepEqual(Object.keys(store.metadataFor(own)), ['schemaVersion', 'kind', 'name', 'description', 'pickup']);
});
test('rejects invalid prices, fractional stock, oversize text, invalid categories and non-public metadata URLs', () => {
  for (const patch of [{ price: '0' }, { price: '0.0000001' }, { available: '1.5' },
    { available: '-1' }, { available: '1000001' }, { kind: 4 }, { name: '' },
    { description: 'x'.repeat(1201) }, { pickup: '' }]) {
    assert.throws(() => store.validateProduct({ ...catalog.products[0], ...patch }, core));
  }
  for (const url of ['javascript:alert(1)', 'http://example.org/product.json', 'https://user:pass@example.org/file']) {
    assert.throws(() => store.validURL(url));
  }
  store.validateDeployment(config);
  store.validateDeployment(demoConfig);
  assert.throws(() => store.validateDeployment({ ...demoConfig, ready: true }), /V2 storefront/);
});
test('compact emoji toolbar switches a fourth exclusive view with editable sample goods and gated live checkout', () => {
  const html = fs.readFileSync('web/index.html', 'utf8');
  const app = fs.readFileSync('web/app.js', 'utf8');
  const css = fs.readFileSync('web/style.css', 'utf8');
  for (const emoji of ['🌻', '🌱', '🍄‍🟫', '🪻']) assert.ok(html.includes(emoji));
  for (const id of ['toolbar-storefront', 'storefront-view', 'storefront-product-form', 'storefront-metadata-url',
    'storefront-kind', 'storefront-price', 'storefront-stock', 'storefront-pickup']) assert.ok(html.includes(`id="${id}"`));
  assert.match(app, /storefrontView.hidden = view !== 'storefront'/);
  assert.match(css, /font-size: 0\.82rem/);
  assert.match(html, /Sample catalog - not for sale/);
  assert.match(html, /id="payout-clock-in-form"/);
  assert.ok(app.indexOf('const storefrontRefresh =') < app.indexOf("loadJson('base-deployment.json')"),
    'Demo initialization does not wait for live ledger RPC verification');
});

test('metadata commitment is stable across JSON formatting and catches changes in every descriptive field', () => {
  const original = store.metadataHash(catalog.products[0], ethers);
  assert.equal(store.metadataHash(JSON.parse(JSON.stringify(store.metadataFor(catalog.products[0]), null, 2)), ethers), original);
  for (const patch of [{ name: 'Different seeds' }, { description: 'Different description' },
    { pickup: 'Different location' }, { kind: 3 }]) {
    assert.notEqual(store.metadataHash({ ...catalog.products[0], ...patch }, ethers), original);
  }
});

test('checkout locks block competing tabs and fail explicitly in unsupported browsers', async () => {
  let requests = 0;
  let actions = 0;
  const locks = { request: async (key, options, callback) => {
    requests++;
    assert.equal(key, 'store-buyer');
    assert.equal(options.ifAvailable, true);
    return callback(requests === 1 ? {} : null);
  } };
  assert.equal(await store.withPurchaseLock(locks, 'store-buyer', () => { actions++; return 'paid'; }), 'paid');
  await assert.rejects(store.withPurchaseLock(locks, 'store-buyer', () => { actions++; }), /Another tab/);
  await assert.rejects(store.withPurchaseLock(undefined, 'store-buyer', () => { actions++; }), /Web Locks/);
  assert.equal(actions, 1);
});

test('saved attempts reject corrupt data; receipt proof binds the exact buyer, goods, quantity, price and reference', () => {
  const attempt = { reference: ethers.id('purchase'), quantity: '2', total: '7000000', stage: 'submitted', txHash: ethers.id('tx') };
  store.validateAttempt(attempt);
  for (const patch of [{ reference: ethers.ZeroHash }, { reference: 'bad' }, { quantity: '0' },
    { total: '-1' }, { txHash: 'bad' }, { stage: 'unknown' }]) assert.throws(() => store.validateAttempt({ ...attempt, ...patch }));
  const abi = require('../web/treasury-v2-abi.json');
  const iface = new ethers.Interface(abi);
  const buyer = '0x' + 'ab'.repeat(20);
  const address = '0x' + 'cd'.repeat(20);
  const log = { address, ...iface.encodeEventLog(iface.getEvent('OrderPlaced'), [1, buyer, 1, 2, 7000000, 1, attempt.reference, 1000]) };
  const args = { ethers, abi, address, buyer, productId: '1', attempt };
  assert.equal(store.verifyPurchaseReceipt({ status: 1, logs: [log] }, args), '1');
  for (const patch of [{ buyer: address }, { productId: '2' }, { attempt: { ...attempt, total: '1' } },
    { attempt: { ...attempt, reference: ethers.id('different') } }]) {
    assert.throws(() => store.verifyPurchaseReceipt({ status: 1, logs: [log] }, { ...args, ...patch }), /exact paid order/);
  }
  assert.throws(() => store.verifyPurchaseReceipt({ status: 0, logs: [log] }, args), /not succeeded/);
  assert.throws(() => store.verifyPurchaseReceipt({ status: 1, logs: [log, log] }, args), /exact paid order/);
});

function domFixture() {
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag;
      this.value = '';
      this.textContent = '';
      this.children = [];
      this.listeners = {};
      this.classList = { toggle() {} };
    }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren() { this.children = []; }
    addEventListener(event, listener) { this.listeners[event] = listener; }
    trigger(event) { return this.listeners[event]({ preventDefault() {} }); }
  }
  const ids = [...fs.readFileSync('web/index.html', 'utf8').matchAll(/id="(storefront-[^"]+)"/g)].map(m => m[1]);
  const nodes = Object.fromEntries(ids.map(id => [id.replace('storefront-', ''), new Element()]));
  nodes['product-form'].elements = ['edit-id', 'kind', 'name', 'description', 'pickup', 'price', 'stock', 'active', 'metadata-url', 'download', 'save'].map(id => nodes[id]);
  nodes.filter.value = 'all';
  nodes.kind.value = '0';
  nodes.active.value = 'true';
  const data = new Map();
  const errors = { storage: false, fetch: false };
  const window = {
    GreenTeaPayroll: core,
    ethers,
    localStorage: {
      getItem: key => data.get(key) || null,
      setItem: (key, value) => { if (errors.storage) throw new Error('Storage denied'); data.set(key, value); },
      removeItem: key => { if (errors.storage) throw new Error('Storage denied'); data.delete(key); },
    },
    confirm: () => true,
    fetch: async url => {
      if (errors.fetch) throw new Error('Network unavailable');
      return { ok: true, json: async () => structuredClone(url === 'storefront-deployment.json' ? demoConfig : catalog) };
    },
  };
  return { window, document: { getElementById: id => nodes[id.replace('storefront-', '')], createElement: tag => new Element(tag) }, nodes, data, errors };
}

async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('UI action did not finish');
}

test('demo editor adds, reloads, edits, hides and resets real goods without a wallet or transactions; failures disable actions', async () => {
  const f = domFixture();
  const previousWindow = global.window;
  const previousDocument = global.document;
  global.window = f.window;
  global.document = f.document;
  try {
    const panel = store.mount({ connectWallet: async () => {} });
    await panel.refresh();
    const { nodes } = f;
    assert.equal(nodes.products.children.length, 4);
    assert.equal(nodes.save.disabled, false);
    for (const card of nodes.products.children) assert.equal(card.children.at(-1).disabled, true);
    nodes.name.value = 'Our own cucumber starters';
    nodes.description.value = 'Grown by our project';
    nodes.kind.value = '1';
    nodes.price.value = '6.25';
    nodes.stock.value = '15';
    nodes.pickup.value = 'Arrange local pickup';
    nodes['product-form'].trigger('submit');
    await until(() => nodes.status.textContent.includes('Demo product saved'));
    assert.equal(nodes.products.children.length, 5);
    const saved = JSON.parse(f.data.get('gth-storefront-demo-v1'));
    const product = saved.find(p => p.name === 'Our own cucumber starters');
    assert.equal(product.price, '6.25');
    await panel.refresh();
    assert.equal(nodes.products.children.length, 5);
    nodes['edit-id'].value = product.id;
    nodes['edit-id'].trigger('change');
    assert.equal(nodes.name.value, product.name);
    nodes.active.value = 'false';
    nodes.price.value = '7';
    nodes['product-form'].trigger('submit');
    await until(() => nodes.status.textContent.includes('Demo product saved') && nodes.products.children.length === 4);
    assert.equal(JSON.parse(f.data.get('gth-storefront-demo-v1')).find(p => p.id === product.id).active, false);
    f.errors.storage = true;
    nodes['reset-demo'].trigger('click');
    assert.match(nodes.status.textContent, /Unable to reset demo: Storage denied/);
    f.errors.storage = false;
    nodes['reset-demo'].trigger('click');
    await until(() => nodes.status.textContent.includes('Demo catalog ready'));
    assert.equal(f.data.has('gth-storefront-demo-v1'), false);
    f.errors.fetch = true;
    await panel.refresh();
    assert.match(nodes.status.textContent, /Storefront unavailable/);
    assert.equal(nodes.save.disabled, true);
    assert.equal(nodes['reset-demo'].disabled, true);
    assert.equal(nodes.open.disabled, true);
    assert.equal(nodes.products.children.length, 1);
    f.errors.fetch = false;
    f.data.set('gth-storefront-demo-v1', '{broken');
    await panel.refresh();
    assert.match(nodes.status.textContent, /Storefront unavailable/);
    assert.equal(nodes.save.disabled, true);
    assert.equal(nodes['reset-demo'].disabled, false);
    nodes['reset-demo'].trigger('click');
    await until(() => nodes.status.textContent.includes('Demo catalog ready'));
    assert.equal(nodes.products.children.length, 4);
  } finally { global.window = previousWindow; global.document = previousDocument; }
});

test('live checkout verifies paid orders, permits an explicitly new repeat purchase, and blocks uncertain submissions', async () => {
  const f = domFixture();
  const buyer = '0x' + 'ab'.repeat(20);
  const address = core.TREASURY;
  const owner = '0x' + 'ef'.repeat(20);
  const abi = require('../web/treasury-v2-abi.json');
  const iface = new ethers.Interface(abi);
  const metadata = store.metadataFor(catalog.products[0]);
  const confirmations = [];
  const receipts = new Map();
  const orders = [];
  const approvals = [];
  let available = 20n;
  let allowance = 0n;
  let unreadableReceipt = false;
  let changedMetadata = false;
  const reader = {
    send: async () => '0x2105',
    getCode: async () => '0x1234',
    getBlockNumber: async () => 1,
    getBlock: async () => ({ hash: ethers.id('block') }),
    getTransactionReceipt: async hash => unreadableReceipt ? null : receipts.get(hash),
  };
  const token = {
    decimals: async () => 6n,
    balanceOf: async () => 100000000n,
    allowance: async () => allowance,
    approve: async (_, amount) => {
      approvals.push(amount);
      allowance = amount;
      return { hash: ethers.id('approval'), wait: async () => ({ status: 1 }) };
    },
  };
  const target = {
    USDC: async () => core.USDC,
    migrationFinalized: async () => true,
    sourceLedger: async () => core.PREVIOUS_TREASURY,
    storeOpen: async () => true,
    productCount: async () => 1n,
    owner: async () => owner,
    managers: async () => false,
    getProduct: async () => ({ kind: 0n, metadataURI: 'https://example.org/product.json',
      metadataHash: store.metadataHash(metadata, ethers), priceUSDC: 3500000n, available, revision: 1n, active: true }),
    filters: { OrderPlaced: () => ({}) },
    queryFilter: async () => orders.map((_, i) => ({ args: { orderId: BigInt(i + 1) } })),
    getOrder: async id => orders[Number(id) - 1],
    usedOrderReferences: async () => false,
    buy: async (productId, quantity, revision, total, reference) => {
      assert.equal(productId, '1');
      assert.equal(quantity, 1n);
      assert.equal(revision, 1n);
      assert.equal(total, 3500000n);
      available -= quantity;
      allowance -= total;
      const id = BigInt(orders.length + 1);
      const hash = ethers.id(`order-${id}`);
      const receipt = { status: 1, blockNumber: 1, blockHash: ethers.id('block'),
        logs: [{ address, ...iface.encodeEventLog(iface.getEvent('OrderPlaced'),
          [id, buyer, productId, quantity, total, revision, reference, 2000000000]) }] };
      receipts.set(hash, receipt);
      orders.push({ buyer, productId: 1n, quantity, amountUSDC: total, deadline: 2000000000n, status: 0n });
      return { hash, wait: async () => receipt };
    },
  };
  const liveConfig = { ...config, ready: true, address, deploymentBlock: core.DEPLOYMENT_BLOCK };
  f.window.ethers = {
    ...ethers,
    JsonRpcProvider: class { constructor() { return reader; } },
    BrowserProvider: class {
      async getNetwork() { return { chainId: 8453n }; }
      async getSigner() { return { getAddress: async () => buyer }; }
    },
    Contract: class { constructor(contractAddress) { return contractAddress === core.USDC ? token : target; } },
  };
  f.window.ethereum = { request: async ({ method }) => method === 'eth_chainId' ? '0x2105' : [buyer], on() {} };
  f.window.navigator = { locks: { request: async (_, __, callback) => callback({}) } };
  f.window.confirm = message => { confirmations.push(message); return true; };
  f.window.fetch = async url => ({ ok: true, json: async () =>
    url === 'storefront-deployment.json' ? liveConfig : url === 'treasury-v2-abi.json' ? abi :
      changedMetadata ? { ...metadata, name: 'Substituted goods' } : metadata });
  const previousWindow = global.window;
  const previousDocument = global.document;
  global.window = f.window;
  global.document = f.document;
  try {
    const panel = store.mount({ connectWallet: async () => {} });
    await panel.refresh();
    const buyButton = () => f.nodes.products.children[0].children.at(-1);
    assert.equal(buyButton().disabled, false);
    assert.equal(f.nodes.save.disabled, true);
    await buyButton().trigger('click');
    assert.equal(orders.length, 1);
    assert.match(f.nodes.status.textContent, /Order #1 paid and reserved/);
    assert.deepEqual(approvals, [3500000n]);
    assert.equal(JSON.parse([...f.data.values()][0]).stage, 'submitted');
    await buyButton().trigger('click');
    assert.equal(orders.length, 2);
    assert.ok(confirmations.some(message => message.includes('separate NEW paid order')));
    unreadableReceipt = true;
    await buyButton().trigger('click');
    assert.equal(orders.length, 2);
    assert.match(f.nodes.status.textContent, /Purchase already submitted/);
    changedMetadata = true;
    await panel.refresh();
    assert.match(f.nodes.status.textContent, /metadata changed without an on-chain listing revision/);
    assert.equal(f.nodes.save.disabled, true);
    assert.equal(f.nodes.open.disabled, true);
  } finally { global.window = previousWindow; global.document = previousDocument; }
});
