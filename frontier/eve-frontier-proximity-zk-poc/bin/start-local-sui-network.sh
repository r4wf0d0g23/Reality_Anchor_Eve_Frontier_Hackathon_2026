#!/bin/bash

# Exit on any error
set -e

# --- Configuration ---
LOGS_DIR="logs/network/localnet"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H%M%SZ")
LOG_FILE="${LOGS_DIR}/${TIMESTAMP}.network.log"
RPC_URL="http://127.0.0.1:9000"

# --- Main Logic ---
echo "Starting local Sui network..."

# Check for and terminate any existing Sui network processes
echo "Checking for existing Sui network processes..."
# Kill any sui processes more aggressively
pkill -9 -f "sui start" 2>/dev/null || true
pkill -9 -f "sui-node" 2>/dev/null || true
# Also check for processes on the RPC port
if lsof -ti :9000 >/dev/null 2>&1; then
    echo "Found process on port 9000, killing it..."
    lsof -ti :9000 | xargs kill -9 2>/dev/null || true
fi
# Give processes time to fully terminate
sleep 3
if pgrep -f "sui start" >/dev/null 2>&1; then
    echo "Warning: Some sui processes may still be running"
    pgrep -f "sui start" | xargs kill -9 2>/dev/null || true
    sleep 2
else
    echo "No existing Sui network processes found."
fi

# Ensure the logs directory exists
mkdir -p "${LOGS_DIR}"

echo "Logs will be written to ${LOG_FILE}"

# Overwrite the log file for a clean start
# The RUST_LOG env var controls the verbosity of the sui-node logs.
# "off,sui_node=info" means disable all logs except for sui-node at info level.
# Check if we need to run with Rosetta 2 (x86_64 binary on arm64)
ARCH=$(uname -m)
# Check actual hardware architecture on macOS
if [[ "$(uname -s)" == "Darwin" ]]; then
    if sysctl -n hw.optional.arm64 2>/dev/null | grep -q "1"; then
        IS_APPLE_SILICON=true
    else
        IS_APPLE_SILICON=false
    fi
else
    IS_APPLE_SILICON=false
fi

# Prefer arm64 binary locations in order:
# 1. ~/.local/bin/sui (direct download)
# 2. /opt/homebrew/bin/sui (Apple Silicon Homebrew)
# 3. system sui (which may be x86_64)
if [[ "${IS_APPLE_SILICON}" == "true" && -x "${HOME}/.local/bin/sui" ]]; then
    SUI_BINARY="${HOME}/.local/bin/sui"
    echo "Using arm64 Sui binary from ~/.local/bin"
elif [[ -x "/opt/homebrew/bin/sui" ]]; then
    SUI_BINARY="/opt/homebrew/bin/sui"
    echo "Using Apple Silicon Homebrew's Sui binary"
elif command -v sui &> /dev/null; then
    SUI_BINARY=$(which sui)
    echo "Using system Sui binary: ${SUI_BINARY}"
else
    echo "Error: Sui binary not found"
    echo "Please run: bash bin/install-sui.sh"
    exit 1
fi

USE_ROSETTA=false

if [[ "${ARCH}" == "arm64" ]]; then
    # Check if the Sui binary is x86_64
    BINARY_TYPE=$(file "${SUI_BINARY}" 2>/dev/null)
    if echo "${BINARY_TYPE}" | grep -q "x86_64"; then
        USE_ROSETTA=true
        echo "Detected x86_64 Sui binary on arm64 system. Running with Rosetta 2..."
        echo "Binary info: ${BINARY_TYPE}"
    else
        echo "Sui binary architecture: ${BINARY_TYPE}"
    fi
fi

# Run the command (with Rosetta if needed)
if [[ "${USE_ROSETTA}" == "true" ]]; then
    # Run the entire command under Rosetta 2
    # Create a temporary wrapper script to ensure Rosetta is properly applied
    SUI_DIR=$(dirname "${SUI_BINARY}")
    PROJECT_DIR=$(pwd)
    ROSETTA_WRAPPER=$(mktemp)
    cat > "${ROSETTA_WRAPPER}" << ROSETTA_EOF
