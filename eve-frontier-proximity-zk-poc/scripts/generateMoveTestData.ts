#!/usr/bin/env tsx

/**
 * Script to generate Move test data from actual proof files
 * 
 * Usage:
 *   tsx scripts/generateMoveTestData.ts <core_proof_path> [merkle_proof_path] [merkle_root]
 * 
 * Example:
 *   tsx scripts/generateMoveTestData.ts src/poofs/proofs/core/core_proof_123.json src/merkle/location/location_merkle_proof.json 0xabcd...
 */

import path from 'path';
import { generateMoveTestFile } from '../src/utils/generateMoveTestData';

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.error('Usage: tsx scripts/generateMoveTestData.ts <core_proof_path> [merkle_proof_path] [merkle_root]');
        process.exit(1);
    }
    
    const coreProofPath = path.resolve(args[0]);
    const merkleProofPath = args[1] ? path.resolve(args[1]) : undefined;
    const merkleRoot = args[2] || undefined;
    
    // Output to move/example/tests/verifier_integration_tests.move
    const outputPath = path.resolve(
        process.cwd(),
        'move',
        'example',
        'tests',
        'verifier_integration_tests.move'
    );
    
    try {
        await generateMoveTestFile(outputPath, coreProofPath, merkleProofPath, merkleRoot);
        console.log('\n✓ Move test file generated successfully!');
        console.log(`  Run 'pnpm move:test' to test the generated code`);
    } catch (error: any) {
        console.error('Error generating Move test file:', error.message);
        process.exit(1);
    }
}

main().catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});

