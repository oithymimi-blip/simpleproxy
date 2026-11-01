import { ethers } from 'ethers';
import { config } from './config.js';

export const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
export const ownerWallet = new ethers.Wallet(config.ownerPrivateKey, provider);

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
