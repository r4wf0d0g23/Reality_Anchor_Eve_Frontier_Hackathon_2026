#!/usr/bin/env tsx
/**
 * Extract timing information from Jest test output
 * 
 * Usage: jest test/proofs/proofGeneration.spec.ts 2>&1 | tsx scripts/extractTimings.ts
 */

import { stdin } from 'process';

interface TimingData {
    testName: string;
    merkleTree?: number;
    corePod?: number;
    zkProof?: number;
    total?: number;
    merkleTreePlusZkProof?: number;
    directProof?: number;
}

function extractTimings(input: string): TimingData[] {
    const timings: TimingData[] = [];
    const lines = input.split('\n');
    
    // Collect timing blocks in order
    const timingBlocks: Array<{merkleTree?: number; corePod?: number; zkProof?: number; total?: number}> = [];
    let currentBlock: any = {};
    
    // Collect direct proof timings in order
    const directProofTimings: number[] = [];
    
    for (const line of lines) {
        // Core proof timings
        const merkleMatch = line.match(/\s*⏱️\s+Merkle tree generation:\s+(\d+)ms/i);
        if (merkleMatch) {
            currentBlock.merkleTree = parseInt(merkleMatch[1], 10);
            continue;
        }
        
        const corePodMatch = line.match(/\s*⏱️\s+Core POD generation:\s+(\d+)ms/i);
        if (corePodMatch) {
            currentBlock.corePod = parseInt(corePodMatch[1], 10);
            continue;
        }
        
        const zkProofMatch = line.match(/\s*⏱️\s+ZK proof generation:\s+(\d+)ms/i);
        if (zkProofMatch) {
            currentBlock.zkProof = parseInt(zkProofMatch[1], 10);
            continue;
        }
        
        const totalMatch = line.match(/\s*⏱️\s+Total time:\s+(\d+)ms/i);
        if (totalMatch) {
            currentBlock.total = parseInt(totalMatch[1], 10);
            if (currentBlock.merkleTree !== undefined && currentBlock.zkProof !== undefined) {
                currentBlock.merkleTreePlusZkProof = currentBlock.merkleTree + currentBlock.zkProof;
            }
            timingBlocks.push(currentBlock);
            currentBlock = {};
            continue;
        }
        
        // Direct proof timings - prefer "Test measured duration" over function-level timings
        // as it's what the test actually measures
        const testDurationMatch = line.match(/\s*⏱️\s+Test measured duration:\s+(\d+)ms/i);
        if (testDurationMatch) {
            const duration = parseInt(testDurationMatch[1], 10);
            directProofTimings.push(duration);
        }
    }
    
    // Match timing blocks to test names by order
    let coreIndex = 0;
    let directIndex = 0;
    
    for (const line of lines) {
        // Core proof tests
        if (line.includes('should generate core POD and zk proof')) {
            const testNameMatch = line.match(/should generate core POD and zk proof for (.+?)(?:\s+with timing)?(?:\s+\(|$)/);
            if (testNameMatch && coreIndex < timingBlocks.length) {
                timings.push({
                    testName: testNameMatch[1].trim(),
                    ...timingBlocks[coreIndex]
                });
                coreIndex++;
            }
        }
        
        // Direct proof tests - only add once per test
        if (line.includes('should generate') && line.includes('location proof')) {
            const isSecond = line.includes('second');
            const testName = isSecond ? 'location proof 2' : 'location proof 1';
            // Check if we already added this test
            if (!timings.find(t => t.testName === testName && t.directProof !== undefined) && directIndex < directProofTimings.length) {
                timings.push({
                    testName,
                    directProof: directProofTimings[directIndex]
                });
                directIndex++;
            }
        }
        
        if (line.includes('should generate') && line.includes('distance proof')) {
            // Check if we already added this test
            if (!timings.find(t => t.testName === 'distance proof' && t.directProof !== undefined) && directIndex < directProofTimings.length) {
                timings.push({
                    testName: 'distance proof',
                    directProof: directProofTimings[directIndex]
                });
                directIndex++;
            }
        }
    }
    
    // Fallback: if we have timing blocks but no test names, use inferred names
    if (coreIndex === 0 && timingBlocks.length > 0) {
        const testNames = ['location POD 1', 'location POD 2', 'distance POD'];
        timingBlocks.forEach((block, index) => {
            timings.push({
                testName: testNames[index] || `Test ${index + 1}`,
                ...block
            });
        });
    }
    
    return timings;
}

function formatTimings(timings: TimingData[]): string {
    if (timings.length === 0) {
        return 'No timing data found. Make sure to run tests with the core proof generation tests.';
    }
    
    // Separate by type
    const locationCore = timings.filter(t => t.testName.includes('location POD') && t.merkleTree !== undefined);
    const distanceCore = timings.filter(t => t.testName.includes('distance POD') && t.merkleTree !== undefined);
    const locationDirect = timings.filter(t => t.testName.includes('location proof') && t.directProof !== undefined);
    const distanceDirect = timings.filter(t => t.testName.includes('distance proof') && t.directProof !== undefined);
    
    let output = '\n=== Proof Generation Timings ===\n\n';
    
    // Location PODs (Core)
    if (locationCore.length > 0) {
        output += '--- Location PODs (Core Proofs) ---\n\n';
        for (const t of locationCore) {
            output += `Test: ${t.testName}\n`;
            if (t.merkleTree !== undefined) output += `  Merkle Tree Generation: ${t.merkleTree}ms (${(t.merkleTree / 1000).toFixed(2)}s)\n`;
            if (t.corePod !== undefined) output += `  Core POD Generation:    ${t.corePod}ms (${(t.corePod / 1000).toFixed(2)}s)\n`;
            if (t.zkProof !== undefined) output += `  ZK Proof Generation:    ${t.zkProof}ms (${(t.zkProof / 1000).toFixed(2)}s)\n`;
            if (t.merkleTreePlusZkProof !== undefined) output += `  Merkle Tree + ZK Proof: ${t.merkleTreePlusZkProof}ms (${(t.merkleTreePlusZkProof / 1000).toFixed(2)}s) ⭐\n`;
            if (t.total !== undefined) output += `  Total Time:             ${t.total}ms (${(t.total / 1000).toFixed(2)}s)\n`;
            output += '\n';
        }
    }
    
    // Distance PODs (Core)
    if (distanceCore.length > 0) {
        output += '--- Distance PODs (Core Proofs) ---\n\n';
        for (const t of distanceCore) {
            output += `Test: ${t.testName}\n`;
            if (t.merkleTree !== undefined) output += `  Merkle Tree Generation: ${t.merkleTree}ms (${(t.merkleTree / 1000).toFixed(2)}s)\n`;
            if (t.corePod !== undefined) output += `  Core POD Generation:    ${t.corePod}ms (${(t.corePod / 1000).toFixed(2)}s)\n`;
            if (t.zkProof !== undefined) output += `  ZK Proof Generation:    ${t.zkProof}ms (${(t.zkProof / 1000).toFixed(2)}s)\n`;
            if (t.merkleTreePlusZkProof !== undefined) output += `  Merkle Tree + ZK Proof: ${t.merkleTreePlusZkProof}ms (${(t.merkleTreePlusZkProof / 1000).toFixed(2)}s) ⭐\n`;
            if (t.total !== undefined) output += `  Total Time:             ${t.total}ms (${(t.total / 1000).toFixed(2)}s)\n`;
            output += '\n';
        }
    }
    
    // Location Proofs (Direct)
    if (locationDirect.length > 0) {
        output += '--- Location Proofs (Direct) ---\n\n';
        for (const t of locationDirect) {
            output += `Test: ${t.testName}\n`;
            if (t.directProof !== undefined) {
                output += `  Direct Proof Generation: ${t.directProof}ms (${(t.directProof / 1000).toFixed(2)}s)`;
                // Note about cold start for first proof
                if (t.testName === 'location proof 1' && locationDirect.length > 1) {
                    const secondTiming = locationDirect.find(t2 => t2.testName === 'location proof 2');
                    if (secondTiming?.directProof) {
                        const overhead = t.directProof - secondTiming.directProof;
                        output += ` (cold start: +${overhead}ms overhead)`;
                    }
                }
                output += '\n';
            }
            output += '\n';
        }
        // Add note about warm-up effect
        if (locationDirect.length > 1) {
            const first = locationDirect.find(t => t.testName === 'location proof 1');
            const second = locationDirect.find(t => t.testName === 'location proof 2');
            if (first?.directProof && second?.directProof) {
                const overhead = first.directProof - second.directProof;
                if (overhead > 100) {
                    output += `  Note: First proof includes ~${overhead}ms cold start overhead\n`;
                    output += `        (WASM loading, worker initialization, proving key loading)\n`;
                    output += `        Use location proof 2 timing (${second.directProof}ms) as performance baseline.\n\n`;
                }
            }
        }
    }
    
    // Distance Proofs (Direct)
    if (distanceDirect.length > 0) {
        output += '--- Distance Proofs (Direct) ---\n\n';
        for (const t of distanceDirect) {
            output += `Test: ${t.testName}\n`;
            if (t.directProof !== undefined) output += `  Direct Proof Generation: ${t.directProof}ms (${(t.directProof / 1000).toFixed(2)}s)\n`;
            output += '\n';
        }
    }
    
    return output;
}

// Read from stdin
let input = '';
stdin.setEncoding('utf8');
stdin.on('data', (chunk) => {
    input += chunk;
});
stdin.on('end', () => {
    const timings = extractTimings(input);
    const output = formatTimings(timings);
    console.log(output);
});
