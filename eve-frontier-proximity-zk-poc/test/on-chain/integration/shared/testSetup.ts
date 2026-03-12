import path from 'path';
import { execSync } from 'child_process';
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { getFaucetHost, requestSuiFromFaucetV1 } from '@mysten/sui/faucet';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { loadPrivateKey, loadEd25519PrivateKey } from '../../../../src/shared/utils/fsUtils';

/**
 * Shared test environment state
 * This is a singleton that ensures network and package setup only happens once
 */
interface TestEnvironment {
    client: SuiClient;
    signer: Ed25519Keypair;
    ed25519Keypair: Ed25519Keypair;
    packageId: string;
    publishTransactionDigest: string;
    objectRegistryId: string;
    adminCapId: string;
    approvedSignersId: string;
    testPrivateKey: string;
    ed25519PrivateKey: string;
    isInitialized: boolean;
}

let testEnvironment: TestEnvironment | null = null;
let initializationPromise: Promise<TestEnvironment> | null = null;

/**
 * Check if local Sui network is running
 */
async function isLocalNetworkRunning(): Promise<boolean> {
    try {
        const client = new SuiClient({ url: 'http://127.0.0.1:9000' });
        await client.getTotalTransactionBlocks();
        return true;
    } catch {
        return false;
    }
}

/**
 * Start local Sui network
 */
async function startLocalNetwork(): Promise<void> {
    console.log('Starting local Sui network...');
    try {
        // Only create 1 account since we only need 1 funded account for these tests
        execSync('pnpm sui:localnet:start -- --accounts 1', { stdio: 'inherit', timeout: 60000 });
    } catch (error: any) {
        if (error.signal !== 'SIGTERM') {
            throw new Error(`Failed to start local network: ${error.message}`);
        }
    }
}

/**
 * Publish Move package
 */
async function publishMovePackage(
    client: SuiClient,
    signer: Ed25519Keypair,
    projectPath: string
): Promise<{ packageId: string; transactionDigest: string }> {
    console.log('Publishing Move package...');
    
    const bech32Key = signer.getSecretKey();
    
    const publishCommand = `pnpm move:publish -- --project-path=${projectPath} --private-key=${bech32Key} --network=localnet`;
    
    try {
        const output = execSync(publishCommand, { encoding: 'utf-8', cwd: process.cwd() });
        
        // Parse package ID from output
        const packageIdMatch = output.match(/PackageID:\s+(0x[a-fA-F0-9]+)/);
        if (!packageIdMatch) {
            throw new Error('Could not find Package ID in publish output');
        }
        
        // Parse transaction digest from output
        const digestMatch = output.match(/Transaction Digest:\s+([A-Za-z0-9]+)/);
        if (!digestMatch) {
            throw new Error('Could not find Transaction Digest in publish output');
        }
        
        const packageId = packageIdMatch[1];
        const transactionDigest = digestMatch[1];
        console.log(`✓ Package published: ${packageId}`);
        console.log(`✓ Transaction digest: ${transactionDigest}`);
        return { packageId, transactionDigest };
    } catch (error: any) {
        const errorOutput = error.stdout || error.stderr || error.message;
        console.error('Publish output:', errorOutput);
        throw new Error(`Failed to publish package: ${error.message}\nOutput: ${errorOutput}`);
    }
}

/**
 * Ensure account has sufficient balance
 */
async function ensureAccountFunded(client: SuiClient, address: string): Promise<void> {
    const balance = await client.getBalance({ owner: address });
    const balanceMist = BigInt(balance.totalBalance);
    const minBalance = BigInt(1000000000); // 1 SUI
    
    if (balanceMist < minBalance) {
        console.log(`Account balance too low (${balanceMist}), requesting from faucet...`);
        await requestSuiFromFaucetV1({
            host: getFaucetHost('localnet'),
            recipient: address,
        });
        // Wait a bit for the transaction to process
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const newBalance = await client.getBalance({ owner: address });
        const newBalanceMist = BigInt(newBalance.totalBalance);
        console.log(`✓ Account funded: ${newBalanceMist} MIST`);
    } else {
        console.log(`✓ Account already funded: ${balanceMist} MIST`);
    }
}

/**
 * Extract object IDs from publish transaction
 */
