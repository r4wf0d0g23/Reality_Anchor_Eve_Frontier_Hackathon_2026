import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import * as dotenv from 'dotenv';
import fs from 'fs';

export async function readJsonFile<T>(filePath: string, defaultVal: T): Promise<T> {
  try {
    const data = await readFile(filePath, 'utf-8');
    if (!data.trim()) {
      console.warn(`Warning: ${filePath} is empty or contains only whitespace. Returning default value.`);
      return defaultVal;
    }
    return JSON.parse(data) as T;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.warn(`Warning: ${filePath} not found. Returning default value.`);
      return defaultVal;
    } else if (error instanceof SyntaxError) {
      console.error(`Error parsing JSON from ${filePath}: ${error.message}`);
      console.warn(`Malformed JSON in ${filePath}. Returning default value.`);
      return defaultVal;
    }
    console.error(`Error reading file ${filePath}:`, error);
    throw error; // Re-throw other errors
  }
}

export async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    // Write file with BigInt replacer
    const replacer = (key: string, value: any) =>
      typeof value === 'bigint'
        ? value.toString() // Convert BigInt to simple string
        : value; // Return other values unchanged

    await writeFile(filePath, JSON.stringify(data, replacer, 2), 'utf-8');
    console.log(`Successfully wrote data to ${filePath}`);
  } catch (error) {
    console.error(`Error writing file ${filePath}:`, error);
    throw error;
  }
}

export function loadPrivateKey(): string {
  const keyVariableName = 'EDDSA_POSEIDON_AUTHORITY_PRIV_KEY';

  // Load .env from project root
  // Try multiple paths to handle different execution contexts (tests, scripts, etc.)
  const possiblePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '..', '..', '.env'),
    path.resolve(__dirname, '..', '..', '..', '.env'),
  ];
  
  let envPath: string | null = null;
  for (const possiblePath of possiblePaths) {
    if (fs.existsSync(possiblePath)) {
      envPath = possiblePath;
      break;
    }
  }
  
  if (envPath) {
    dotenv.config({ path: envPath });
    console.log(`Loaded environment variables from: ${envPath}`);
  } else {
    console.warn(`Warning: .env file not found in any of these locations: ${possiblePaths.join(', ')}`);
  }

  const privateKey = process.env[keyVariableName];

  if (!privateKey) {
    const errorMsg = `${keyVariableName} is not set in the environment or any .env file. Please run 'pnpm generate-auth-key' first or set it in your .env file.`;
    console.error(`Error: ${errorMsg}`);
    throw new Error(errorMsg);
  }

  // Remove 0x prefix if present, as @pcd/pod expects raw hex
  return privateKey.startsWith('0x') ? privateKey.substring(2) : privateKey;
}

/**
 * Loads the authority's EdDSA public key from environment variables.
 * Assumes the key is stored as EDDSA_POSEIDON_AUTHORITY_PUB_KEY
 * and is a packed hexadecimal string representation.
 *
 * @returns {string} The EdDSA public key as a packed hexadecimal string.
 */
export function loadPublicKey(): string {
    // Load .env from project root (same as loadPrivateKey)
    const envPath = path.resolve(__dirname, '..', '..', '.env');
    
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
    } else {
        console.warn(`Warning: ${envPath} not found. EDDSA_POSEIDON_AUTHORITY_PUB_KEY might be missing.`);
    }

    const packedPublicKeyHex = process.env.EDDSA_POSEIDON_AUTHORITY_PUB_KEY;

    if (!packedPublicKeyHex) {
        throw new Error(
            'Missing EDDSA_POSEIDON_AUTHORITY_PUB_KEY in environment variables. ' +
            'Please ensure it is set in the relevant .env file.'
        );
    }

    // Return the string value directly
    return packedPublicKeyHex;
}

/**
 * Loads Ed25519 private key from environment variables.
 * 
 * @returns Ed25519 private key as Bech32 string (suiprivkey...) or hex string (for backward compatibility)
 * @throws Error if ED25519_PRIVATE_KEY is not set
 */
export function loadEd25519PrivateKey(): string {
    const keyVariableName = 'ED25519_PRIVATE_KEY';
    const envPath = path.resolve(__dirname, '..', '..', '.env');
    
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
    }
    
    const privateKey = process.env[keyVariableName];
    
    if (!privateKey) {
        throw new Error(
            `${keyVariableName} is not set in the environment or any .env file. ` +
            `Please set it in your .env file or run 'pnpm generate-ed25519-key' to generate one.`
        );
    }
    
    // Return as-is (Bech32 format or hex format)
    return privateKey;
}

/**
 * Loads Ed25519 public key from environment variables.
 * 
 * @returns Ed25519 public key as hex string (without 0x prefix)
 * @throws Error if ED25519_PUBLIC_KEY is not set
 */
export function loadEd25519PublicKey(): string {
    const keyVariableName = 'ED25519_PUBLIC_KEY';
    const envPath = path.resolve(__dirname, '..', '..', '.env');
    
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
    }
    
    const publicKey = process.env[keyVariableName];
    
    if (!publicKey) {
        throw new Error(
            `${keyVariableName} is not set in the environment or any .env file. ` +
            `Please set it in your .env file or run 'pnpm generate-ed25519-key' to generate one.`
        );
    }
    
    // Remove 0x prefix if present
    return publicKey.startsWith('0x') ? publicKey.substring(2) : publicKey;
}

/**
 * Generates Ed25519 keypair and saves both private and public keys to .env file.
 * 
 * This function:
 * 1. Generates a new Ed25519 keypair
 * 2. Derives the public key from the private key
 * 3. Saves both to .env file
 * 
 * @returns Object with private and public keys (hex strings without 0x prefix)
 */
export function generateAndSaveEd25519Keys(): { privateKey: string; publicKey: string } {
    const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
    const envPath = path.resolve(__dirname, '..', '..', '.env');
    
    // Generate new Ed25519 keypair
    const keypair = new Ed25519Keypair();
    // getSecretKey() returns Bech32-encoded string (Sui's native format)
    const privateKey = keypair.getSecretKey();
    const publicKey = Buffer.from(keypair.getPublicKey().toRawBytes()).toString('hex');
    
    // Read existing .env content
    let envContent = '';
    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf-8');
    }
    
    // Remove existing Ed25519 keys if present
    const lines = envContent.split('\n');
    const filteredLines = lines.filter(line => 
        !line.startsWith('ED25519_PRIVATE_KEY=') && 
        !line.startsWith('ED25519_PUBLIC_KEY=')
    );
    
    // Add new keys
    const newLines = [
        ...filteredLines,
        `ED25519_PRIVATE_KEY=${privateKey}`,
        `ED25519_PUBLIC_KEY=${publicKey}`
    ];
    
    // Write back to .env
    fs.writeFileSync(envPath, newLines.join('\n') + '\n', 'utf-8');
    console.log(`Generated and saved Ed25519 keys to ${envPath}`);
    console.log(`  ED25519_PRIVATE_KEY=${privateKey}`);
    console.log(`  ED25519_PUBLIC_KEY=${publicKey}`);
    
    return { privateKey, publicKey };
} 