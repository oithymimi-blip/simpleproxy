import 'dotenv/config';

function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT || 8787),
  rpcUrl: req('RPC_URL'),
  chainId: Number(req('CHAIN_ID')),
  contractAddress: req('CONTRACT_ADDRESS'),
  ownerPrivateKey: req('OWNER_PRIVATE_KEY'),
  adminAddresses: req('ADMIN_ADDRESSES')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  jwtSecret: req('JWT_SECRET'),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  fromBlock: Number(process.env.FROM_BLOCK || 0),
};