async function extractObjectIds(
    client: SuiClient,
    transactionDigest: string
): Promise<{
    objectRegistryId: string;
    adminCapId: string;
    approvedSignersId: string;
}> {
    const publishTx = await client.getTransactionBlock({
        digest: transactionDigest,
        options: {
            showEffects: true,
            showEvents: true,
            showObjectChanges: true,
        },
    });

    const events = publishTx.events || [];
    const publishCreatedObjects = publishTx.effects?.created || [];
    const objectChanges = publishTx.objectChanges || [];

    let objectRegistryId = '';
    let adminCapId = '';
    let approvedSignersId = '';

    // Find ObjectRegistry
    const registryEvent = events.find((event: any) => {
        const eventType = event.type || '';
        return eventType.includes('ObjectRegistryCreated');
    });

    if (registryEvent && registryEvent.parsedJson) {
        const parsedJson = registryEvent.parsedJson as any;
        objectRegistryId = parsedJson.registry_id;
    }

    if (!objectRegistryId) {
        const registryObj = publishCreatedObjects.find((obj: any) => {
            const objectType = obj.reference?.objectType || '';
            return objectType.includes('ObjectRegistry');
        });
        objectRegistryId = registryObj?.reference?.objectId || '';
    }

    if (!objectRegistryId && objectChanges) {
        const registryChange = objectChanges.find((change: any) => {
            if (change.type === 'created') {
                const objectType = change.objectType || '';
                return objectType.includes('ObjectRegistry');
            }
            return false;
        }) as any;
        objectRegistryId = registryChange?.objectId || '';
    }

    // Find AdminCap
    const adminCapObj = publishCreatedObjects.find((obj: any) => {
        const objectType = obj.reference?.objectType || '';
        return objectType.includes('AdminCap');
    });
    adminCapId = adminCapObj?.reference?.objectId || '';

    if (!adminCapId && objectChanges) {
        const adminCapChange = objectChanges.find((change: any) => {
            if (change.type === 'created') {
                const objectType = change.objectType || '';
                return objectType.includes('AdminCap');
            }
            return false;
        }) as any;
        adminCapId = adminCapChange?.objectId || '';
    }

    // Find ApprovedSigners
    const approvedSignersObj = publishCreatedObjects.find((obj: any) => {
        const objectType = obj.reference?.objectType || '';
        return objectType.includes('ApprovedSigners');
    });
    approvedSignersId = approvedSignersObj?.reference?.objectId || '';

    if (!approvedSignersId && objectChanges) {
        const approvedSignersChange = objectChanges.find((change: any) => {
            if (change.type === 'created') {
                const objectType = change.objectType || '';
                return objectType.includes('ApprovedSigners');
            }
            return false;
        }) as any;
        approvedSignersId = approvedSignersChange?.objectId || '';
    }

    return { objectRegistryId, adminCapId, approvedSignersId };
}

/**
 * Initialize test environment (singleton pattern)
 * This ensures network and package setup only happens once, even if called from multiple test files
 */
