module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Run tests sequentially to avoid snarkjs WASM worker conflicts
  // This prevents bus errors from parallel WASM execution
  maxWorkers: 1,
  // Force sequential execution (alternative to maxWorkers: 1)
  // runInBand: true,
  // Increase timeout for proof generation tests
  testTimeout: 60000,
  // Collect coverage from source files
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.test.ts',
  ],
  // Module file extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  // Transform files
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        allowJs: true,
      },
    }],
    // Transform all .js files (babel will handle ES modules)
    // transformIgnorePatterns will exclude most node_modules except @noble/ed25519
    // Use babel.config.js for babel-jest configuration
    '^.+\\.js$': 'babel-jest',
  },
  // Transform @noble/ed25519 (ES module) even though it's in node_modules
  // Handle both regular node_modules and pnpm structure (.pnpm/@noble+ed25519@...)
  // transformIgnorePatterns: if pattern matches, file is IGNORED (not transformed)
  // We want to IGNORE all node_modules EXCEPT @noble/ed25519
  // So the pattern should match everything that is NOT @noble/ed25519
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm/@noble\\+ed25519@|@noble/ed25519))',
  ],
  // Test match patterns
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts',
  ],
  // Setup and teardown files
  globalSetup: '<rootDir>/test/setup.js',
  globalTeardown: '<rootDir>/test/teardown.js',
  // Force exit after tests complete to prevent hanging
  forceExit: true,
  // Detect open handles to help debug hanging issues
  detectOpenHandles: false, // Set to true for debugging
};
