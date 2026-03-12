// Global teardown to ensure snarkjs workers are terminated after all tests
module.exports = async () => {
  console.log('\n=== Global Test Teardown ===');
  
  try {
    const { groth16 } = require('snarkjs');
    
    // Multiple attempts to ensure all workers are terminated
    for (let i = 0; i < 3; i++) {
      try {
        // Terminate all snarkjs workers
        if (typeof groth16?.thread?.terminateAll === 'function') {
          await groth16.thread.terminateAll();
        }
        
        // Also try to terminate individual workers if they exist
        if (typeof groth16?.thread?.terminate === 'function') {
          const workers = groth16.thread?.workers || [];
          for (const worker of workers) {
            try {
              await groth16.thread.terminate(worker);
            } catch (e) {
              // Ignore - worker may already be terminated
            }
          }
        }
        
        // Delay between attempts
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        // Continue to next attempt
        if (i === 2) {
          console.warn('⚠ Warning during worker termination attempt:', error.message);
        }
      }
    }
    
    // Final delay to ensure all cleanup completes
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Clean up any lingering move-analyzer processes spawned by tests
    // Note: We skip move-analyzer processes that are children of Cursor IDE (extension host)
    // as those are legitimate language server processes that should not be killed
    try {
      const { execSync } = require('child_process');
      // Only kill move-analyzer processes that are NOT children of Cursor
      // This is a best-effort cleanup for test-spawned processes only
      const result = execSync('ps aux | grep "move-analyzer" | grep -v grep | grep -v "Cursor" | awk \'{print $2}\' | xargs -r kill -9 2>/dev/null || true', { stdio: 'ignore' });
    } catch (error) {
      // Ignore cleanup errors - move-analyzer might not be running or might be a Cursor process
    }
    
    // Clean up any zombie sui processes from failed network starts
    try {
      const { execSync } = require('child_process');
      execSync('pkill -9 -f "sui start" 2>/dev/null || true', { stdio: 'ignore' });
    } catch (error) {
      // Ignore cleanup errors
    }
    
    // Clean up generated test files: logs, outputs, traces, test.log
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const projectRoot = process.cwd();
      
      // Clean test.log
      const testLogPath = path.join(projectRoot, 'logs', 'tests', 'world', 'test.log');
      try {
        await fs.unlink(testLogPath);
      } catch (error) {
        // Ignore if file doesn't exist
      }
      
      // Clean trace files
      const tracesDir = path.join(projectRoot, 'logs', 'tests', 'world', 'traces');
      try {
        const files = await fs.readdir(tracesDir);
        for (const file of files) {
          if (file.endsWith('.zst')) {
            try {
              await fs.unlink(path.join(tracesDir, file));
            } catch (error) {
              // Ignore individual file errors
            }
          }
        }
      } catch (error) {
        // Ignore if directory doesn't exist
      }
      
      // Clean outputs directory (but keep the directory structure)
      const outputDirs = [
        path.join(projectRoot, 'outputs', 'pods'),
        path.join(projectRoot, 'outputs', 'merkle', 'trees'),
        path.join(projectRoot, 'outputs', 'merkle', 'multiproofs'),
        path.join(projectRoot, 'outputs', 'proofs', 'on-chain', 'location-attestation'),
        path.join(projectRoot, 'outputs', 'proofs', 'on-chain', 'distance-attestation'),
      ];
      
      for (const dir of outputDirs) {
        try {
          const files = await fs.readdir(dir);
          for (const file of files) {
            try {
              const filePath = path.join(dir, file);
              const stat = await fs.stat(filePath);
              if (stat.isFile()) {
                await fs.unlink(filePath);
              } else if (stat.isDirectory()) {
                await fs.rm(filePath, { recursive: true, force: true });
              }
            } catch (error) {
              // Ignore individual file errors
            }
          }
        } catch (error) {
          // Ignore if directory doesn't exist
        }
      }
    } catch (error) {
      // Ignore cleanup errors - this is best effort
    }
    
    console.log('✓ Global test teardown complete');
  } catch (error) {
    console.warn('⚠ Warning during global teardown:', error.message);
    // Don't fail the test suite if teardown has issues
  }
};

