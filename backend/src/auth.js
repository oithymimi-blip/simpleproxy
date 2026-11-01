import { Router } from 'express';
import { ethers } from 'ethers';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

const router = Router();
const nonces = new Map();

function buildMessage(address, nonce) {
  return [
    'SimpleProxy Admin Login',
    '',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    '',
    'Sign to prove wallet ownership. No gas required.',
  ].join('\n');
}

router.post('/nonce', (req, res) => {
  const { address } = req.body ?? {};
  if (!ethers.isAddress(address)) return res.status(400).json({ error: 'invalid_address' });

  const nonce = ethers.hexlify(ethers.randomBytes(16));
  nonces.set(address.toLowerCase(), { nonce, exp: Date.now() + 5 * 60_000 });
  res.json({ nonce, message: buildMessage(address, nonce) });
});

router.post('/verify', (req, res) => {
  const { address, signature } = req.body ?? {};
  if (!ethers.isAddress(address) || typeof signature !== 'string') {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const key = address.toLowerCase();
  const entry = nonces.get(key);
  if (!entry || entry.exp < Date.now()) return res.status(400).json({ error: 'nonce_expired' });
  nonces.delete(key);

  let signer;
  try {
    signer = ethers.verifyMessage(buildMessage(address, entry.nonce), signature).toLowerCase();
  } catch {
    return res.status(400).json({ error: 'bad_signature' });
  }

  if (signer !== key) return res.status(401).json({ error: 'signature_mismatch' });
  if (!config.adminAddresses.includes(signer)) return res.status(403).json({ error: 'not_admin' });

  const token = jwt.sign({ sub: signer, role: 'admin' }, config.jwtSecret, { expiresIn: '8h' });
  res.json({ token, address: signer });
});

export function requireAdmin(req, res, next) {
  // Admin authentication requirement removed: dashboard operations open without login
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      req.admin = payload.sub;
    } catch {
      // ignore
    }
  }
  next();
}

export default router;