export async function setupTestEnvironment(): Promise<TestEnvironment> {
    // If already initialized, return cached environment
    if (testEnvironment?.isInitialized) {
        return testEnvironment;
    }

    // If initialization is in progress, wait for it
    if (initializationPromise) {
        return initializationPromise;
    }

    // Start initialization
    initializationPromise = (async () => {
        console.log('\n=== Shared Test Environment Setup ===');

        // Clean Move build artifacts to prevent "Bus error: 10"
        try {
            const moveProjectPath = path.join(process.cwd(), 'move', 'world');
            console.log('Cleaning Move build artifacts...');
            execSync(`sui move clean --path ${moveProjectPath}`, { stdio: 'pipe' });
            console.log('✓ Move build artifacts cleaned');
        } catch (error: any) {
            console.log('Note: Move clean completed (or no build artifacts to clean)');
        }

        // Check if local network is running
        const isRunning = await isLocalNetworkRunning();
        if (!isRunning) {
            await startLocalNetwork();
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for network to be ready
        } else {
            console.log('✓ Local network already running');
        }

        // Initialize client
        const client = new SuiClient({ url: 'http://127.0.0.1:9000' });

        // Load keys
        const testPrivateKey = await loadPrivateKey();
        const ed25519PrivateKeyBech32 = loadEd25519PrivateKey();
        
        // Create Ed25519 keypair for POD signing
        let rawPrivateKey: Uint8Array;
        if (ed25519PrivateKeyBech32.startsWith('suiprivkey')) {
            const decoded = decodeSuiPrivateKey(ed25519PrivateKeyBech32);
            rawPrivateKey = decoded.secretKey;
        } else {
            rawPrivateKey = Buffer.from(
                ed25519PrivateKeyBech32.startsWith('0x') 
                    ? ed25519PrivateKeyBech32.slice(2) 
                    : ed25519PrivateKeyBech32, 
                'hex'
            );
        }
        const ed25519Keypair = Ed25519Keypair.fromSecretKey(rawPrivateKey);
        
        // Use prefunded test account for transaction signing
        const DEFAULT_MNEMONIC = "film crazy soon outside stand loop salt tire century congress rival abstract";
        const signer = Ed25519Keypair.deriveKeypair(DEFAULT_MNEMONIC, "m/44'/784'/0'/0'/0'");
        const address = signer.getPublicKey().toSuiAddress();
        
        console.log(`Using prefunded test account for transactions: ${address}`);
        console.log(`Using Ed25519 key from .env for POD signing`);

        // Ensure transaction account is funded
        await ensureAccountFunded(client, address);

        // Clean Move build artifacts again before publishing
        const moveProjectPath = path.join(process.cwd(), 'move', 'world');
        try {
            console.log('Cleaning Move build artifacts before publishing...');
            execSync(`sui move clean --path ${moveProjectPath}`, { stdio: 'pipe' });
            console.log('✓ Move build artifacts cleaned before publish');
        } catch (error: any) {
            console.log('Note: Move clean may have failed (this is OK if no build dir exists)');
        }

        // Publish Move package
        const publishResult = await publishMovePackage(client, signer, moveProjectPath);
        const packageId = publishResult.packageId;
        const publishTransactionDigest = publishResult.transactionDigest;

        // Extract object IDs from publish transaction
        let { objectRegistryId, adminCapId, approvedSignersId } = await extractObjectIds(
            client,
            publishTransactionDigest
        );

        // AdminCap is not created during publishing - it must be created manually
        // Create it if not found
        if (!adminCapId) {
            console.log('Creating AdminCap (not created during publishing)...');
            try {
                const tx = new Transaction();
                tx.moveCall({
                    target: `${packageId}::authority::create_admin_cap`,
                    arguments: [tx.pure.address(signer.toSuiAddress())],
                });
                
                const result = await client.signAndExecuteTransaction({
                    signer,
                    transaction: tx,
                    options: {
                        showObjectChanges: true,
                        showEffects: true,
                    },
                });

                // Extract AdminCap ID from transaction result
                const createdAdminObj = result.effects?.created?.find((obj: any) =>
                    obj.reference?.objectType?.includes('AdminCap')
                );
                if (createdAdminObj?.reference?.objectId) {
                    adminCapId = createdAdminObj.reference.objectId;
                    console.log(`✓ Created AdminCap: ${adminCapId}`);
                } else {
                    // Try objectChanges as fallback
                    const adminCapChange = result.objectChanges?.find((change: any) =>
                        change.type === 'created' && change.objectType?.includes('AdminCap')
                    ) as any;
                    if (adminCapChange && adminCapChange.type === 'created') {
                        adminCapId = adminCapChange.objectId;
                        console.log(`✓ Created AdminCap (from objectChanges): ${adminCapId}`);
                    }
                }
            } catch (error: any) {
                console.error(`⚠ Failed to create AdminCap: ${error.message}`);
                throw new Error(`Failed to create AdminCap: ${error.message}`);
            }
        }

        if (!objectRegistryId || !adminCapId || !approvedSignersId) {
            throw new Error(
                `Failed to extract object IDs from publish transaction.\n` +
                `  ObjectRegistry: ${objectRegistryId || 'NOT FOUND'}\n` +
                `  AdminCap: ${adminCapId || 'NOT FOUND'}\n` +
                `  ApprovedSigners: ${approvedSignersId || 'NOT FOUND'}`
            );
        }

        console.log(`✓ ObjectRegistry: ${objectRegistryId}`);
        console.log(`✓ AdminCap: ${adminCapId}`);
        console.log(`✓ ApprovedSigners: ${approvedSignersId}`);
        console.log('✓ Shared test environment setup complete\n');

        // Cache the environment
        testEnvironment = {
            client,
            signer,
            ed25519Keypair,
            packageId,
            publishTransactionDigest,
            objectRegistryId,
            adminCapId,
            approvedSignersId,
            testPrivateKey,
            ed25519PrivateKey: ed25519PrivateKeyBech32,
            isInitialized: true,
        };

        return testEnvironment;
    })();

    return initializationPromise;
}

/**
 * Get the current test environment (must be initialized first)
 */
export function getTestEnvironment(): TestEnvironment {
    if (!testEnvironment?.isInitialized) {
        throw new Error('Test environment not initialized. Call setupTestEnvironment() first.');
    }
    return testEnvironment;
}

