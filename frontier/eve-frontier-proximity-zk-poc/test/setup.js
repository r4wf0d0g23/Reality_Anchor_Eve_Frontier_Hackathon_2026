// Global setup to ensure snarkjs workers are properly initialized
// This runs once before all tests
module.exports = async () => {
  console.log('=== Global Test Setup ===');
  
  // Ensure snarkjs is loaded and workers are in a clean state
  try {
    const { groth16 } = require('snarkjs');
    
    // Terminate any existing workers to start fresh
    if (typeof groth16?.thread?.terminateAll === 'function') {
      await groth16.thread.terminateAll();
      console.log('✓ Cleaned up any existing snarkjs workers');
    }
    
    // Small delay to ensure cleanup completes
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log('✓ Global test setup complete');
  } catch (error) {
    console.warn('⚠ Warning during global setup:', error.message);
    // Don't fail the test suite if setup has issues
  }
};

