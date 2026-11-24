import crypto from 'node:crypto';

const key = () => crypto.randomBytes(32).toString('base64');
console.log(`DATA_ENCRYPTION_KEY=${key()}\nDATA_HASH_KEY=${key()}\nJOBS_SECRET=${crypto.randomBytes(32).toString('base64url')}`);
