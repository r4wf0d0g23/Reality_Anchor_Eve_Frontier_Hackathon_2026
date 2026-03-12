#!/usr/bin/env tsx
/**
 * Serialize verification key for Sui using arkworks Rust implementation
 * 
 * This script reads a snarkjs vkey.json file and serializes it to arkworks
 * compressed format using the Rust vkey-serializer tool, which uses the exact
 * same serialization method that Sui expects.
 * 
 * Usage:
 *   pnpm serialize:vkey <vkey.json> [output.hex]
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { buildRustVKeySerializer } from './buildRustVKeySerializer.js';

async function serializeVKeyForSui(vkeyPath: string, outputPath?: string): Promise<string> {
    // Read the vkey JSON
    const vkeyJson = await fs.readFile(vkeyPath, 'utf-8');
    
    // Get the path to the Rust serializer
    const projectRoot = path.resolve(__dirname, '..');
    const rustSerializerPath = path.join(projectRoot, 'src/on-chain/tools/rust-vkey-serializer/target/release/vkey-serializer');
    
    // Check if the binary exists, if not, fetch and build it
    try {
        await fs.access(rustSerializerPath);
    } catch {
        // Binary doesn't exist, fetch and build it
        console.log('Rust vkey serializer not found, fetching and building...');
        await buildRustVKeySerializer();
    }
    
    // Call the Rust binary with the JSON as stdin
    const result = spawnSync(rustSerializerPath, [], {
        input: vkeyJson,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false
    });
    
    if (result.error) {
        throw new Error(`Failed to run Rust serializer: ${result.error.message}`);
    }
    
    if (result.status !== 0) {
        const stderr = result.stderr?.toString() || 'Unknown error';
        throw new Error(`Rust serializer failed with status ${result.status}: ${stderr}`);
    }
    
    const serializedHex = result.stdout.toString().trim();
    
    // Write to output file if specified
    if (outputPath) {
        // Ensure directory exists
        const outputDir = path.dirname(outputPath);
        await fs.mkdir(outputDir, { recursive: true });
        await fs.writeFile(outputPath, serializedHex, 'utf-8');
        console.log(`✓ Serialized verification key saved to: ${outputPath}`);
    }
    
    return serializedHex;
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.error('Usage: pnpm serialize:vkey <vkey.json> [output.hex]');
        process.exit(1);
    }
    
    const vkeyPath = args[0];
    const outputPath = args[1];
    
    try {
        await serializeVKeyForSui(vkeyPath, outputPath);
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

export { serializeVKeyForSui };

