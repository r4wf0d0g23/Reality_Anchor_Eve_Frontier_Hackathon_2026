# Eve Frontier Proximity ZK PoC: Location and Distance Attestation System

A zero-knowledge proof system for obfuscated location and distance verification in Eve Frontier on the Sui blockchain, using optimized Groth16 circuits and POD (Provable Object Datatype) structures.

## Overview

This project provides two main capabilities:

### 1. On-Chain: Obfuscated Location and Distance Verification

**Goal**: Enable privacy-preserving location and distance attestations on-chain using optimized Groth16 circuits.

- **Location Attestation**: Prove knowledge of an object's location (coordinates) without revealing the exact coordinates on-chain
- **Distance Attestation**: Prove the distance between two objects without revealing their individual locations
- **Circuit Optimization**: Custom Groth16 circuits (`location-attestation`, `distance-attestation`) for efficient on-chain verification
  - **Performance**: ~320ms location proof generation, ~250ms distance proof generation
- **Merkle Proofs**: Poseidon-based Merkle trees for efficient in-circuit and on-chain inclusion proofs
- **Ed25519 Signatures**: Cryptographic binding of location data to authorized signers

**Key Features**:
- Deterministic object ID generation using `derived_object::claim`
- **Fixed Objects**: Location set once during creation (for deployed assemblies like stations, structures)
- **Dynamic Objects**: Location can be updated via `set_location` (for ships, characters, and other non-deployed objects)
- **Distance Verification**: Can be used independently; once distance is proven for fixed object pairs, it can be reused for subsequent operations
- Unified `ObjectRegistry` for location and distance data storage
- Inline Groth16 verification

### 2. Off-Chain: POD/GCP Integration

**Goal**: General-purpose POD (Provable Object Datatype) and GPC (General Purpose Circuits) integration for off-chain use cases.

- **POD Structure**: Standard POD format with EDDSA-Poseidon signatures
- **Provable Object Datatype (POD)**: The foundational data structure that enables cryptographic attestation of object properties
- **GPC Circuits**: General Purpose Circuits for flexible attestation structures
- **Context IDs**: POD contentIDs used as context identifiers in distance proofs
- **Poseidon Merkle Roots**: Consistent Poseidon-based hashing across on-chain and off-chain

## Usage Patterns and Data Lifecycle

### Location Data Updates

Location data is designed to be **lazily updated** through natural game interactions:

- **Natural Updates**: When objects interact (e.g., assemblies are anchored, ships dock, characters interact with assemblies), the location attestation timestamp and **hidden salt** are automatically updated
- **Brute-Force Protection**: Salt randomization prevents brute-force attacks on location data
- **Force Updates**: Location data can also be force-updated at any time by providing new ZK proofs on-chain

### Timestamp-Based Attestations

POD attestations are **timestamp-based** to allow multiple re-use (as long as on-chain logic permits):

- **Fixed Objects**: Allow any timestamp for interaction as long as it's after object deployment
- **Dynamic Objects**: More restricted timestamp validation for real-time location updates
- **Staleness Enforcement**: On-chain logic is responsible for enforcing time data staleness based on use case requirements

### Distance Data Reuse

Once distance is proven between two fixed objects:

- The distance data is stored on-chain and can be **reused indefinitely** for subsequent operations (as long as those objects remain deployed in the same location)
- No need to regenerate proofs for the same object pair
- Enables efficient batch operations and game mechanics that rely on persistent distance relationships

## Usage and Benefits

### Information Asymmetry and Builder Choice

The system provides **multiple levels of data revelation**, giving builders flexibility in information asymmetry and meta gameplay trade-offs:

#### 1. POD Attestation Data (Most Private)
- **Clear text data** revealed only to direct observers
- Examples: Survey data, direct in-game interaction data, data about objects a character is piloting/using
- **Use Cases**:
  - Data marketplace for buying and selling location information of valuable objects in space
  - Corporate espionage and intelligence gathering
  - Player-to-player information trading

