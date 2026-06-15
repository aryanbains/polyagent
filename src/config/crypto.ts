import * as crypto from 'node:crypto';
import os from 'node:os';
import type {EncryptedSecret} from '../domain.js';

const ALGORITHM = 'aes-256-gcm';

function deriveLocalKey(): Buffer {
	const identity = [
		os.userInfo().username,
		os.hostname(),
		os.platform(),
		os.arch()
	].join(':');

	return crypto.createHash('sha256').update(`polyagent:${identity}`).digest();
}

export function encryptSecret(secret: string): EncryptedSecret | null {
	if (secret.length === 0) {
		return null;
	}

	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv(ALGORITHM, deriveLocalKey(), iv);
	const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();

	return {
		storage: 'local-aes-256-gcm',
		algorithm: ALGORITHM,
		iv: iv.toString('base64'),
		tag: tag.toString('base64'),
		ciphertext: ciphertext.toString('base64')
	};
}

export function decryptSecret(secret: EncryptedSecret | null): string {
	if (secret === null) {
		return '';
	}

	const decipher = crypto.createDecipheriv(
		ALGORITHM,
		deriveLocalKey(),
		Buffer.from(secret.iv, 'base64')
	);
	decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));

	return Buffer.concat([
		decipher.update(Buffer.from(secret.ciphertext, 'base64')),
		decipher.final()
	]).toString('utf8');
}
