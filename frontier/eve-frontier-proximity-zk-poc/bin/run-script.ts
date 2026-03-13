import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Keypair } from '@mysten/sui/cryptography';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import * as fs from 'fs';
import * as path from 'path';

// --- Types and Interfaces ---
interface RunArgs {
    network: 'localnet' | 'devnet' | 'testnet' | 'mainnet';
    scriptPaths: string[];
    privateKey: string;
    dryRun: boolean;
}

export interface ScriptContext {
    client: SuiClient;
    signer: Keypair;
}

// --- Argument Parsing ---
function parseArgs(): RunArgs {
    const args = process.argv.slice(2);
    let network: any = 'localnet';
    let scriptPathArg: string | undefined;
    let privateKey: string | undefined;
    let dryRun = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--network=')) {
            network = arg.substring('--network='.length);
        } else if (arg.startsWith('--script=')) {
            scriptPathArg = arg.substring('--script='.length);
        } else if (arg.startsWith('--private-key=')) {
            privateKey = arg.substring('--private-key='.length);
        } else if (arg.startsWith('--dry-run')) {
            dryRun = true;
        }
    }

    if (!['localnet', 'devnet', 'testnet', 'mainnet'].includes(network)) {
        throw new Error('Invalid network. Must be one of: localnet, devnet, testnet, mainnet.');
    }
    if (!scriptPathArg) throw new Error('Missing --script argument.');
    if (!privateKey) throw new Error('Missing --private-key argument.');

    const scriptPaths = scriptPathArg.split(',');

    return { network, scriptPaths, privateKey, dryRun };
}

// --- Main Runner Logic ---
async function main() {
    const { network, scriptPaths, privateKey, dryRun } = parseArgs();

    // 1. Initialize Sui Client and Signer
    const rpcUrl = getFullnodeUrl(network);
    const client = new SuiClient({ url: rpcUrl });
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    const signer = Ed25519Keypair.fromSecretKey(secretKey);
    
    const context: ScriptContext = { client, signer };
    
    for (const scriptPath of scriptPaths) {
        const scriptName = path.basename(scriptPath, '.ts');
        const timestamp = new Date().toISOString().replace(/:/g, '-');
        const networkOrDryRun = dryRun ? 'dry-run' : network;
        const logDir = path.join('logs', 'scripts', scriptName, networkOrDryRun);
        fs.mkdirSync(logDir, { recursive: true });
        const logFile = path.join(logDir, `${timestamp}.run.log`);
        
        if (dryRun) {
            console.log(`\nRunning script '${scriptName}' on ${network} in dry-run mode...`);
        } else {
            console.log(`\nRunning script '${scriptName}' on ${network}...`);
        }
        console.log(`Full transaction details will be logged to: ${logFile}`);

        // 2. Dynamically import and run the specified script
        try {
            const scriptModule = await import(path.resolve(scriptPath));
            if (typeof scriptModule.run !== 'function') {
                throw new Error(`The script at '${scriptPath}' does not have an exported 'run' function.`);
            }
            
            // Pass the context to the script's run function.
            // We will wrap it to log the full output.
            const result = await scriptModule.run(context, dryRun);
            
            // 3. Log the results
            const logContent = JSON.stringify(result, null, 2);
            fs.writeFileSync(logFile, logContent);
            
            console.log(`\n✅ Script '${scriptName}' executed successfully.`);
            
        } catch (error: any) {
            console.error(`\n❌ Error during execution of script '${scriptName}':`);
            console.error(error.message);
            fs.writeFileSync(logFile, error.stack || error.toString());
            process.exit(1); // Exit on the first error
        }
    }
}

main(); 