#### 2. ZK Proofs (Configurable Revelation)
- **Naturally hidden data**: Data is hidden by the merkle root structure and maximum ZK hidden configuration
- **Configurable revelation**: ZK proofs can be built and configured in various ways to reveal different pieces of data as needed
- **General Circuit Capabilities**: POD/GPC circuits can be configured for any proof structure
- **Merkle root integration**: The merkle root construction can also be used to reveal and verify attestation data on-chain
- **Strongest cryptographic binding**: Distance attestations are cryptographically bound to specific location ZK proofs and their underlying POD attestations, ensuring distance proofs cannot be reused with different location data
- **Use Cases**:
  - Off-chain tools and interactions
  - Player-built on-chain integrations
  - Privacy-preserving game mechanics
  - Selective data revelation based on use case requirements
  - Maximum privacy with cryptographic guarantees
  - Distance verification without location disclosure
  - Trustless proximity-based interactions

#### 3. Merkle Root Construction (On-Chain Verification and Usage)
- **Merkle inclusion proofs** allow revealing and verifying specific POD attestation data on-chain
- Builders can independently choose which POD entries to reveal and verify
- **Entry Merkle Root Structure**: Each POD entry can be verified independently via Merkle inclusion
- **Use Cases**:
  - Selective data revelation for on-chain operations
  - Verification of specific attestation properties without revealing others
  - Custom game mechanics that require partial data disclosure

### Architectural Benefits

#### POD Layer as Outer Wrapper
- The POD layer acts as an **outer wrapper** around the ZK proof system
- Enables builders to use **generalized circuits** to more easily build other ZK configurations around POD attestations
- Supports diverse use cases beyond location and distance

**Trade-offs**:
- **Generality vs Efficiency**: Generalized circuits (POD/GPC) provide flexibility but may be less efficient for proof generation compared to custom-optimized circuits
- **Hashing Differences**: POD uses SHA256 hashing for `bytes` types (while we use Poseidon for our unified format), and POD uses EDDSA-Poseidon signing (efficient for circuits but not supported on-chain in Sui, which is why we use Ed25519 for on-chain verification)
- **Circuit Optimization**: Our custom circuits (`location-attestation`, `distance-attestation`) are optimized for specific use cases, achieving ~320ms and ~250ms proof generation respectively

#### Generalized Distance and Timestamp Revelation
- The general revealing of **timestamp and distance** for two objects on-chain is highly generalized
- Can accommodate **any kind and multiple interactions** between two objects in space in parallel
- Simple information structure enables complex game mechanics

#### Merkle Root Flexibility
- **Entry Merkle Root Structure** allows builders to independently verify any POD attestation data on-chain via Merkle inclusion
- Builders have full control over **information asymmetry** and **meta gameplay trade-offs**
- Enables on-chain usage vs. data reveal decisions per use case

## Project Structure

```
eve-frontier-proximity-zk-poc/
├── move/world/                    # Move smart contracts
│   ├── sources/
│   │   ├── assemblies/            # Object assemblies (FixedObject, DynamicObject)
│   │   ├── attestations/         # Location and distance attestation logic
│   │   ├── primitives/           # Core primitives (location, distance, authority)
│   │   ├── registries/           # ObjectRegistry for deterministic IDs and data storage
│   │   └── crypto/               # Cryptographic primitives (Merkle, Groth16)
│   └── tests/                    # Move unit tests
├── src/
│   ├── on-chain/                 # On-chain circuit compilation and proof generation
│   │   ├── circuits/             # Custom Groth16 circuits (location, distance)
│   │   ├── proofs/               # Proof generation utilities
│   │   └── tools/                # Rust vkey serializer
│   ├── off-chain/                # Off-chain POD/GCP integration
│   │   ├── circuits/             # GPC circuit compilation
│   │   └── proofs/               # POD/GPC proof generation
│   └── shared/                   # Shared utilities
│       ├── pods/                 # POD generation utilities
│       ├── merkle/               # Merkle tree generation
│       └── utils/                # Common utilities
├── test/
│   ├── on-chain/
│   │   ├── integration/          # Integration tests (step-by-step flows)
│   │   └── proofs/               # Proof generation tests
│   └── off-chain/                # Off-chain functionality tests
└── outputs/                      # Generated files (PODs, proofs, Merkle trees) - excluded from git
    ├── pods/
    ├── proofs/
    └── merkle/
```

