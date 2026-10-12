(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GreenTeaStorefront = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KINDS = ['Seeds', 'Starter plants', 'Cuttings', 'Harvest'];
  const ICONS = ['🌻', '🌱', '🪻', '🥬'];
  const DEMO_KEY = 'gth-storefront-demo-v1';
  const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const TOKEN_ABI = ['function decimals() view returns (uint8)', 'function allowance(address,address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'];

  function validateMetadata(data) {
    if (!data || data.schemaVersion !== 1 || !Number.isInteger(data.kind) || data.kind < 0 || data.kind > 3 ||
        typeof data.name !== 'string' || !data.name.trim() || data.name.length > 80 ||
        typeof data.description !== 'string' || !data.description.trim() || data.description.length > 1200 ||
        typeof data.pickup !== 'string' || !data.pickup.trim() || data.pickup.length > 600) {
      throw new Error('Product needs a category, name (80 characters max), description (1200 max), and public pickup instructions (600 max)');
    }
    return { schemaVersion: 1, kind: data.kind, name: data.name.trim(), description: data.description.trim(), pickup: data.pickup.trim() };
  }
  function validateProduct(data, core) {
    const metadata = validateMetadata({ ...data, schemaVersion: 1 });
    core.amountUnits(data.price);
    if (typeof data.available !== 'string' || !/^(?:0|[1-9]\d*)$/.test(data.available) ||
        BigInt(data.available) > 1000000n || typeof data.active !== 'boolean') {
      throw new Error('Stock must be a whole number from 0 to 1000000; listing status is required');
    }
    return { ...data, ...metadata };
  }
  function validURL(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 512) throw new Error('Product metadata must use a public HTTPS URL without credentials (512 characters max)');
    return url.href;
  }
  function metadataFor(product) { return validateMetadata({ ...product, schemaVersion: 1 }); }
  function metadataHash(product, ethers) {
    return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(metadataFor(product))));
  }
  function validateDeployment(config) {
    if (!config || typeof config.ready !== 'boolean' || config.chainId !== 8453 || config.usdcAddress?.toLowerCase() !== USDC.toLowerCase() ||
        !/^https:\/\//.test(config.rpcUrl)) throw new Error('Storefront configuration must use native USDC on Base');
    if (config.ready && (!/^0x[0-9a-f]{40}$/i.test(config.address || '') ||
        /^0x0{40}$/i.test(config.address) || !Number.isSafeInteger(config.deploymentBlock) || config.deploymentBlock < 1)) {
      throw new Error('Activated V2 storefront address and deployment block are required');
    }
  }
  function validateAttempt(attempt) {
    if (!attempt || !/^0x[0-9a-f]{64}$/i.test(attempt.reference || '') ||
        /^0x0{64}$/i.test(attempt.reference) || !/^[1-9]\d*$/.test(attempt.quantity || '') ||
        !/^[1-9]\d*$/.test(attempt.total || '') || !['prepared', 'submitting', 'submitted'].includes(attempt.stage) ||
        (attempt.txHash !== undefined && !/^0x[0-9a-f]{64}$/i.test(attempt.txHash))) {
      throw new Error('Saved purchase data is invalid. Review wallet history and orders before changing browser storage.');
    }
    return attempt;
  }
  async function withPurchaseLock(locks, key, action) {
    if (!locks?.request) throw new Error('Live checkout needs a browser with Web Locks support to prevent concurrent purchases across tabs.');
    return locks.request(key, { mode: 'exclusive', ifAvailable: true }, lock => {
      if (!lock) throw new Error('Another tab is submitting a purchase. Wait and review orders before retrying.');
      return action();
    });
  }
  function verifyPurchaseReceipt(receipt, { ethers, abi, address, buyer, productId, attempt }) {
    if (!receipt || receipt.status !== 1) throw new Error('Purchase has not succeeded');
    const iface = new ethers.Interface(abi);
    const event = iface.getEvent('OrderPlaced');
    const matches = receipt.logs.filter(log => log.address.toLowerCase() === address.toLowerCase() &&
      log.topics[0] === event.topicHash).map(log => iface.parseLog(log)).filter(log =>
      log.args.buyer.toLowerCase() === buyer.toLowerCase() &&
      log.args.productId === BigInt(productId) && log.args.quantity === BigInt(attempt.quantity) &&
      log.args.amountUSDC === BigInt(attempt.total) && log.args.clientReference === attempt.reference);
    if (matches.length !== 1) throw new Error('Receipt does not contain the exact paid order; review before retrying');
    return matches[0].args.orderId.toString();
  }

  function mount({ connectWallet }) {
    const core = window.GreenTeaPayroll;
    const ethers = window.ethers;
    const el = id => document.getElementById(`storefront-${id}`);
    let config;
    let abi;
    let reader;
    let contract;
    let products = [];
    let sampleProducts = [];
    let orders = [];
    let account = '';
    let manager = false;
    let owner = false;
    let open = false;
    let demo = true;
    let loaded = false;
    let demoResetAllowed = false;
    let busy = false;
    let editSnapshot;
    const status = (text, error = false) => { el('status').textContent = text; el('status').classList.toggle('error', error); };
    async function fetchJSON(url) {
      const response = await window.fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Unable to load public store data: ${url}`);
      return response.json();
    }
    function text(parent, tag, value, className) {
      const element = document.createElement(tag);
      element.textContent = value;
      if (className) element.className = className;
      parent.appendChild(element);
      return element;
    }
    function button(parent, label, action, disabled = false) {
      const element = text(parent, 'button', label, 'entry-submit');
      element.type = 'button';
      element.disabled = disabled || busy;
      element.addEventListener('click', action);
    }
    function formProduct() {
      return validateProduct({
        id: el('edit-id').value, kind: Number(el('kind').value), name: el('name').value,
        description: el('description').value, pickup: el('pickup').value,
        price: el('price').value.trim(), available: el('stock').value, active: el('active').value === 'true',
      }, core);
    }
    function hydrate(id = '') {
      const product = products.find(item => String(item.id) === id);
      editSnapshot = product ? { id, revision: product.revision, available: product.available } : undefined;
      el('edit-id').value = id;
      for (const field of ['name', 'price', 'description', 'pickup']) el(field).value = product?.[field] || '';
      el('stock').value = product?.available || '0';
      el('kind').value = String(product?.kind || 0);
      el('active').value = String(product?.active ?? true);
      el('metadata-url').value = product?.metadataURI || '';
    }
    function render() {
      el('refresh').disabled = busy;
      el('connect').disabled = busy;
      el('open').disabled = !loaded || demo || !owner || busy || open;
      el('close').disabled = !loaded || demo || !owner || busy || !open;
      el('reset-demo').hidden = !demo;
      el('reset-demo').disabled = busy || !demoResetAllowed;
      el('save').textContent = demo ? 'Save demo product' : 'Publish product on Base';
      el('admin-note').textContent = demo
        ? 'Demo editor: browser-local sample goods only. No products or funds are published. Your demo edits will not automatically become live listings.'
        : 'Live goods: only the owner and approved treasury managers can publish names, metadata, prices, stock, and availability. Personal details must stay off-chain.';
      el('mode').textContent = !loaded ? 'Storefront unavailable or loading. Checkout and editing are disabled.'
        : demo ? 'SAMPLE CATALOG - NOT FOR SALE. No purchase transactions are enabled.'
        : open ? 'Live Base USDC store - local pickup. Customer payments are reserved until buyer-confirmed pickup.' : 'Live store is paused. Purchasing is disabled; refunds remain available.';
      for (const field of el('product-form').elements) field.disabled = busy || !loaded || (!demo && !manager);
      const selected = el('edit-id').value;
      el('edit-id').replaceChildren();
      const add = text(el('edit-id'), 'option', 'Add a new product');
      add.value = '';
      for (const product of products) {
        const option = text(el('edit-id'), 'option', product.name);
        option.value = product.id;
      }
      el('edit-id').value = products.some(p => String(p.id) === selected) ? selected : '';
      el('products').replaceChildren();
      const visibleProducts = products.filter(p => p.active && (el('filter').value === 'all' || String(p.kind) === el('filter').value));
      for (const product of visibleProducts) {
        const card = text(el('products'), 'article', '', 'storefront-product');
        text(card, 'div', ICONS[product.kind], 'storefront-product-icon');
        text(card, 'p', `${KINDS[product.kind]}${demo ? ' / DEMO' : ''}`);
        text(card, 'h3', product.name);
        text(card, 'p', product.description);
        text(card, 'p', `${product.price} USDC per unit / ${product.available} available`);
        text(card, 'p', `Pickup: ${product.pickup}`);
        const label = text(card, 'label', 'Quantity');
        const quantity = document.createElement('input');
        quantity.type = 'number';
        quantity.min = '1';
        quantity.max = product.available;
        quantity.step = '1';
        quantity.value = '1';
        label.appendChild(quantity);
        button(card, demo ? 'Sample only - not for sale' : 'Buy for local pickup',
          () => transact(() => buy(product, quantity.value)),
          demo || !loaded || !open || !account || product.available === '0');
      }
      if (!visibleProducts.length) text(el('products'), 'p', 'No goods in this category. Use Manage greenhouse goods to add products or choose another category.');
      el('orders').replaceChildren();
      el('admin-orders').replaceChildren();
      if (demo) text(el('orders'), 'p', 'Sample mode has no purchases or pickup orders.');
      else if (!account) text(el('orders'), 'p', 'Connect your Base wallet to view pickup orders.');
      for (const order of orders) {
        const own = order.buyer.toLowerCase() === account.toLowerCase();
        if (!own && !manager) continue;
        const parent = own ? el('orders') : el('admin-orders');
        const row = text(parent, 'div', '', 'storefront-order');
        text(row, 'p', `Order #${order.id}: product #${order.productId}, ${order.quantity} units, ${core.formatUnits(order.amountUSDC)} USDC. ${['Pending preparation', 'Ready for pickup', 'Collected', 'Refunded'][order.status]}. Buyer: ${order.buyer}`);
        text(row, 'p', `Pickup/refund expiry: ${new Date(Number(order.deadline) * 1000).toLocaleString()}`);
        if (order.status < 2) {
          const expired = Number(order.deadline) * 1000 <= Date.now();
          if (manager && order.status === 0 && !expired) button(row, 'Mark ready for pickup', () => transact(() => orderAction('markReady', order.id)));
          if (own && order.status === 1 && !expired) button(row, 'Confirm goods collected', () => transact(() => orderAction('confirmPickup', order.id)));
          button(row, 'Cancel and refund buyer', () => transact(() => orderAction('refundOrder', order.id)));
        }
      }
    }
    async function refresh() {
      if (busy) return;
      busy = true;
      loaded = false;
      demoResetAllowed = false;
      render();
      try {
        config = await fetchJSON('storefront-deployment.json');
        validateDeployment(config);
        demo = !config.ready;
        account = '';
        manager = false;
        owner = false;
        if (demo) {
          const catalog = await fetchJSON('storefront-catalog.json');
          if (catalog.sample !== true || !Array.isArray(catalog.products)) throw new Error('Sample catalog is not marked as demo data');
          sampleProducts = catalog.products.map(p => validateProduct(p, core));
          demoResetAllowed = true;
          const saved = window.localStorage.getItem(DEMO_KEY);
          products = saved ? JSON.parse(saved).map(p => validateProduct(p, core)) : structuredClone(sampleProducts);
          const ids = products.map(p => p.id);
          if (ids.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(id)) || new Set(ids).size !== ids.length) {
            throw new Error('Demo product IDs must be unique nonempty strings. Reset the sample catalog to recover.');
          }
          orders = [];
        } else {
          if (config.address.toLowerCase() !== core.TREASURY.toLowerCase() || config.deploymentBlock !== core.DEPLOYMENT_BLOCK) {
            throw new Error('Storefront must use the reviewed V2 treasury');
          }
          abi = await fetchJSON('treasury-v2-abi.json');
          reader = new ethers.JsonRpcProvider(config.rpcUrl, 8453, { staticNetwork: true });
          if (Number(BigInt(await reader.send('eth_chainId', []))) !== 8453 || await reader.getCode(config.address) === '0x') throw new Error('V2 Base deployment not found');
          contract = new ethers.Contract(config.address, abi, reader);
          const [asset, finalized, source, isOpen, productCount, chainOwner] = await Promise.all([
            contract.USDC(), contract.migrationFinalized(), contract.sourceLedger(), contract.storeOpen(), contract.productCount(), contract.owner(),
          ]);
          if (asset.toLowerCase() !== USDC.toLowerCase() || !finalized || source.toLowerCase() !== core.PREVIOUS_TREASURY.toLowerCase()) throw new Error('V2 asset or migration verification failed');
          open = isOpen;
          if (window.ethereum) {
            const [chain, addresses] = await Promise.all([window.ethereum.request({ method: 'eth_chainId' }), window.ethereum.request({ method: 'eth_accounts' })]);
            if (Number(BigInt(chain)) === 8453 && addresses[0]) {
              account = addresses[0];
              owner = account.toLowerCase() === chainOwner.toLowerCase();
              manager = owner || await contract.managers(account);
            }
          }
          if (productCount > 200n) throw new Error('Catalog exceeds this UI limit (200 products); pagination is required before adding more');
          products = [];
          for (let id = 1; id <= Number(productCount); ++id) {
            const product = await contract.getProduct(id);
            const metadata = validateMetadata(await fetchJSON(validURL(product.metadataURI)));
            if (metadata.kind !== Number(product.kind)) throw new Error(`Product #${id} metadata category does not match on-chain category`);
            if (metadataHash(metadata, ethers) !== product.metadataHash) throw new Error(`Product #${id} public metadata changed without an on-chain listing revision`);
            products.push({ ...metadata, id: String(id), price: core.formatUnits(product.priceUSDC),
              available: product.available.toString(), active: product.active, revision: product.revision,
              metadataURI: product.metadataURI });
          }
          orders = [];
          if (account) {
            const last = await reader.getBlockNumber();
            const filter = contract.filters.OrderPlaced(null, manager ? null : account);
            const ids = new Set();
            for (let block = config.deploymentBlock; block <= last; block += 9000) {
              for (const log of await contract.queryFilter(filter, block, Math.min(block + 8999, last))) ids.add(log.args.orderId.toString());
            }
            if (ids.size > 200) throw new Error('Order view exceeds 200 orders; pagination is required');
            for (const id of ids) {
              const order = await contract.getOrder(id);
              orders.push({ ...Object.fromEntries(['buyer', 'productId', 'quantity', 'amountUSDC', 'deadline'].map(k => [k, order[k]])), id, status: Number(order.status) });
            }
          }
        }
        loaded = true;
        status(demo ? 'Demo catalog ready. Use the editor below to add or change sample goods.' : 'On-chain catalog and pickup orders verified.');
      } catch (error) {
        products = [];
        orders = [];
        manager = false;
        owner = false;
        status(`Storefront unavailable: ${error.message}`, true);
      } finally { busy = false; render(); }
    }
    async function signerContract() {
      if (demo || !loaded || !window.ethereum) throw new Error('Live V2 deployment and a Base wallet are required');
      const wallet = new ethers.BrowserProvider(window.ethereum, 8453);
      if (Number((await wallet.getNetwork()).chainId) !== 8453) throw new Error('Switch your wallet to Base');
      const signer = await wallet.getSigner();
      if ((await signer.getAddress()).toLowerCase() !== account.toLowerCase()) throw new Error('Wallet account changed; refresh the store');
      return { signer, target: new ethers.Contract(config.address, abi, signer) };
    }
    async function transact(action) {
      if (busy) return;
      busy = true;
      render();
      let feedback;
      try {
        if (!loaded) throw new Error('Load a verified catalog before editing or transacting');
        feedback = await action();
      } catch (error) {
        feedback = `Action stopped: ${error.shortMessage || error.message}`;
      } finally { busy = false; }
      await refresh();
      if (feedback) {
        const refreshError = loaded ? '' : ` ${el('status').textContent}`;
        status(feedback + refreshError, feedback.startsWith('Action stopped:') || !loaded);
      }
    }
    async function save() {
      const product = formProduct();
      if (demo) {
        const index = products.findIndex(p => p.id === product.id);
        product.id ||= `demo-${crypto.randomUUID()}`;
        if (index < 0) products.push(product); else products[index] = product;
        window.localStorage.setItem(DEMO_KEY, JSON.stringify(products));
        hydrate('');
        return 'Demo product saved in this browser only. Not for sale.';
      }
      if (!manager) throw new Error('Owner or approved manager required to publish goods');
      const metadataURI = validURL(el('metadata-url').value);
      const published = validateMetadata(await fetchJSON(metadataURI));
      if (JSON.stringify(published) !== JSON.stringify(metadataFor(product))) throw new Error('Published product JSON must match the form. Download and publish the updated JSON first.');
      const { target } = await signerContract();
      if (product.id && editSnapshot?.id !== product.id) throw new Error('Select the product again to load its inventory revision');
      const tx = await target.setProduct(product.id || 0, product.kind, metadataURI, metadataHash(product, ethers),
        core.amountUnits(product.price), BigInt(product.available), product.active,
        editSnapshot?.revision || 0, BigInt(editSnapshot?.available || 0));
      status(`Product transaction submitted: ${tx.hash}`);
      await tx.wait();
      hydrate('');
      return 'Product published on Base. Store opening is controlled separately by the owner.';
    }
    async function buy(product, quantityValue) {
      return withPurchaseLock(window.navigator?.locks, `gth-store-checkout:${config.address}:${account.toLowerCase()}`,
        () => buyLocked(product, quantityValue));
    }
    async function buyLocked(product, quantityValue) {
      if (!/^[1-9]\d*$/.test(quantityValue)) throw new Error('Choose a positive whole quantity');
      const quantity = BigInt(quantityValue);
      if (quantity > BigInt(product.available)) throw new Error('Quantity exceeds available stock');
      const total = core.amountUnits(product.price) * quantity;
      if (!window.confirm(`Buy ${quantity} × ${product.name} for ${core.formatUnits(total)} USDC on Base? Local pickup only. Confirm collection only after receiving your goods. All order and wallet details are public.`)) return 'Purchase cancelled.';
      const { signer, target } = await signerContract();
      const token = new ethers.Contract(USDC, TOKEN_ABI, signer);
      const [balance, decimals] = await Promise.all([token.balanceOf(account), token.decimals()]);
      if (Number(decimals) !== 6 || balance < total) throw new Error('Native USDC balance/decimals check failed');
      const key = `gth-store-order:${config.address}:${account.toLowerCase()}:${product.id}`;
      const previous = window.localStorage.getItem(key);
      const fresh = () => ({ reference: ethers.hexlify(ethers.randomBytes(32)), quantity: quantity.toString(), total: total.toString(), stage: 'prepared' });
      let attempt = previous ? validateAttempt(JSON.parse(previous)) : fresh();
      if (attempt.txHash) {
        const receipt = await reader.getTransactionReceipt(attempt.txHash);
        if (!receipt) throw new Error(`Purchase already submitted: ${attempt.txHash}. Review orders before retrying.`);
        const block = await reader.getBlock(receipt.blockNumber);
        if (!block || block.hash !== receipt.blockHash) throw new Error('Previous purchase receipt is not canonical; do not resend');
        if (receipt.status === 1) {
          const id = verifyPurchaseReceipt(receipt, { ethers, abi, address: config.address, buyer: account, productId: product.id, attempt });
          if (!window.confirm(`Your previous purchase succeeded as order #${id}. Create a separate NEW paid order?`)) return `Previous purchase is order #${id}; no new payment sent.`;
        } else if (receipt.status !== 0) throw new Error('Previous purchase status is unknown; do not resend');
        attempt = fresh();
      } else if (await target.usedOrderReferences(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address', 'bytes32'], [account, attempt.reference])))) {
        throw new Error('This purchase reference already created an order. Review orders and wallet history before starting another purchase.');
      }
      if (attempt.quantity !== quantity.toString() || attempt.total !== total.toString()) {
        if (attempt.stage !== 'prepared') throw new Error('An uncertain purchase has a different quantity or price. Review wallet history before retrying.');
        attempt = fresh();
      }
      window.localStorage.setItem(key, JSON.stringify(attempt));
      if (await token.allowance(account, config.address) < total) {
        const approval = await token.approve(config.address, total);
        status(`Exact-amount USDC approval submitted: ${approval.hash}. Approval alone does not purchase goods.`);
        await approval.wait();
      }
      await signerContract();
      attempt.stage = 'submitting';
      window.localStorage.setItem(key, JSON.stringify(attempt));
      let tx;
      try { tx = await target.buy(product.id, quantity, product.revision, total, attempt.reference); }
      catch (error) {
        if (error.code === 'ACTION_REJECTED' || error.code === 4001) {
          attempt.stage = 'prepared';
          window.localStorage.setItem(key, JSON.stringify(attempt));
        }
        throw error;
      }
      // Keep the hash before waiting so a receipt/RPC failure never becomes a fresh purchase.
      attempt.txHash = tx.hash;
      attempt.stage = 'submitted';
      window.localStorage.setItem(key, JSON.stringify(attempt));
      status(`Purchase submitted: ${tx.hash}. Do not resend.`);
      const receipt = await tx.wait();
      const id = verifyPurchaseReceipt(receipt, { ethers, abi, address: config.address, buyer: account, productId: product.id, attempt });
      return `Order #${id} paid and reserved: ${tx.hash}. After preparation, collect goods and confirm pickup with your wallet.`;
    }
    async function orderAction(method, id) {
      if (!window.confirm(method === 'confirmPickup'
        ? `Confirm you have received order #${id}? This releases its USDC to the project and ends the refund option.`
        : `${method === 'refundOrder' ? 'Refund and cancel' : 'Mark ready'} order #${id}?`)) return 'Action cancelled.';
      const { target } = await signerContract();
      const tx = await target[method](id);
      status(`Order update submitted: ${tx.hash}`);
      await tx.wait();
      return `Order updated: ${tx.hash}`;
    }
    el('filter').addEventListener('change', render);
    el('edit-id').addEventListener('change', () => hydrate(el('edit-id').value));
    el('refresh').addEventListener('click', refresh);
    el('connect').addEventListener('click', async () => {
      try { await connectWallet(); await refresh(); } catch (error) { status(error.message, true); }
    });
    el('product-form').addEventListener('submit', event => { event.preventDefault(); transact(save); });
    el('download').addEventListener('click', () => {
      try {
        const metadata = metadataFor(formProduct());
        const url = URL.createObjectURL(new Blob([JSON.stringify(metadata, null, 2) + '\n'], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url; a.download = 'greenhouse-product.json'; a.click(); URL.revokeObjectURL(url);
        status('Product JSON downloaded. Publish it at a public HTTPS URL before live listing.');
      } catch (error) { status(error.message, true); }
    });
    el('reset-demo').addEventListener('click', () => {
      if (!demo || !demoResetAllowed || !window.confirm('Discard your browser-local demo edits and restore sample goods?')) return;
      try {
        window.localStorage.removeItem(DEMO_KEY);
        hydrate('');
        refresh();
      } catch (error) { status(`Unable to reset demo: ${error.message}`, true); }
    });
    for (const [id, value] of [['open', true], ['close', false]]) el(id).addEventListener('click', () => transact(async () => {
      if (!owner) throw new Error('Only the treasury owner can open or pause the store');
      if (!window.confirm(`${value ? 'Open' : 'Pause'} the live store?`)) return 'Action cancelled.';
      const { target } = await signerContract();
      await (await target.setStoreOpen(value)).wait();
      return value ? 'Live store open.' : 'Live store paused. Refunds remain available.';
    }));
    if (window.ethereum?.on) {
      window.ethereum.on('accountsChanged', refresh);
      window.ethereum.on('chainChanged', refresh);
    }
    return { refresh };
  }
  return { KINDS, validateMetadata, validateProduct, validURL, metadataFor, metadataHash,
    validateDeployment, validateAttempt, verifyPurchaseReceipt, withPurchaseLock, mount };
}));
