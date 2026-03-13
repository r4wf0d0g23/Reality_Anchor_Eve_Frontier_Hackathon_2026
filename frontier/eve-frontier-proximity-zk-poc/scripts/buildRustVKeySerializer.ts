#!/usr/bin/env tsx
/**
 * Build the rust-vkey-serializer
 * 
 * This script:
 * 1. Fetches the rust-vkey-serializer from a git repository if it doesn't exist
 * 2. Builds the Rust project
 * 
 * Usage:
 *   pnpm rust:vkey-serializer:build
 */

import { spawnSync } from 'child_process';
import * as path from 'path';
import { fetchRustVKeySerializer } from './fetchRustVKeySerializer.js';

async function buildRustVKeySerializer(): Promise<void> {
    const projectRoot = path.resolve(__dirname, '..');
    const cargoPath = path.join(projectRoot, 'src/on-chain/tools/rust-vkey-serializer');
    
    // First, ensure the repository is fetched
    await fetchRustVKeySerializer();
    
    // Build the Rust project
    console.log('Building rust-vkey-serializer...');
    const buildResult = spawnSync('cargo', ['build', '--release'], {
        cwd: cargoPath,
        stdio: 'inherit',
        shell: false
    });
    
    if (buildResult.error) {
        throw new Error(`Failed to build Rust serializer: ${buildResult.error.message}`);
    }
    
    if (buildResult.status !== 0) {
        throw new Error(`Cargo build failed with status ${buildResult.status}`);
    }
    
    console.log('✓ Successfully built rust-vkey-serializer');
}

// CLI interface
async function main() {
    try {
        await buildRustVKeySerializer();
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

export { buildRustVKeySerializer };

