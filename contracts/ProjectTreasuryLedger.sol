// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract ProjectTreasuryLedger is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum EntryType { INCOMING, OUTGOING }
    enum EntryStatus { PENDING, CONFIRMED, REQUESTED, COMMITTED, CANCELED }

    // Accounting amounts are whole USD, never token units or spend authorizations.
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

    uint256 public constant sourceChainId = 10;
    address public constant sourceLedger = 0x44500FFd99B621620f393FCdbcF55D5137A55A23;
    uint256 public immutable sourceBlock;
    bytes32 public immutable sourceBlockHash;
    bytes32 public immutable historyHash;
    uint256 public immutable historicalEntries;
    uint256 public importedEntries;
    bytes32 public importedHash;
    bool public migrationFinalized;
    uint256 private nextEntryId = 1;
    uint256 public transferCount;
    mapping(uint256 => Entry) private entries;
    mapping(address => bool) public managers;

    event ManagerUpdated(address indexed manager, bool approved);
    event HistoryImported(uint256 indexed id);
    event MigrationFinalized(bytes32 historyHash, uint256 count);
    event EntryCreated(uint256 indexed id, EntryType indexed entryType, EntryStatus status, uint256 amount, string category, string description, string referenceURI, uint256 createdAt);
    event EntryConfirmed(uint256 indexed id, string previousReferenceURI, string referenceURI, uint256 settledAt);
    event EntryStatusUpdated(uint256 indexed id, EntryStatus oldStatus, EntryStatus newStatus, uint256 updatedAt);
    event EntryReferenceUpdated(uint256 indexed id, string previousReferenceURI, string newReferenceURI);
    event AmountUpdated(uint256 indexed id, uint256 oldAmount, uint256 newAmount, address indexed updatedBy, string reason, string referenceURI);
    // asset=address(0) means ETH; amounts are raw asset units, not USD.
    event FundsReceived(uint256 indexed transferId, address indexed asset, address indexed sender, uint256 amount, string referenceURI);
    event FundsPaid(uint256 indexed transferId, address indexed asset, address indexed recipient, address manager, uint256 amount, string referenceURI);

    error Unauthorized();
    error InvalidInput();
    error InvalidHistory();
    error HistoricalEntryReadOnly();
    error EntryNotFound();
    error InvalidStatusTransition();
    error MigrationIncomplete();
    error TransferFailed();
    error RenounceDisabled();

    modifier onlyManager() {
        if (msg.sender != owner() && !managers[msg.sender]) revert Unauthorized();
        _;
    }

    constructor(address initialOwner, uint256 snapshotBlock, bytes32 snapshotBlockHash, uint256 count, bytes32 snapshotHash)
        Ownable(initialOwner)
    {
        if (initialOwner == address(this) || snapshotBlock == 0 || snapshotBlockHash == bytes32(0)) revert InvalidInput();
        if (count == 0 ? snapshotHash != bytes32(0) : snapshotHash == bytes32(0)) revert InvalidHistory();
        sourceBlock = snapshotBlock;
        sourceBlockHash = snapshotBlockHash;
        historicalEntries = count;
        historyHash = snapshotHash;
    }

    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

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
            if (entry.id != nextEntryId || entry.id > historicalEntries || entry.amount == 0) revert InvalidHistory();
            importedHash = keccak256(abi.encode(importedHash, entry));
            entries[nextEntryId++] = entry;
            importedEntries++;
            emit HistoryImported(entry.id);
        }
        if (importedHash != historyHash) revert InvalidHistory();
    }

    function finalizeMigration() external onlyOwner {
        if (migrationFinalized || importedEntries != historicalEntries || importedHash != historyHash) revert InvalidHistory();
        migrationFinalized = true;
        emit MigrationFinalized(historyHash, importedEntries);
    }

    function createEntry(EntryType entryType, EntryStatus status, uint256 amount, string calldata category, string calldata description, string calldata referenceURI)
        external onlyManager returns (uint256 entryId)
    {
        if (!migrationFinalized) revert MigrationIncomplete();
        if (amount == 0 || bytes(category).length == 0 || bytes(description).length == 0) revert InvalidInput();
        if (!((entryType == EntryType.INCOMING && status == EntryStatus.PENDING) ||
            (entryType == EntryType.OUTGOING && (status == EntryStatus.REQUESTED || status == EntryStatus.COMMITTED)))) revert InvalidStatusTransition();
        entryId = nextEntryId++;
        entries[entryId] = Entry(entryId, amount, entryType, status, category, description, referenceURI, block.timestamp, 0);
        emit EntryCreated(entryId, entryType, status, amount, category, description, referenceURI, block.timestamp);
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

    function getEntry(uint256 id) external view returns (Entry memory) {
        return _existing(id);
    }

    function totalEntries() external view returns (uint256) {
        return nextEntryId - 1;
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
        IERC20 token = IERC20(asset);
        uint256 previous = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - previous;
        if (received == 0) revert InvalidInput();
        emit FundsReceived(++transferCount, asset, msg.sender, received, referenceURI);
    }

    function payETH(address payable recipient, uint256 amount, string calldata referenceURI) external onlyManager nonReentrant {
        _validatePayment(recipient, amount, referenceURI);
        emit FundsPaid(++transferCount, address(0), recipient, msg.sender, amount, referenceURI);
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    // Also recovers ordinary ERC-20s transferred directly, without an allowlist.
    function payToken(address asset, address recipient, uint256 amount, string calldata referenceURI) external onlyManager nonReentrant {
        _validatePayment(recipient, amount, referenceURI);
        if (asset.code.length == 0 || asset == address(this)) revert InvalidInput();
        emit FundsPaid(++transferCount, asset, recipient, msg.sender, amount, referenceURI);
        IERC20(asset).safeTransfer(recipient, amount);
    }

    function _validatePayment(address recipient, uint256 amount, string calldata referenceURI) private view {
        if (recipient == address(0) || recipient == address(this) || amount == 0 || bytes(referenceURI).length == 0) revert InvalidInput();
    }

    function _existing(uint256 id) private view returns (Entry storage entry) {
        if (id == 0 || id >= nextEntryId) revert EntryNotFound();
        return entries[id];
    }

    function _editable(uint256 id) private view returns (Entry storage entry) {
        entry = _existing(id);
        if (id <= historicalEntries) revert HistoricalEntryReadOnly();
    }
}