## Prerequisites

### System Requirements

- **Node.js**: v20+ (via NVM recommended)
- **Rust**: Latest stable (for vkey serializer)
- **Sui CLI**: Latest version
- **pnpm**: Package manager

### macOS Setup

1. **Install Homebrew** (if not already installed):
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. **Install Git, Curl, and Rust**:
   ```bash
   brew install git curl
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

3. **Install NVM and Node.js**:
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
   # Restart terminal, then:
   nvm install 20
   nvm use 20
   npm install -g pnpm
   ```

4. **Install Sui CLI**:
   ```bash
   pnpm sui:install
   ```
   This script detects macOS architecture (Apple Silicon vs Intel) and installs the appropriate binary.

5. **Install Project Dependencies**:
   ```bash
   pnpm install
   ```

### Linux/WSL Setup

Follow similar steps as macOS, but use system package managers (`apt-get` for Ubuntu/Debian).

## Quick Start

### 1. Start Local Sui Network

```bash
pnpm sui:localnet:start
```

**Note for macOS**: The script automatically detects Apple Silicon and uses Rosetta 2 if needed for x86_64 Sui binaries. It also prefers arm64 binaries from `~/.local/bin/sui` or `/opt/homebrew/bin/sui`.

**Customization**:
- `--accounts N`: Create N funded accounts (default: 1 for tests)
- `--mnemonic "..."`: Use custom mnemonic for account generation

The network runs in the background. To stop:
```bash
pnpm sui:localnet:stop
```

### 2. Build Move Contracts

```bash
pnpm move:build
```

### 3. Generate Required Keys

Before generating test proof data, you need to generate the required cryptographic keys:

```bash
pnpm generate-auth-key
pnpm generate-ed25519-key
```

