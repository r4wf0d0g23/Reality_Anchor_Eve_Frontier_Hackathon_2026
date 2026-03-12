#!/usr/bin/env tsx

/**
 * Script to generate Ed25519 keypair for Sui signing and save to .env
 * 
 * This generates:
 * - ED25519_PRIVATE_KEY: Private key (Bech32 format: suiprivkey...)
 * - ED25519_PUBLIC_KEY: Public key (hex string, no 0x prefix)
 * 
 * Usage:
 *   tsx scripts/generateEd25519Key.ts
 */

import { generateAndSaveEd25519Keys } from '../src/shared/utils/fsUtils';

async function main() {
    console.log('=== Generating Ed25519 Keypair for Sui Signing ===\n');
    
    try {
        const { privateKey, publicKey } = generateAndSaveEd25519Keys();
        
        console.log('\n✓ Ed25519 keypair generated and saved to .env');
        console.log('\nKeys:');
        console.log(`  Private Key: ${privateKey}`);
        console.log(`  Public Key:  ${publicKey}`);
        console.log(`  Sui Address: (use public key with Ed25519Keypair to get address)`);
        
        console.log('\n⚠️  IMPORTANT: Keep your private key secure!');
        console.log('   - Never commit .env file to version control');
        console.log('   - Ensure .env is in .gitignore');
        
    } catch (error: any) {
        console.error('❌ Error generating Ed25519 keys:', error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

main();

