import { BrowserProvider } from 'ethers';
import { CHAIN_ID } from './api';

const TARGET_CHAINS = {
  56: {
    chainId: '0x38',
    chainName: 'BNB Smart Chain',
    nativeCurrency: {
      name: 'BNB',
      symbol: 'BNB',
      decimals: 18,
    },
    rpcUrls: ['https://bsc-dataseed.binance.org/'],
    blockExplorerUrls: ['https://bscscan.com'],
  },
  97: {
    chainId: '0x61',
    chainName: 'BNB Smart Chain Testnet',
    nativeCurrency: {
      name: 'tBNB',
      symbol: 'tBNB',
      decimals: 18,
    },
    rpcUrls: ['https://data-seed-prebsc-1-s1.binance.org:8545/'],
    blockExplorerUrls: ['https://testnet.bscscan.com'],
  },
};

function isChainNotAddedError(err) {
  if (!err) return false;
  const codes = [err.code, err?.data?.originalError?.code, err?.cause?.code];
  if (codes.includes(4902)) return true;
  const msg = String(err.message || '').toLowerCase();
  return (
    msg.includes('unrecognized chain') ||
    msg.includes('wallet_addethereumchain') ||
    msg.includes('not been added')
  );
}

export async function switchToNetwork(targetChainId = CHAIN_ID) {
  if (!window.ethereum) throw new Error('No wallet detected. Install MetaMask.');
  const hexChainId = `0x${Number(targetChainId).toString(16)}`;

  try {
    const currentHex = await window.ethereum.request({ method: 'eth_chainId' });
    if (currentHex && Number(currentHex) === Number(targetChainId)) {
      return true;
    }
  } catch {
    // Proceed with switch attempt if eth_chainId read fails
  }

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });
    return true;
  } catch (err) {
    if (isChainNotAddedError(err) && TARGET_CHAINS[targetChainId]) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [TARGET_CHAINS[targetChainId]],
      });
      const afterAddHex = await window.ethereum.request({ method: 'eth_chainId' }).catch(() => '');
      if (!afterAddHex || Number(afterAddHex) !== Number(targetChainId)) {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: hexChainId }],
        });
      }
      return true;
    }
    throw err;
  }
}

export async function refreshWalletSession() {
  if (!window.ethereum) throw new Error('No wallet detected. Install MetaMask.');
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const network = await provider.getNetwork();
  return { provider, signer, address, chainId: Number(network.chainId) };
}

export async function connectWallet(targetChainId = CHAIN_ID) {
  if (!window.ethereum) throw new Error('No wallet detected. Install MetaMask.');
  await window.ethereum.request({ method: 'eth_requestAccounts' });

  try {
    await switchToNetwork(targetChainId);
  } catch (err) {
    // Allow session return so UI can surface switch prompt and retry on action
    console.warn('Auto network switch skipped:', err?.message || err);
  }

  return await refreshWalletSession();
}
