#!/usr/bin/env tsx
/**
 * Clean generated files and directories
 * 
 * Removes:
 * - outputs/ - Generated PODs, proofs, Merkle trees
 * - logs/ - Log files
 * - coverage/ - Test coverage reports
 * - *.log - Log files in root
 * 
 * Usage:
 *   pnpm clean
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';

const projectRoot = path.resolve(__dirname, '..');

async function cleanDirectory(dirPath: string, description: string): Promise<void> {
    try {
        const fullPath = path.join(projectRoot, dirPath);
        const stats = await fs.stat(fullPath).catch(() => null);
        
        if (stats && stats.isDirectory()) {
            await fs.rm(fullPath, { recursive: true, force: true });
            console.log(`✓ Removed ${description}: ${dirPath}`);
        } else {
            console.log(`  ${description} does not exist: ${dirPath}`);
        }
    } catch (error: any) {
        console.warn(`⚠ Could not remove ${description} (${dirPath}): ${error.message}`);
    }
}

async function cleanFiles(pattern: string, description: string): Promise<void> {
    try {
        // Use find command for cross-platform compatibility (works on macOS/Linux)
        const command = process.platform === 'win32' 
            ? `Get-ChildItem -Path . -Filter ${pattern} -Recurse -File | Remove-Item -Force`
            : `find . -name "${pattern}" -type f -delete 2>/dev/null || true`;
        
        if (process.platform === 'win32') {
            // For Windows, we'll use a simpler approach
            execSync(`powershell -Command "${command}"`, { cwd: projectRoot, stdio: 'ignore' });
        } else {
            execSync(command, { cwd: projectRoot, stdio: 'ignore' });
        }
        console.log(`✓ Cleaned ${description} (pattern: ${pattern})`);
    } catch (error: any) {
        // Ignore errors - files may not exist
    }
}

async function cleanTraceFiles(): Promise<void> {
    try {
        const tracesDir = path.join(projectRoot, 'logs', 'tests', 'world', 'traces');
        const stats = await fs.stat(tracesDir).catch(() => null);
        
        if (stats && stats.isDirectory()) {
            const files = await fs.readdir(tracesDir);
            for (const file of files) {
                if (file.endsWith('.zst')) {
                    try {
                        await fs.unlink(path.join(tracesDir, file));
                    } catch (error: any) {
                        // Ignore individual file errors
                    }
                }
            }
            console.log(`✓ Cleaned trace files in logs/tests/world/traces/`);
        }
    } catch (error: any) {
        // Ignore errors
    }
}

async function main() {
    console.log('=== Cleaning Generated Files ===\n');
    
    // Clean directories
    await cleanDirectory('outputs', 'Generated outputs');
    await cleanDirectory('logs', 'Log files');
    await cleanDirectory('coverage', 'Test coverage');
    await cleanDirectory('.jest-cache', 'Jest cache');
    
    // Clean log files in root
    await cleanFiles('*.log', 'Log files');
    
    // Clean test.log in logs directory (if it exists)
    try {
        const testLogPath = path.join(projectRoot, 'logs', 'tests', 'world', 'test.log');
        await fs.unlink(testLogPath);
        console.log(`✓ Removed test log: logs/tests/world/test.log`);
    } catch (error: any) {
        if (error.code !== 'ENOENT') {
            console.warn(`⚠ Could not remove test log: ${error.message}`);
        }
    }
    
    // Clean trace files
    await cleanTraceFiles();
    
    console.log('\n✓ Cleanup complete');
}

main().catch((error) => {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
});

