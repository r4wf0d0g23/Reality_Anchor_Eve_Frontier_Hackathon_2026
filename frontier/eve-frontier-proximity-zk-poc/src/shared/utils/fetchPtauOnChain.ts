import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

// --- Configuration ---
// Get __dirname equivalent for ES modules
// @ts-ignore - import.meta is available when using tsx
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// PTAU file configuration for on-chain circuits
// Using ppot_0080_12.ptau (PSE Powers of Tau) which supports up to 2^12 = 4,096 constraints
// On-chain circuits have ~2,109 constraints, so 2^12 is required
export const PTAU_DIR = path.resolve(__dirname, '..', 'ptau');
export const PTAU_FILENAME_ON_CHAIN = 'ppot_0080_12.ptau';
export const PTAU_FILE_PATH_ON_CHAIN = path.join(PTAU_DIR, PTAU_FILENAME_ON_CHAIN);
export const PTAU_DOWNLOAD_URL_ON_CHAIN = 'https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_12.ptau';

// --- Main Fetch Logic ---
async function fetchPtauFile() {
    console.log(`--- Checking for Powers of Tau file (${PTAU_FILENAME_ON_CHAIN}) ---`);
    console.log(`   For on-chain circuits (supports up to 2^12 = 4,096 constraints)`);

    // 1. Check if file already exists
    try {
        await fsPromises.access(PTAU_FILE_PATH_ON_CHAIN);
        console.log(`File already exists at: ${PTAU_FILE_PATH_ON_CHAIN}`);
        console.log("Skipping download.");
        return; // Exit early if file exists
    } catch (error) {
        // File doesn't exist, proceed with download
        console.log("File not found locally.");
    }

    // 2. Ensure ptau directory exists
    console.log(`Ensuring ptau directory exists: ${PTAU_DIR}`);
    try {
        await fsPromises.mkdir(PTAU_DIR, { recursive: true });
    } catch (error: any) {
        console.error(`Error creating ptau directory: ${error.message}`);
        process.exit(1);
    }

    // 3. Download the file
    console.log(`Starting download from: ${PTAU_DOWNLOAD_URL_ON_CHAIN}`);
    console.log(`Saving to: ${PTAU_FILE_PATH_ON_CHAIN}`);
    console.log("(This may take some time depending on network speed...)");

    const fileStream = fs.createWriteStream(PTAU_FILE_PATH_ON_CHAIN);
    let receivedBytes = 0;
    let totalBytes = 0;
    let lastLoggedMb = 0;

    const request = https.get(PTAU_DOWNLOAD_URL_ON_CHAIN, (response) => {
        if (response.statusCode !== 200) {
            console.error(`Error: Download failed with status code ${response.statusCode}`);
            fs.unlink(PTAU_FILE_PATH_ON_CHAIN, () => {}); // Attempt to delete partial file
            process.exit(1);
        }

        totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        if (totalBytes > 0) {
            console.log(`File size: ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`);
        }

        response.pipe(fileStream);

        response.on('data', (chunk) => {
            receivedBytes += chunk.length;
            const currentMb = Math.floor(receivedBytes / (1024 * 1024));
            // Log progress roughly every 1MB (smaller file)
            if (currentMb > lastLoggedMb) {
                console.log(`Downloaded: ${currentMb} MB / ${(totalBytes / (1024 * 1024)).toFixed(0)} MB`);
                lastLoggedMb = currentMb;
            }
        });

        fileStream.on('finish', () => {
            fileStream.close();
            console.log(`\nDownload complete! File saved to ${PTAU_FILE_PATH_ON_CHAIN}`);
            console.log(`Received ${receivedBytes} bytes.`);
            if (totalBytes > 0 && receivedBytes !== totalBytes) {
                console.warn("Warning: Received bytes do not match expected content length.");
            }
        });
    });

    request.on('error', (err) => {
        console.error(`Error during download request: ${err.message}`);
        fs.unlink(PTAU_FILE_PATH_ON_CHAIN, () => {}); // Attempt to delete partial file
        process.exit(1);
    });

    fileStream.on('error', (err) => {
        console.error(`Error writing file: ${err.message}`);
        process.exit(1);
    });
}

// --- Script Execution ---
fetchPtauFile().catch(error => {
    console.error("An unexpected error occurred:", error);
    process.exit(1);
});

