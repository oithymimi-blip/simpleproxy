import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 8787),
  rpcUrl: process.env.RPC_URL || 'https://bsc-dataseed.binance.org',
  chainId: Number(process.env.CHAIN_ID || 56),
  contractAddress: process.env.CONTRACT_ADDRESS || '0x842792E64a1b2e1c43EeDd458F877eCfCAe44651',
  ownerPrivateKey: process.env.OWNER_PRIVATE_KEY || '',
  adminAddresses: (process.env.ADMIN_ADDRESSES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  jwtSecret: process.env.JWT_SECRET || 'simple-proxy-jwt-secret-key-32chars-min',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  fromBlock: Number(process.env.FROM_BLOCK || 0),
};
