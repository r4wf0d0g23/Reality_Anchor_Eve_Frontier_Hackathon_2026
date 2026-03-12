#!/usr/bin/env tsx
/**
 * Script to generate EDDSA-Poseidon authority keypair and save to .env
 * 
 * This generates:
 * - EDDSA_POSEIDON_AUTHORITY_PRIV_KEY: Private key (hex with 0x prefix)
 * - EDDSA_POSEIDON_AUTHORITY_PUB_KEY: Public key (base64)
 * 
 * Usage:
 *   pnpm generate-auth-key
 */

// Execute the generateAuthKey script directly
// The generateAuthKey.ts file is a standalone script that executes on import
require('../src/shared/utils/generateAuthKey.ts');

