#!/usr/bin/env tsx
/**
 * Fetch the rust-vkey-serializer from a git repository
 * 
 * This script clones the rust-vkey-serializer repository into
 * src/on-chain/tools/rust-vkey-serializer if it doesn't already exist.
 * 
 * The repository URL can be configured via:
 * - RUST_VKEY_SERIALIZER_REPO environment variable
 * - Or update the default URL in this script
 * 
 * Usage:
 *   pnpm rust:vkey-serializer:fetch
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

const DEFAULT_REPO_URL = process.env.RUST_VKEY_SERIALIZER_REPO || 'https://github.com/your-org/rust-vkey-serializer.git';
const DEFAULT_BRANCH = process.env.RUST_VKEY_SERIALIZER_BRANCH || 'main';

async function fetchRustVKeySerializer(): Promise<void> {
    const projectRoot = path.resolve(__dirname, '..');
    const toolsDir = path.join(projectRoot, 'src/on-chain/tools');
    const targetDir = path.join(toolsDir, 'rust-vkey-serializer');
    
    // Check if the directory already exists
    try {
        const stats = await fs.stat(targetDir);
        if (stats.isDirectory()) {
            console.log('✓ rust-vkey-serializer already exists, skipping fetch');
            return;
        }
    } catch {
        // Directory doesn't exist, proceed with fetch
    }
    
    // Ensure the tools directory exists
    try {
        await fs.mkdir(toolsDir, { recursive: true });
    } catch (error) {
        throw new Error(`Failed to create tools directory: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Clone the repository
    const repoUrl = process.env.RUST_VKEY_SERIALIZER_REPO || DEFAULT_REPO_URL;
    const branch = process.env.RUST_VKEY_SERIALIZER_BRANCH || DEFAULT_BRANCH;
    
    console.log(`Fetching rust-vkey-serializer from ${repoUrl} (branch: ${branch})...`);
    
    // Use git clone with depth 1 for faster cloning
    const cloneResult = spawnSync('git', [
        'clone',
        '--depth', '1',
        '--branch', branch,
        repoUrl,
        targetDir
    ], {
        cwd: toolsDir,
        stdio: 'inherit',
        shell: false
    });
    
    if (cloneResult.error) {
        throw new Error(`Failed to clone repository: ${cloneResult.error.message}`);
    }
    
    if (cloneResult.status !== 0) {
        throw new Error(`Git clone failed with status ${cloneResult.status}`);
    }
    
    console.log('✓ Successfully fetched rust-vkey-serializer');
}

// CLI interface
async function main() {
    try {
        await fetchRustVKeySerializer();
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

export { fetchRustVKeySerializer };

