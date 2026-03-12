#!/usr/bin/env tsx

/**
 * Script to generate Move test files for location attestation (wrapped in core proof)
 * 
 * This script:
 * 1. Generates a location attestation POD
 * 2. Generates a core POD with Merkle root
 * 3. Generates a core ZK proof
 * 4. Generates a Merkle proof
 * 5. Generates Move test files from the proofs
 * 
 * Usage:
 *   tsx scripts/generateLocationMoveTests.ts
 */

import path from 'path';
import fs from 'fs/promises';
import { POD } from '@pcd/pod';
import * as groth16 from 'snarkjs';
import { generateLocationAttestationPod } from '../src/pods/utils/generateLocationAttestationPod';
import { generateCorePod } from '../src/pods/utils/generateCorePod';
import { generateCoreProof } from '../src/poofs/utils/generateCoreProof';
import { generatePodMerkleTree } from '../src/merkle/utils/podMerkleUtils';
import { generateMerkleProof } from '../src/merkle/utils/generateMerkleProof';
import { generateMoveTestFile } from '../src/utils/generateMoveTestData';
import { loadPrivateKey } from '../src/utils/fsUtils';
import { LocationAttestationData } from '../src/types/locationType';

async function main() {
    console.log('=== Generating Location Attestation Move Test Files ===\n');

    // Load private key
    let testPrivateKey: string;
    try {
        testPrivateKey = loadPrivateKey();
        console.log('✓ Loaded private key\n');
    } catch (error: any) {
        console.error('❌ Error loading private key:', error.message);
        console.error('Please set EDDSA_POSEIDON_AUTHORITY_PRIV_KEY in .env');
        process.exit(1);
    }

    // Generate location attestation data
    const locationData: LocationAttestationData = {
        objectId: '0x' + '1'.repeat(64), // Valid 32-byte Sui object ID
        solarSystemId: 987,
        coordinates: { x: 1000, y: 2000, z: 3000 },
        pod_data_type: 'evefrontier.location_attestation',
        timestamp: BigInt(Date.now())
    };

    console.log('1. Generating location attestation POD...');
    const { jsonPod: locationPodJson, filePath: locationPodPath } = 
        await generateLocationAttestationPod(locationData, testPrivateKey);
    console.log(`   ✓ Location POD saved to: ${locationPodPath}\n`);

    const locationPod = POD.fromJSON(locationPodJson);
    const podEntries = locationPod.content.asEntries();

    console.log('2. Generating core POD with Merkle root...');
    const { jsonPod: corePodJson, filePath: corePodPath, merkleTreeResult } = 
        await generateCorePod(podEntries, locationData.pod_data_type, testPrivateKey);
    console.log(`   ✓ Core POD saved to: ${corePodPath}`);
    console.log(`   ✓ Merkle root: ${merkleTreeResult.root}\n`);

    const corePod = POD.fromJSON(corePodJson);

    console.log('3. Generating core ZK proof...');
    const { filePath: coreProofPath } = await generateCoreProof(corePod);
    console.log(`   ✓ Core proof saved to: ${coreProofPath}\n`);

    console.log('4. Generating Merkle proof...');
    // Save tree dump
    const merkleDir = path.resolve(process.cwd(), 'src', 'merkle', 'location');
    await fs.mkdir(merkleDir, { recursive: true });

    const podFileName = path.basename(locationPodPath, '.json');
    const treeDumpPath = path.join(merkleDir, `${podFileName}_merkle_tree.json`);
    const treeDump = merkleTreeResult.tree.dump();
    await fs.writeFile(treeDumpPath, JSON.stringify(treeDump, null, 2));
    console.log(`   ✓ Merkle tree dump saved to: ${treeDumpPath}`);

    // Generate Merkle proof for all fields
    const fieldNames = Object.keys(podEntries).filter(
        k => k !== 'sha256_merkle_root' && k !== 'keccak256_merkle_root'
    );
    const merkleProofPath = path.join(merkleDir, `${podFileName}_merkle_proof.json`);
    await generateMerkleProof(
        treeDumpPath,
        locationPodPath,
        fieldNames,
        locationData.pod_data_type,
        merkleProofPath
    );
    console.log(`   ✓ Merkle proof saved to: ${merkleProofPath}\n`);

    console.log('5. Generating Move test file...');
    const moveTestPath = path.resolve(
        process.cwd(),
        'move',
        'example',
        'tests',
        'verifier_integration_tests.move'
    );
    
    await generateMoveTestFile(
        moveTestPath,
        coreProofPath,
        merkleProofPath,
        merkleTreeResult.root
    );
    console.log(`   ✓ Move test file saved to: ${moveTestPath}\n`);

    // Verify the test file was created
    const testFileContent = await fs.readFile(moveTestPath, 'utf-8');
    console.log('=== Generated Move Test File Summary ===');
    console.log(`   File size: ${testFileContent.length} bytes`);
    console.log(`   Contains Groth16 test: ${testFileContent.includes('test_verify_core_proof_real_data')}`);
    console.log(`   Contains Merkle test: ${testFileContent.includes('test_verify_merkle_proof_real_data')}`);
    console.log('\n✓ All files generated successfully!');
    console.log(`\nNext steps:`);
    console.log(`  1. Run 'pnpm move:test' to test the generated Move code`);
    console.log(`  2. The test file is located at: ${moveTestPath}`);

    // Cleanup snarkjs workers
    console.log('\nCleaning up snarkjs workers...');
    try {
        if (typeof (groth16 as any)?.thread?.terminateAll === 'function') {
            // Add timeout to prevent hanging
            const cleanupPromise = (groth16 as any).thread.terminateAll();
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Cleanup timeout')), 1000)
            );
            
            try {
                await Promise.race([cleanupPromise, timeoutPromise]);
                console.log('✓ snarkjs workers terminated');
            } catch (timeoutError: any) {
                if (timeoutError.message === 'Cleanup timeout') {
                    console.warn('⚠ Cleanup timed out (workers may still be terminating in background)');
                } else {
                    throw timeoutError;
                }
            }
        } else {
            console.log('✓ No snarkjs workers to clean up');
        }
    } catch (cleanupError: any) {
        // Ignore cleanup errors - workers may already be terminated
        console.warn('⚠ Warning during cleanup (safe to ignore):', cleanupError.message);
    }
}

main()
    .then(() => {
        // Ensure process exits cleanly
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Unexpected error:', error);
        if (error.stack) {
            console.error(error.stack);
        }
        // Cleanup on error
        try {
            if (typeof (groth16 as any)?.thread?.terminateAll === 'function') {
                (groth16 as any).thread.terminateAll().catch(() => {});
            }
        } catch (e) {
            // Ignore cleanup errors
        }
        process.exit(1);
    });

