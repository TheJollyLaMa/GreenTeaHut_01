// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ProjectLedger {
    enum EntryType {
        INCOMING,
        OUTGOING
    }

    // Status lifecycle for ledger entries.
    // PENDING (0)   — soft incoming entry: expected inflow, not yet settled.
    // CONFIRMED (1) — finalized; frontend displays this as "SETTLED".
    // REQUESTED (2) — soft outgoing entry: expected outflow, not yet approved/executed.
    // COMMITTED (3) — approved and awaiting execution.
    // CANCELED (4)  — invalidated, no longer active.
    enum EntryStatus {
        PENDING,
        CONFIRMED,
        REQUESTED,
        COMMITTED,
        CANCELED
    }

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

    address public immutable owner;
    uint256 private nextEntryId = 1;

    mapping(uint256 => Entry) private entries;

    event EntryCreated(
        uint256 indexed id,
        EntryType indexed entryType,
        EntryStatus status,
        uint256 amount,
        string category,
        string description,
        string referenceURI,
        uint256 createdAt
    );
    event EntryConfirmed(
        uint256 indexed id,
        string previousReferenceURI,
        string referenceURI,
        uint256 settledAt
    );
    event EntryReferenceUpdated(uint256 indexed id, string previousReferenceURI, string newReferenceURI);
    // Emitted whenever a pending/requested entry's estimated amount is revised.
    event AmountUpdated(
        uint256 indexed id,
        uint256 oldAmount,
        uint256 newAmount,
        address indexed updatedBy,
        string reason,
        string referenceURI
    );

    error EmptyCategory();
    error EmptyDescription();
    error EmptyReferenceURI();
    error EmptyReason();
    error EntryAlreadyConfirmed();
    error EntryAlreadyFinalized();
    error EntryNotFound();
    error AmountMustBePositive();
    error Unauthorized();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // Creates a new soft entry with the given status (PENDING, REQUESTED, etc.).
    // Callers must supply a non-zero amount, category, and description.
    // referenceURI is optional at creation time; pass an empty string when unavailable.
    // Valid soft statuses at creation: PENDING (expected inflow), REQUESTED (expected outflow).
    // CONFIRMED and CANCELED should not be used here; use confirmEntry or updateStatus instead.
    function createEntry(
        EntryType entryType,
        EntryStatus status,
        uint256 amount,
        string calldata category,
        string calldata description,
        string calldata referenceURI
    ) external onlyOwner returns (uint256 entryId) {
        if (amount == 0) revert AmountMustBePositive();
        if (bytes(category).length == 0) revert EmptyCategory();
        if (bytes(description).length == 0) revert EmptyDescription();

        entryId = nextEntryId;
        nextEntryId += 1;

        entries[entryId] = Entry({
            id: entryId,
            amount: amount,
            entryType: entryType,
            status: status,
            category: category,
            description: description,
            referenceURI: referenceURI,
            createdAt: block.timestamp,
            settledAt: 0
        });

        emit EntryCreated(
            entryId,
            entryType,
            status,
            amount,
            category,
            description,
            referenceURI,
            block.timestamp
        );
    }

    // Settles a soft entry by recording a proof/reference URL and marking it CONFIRMED.
    // Blocked for entries that are already CONFIRMED or CANCELED.
    function confirmEntry(uint256 entryId, string calldata referenceURI) external onlyOwner {
        if (bytes(referenceURI).length == 0) revert EmptyReferenceURI();

        Entry storage entry = _getExistingEntry(entryId);
        if (entry.status == EntryStatus.CONFIRMED) revert EntryAlreadyConfirmed();
        if (entry.status == EntryStatus.CANCELED) revert EntryAlreadyFinalized();

        string memory previousReferenceURI = entry.referenceURI;
        entry.status = EntryStatus.CONFIRMED;
        entry.referenceURI = referenceURI;
        entry.settledAt = block.timestamp;

        emit EntryConfirmed(entryId, previousReferenceURI, referenceURI, entry.settledAt);
    }

    // Revises the estimated amount of a soft entry while it is still pending/requested.
    // Allowed only while status is PENDING, REQUESTED, or COMMITTED.
    // Emits AmountUpdated for a full on-chain audit trail of every revision.
    function updatePendingAmount(
        uint256 entryId,
        uint256 newAmount,
        string calldata reason,
        string calldata referenceURI
    ) external onlyOwner {
        if (newAmount == 0) revert AmountMustBePositive();
        if (bytes(reason).length == 0) revert EmptyReason();

        Entry storage entry = _getExistingEntry(entryId);

        if (
            entry.status != EntryStatus.PENDING &&
            entry.status != EntryStatus.REQUESTED &&
            entry.status != EntryStatus.COMMITTED
        ) {
            revert EntryAlreadyFinalized();
        }

        uint256 oldAmount = entry.amount;
        entry.amount = newAmount;

        emit AmountUpdated(entryId, oldAmount, newAmount, msg.sender, reason, referenceURI);
    }

    function updateReferenceURI(uint256 entryId, string calldata referenceURI) external onlyOwner {
        Entry storage entry = _getExistingEntry(entryId);

        if (bytes(referenceURI).length == 0) revert EmptyReferenceURI();

        string memory previousReferenceURI = entry.referenceURI;
        entry.referenceURI = referenceURI;

        emit EntryReferenceUpdated(entryId, previousReferenceURI, referenceURI);
    }

    function getEntry(uint256 entryId) external view returns (Entry memory) {
        return _getExistingEntry(entryId);
    }

    function totalEntries() external view returns (uint256) {
        return nextEntryId - 1;
    }

    function _getExistingEntry(uint256 entryId) private view returns (Entry storage entry) {
        if (entryId == 0 || entryId >= nextEntryId) revert EntryNotFound();
        entry = entries[entryId];
    }
}
