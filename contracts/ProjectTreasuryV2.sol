// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

contract ProjectTreasuryV2 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    uint256 public constant sourceChainId = 8453;
    uint256 public constant PICKUP_WINDOW = 14 days;
    address public immutable sourceLedger;
    uint256 public immutable sourceBlock;
    bytes32 public immutable sourceBlockHash;
    bytes32 public immutable historyHash;
    uint256 public immutable historicalEntries;
    bytes32 public importedHash;
    uint256 public importedEntries;
    bool public migrationFinalized;
    bool public storeOpen;
    uint256 public reservedUSDC;
    uint256 public transferCount;
    uint256 private nextEntryId = 1;
    uint256 public productCount;
    uint256 public orderCount;
    mapping(address => bool) public managers;
    mapping(bytes32 => bool) public paidPayrollReferences;
    mapping(bytes32 => bool) public usedOrderReferences;

    enum EntryType { INCOMING, OUTGOING }
    enum EntryStatus { PENDING, CONFIRMED, REQUESTED, COMMITTED, CANCELED }
    enum ProductKind { SEEDS, STARTER_PLANTS, CUTTINGS, HARVEST }
    enum OrderStatus { PENDING, READY, FULFILLED, REFUNDED }
    struct Entry {
        uint256 id;
        uint256 amount;
        EntryType entryType;
        EntryStatus status;
        string category;
        string description;
        string referenceURI;
        uint256 createdAt;
        uint256 settledAt;
    }
    struct Product {
        ProductKind kind;
        string metadataURI;
        bytes32 metadataHash;
        uint256 priceUSDC;
        uint256 available;
        uint256 revision;
        bool active;
    }
    struct Order {
        address buyer;
        uint256 productId;
        uint256 quantity;
        uint256 amountUSDC;
        uint256 productRevision;
        uint256 deadline;
        bytes32 clientReference;
        OrderStatus status;
    }
    mapping(uint256 => Entry) private entries;
    mapping(uint256 => Product) private products;
    mapping(uint256 => Order) private orders;

    event ManagerUpdated(address indexed manager, bool approved);
    event HistoryImported(uint256 indexed id);
    event MigrationFinalized(bytes32 historyHash, uint256 count);
    event EntryCreated(uint256 indexed id, EntryType indexed entryType, EntryStatus status, uint256 amount, string category, string description, string referenceURI, uint256 createdAt);
    event EntryConfirmed(uint256 indexed id, string previousReferenceURI, string referenceURI, uint256 settledAt);
    event EntryStatusUpdated(uint256 indexed id, EntryStatus oldStatus, EntryStatus newStatus, uint256 updatedAt);
    event EntryReferenceUpdated(uint256 indexed id, string previousReferenceURI, string newReferenceURI);
    event AmountUpdated(uint256 indexed id, uint256 oldAmount, uint256 newAmount, address indexed updatedBy, string reason, string referenceURI);
    event FundsReceived(uint256 indexed transferId, address indexed asset, address indexed sender, uint256 amount, string referenceURI);
    event FundsPaid(uint256 indexed transferId, address indexed asset, address indexed recipient, address manager, uint256 amount, string referenceURI);
    event PayrollPaid(bytes32 indexed workReference, address indexed recipient, uint256 amountUSDC, address manager);
    event ProductUpdated(uint256 indexed productId, ProductKind kind, string metadataURI, bytes32 metadataHash, uint256 priceUSDC, uint256 available, uint256 revision, bool active);
    event StoreOpenChanged(bool open);
    event OrderPlaced(uint256 indexed orderId, address indexed buyer, uint256 indexed productId, uint256 quantity, uint256 amountUSDC, uint256 productRevision, bytes32 clientReference, uint256 deadline);
    event OrderReady(uint256 indexed orderId);
    event OrderCollected(uint256 indexed orderId, address indexed buyer, uint256 amountUSDC);
    event OrderRefunded(uint256 indexed orderId, address indexed buyer, uint256 amountUSDC);

    error Unauthorized();
    error InvalidInput();
    error InvalidHistory();
    error MigrationIncomplete();
    error InvalidStatusTransition();
    error HistoricalEntryReadOnly();
    error EntryNotFound();
    error PayrollAlreadyPaid();
    error OrderReferenceUsed();
    error StoreUnavailable();
    error StaleProduct();
    error InsufficientAvailableFunds();
    error TransferFailed();
    error RenounceDisabled();

    modifier onlyManager() {
        if (msg.sender != owner() && !managers[msg.sender]) revert Unauthorized();
        _;
    }

    constructor(address initialOwner, address predecessor, uint256 snapshotBlock, bytes32 snapshotBlockHash, uint256 count, bytes32 snapshotHash)
        Ownable(initialOwner)
    {
        if (initialOwner == address(this) || predecessor == address(0) || snapshotBlock == 0 ||
            snapshotBlockHash == bytes32(0) || (count == 0 ? snapshotHash != bytes32(0) : snapshotHash == bytes32(0))) revert InvalidInput();
        sourceLedger = predecessor;
        sourceBlock = snapshotBlock;
        sourceBlockHash = snapshotBlockHash;
        historicalEntries = count;
        historyHash = snapshotHash;
    }

    function renounceOwnership() public view override onlyOwner { revert RenounceDisabled(); }
    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == address(this)) revert InvalidInput();
        super.transferOwnership(newOwner);
    }
    function setManager(address manager, bool approved) external onlyOwner {
        if (manager == address(0) || manager == address(this)) revert InvalidInput();
        managers[manager] = approved;
        emit ManagerUpdated(manager, approved);
    }
    function importHistory(Entry[] calldata batch) external onlyOwner {
        if (migrationFinalized || importedEntries != 0 || batch.length == 0 || batch.length != historicalEntries) revert InvalidHistory();
        for (uint256 i; i < batch.length; ++i) {
            Entry calldata entry = batch[i];
            if (entry.id != nextEntryId || entry.amount == 0) revert InvalidHistory();
            importedHash = keccak256(abi.encode(importedHash, entry));
            entries[nextEntryId++] = entry;
            ++importedEntries;
            emit HistoryImported(entry.id);
        }
        if (importedHash != historyHash) revert InvalidHistory();
    }
    function finalizeMigration() external onlyOwner {
        if (migrationFinalized || importedEntries != historicalEntries || importedHash != historyHash) revert InvalidHistory();
        migrationFinalized = true;
        emit MigrationFinalized(historyHash, importedEntries);
    }
    function createEntry(EntryType kind, EntryStatus status, uint256 amount, string calldata category, string calldata description, string calldata referenceURI)
        external onlyManager returns (uint256 id)
    {
        if (!migrationFinalized) revert MigrationIncomplete();
        if (amount == 0 || bytes(category).length == 0 || bytes(description).length == 0) revert InvalidInput();
        if (!((kind == EntryType.INCOMING && status == EntryStatus.PENDING) ||
            (kind == EntryType.OUTGOING && (status == EntryStatus.REQUESTED || status == EntryStatus.COMMITTED)))) revert InvalidStatusTransition();
        id = nextEntryId++;
        entries[id] = Entry(id, amount, kind, status, category, description, referenceURI, block.timestamp, 0);
        emit EntryCreated(id, kind, status, amount, category, description, referenceURI, block.timestamp);
    }
    function confirmEntry(uint256 id, string calldata referenceURI) external onlyManager {
        Entry storage entry = _editable(id);
        if (bytes(referenceURI).length == 0) revert InvalidInput();
        if (entry.status == EntryStatus.CONFIRMED || entry.status == EntryStatus.CANCELED) revert InvalidStatusTransition();
        string memory previous = entry.referenceURI;
        entry.status = EntryStatus.CONFIRMED;
        entry.referenceURI = referenceURI;
        entry.settledAt = block.timestamp;
        emit EntryConfirmed(id, previous, referenceURI, block.timestamp);
    }
    function updateStatus(uint256 id, EntryStatus status) external onlyManager {
        Entry storage entry = _editable(id);
        EntryStatus previous = entry.status;
        if (!((previous == EntryStatus.REQUESTED && (status == EntryStatus.COMMITTED || status == EntryStatus.CANCELED)) ||
            ((previous == EntryStatus.PENDING || previous == EntryStatus.COMMITTED) && status == EntryStatus.CANCELED))) revert InvalidStatusTransition();
        entry.status = status;
        emit EntryStatusUpdated(id, previous, status, block.timestamp);
    }
    function updatePendingAmount(uint256 id, uint256 amount, string calldata reason, string calldata referenceURI) external onlyManager {
        Entry storage entry = _editable(id);
        if (amount == 0 || bytes(reason).length == 0) revert InvalidInput();
        if (entry.status == EntryStatus.CONFIRMED || entry.status == EntryStatus.CANCELED) revert InvalidStatusTransition();
        uint256 previous = entry.amount;
        entry.amount = amount;
        emit AmountUpdated(id, previous, amount, msg.sender, reason, referenceURI);
    }
    function updateReferenceURI(uint256 id, string calldata referenceURI) external onlyManager {
        Entry storage entry = _editable(id);
        if (bytes(referenceURI).length == 0) revert InvalidInput();
        string memory previous = entry.referenceURI;
        entry.referenceURI = referenceURI;
        emit EntryReferenceUpdated(id, previous, referenceURI);
    }
    function getEntry(uint256 id) external view returns (Entry memory) { return _existing(id); }
    function totalEntries() external view returns (uint256) { return nextEntryId - 1; }
    function _existing(uint256 id) private view returns (Entry storage) {
        if (id == 0 || id >= nextEntryId) revert EntryNotFound();
        return entries[id];
    }
    function _editable(uint256 id) private view returns (Entry storage entry) {
        entry = _existing(id);
        if (id <= historicalEntries) revert HistoricalEntryReadOnly();
    }

    receive() external payable {
        if (msg.value == 0) revert InvalidInput();
        emit FundsReceived(++transferCount, address(0), msg.sender, msg.value, "Direct ETH deposit");
    }
    function depositETH(string calldata referenceURI) external payable {
        if (msg.value == 0) revert InvalidInput();
        emit FundsReceived(++transferCount, address(0), msg.sender, msg.value, referenceURI);
    }
    function depositToken(address asset, uint256 amount, string calldata referenceURI) external nonReentrant {
        if (asset.code.length == 0 || asset == address(this) || amount == 0) revert InvalidInput();
        uint256 previous = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(asset).balanceOf(address(this)) - previous;
        if (received == 0) revert InvalidInput();
        emit FundsReceived(++transferCount, asset, msg.sender, received, referenceURI);
    }
    function availableUSDC() public view returns (uint256) {
        uint256 balance = IERC20(USDC).balanceOf(address(this));
        if (balance < reservedUSDC) revert InsufficientAvailableFunds();
        return balance - reservedUSDC;
    }
    function payETH(address payable recipient, uint256 amount, string calldata referenceURI) external onlyManager nonReentrant {
        _validatePayment(recipient, amount);
        if (bytes(referenceURI).length == 0) revert InvalidInput();
        emit FundsPaid(++transferCount, address(0), recipient, msg.sender, amount, referenceURI);
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
    }
    function payToken(address asset, address recipient, uint256 amount, string calldata referenceURI) external onlyManager nonReentrant {
        if (bytes(referenceURI).length == 0) revert InvalidInput();
        // Generic payouts cannot masquerade as the reserved repository payroll namespace.
        bytes memory prefix = bytes("repo-payroll:");
        bytes memory referenceBytes = bytes(referenceURI);
        bool payroll = referenceBytes.length >= prefix.length;
        for (uint256 i; payroll && i < prefix.length; ++i) payroll = referenceBytes[i] == prefix[i];
        if (payroll) revert InvalidInput();
        _payToken(asset, recipient, amount, referenceURI);
    }
    function payrollReference(uint256 issueId, string calldata contributorGithub, uint8 role) public pure returns (string memory) {
        bytes memory login = bytes(contributorGithub);
        if (issueId == 0 || login.length == 0 || login.length > 39 || role > 3) revert InvalidInput();
        for (uint256 i; i < login.length; ++i) {
            bytes1 character = login[i];
            if (!((character >= 0x61 && character <= 0x7a) || (character >= 0x30 && character <= 0x39) ||
                (i > 0 && character == 0x2d))) revert InvalidInput();
        }
        string[4] memory roles = ["contributor", "implementer", "idea-originator", "tester"];
        return string.concat("repo-payroll:TheJollyLaMa/GreenTeaHut_01#", Strings.toString(issueId), ":", contributorGithub, ":", roles[role], ":USDC");
    }
    function payPayroll(uint256 issueId, string calldata contributorGithub, uint8 role, address recipient, uint256 amountUSDC) external onlyManager nonReentrant {
        if (!migrationFinalized) revert MigrationIncomplete();
        string memory referenceURI = payrollReference(issueId, contributorGithub, role);
        bytes32 workReference = keccak256(bytes(referenceURI));
        if (paidPayrollReferences[workReference]) revert PayrollAlreadyPaid();
        paidPayrollReferences[workReference] = true;
        _payToken(USDC, recipient, amountUSDC, referenceURI);
        emit PayrollPaid(workReference, recipient, amountUSDC, msg.sender);
    }
    function _validatePayment(address recipient, uint256 amount) private view {
        if (recipient == address(0) || recipient == address(this) || amount == 0) revert InvalidInput();
    }
    function _payToken(address asset, address recipient, uint256 amount, string memory referenceURI) private {
        _validatePayment(recipient, amount);
        if (asset.code.length == 0 || asset == address(this)) revert InvalidInput();
        if (asset == USDC && amount > availableUSDC()) revert InsufficientAvailableFunds();
        emit FundsPaid(++transferCount, asset, recipient, msg.sender, amount, referenceURI);
        IERC20(asset).safeTransfer(recipient, amount);
    }

    function setStoreOpen(bool open) external onlyOwner {
        if (open && !migrationFinalized) revert MigrationIncomplete();
        storeOpen = open;
        emit StoreOpenChanged(open);
    }
    function setProduct(uint256 id, ProductKind kind, string calldata metadataURI, bytes32 metadataHash, uint256 priceUSDC, uint256 available, bool active, uint256 expectedRevision, uint256 expectedAvailable)
        external onlyManager returns (uint256 productId)
    {
        if (bytes(metadataURI).length == 0 || bytes(metadataURI).length > 512 || metadataHash == bytes32(0) || priceUSDC == 0) revert InvalidInput();
        if (id == 0 ? (expectedRevision != 0 || expectedAvailable != 0) :
            (products[id].revision != expectedRevision || products[id].available != expectedAvailable)) revert StaleProduct();
        productId = id == 0 ? ++productCount : id;
        if (productId > productCount) revert InvalidInput();
        uint256 revision = products[productId].revision + 1;
        products[productId] = Product(kind, metadataURI, metadataHash, priceUSDC, available, revision, active);
        emit ProductUpdated(productId, kind, metadataURI, metadataHash, priceUSDC, available, revision, active);
    }
    function getProduct(uint256 id) external view returns (Product memory) {
        if (id == 0 || id > productCount) revert InvalidInput();
        return products[id];
    }
    function getOrder(uint256 id) external view returns (Order memory) {
        if (id == 0 || id > orderCount) revert InvalidInput();
        return orders[id];
    }
    function buy(uint256 productId, uint256 quantity, uint256 expectedRevision, uint256 expectedTotalUSDC, bytes32 clientReference)
        external nonReentrant returns (uint256 orderId)
    {
        if (!storeOpen || !migrationFinalized) revert StoreUnavailable();
        Product storage product = products[productId];
        if (productId == 0 || productId > productCount || !product.active || quantity == 0 || quantity > product.available ||
            clientReference == bytes32(0)) revert InvalidInput();
        uint256 amount = product.priceUSDC * quantity;
        if (product.revision != expectedRevision || amount != expectedTotalUSDC) revert StaleProduct();
        bytes32 orderReference = keccak256(abi.encode(msg.sender, clientReference));
        if (usedOrderReferences[orderReference]) revert OrderReferenceUsed();
        usedOrderReferences[orderReference] = true;
        product.available -= quantity;
        reservedUSDC += amount;
        uint256 previous = IERC20(USDC).balanceOf(address(this));
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(USDC).balanceOf(address(this)) - previous != amount) revert InvalidInput();
        orderId = ++orderCount;
        uint256 deadline = block.timestamp + PICKUP_WINDOW;
        orders[orderId] = Order(msg.sender, productId, quantity, amount, product.revision, deadline, clientReference, OrderStatus.PENDING);
        emit FundsReceived(++transferCount, USDC, msg.sender, amount, "Storefront pickup escrow");
        emit OrderPlaced(orderId, msg.sender, productId, quantity, amount, product.revision, clientReference, deadline);
    }
    function markReady(uint256 id) external onlyManager {
        Order storage order = _openOrder(id);
        if (order.status != OrderStatus.PENDING || block.timestamp >= order.deadline) revert InvalidStatusTransition();
        order.status = OrderStatus.READY;
        emit OrderReady(id);
    }
    function confirmPickup(uint256 id) external nonReentrant {
        Order storage order = _openOrder(id);
        if (msg.sender != order.buyer) revert Unauthorized();
        if (order.status != OrderStatus.READY || block.timestamp >= order.deadline) revert InvalidStatusTransition();
        order.status = OrderStatus.FULFILLED;
        reservedUSDC -= order.amountUSDC;
        emit OrderCollected(id, order.buyer, order.amountUSDC);
    }
    function refundOrder(uint256 id) external nonReentrant {
        Order storage order = _openOrder(id);
        if (msg.sender != order.buyer && msg.sender != owner() && !managers[msg.sender] && block.timestamp < order.deadline) revert Unauthorized();
        order.status = OrderStatus.REFUNDED;
        reservedUSDC -= order.amountUSDC;
        products[order.productId].available += order.quantity;
        IERC20(USDC).safeTransfer(order.buyer, order.amountUSDC);
        emit OrderRefunded(id, order.buyer, order.amountUSDC);
    }
    function _openOrder(uint256 id) private view returns (Order storage order) {
        if (id == 0 || id > orderCount) revert InvalidInput();
        order = orders[id];
        if (order.status == OrderStatus.FULFILLED || order.status == OrderStatus.REFUNDED) revert InvalidStatusTransition();
    }
}
