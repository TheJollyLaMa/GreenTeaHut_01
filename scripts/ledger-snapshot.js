'use strict';

const { AbiCoder, ZeroHash, keccak256, isHexString } = require('ethers');

const SOURCE_ADDRESS = '0x44500FFd99B621620f393FCdbcF55D5137A55A23';
const ENTRY_TUPLE = 'tuple(uint256 id,uint256 amount,uint8 entryType,uint8 status,string category,string description,string referenceURI,uint256 createdAt,uint256 settledAt)';
const LEGACY_ABI = [
  'function totalEntries() view returns (uint256)',
  `function getEntry(uint256) view returns (${ENTRY_TUPLE})`,
  'event AmountUpdated(uint256 indexed id,uint256 oldAmount,uint256 newAmount,address indexed updatedBy,string reason,string referenceURI)',
];
const FIELDS = ['id', 'amount', 'entryType', 'status', 'category', 'description', 'referenceURI', 'createdAt', 'settledAt'];

function hashEntries(entries) {
  const coder = AbiCoder.defaultAbiCoder();
  return entries.reduce((hash, entry, index) => {
    if (BigInt(entry.id) !== BigInt(index + 1) || BigInt(entry.amount) <= 0n) throw new Error('Invalid entry sequence or amount');
    return keccak256(coder.encode(['bytes32', ENTRY_TUPLE], [hash, entry]));
  }, ZeroHash);
}

function validateSnapshot(snapshot) {
  if (snapshot.sourceChainId !== 10 || snapshot.sourceAddress !== SOURCE_ADDRESS ||
      !Number.isSafeInteger(snapshot.sourceBlock) || snapshot.sourceBlock <= 0 ||
      !isHexString(snapshot.sourceBlockHash, 32) || snapshot.sourceBlockHash === ZeroHash ||
      snapshot.count !== snapshot.entries.length || hashEntries(snapshot.entries) !== snapshot.historyHash) {
    throw new Error('Snapshot provenance, count or commitment is invalid');
  }
  return snapshot;
}

function serializeEntry(entry) {
  return Object.fromEntries(FIELDS.map((key) => [key, typeof entry[key] === 'bigint' ? entry[key].toString() : entry[key]]));
}

module.exports = { SOURCE_ADDRESS, ENTRY_TUPLE, LEGACY_ABI, FIELDS, hashEntries, validateSnapshot, serializeEntry };
