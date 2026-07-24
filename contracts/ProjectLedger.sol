// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ProjectLedger {
    enum EntryType {
        INCOMING,
        OUTGOING
    }

    enum EntryStatus {
        PENDING,
        CONFIRMED
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
    event EntryConfirmed(uint256 indexed id, string referenceURI, uint256 settledAt);
    event EntryReferenceUpdated(uint256 indexed id, string previousReferenceURI, string newReferenceURI);

    error EmptyCategory();
    error EmptyDescription();
    error EmptyReferenceURI();
    error EntryAlreadyConfirmed();
    error EntryNotFound();
    error InvalidAmount();
    error Unauthorized();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function createEntry(
        EntryType entryType,
        uint256 amount,
        string calldata category,
        string calldata description,
        string calldata referenceURI
    ) external onlyOwner returns (uint256 entryId) {
        if (amount == 0) revert InvalidAmount();
        if (bytes(category).length == 0) revert EmptyCategory();
        if (bytes(description).length == 0) revert EmptyDescription();

        entryId = nextEntryId;
        nextEntryId += 1;

        entries[entryId] = Entry({
            id: entryId,
            amount: amount,
            entryType: entryType,
            status: EntryStatus.PENDING,
            category: category,
            description: description,
            referenceURI: referenceURI,
            createdAt: block.timestamp,
            settledAt: 0
        });

        emit EntryCreated(
            entryId,
            entryType,
            EntryStatus.PENDING,
            amount,
            category,
            description,
            referenceURI,
            block.timestamp
        );
    }

    function confirmEntry(uint256 entryId, string calldata referenceURI) external onlyOwner {
        Entry storage entry = _getExistingEntry(entryId);

        if (entry.status == EntryStatus.CONFIRMED) revert EntryAlreadyConfirmed();
        if (bytes(referenceURI).length == 0) revert EmptyReferenceURI();

        entry.status = EntryStatus.CONFIRMED;
        entry.referenceURI = referenceURI;
        entry.settledAt = block.timestamp;

        emit EntryConfirmed(entryId, referenceURI, entry.settledAt);
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
        entry = entries[entryId];
        if (entry.id == 0) revert EntryNotFound();
    }
}