#!/bin/bash
export PATH='${SUI_DIR}:'"\$PATH"
export RUST_LOG='off,sui_node=info'
cd '${PROJECT_DIR}'
exec '${SUI_BINARY}' start --with-faucet --force-regenesis
ROSETTA_EOF
    chmod +x "${ROSETTA_WRAPPER}"
    # Run the wrapper under Rosetta, redirecting both stdout and stderr to log file
    # Use nohup to ensure the process doesn't get killed when the parent script exits
    nohup arch -x86_64 "${ROSETTA_WRAPPER}" >> "${LOG_FILE}" 2>&1 &
    SUI_PID=$!
    # Clean up wrapper script after a delay
    (sleep 10 && rm -f "${ROSETTA_WRAPPER}") &
else
    RUST_LOG="off,sui_node=info" "${SUI_BINARY}" start --with-faucet --force-regenesis > "${LOG_FILE}" 2>&1 &
    SUI_PID=$!
fi

# Function to clean up and exit on error
cleanup_and_exit() {
    echo "An error occurred. Cleaning up background Sui process (PID: ${SUI_PID})..."
    kill ${SUI_PID}
    exit 1
}

# Trap errors and call the cleanup function
trap cleanup_and_exit ERR SIGINT SIGTERM

echo "Waiting for the network to initialize (PID: ${SUI_PID})..."

# Poll the RPC endpoint to see if the network is up
# Try for 30 seconds (15 attempts * 2 seconds)
for i in {1..15}; do
    # Check if the sui process is still running
    if ! kill -0 ${SUI_PID} 2>/dev/null; then
        echo "Error: The sui process terminated unexpectedly."
        echo "Check logs for details: ${LOG_FILE}"
        exit 1
    fi

    # Use curl to check the health of the RPC endpoint
    # Try the newer RPC method first, fallback to older method for compatibility
    if curl -s -f -o /dev/null --location --request POST "${RPC_URL}" \
        --header 'Content-Type: application/json' \
        --data-raw '{ "jsonrpc": "2.0", "id": 1, "method": "sui_getChainIdentifier", "params": [] }' 2>/dev/null || \
       curl -s -f -o /dev/null --location --request POST "${RPC_URL}" \
        --header 'Content-Type: application/json' \
        --data-raw '{ "jsonrpc": "2.0", "id": 1, "method": "sui_getTotalTransactionBlocks", "params": [] }' 2>/dev/null; then
        
        echo "Sui network is up and running!"
        
        # Display RPC and Faucet info from the logs
        echo ""
        echo "--- Network Information ---"
        # The '|| true' prevents the script from exiting if grep finds no matches
        grep -E "Fullnode RPC URL|Faucet URL" "${LOG_FILE}" || true
        echo "--------------------------"
        
        # For debugging, show the last few lines of the log
        echo -e "\nRecent logs from sui-local-network.log:"
        tail -n 10 "${LOG_FILE}"
        echo ""

        # Now that the network is up, run the account creation script
        # Pass through any arguments from this script to the tsx script
        if command -v tsx &> /dev/null; then
            tsx bin/create-accounts.ts "$@"
        elif command -v pnpm &> /dev/null; then
            pnpm exec tsx bin/create-accounts.ts "$@"
        elif command -v npx &> /dev/null; then
            npx tsx bin/create-accounts.ts "$@"
        else
            echo "Warning: Could not find tsx. Skipping account creation."
            echo "Install tsx with: npm install -g tsx"
        fi

        # Detach the trap so we don't kill the process on a normal exit
        trap - ERR SIGINT SIGTERM
        exit 0
    fi
    sleep 2
done

# If the loop finishes without the network being ready, it's an error.
echo "Error: Sui network did not start within 30 seconds."
echo "Check the logs in ${LOG_FILE} for details."
cleanup_and_exit 