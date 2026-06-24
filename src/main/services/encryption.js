const crypto = require('crypto');
const { getMachineCode } = require('./machineId');

// Standard algorithm for authenticated encryption
const ALGORITHM = 'aes-256-gcm';
// A static salt used in combination with the machine code to derive the 32-byte encryption key
const STORAGE_SALT = 'HL-MCK-STORAGE-ENCRYPTION-SALT-2024';

let cachedKey = null;

/**
 * Derives a stable 32-byte encryption key bound to the hardware machine code.
 * Cached in memory to avoid recalculating on every read/write.
 */
function getEncryptionKey() {
  if (cachedKey) return cachedKey;
  try {
    const machineCode = getMachineCode(); // E.g., 'XXXX XXXX XXXX XXXX'
    // Combine hardware ID with salt and hash it to get exactly 32 bytes (256 bits)
    const rawData = machineCode.replace(/\s/g, '') + STORAGE_SALT;
    cachedKey = crypto.createHash('sha256').update(rawData).digest();
    return cachedKey;
  } catch (error) {
    console.error('[Encryption] Failed to derive hardware key:', error);
    // Fallback key if machine ID fails (extremely rare, but prevents crashes)
    cachedKey = crypto.createHash('sha256').update('FALLBACK-KEY-' + STORAGE_SALT).digest();
    return cachedKey;
  }
}

/**
 * Encrypts a plain text string using AES-256-GCM.
 * Output format (base64): iv(12 bytes) : authTag(16 bytes) : ciphertext
 * @param {string} text - The plain text JSON string to encrypt
 * @returns {string} The encrypted string
 */
function encryptProfileStorage(text) {
  try {
    const key = getEncryptionKey();
    // GCM recommended IV size is 12 bytes
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext (all base64 encoded)
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
  } catch (error) {
    console.error('[Encryption] Encryption failed:', error);
    throw new Error('Failed to encrypt profile storage');
  }
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 * @param {string} encryptedText - The encrypted string format (iv:authTag:ciphertext)
 * @returns {string|null} The decrypted plain text JSON string, or null if decryption fails
 */
function decryptProfileStorage(encryptedText) {
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      return null; // Not in the expected encrypted format
    }

    const [ivBase64, authTagBase64, ciphertextBase64] = parts;
    
    const key = getEncryptionKey();
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(ciphertextBase64, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    // Decryption will fail if hardware key changes (machine changed) or file is corrupted/tampered
    console.error('[Encryption] Decryption failed (hardware mismatch or corrupt data).');
    return null;
  }
}

module.exports = {
  encryptProfileStorage,
  decryptProfileStorage
};
