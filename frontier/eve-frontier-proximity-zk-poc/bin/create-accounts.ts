import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { getFaucetHost, requestSuiFromFaucetV1 } from '@mysten/sui/faucet';
import { SuiClient } from '@mysten/sui/client';
import { toHex } from '@mysten/sui/utils';

const DEFAULT_NUM_ACCOUNTS = 3;
// IMPORTANT: this a test mnemonic, do NOT use in a live environment
const DEFAULT_MNEMONIC = "film crazy soon outside stand loop salt tire century congress rival abstract";

function parseArgs() {
    const args = process.argv.slice(2);
    let mnemonic = DEFAULT_MNEMONIC;
    let numAccounts = DEFAULT_NUM_ACCOUNTS;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--mnemonic' && i + 1 < args.length) {
            mnemonic = args[i+1];
            i++;
        } else if ((args[i] === '--num-accounts' || args[i] === '--accounts') && i + 1 < args.length) {
            const parsed = parseInt(args[i+1], 10);
            if (isNaN(parsed) || parsed < 1) {
                console.error(`Error: Invalid number of accounts: ${args[i+1]}. Must be a positive integer.`);
                process.exit(1);
            }
            numAccounts = parsed;
            i++;
        }
    }
    return { mnemonic, numAccounts };
}

// Wait for faucet to be ready
async function waitForFaucet(maxAttempts = 30, delayMs = 1000): Promise<void> {
    const faucetHost = getFaucetHost('localnet');
    console.log(`Waiting for faucet at ${faucetHost}...`);
    
    for (let i = 0; i < maxAttempts; i++) {
        try {
            // Try to connect to the faucet
            const response = await fetch(`${faucetHost}/gas`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ FixedAmountRequest: { recipient: '0x0000000000000000000000000000000000000000000000000000000000000000' } }),
            });
            if (response.ok || response.status === 400) { // 400 means faucet is up but address is invalid
                console.log(`✓ Faucet is ready`);
                return;
            }
        } catch (error) {
            // Faucet not ready yet
        }
        if (i < maxAttempts - 1) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    throw new Error(`Faucet did not become ready after ${maxAttempts} attempts`);
}

async function main() {
    const { mnemonic, numAccounts } = parseArgs();
    
    console.log(`\nUsing mnemonic: "${mnemonic}"`);
    console.log(`Creating ${numAccounts} account(s)...`);

    const client = new SuiClient({ url: 'http://127.0.0.1:9000' });

    // Wait for faucet to be ready before making requests
    try {
        await waitForFaucet();
    } catch (error) {
        console.warn(`⚠ Could not verify faucet readiness: ${error}`);
        console.log(`Proceeding anyway - faucet may still work...`);
    }

    console.log("\n--- Generated & Funded Accounts ---");

    for (let i = 0; i < numAccounts; i++) {
        const path = `m/44'/784'/0'/0'/${i}'`;
        const keypair = Ed25519Keypair.deriveKeypair(mnemonic, path);
        
        const address = keypair.getPublicKey().toSuiAddress();
        const publicKeyHex = `0x${toHex(keypair.getPublicKey().toRawBytes())}`;
        
        const bech32PrivateKey = keypair.getSecretKey();

        console.log(`\nAccount ${i+1}:`);
        console.log(`  Sui Address: ${address}`);
        console.log(`  Public Key (hex): ${publicKeyHex}`);
        console.log(`  Private Key (Bech32): ${bech32PrivateKey}`);

        // Retry faucet request with exponential backoff
        let success = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await requestSuiFromFaucetV1({
                    host: getFaucetHost('localnet'),
                    recipient: address,
                });
                
                // Wait a bit for transaction to process
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                const balance = await client.getBalance({ owner: address });
                const suiBalance = parseInt(balance.totalBalance) / 1_000_000_000;
                console.log(`  Balance: ${suiBalance} SUI`);
                success = true;
                break;
            } catch (error: any) {
                if (attempt < 2) {
                    const delay = (attempt + 1) * 1000;
                    console.log(`  -> Faucet request failed, retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error(`  -> Error during faucet request for account ${i+1}:`, error.message || error);
                }
            }
        }
    }
    console.log("\n-----------------------------------\n");
}

main(); 