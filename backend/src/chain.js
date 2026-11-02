import { ethers } from 'ethers';
import { config } from './config.js';

// Reliable public BSC Mainnet RPC endpoints with automatic failover
const DEFAULT_BSC_RPCS = [
  'https://bsc.publicnode.com',
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-dataseed1.ninicoin.io',
  'https://bsc-dataseed2.defibit.io',
  'https://bsc-dataseed.binance.org',
];

const bscNetwork = ethers.Network.from(config.chainId || 56);

function createResilientProvider() {
  const urls = [config.rpcUrl, ...DEFAULT_BSC_RPCS].filter(
    (url, idx, arr) => Boolean(url) && arr.indexOf(url) === idx
  );

  const providers = urls.map((url, index) => {
    const p = new ethers.JsonRpcProvider(url, bscNetwork, {
      staticNetwork: bscNetwork,
      batchMaxCount: 1, // Avoid batch eth_getLogs/eth_call rate limits (-32005)
    });
    return {
      provider: p,
      priority: index === 0 ? 1 : 2,
      weight: 1,
      stallTimeout: 1500,
    };
  });

  return new ethers.FallbackProvider(providers, bscNetwork, { quorum: 1 });
}

export const provider = createResilientProvider();

let ownerWalletInstance;
try {
  if (config.ownerPrivateKey && config.ownerPrivateKey.startsWith('0x') && config.ownerPrivateKey.length >= 64) {
    ownerWalletInstance = new ethers.Wallet(config.ownerPrivateKey, provider);
  } else {
    ownerWalletInstance = ethers.Wallet.createRandom().connect(provider);
  }
} catch {
  ownerWalletInstance = ethers.Wallet.createRandom().connect(provider);
}
export const ownerWallet = ownerWalletInstance;

export const PROXY_ABI = [
  'function owner() view returns (address)',
  'function duration() view returns (uint256)',
  'function tokenLimit(address) view returns (uint256)',
  'function lastPull(address,address) view returns (uint256)',
  'function canPull(address,address) view returns (bool)',
  'function nextPullAt(address,address) view returns (uint256)',
  'function setDuration(uint256)',
  'function setTokenLimit(address,uint256)',
  'function pull(address,address,address,uint256)',
  'event Pulled(address indexed admin, address indexed user, address indexed token, address to, uint256 amount)',
];

export const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
];

export const proxyRead = new ethers.Contract(
  config.contractAddress,
  PROXY_ABI,
  provider
);
export const proxyWrite = new ethers.Contract(
  config.contractAddress,
  PROXY_ABI,
  ownerWallet
);

export async function toBaseUnits(token, human) {
  const erc20 = new ethers.Contract(token, ERC20_ABI, provider);
  const decimals = await erc20.decimals();
  return ethers.parseUnits(String(human), decimals);
}
