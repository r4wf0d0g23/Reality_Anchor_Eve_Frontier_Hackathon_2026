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

// PTAU file configuration for off-chain circuits
// Using ppot_0080_14.ptau (PSE Powers of Tau) which supports up to 2^14 = 16,384 constraints
// This is required for the default POD/GPC circuit configurations used in this project
// Custom builds with larger constraint counts may require larger ptau files
// PTAU file for off-chain circuits (ppot_0080_16.ptau)
// Using ppot_0080_16.ptau (2^16 = 65,536 constraints) to support circuits with ~35k+ constraints
export const PTAU_DIR = path.resolve(__dirname, '..', '..', '..', 'shared', 'ptau');
export const PTAU_FILENAME_OFF_CHAIN = 'ppot_0080_16.ptau';
export const PTAU_FILE_PATH_OFF_CHAIN = path.join(PTAU_DIR, PTAU_FILENAME_OFF_CHAIN);
export const PTAU_DOWNLOAD_URL_OFF_CHAIN = 'https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_16.ptau';

// --- Main Fetch Logic ---
async function fetchPtauFile() {
    console.log(`--- Checking for Powers of Tau file (${PTAU_FILENAME_OFF_CHAIN}) ---`);
    console.log(`   For off-chain POD/GPC circuits (supports up to 2^16 = 65,536 constraints)`);

    // 1. Check if file already exists
    try {
        await fsPromises.access(PTAU_FILE_PATH_OFF_CHAIN);
        console.log(`File already exists at: ${PTAU_FILE_PATH_OFF_CHAIN}`);
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
    console.log(`Starting download from: ${PTAU_DOWNLOAD_URL_OFF_CHAIN}`);
    console.log(`Saving to: ${PTAU_FILE_PATH_OFF_CHAIN}`);
    console.log("(This may take some time depending on network speed...)");

    const fileStream = fs.createWriteStream(PTAU_FILE_PATH_OFF_CHAIN);
    let receivedBytes = 0;
    let totalBytes = 0;
    let lastLoggedMb = 0;

    const request = https.get(PTAU_DOWNLOAD_URL_OFF_CHAIN, (response) => {
        if (response.statusCode !== 200) {
            console.error(`Error: Download failed with status code ${response.statusCode}`);
            fs.unlink(PTAU_FILE_PATH_OFF_CHAIN, () => {}); // Attempt to delete partial file
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
            // Log progress every 1MB for better feedback
            if (currentMb > lastLoggedMb) {
                console.log(`Downloaded: ${currentMb} MB / ${(totalBytes / (1024 * 1024)).toFixed(0)} MB`);
                lastLoggedMb = currentMb;
            }
        });

        fileStream.on('finish', () => {
            fileStream.close();
            console.log(`\nDownload complete! File saved to ${PTAU_FILE_PATH_OFF_CHAIN}`);
            console.log(`Received ${receivedBytes} bytes.`);
            if (totalBytes > 0 && receivedBytes !== totalBytes) {
                console.warn("Warning: Received bytes do not match expected content length.");
            }
        });
    });

    request.on('error', (err) => {
        console.error(`Error during download request: ${err.message}`);
        fs.unlink(PTAU_FILE_PATH_OFF_CHAIN, () => {}); // Attempt to delete partial file
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