These scripts will create a `.env` file (if it doesn't exist) with:
- `EDDSA_POSEIDON_AUTHORITY_PRIV_KEY` and `EDDSA_POSEIDON_AUTHORITY_PUB_KEY` (for POD signing)
- `ED25519_PRIVATE_KEY` and `ED25519_PUBLIC_KEY` (for on-chain signing)

**Note**: The `.env` file is excluded from git via `.gitignore`. Never commit your private keys.

### 4. Compile On-Chain Circuits

Before generating test proof data, you need to compile the on-chain circuits. This is required for proof generation.

#### 4a. Fetch Powers of Tau Files

The Powers of Tau (ptau) files are large binary files used for trusted setup. Download them first:

```bash
pnpm circuit:fetch-ptau:on-chain
```

This downloads `ppot_0080_12.ptau` to `src/shared/ptau/`. This file supports up to 2^12 = 4,096 constraints, which is sufficient for the on-chain circuits (location-attestation: ~2,359 constraints, distance-attestation: ~1,010 constraints).

**Note**: Ptau files are stored in `src/shared/ptau/` and are excluded from git via `.gitignore`. Smaller ptau files (like `ppot_0080_12.ptau`) are typically tens to hundreds of MB, while larger ones (like `ppot_0080_16.ptau`) are typically around 70MB.

#### 4b. Setup Rust VKey Serializer

The on-chain circuit compilation process uses the Rust vkey serializer to create canonical compressed verification keys for Move contracts. The serializer is automatically fetched and built when needed, but you can also set it up manually:

```bash
pnpm rust:vkey-serializer:build
```

This script will:
- Fetch the `rust-vkey-serializer` repository from the configured git URL (if it doesn't exist)
- Build the Rust project in release mode

**Configuration**: The repository URL can be set via the `RUST_VKEY_SERIALIZER_REPO` environment variable, or by updating the default in `scripts/fetchRustVKeySerializer.ts`. The branch can be configured via `RUST_VKEY_SERIALIZER_BRANCH` (defaults to `main`).

**Note**: The serializer will be automatically fetched and built during circuit compilation if it's not already available.

#### 4c. Compile On-Chain Circuits

Compile the custom Groth16 circuits (`location-attestation`, `distance-attestation`):

```bash
pnpm circuit:compile:on-chain
```

This compiles the circuits and generates:
- WASM files (`.wasm`)
- Proving keys (`.zkey`)
- Verification keys (`.vkey.json`, `.vkey.hex`)
- R1CS files (`.r1cs`)

**Output**: Artifacts are saved to `src/on-chain/circuits/artifacts/`

**Note**: During compilation, the Rust vkey serializer is automatically used to serialize verification keys for Move contracts. The serializer will be fetched and built automatically if needed.

### 5. Generate Test Proof Data

**Important**: This must be done before running unit tests, as the tests depend on the generated proof data.

```bash
pnpm move:test:generate:proof
```

This generates `move/world/tests/test_proof_data.move` with valid proof data for unit tests. The script:
- Generates location PODs for deterministic object IDs (`0x111111`, `0x111112`, `0x222222`)
- Creates Merkle trees and multiproofs
- Generates Groth16 ZK proofs
- Formats all data into Move `vector<u8>` literals for use in unit tests

**Note**: This script uses a fixed test registry ID (`0x34401905bebdf8c04f3cd5f04f442a39372c8dc321c29edfb4f9cb30b23ab96`) for deterministic object ID generation. This ID matches what `test_scenario` creates in Move unit tests when using `test_scenario::begin(@0x1)`.

### 6. Run Unit Tests

```bash
pnpm move:test
```

**Note**: Groth16 verification in Move unit tests is skipped (commented out) because it requires depth 0 (entry point), but unit tests add an extra level of call depth. Full ZK verification is tested in integration tests where Groth16 verification can be called directly from `entry` functions.

## Workflows

### Circuit Compilation

**Note**: For initial setup, follow the circuit compilation steps in the [Quick Start](#quick-start) section (Step 4). This section provides additional details and options.

#### On-Chain Circuit Compilation

The on-chain circuits are required for test proof generation and on-chain verification. See [Quick Start Step 4](#4-compile-on-chain-circuits) for the setup process.

**Manual Serialization** (if needed):
```bash
pnpm serialize:vkey
```
Manually serialize verification keys using the Rust serializer. This is typically done automatically during circuit compilation, but can be run separately if needed.

#### Off-Chain POD/GPC Circuit Compilation

**Note**: Off-chain circuit compilation is optional and only needed if you plan to use POD/GPC circuits for off-chain proof generation. For the basic setup and test proof generation, you only need the on-chain circuits.

**Prerequisites: Fetch ptau Files for Off-Chain Circuits**:
```bash
pnpm circuit:fetch-ptau:off-chain
```
This downloads `ppot_0080_16.ptau` to `src/shared/ptau/`. This file supports up to 2^16 = 65,536 constraints, which is required for the default POD/GPC circuit configurations used in this project (circuits have ~35k+ constraints).

**Note**: 
- `ppot_0080_16.ptau` is required for the default off-chain circuit configurations. The location and distance circuits have approximately 35,669 constraints, which exceeds the capacity of smaller ptau files.
- Ptau files are stored in `src/shared/ptau/` and are excluded from git via `.gitignore`. The `ppot_0080_16.ptau` file is approximately 70MB, while smaller files like `ppot_0080_12.ptau` are typically tens to hundreds of MB.

1. **Compile GPC Circuits**:
```bash
pnpm circuit:compile:off-chain
```
This compiles the generic POD/GPC circuits for off-chain use.

**Output**: Artifacts are saved to `src/off-chain/circuits/artifacts/`

**Note**: All circuit artifacts (`.wasm`, `.zkey`, `.vkey.*`, `.r1cs`, `.ptau`) are excluded from git via `.gitignore` due to their large size.

### Integration Testing

**Location Attestation Flow**:
```bash
pnpm test -- locationAttestationStepByStep
```

Tests the complete flow:
1. Create `DynamicObject` with location data
2. Update location via `set_location`
3. Create `FixedObject` with location data during creation

**Distance Attestation Flow**:
```bash
pnpm test -- distanceAttestationStepByStep
```

Tests the complete flow:
1. Create two `FixedObject`s with location data
2. Generate distance proof
3. Verify distance via mock `inventory::transfer`

**Note**: Integration tests automatically clean up generated output files in `afterAll` hooks.

### Off-Chain Functionality Testing

**POD Generation**:
```bash
pnpm test -- shared/pods
```

**Merkle Tree Generation**:
```bash
pnpm test -- shared/merkle
```

**Proof Generation**:
```bash
pnpm test -- off-chain/proofs
```

## Key Concepts

### Deterministic Object IDs

Objects use `sui::derived_object::claim` for deterministic ID generation:
- `FixedObject`: Created with `item_id` → deterministic ID
- `DynamicObject`: Created with `item_id` → deterministic ID
- Off-chain: Use `deriveObjectID` or custom implementation to compute IDs before creation

### Circuit Architecture

#### Poseidon Hashing Throughout

The system uses **Poseidon hashing** consistently across all layers for circuit and on-chain operations:

- **Merkle Tree Construction**: All leaf hashes and tree nodes use Poseidon
- **Circuit Verification**: Leaf hash computation and Merkle proof verification use Poseidon
- **On-Chain Verification**: Uses Sui's native `poseidon_bn254` (available on mainnet)
- **Benefits**: ~100x cheaper than SHA256 in circuits (~250 constraints vs ~25,000)

**Note on POD Merkleization**: POD's native merkleization uses Poseidon for `int` types but SHA256 for `bytes` types. We add an **extra layer** to achieve a unified Poseidon format for both off-chain and on-chain circuits. This is particularly important for circuit optimization, as Poseidon operations are much cheaper in-circuit than SHA256.

**Compatibility**: All implementations (POD's `poseidon-lite`, Sui's `poseidon_bn254`, Circomlib's `Poseidon`) are 100% compatible using the same BN254 Poseidon parameters.

#### Location Circuit

- **Public Inputs**: 4 (well within Sui's 8 limit)
  - `merkleRoot` - Poseidon Merkle root
  - `coordinatesHash` - Poseidon hash(x, y, z, salt)
  - `timestamp` - Timestamp
  - `signatureAndKeyHash` - Poseidon hash(signature || public key)
- **Constraints**: ~2,359
- **Proof Generation**: ~320ms
- **Verification**: Coordinates-only verification in-circuit (for efficiency), full verification available on-chain

#### Distance Circuit

- **Public Inputs**: 8 (at Sui's limit)
  - `merkleRoot` - Distance POD Merkle root
  - `locationMerkleRoot1`, `locationMerkleRoot2` - Location Merkle roots
  - `coordinatesHash1`, `coordinatesHash2` - Coordinate hashes from location proofs
  - `distanceSquaredMeters` - Distance squared
  - `timestamp` - Max timestamp
  - `signatureAndKeyHash` - Poseidon hash(signature || public key)
- **Constraints**: ~1,010
- **Proof Generation**: ~250ms
- **Distance Calculation**: Manhattan distance (|x1-x2| + |y1-y2| + |z1-z2|)²

### Merkle Root Format

- **On-Chain**: Poseidon-based Merkle roots (32-byte big-endian)
- **Off-Chain**: Consistent Poseidon hashing with BCS encoding
- **POD Entry**: Stored as `poseidon_merkle_root` (string, hex format)
- **Tree Structure**: Depth 3 (supports 8 entries), Poseidon(2 inputs) for parent nodes
- **Leaf Hash**: Poseidon(BCS_bytes_to_field_elements(BCS_encode(entryName) || BCS_encode(value)))

### Signature Formats

- **POD Signature**: EDDSA-Poseidon (signs entire POD) - This is POD/GCP's native signing method, efficient for circuits but not supported on-chain in Sui
- **Ed25519 Signature**: Raw Ed25519 (signs merkle root bytes, 64 bytes) - Used for on-chain verification because Ed25519 can be efficiently verified on-chain via Sui's native `ed25519_verify` function
- **Public Key**: Ed25519 public key (32 bytes)

**Why Ed25519 for On-Chain**: While POD/GCP uses EDDSA-Poseidon signing natively (which is efficient for circuits), Sui does not support Poseidon-based signature verification on-chain. We use Ed25519 signatures specifically for the merkle root to enable efficient on-chain verification while maintaining cryptographic binding.

## Configuration

### Environment Variables

Generate the required keys using the provided scripts:

```bash
pnpm generate-auth-key      # Generates EDDSA_POSEIDON_AUTHORITY_PRIV_KEY and EDDSA_POSEIDON_AUTHORITY_PUB_KEY
pnpm generate-ed25519-key   # Generates ED25519_PRIVATE_KEY and ED25519_PUBLIC_KEY
```

These scripts will create a `.env` file (if it doesn't exist) with the required keys. Alternatively, you can manually create a `.env` file:

```env
EDDSA_POSEIDON_AUTHORITY_PRIV_KEY=your_eddsa_poseidon_private_key
EDDSA_POSEIDON_AUTHORITY_PUB_KEY=your_eddsa_poseidon_public_key
ED25519_PRIVATE_KEY=your_ed25519_private_key
ED25519_PUBLIC_KEY=your_ed25519_public_key
```

**Note**: The `.env` file is excluded from git via `.gitignore`. Never commit your private keys.

### POD Entry Names

**Location Attestation POD**:
- `objectId` (bytes)
- `solarSystem` (int)
- `x_coord`, `y_coord`, `z_coord` (int)
- `timestamp` (int)
- `pod_data_type` (string)
- `salt` (bytes)
- `poseidon_merkle_root` (string)
- `ed25519_signature` (bytes)

**Distance Attestation POD**:
- `objectId1`, `objectId2` (bytes)
- `objectLocation1`, `objectLocation2` (string, context IDs/contentIDs)
- `distanceSquaredMeters` (int)
- `timestamp` (int, max_timestamp)
- `pod_data_type` (string)
- `poseidon_merkle_root` (string)
- `ed25519_signature` (bytes)

## Troubleshooting

### "Bus error: 10" in Tests

This is often caused by corrupted Move build artifacts. Clean and rebuild:
```bash
pnpm move:clean
pnpm move:build
```

**Note**: `pnpm move:clean` deletes the entire `build/` folder and all other Move contract artifacts (`.sui/` directories) for all Move projects.

### Groth16 Verification Fails in Unit Tests

This is expected. Groth16 verification requires depth 0, which unit tests cannot provide. Use integration tests for full ZK verification.

### Network Won't Start on macOS

1. Check if port 9000 is in use: `lsof -ti :9000`
2. Kill existing Sui processes: `pkill -9 -f "sui start"`
3. Check Sui binary architecture: `file $(which sui)`
4. For Apple Silicon, ensure arm64 binary is used or Rosetta 2 is available

### Proof Generation Fails with Exit Code 138

This is a segfault, often due to memory issues. Increase Node.js memory:
```bash
NODE_OPTIONS=--max-old-space-size=8192 pnpm move:test:generate:proof
```

## Scripts Reference

### Move Scripts
- `move:build` - Build all Move projects
- `move:test` - Run Move unit tests
- `move:publish` - Publish Move package to network
- `move:test:generate:proof` - Generate test proof data

### Circuit Scripts
- `circuit:compile:on-chain` - Compile on-chain Groth16 circuits
- `circuit:compile:off-chain` - Compile off-chain GPC circuits
- `circuit:fetch-ptau:on-chain` - Download ptau file for on-chain circuits (ppot_0080_12.ptau)
- `circuit:fetch-ptau:off-chain` - Download ptau file for off-chain circuits (ppot_0080_16.ptau)
- `serialize:vkey` - Serialize verification keys for Move

### Rust Tools Scripts
- `rust:vkey-serializer:fetch` - Fetch the rust-vkey-serializer from git repository
- `rust:vkey-serializer:build` - Fetch (if needed) and build the rust-vkey-serializer

### Network Scripts
- `sui:install` - Install Sui CLI
- `sui:localnet:start` - Start local Sui network
- `sui:localnet:stop` - Stop local Sui network


### Test Scripts
- `test` - Run all tests
- `test:watch` - Run tests in watch mode
- `test:coverage` - Generate test coverage

## Contributing

1. Follow the existing code structure
2. Keep on-chain and off-chain logic separate
3. Use deterministic object IDs for testability
4. Clean up generated files in test `afterAll` hooks
5. Document any new circuit parameters or POD structures

## License

MIT
