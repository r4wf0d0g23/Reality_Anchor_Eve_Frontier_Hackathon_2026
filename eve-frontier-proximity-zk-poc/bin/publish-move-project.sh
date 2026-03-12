#!/bin/bash

set -e

# --- Argument Parsing ---
PROJECT_PATH=""
PRIVATE_KEY=""
NETWORK="localnet" # Default network
GAS_BUDGET=""
GAS_PRICE=""
GAS_SPONSOR=""
TEST_FLAG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --network=*)
      NETWORK="${1#*=}"
      ;;
    --project-path=*)
      PROJECT_PATH="${1#*=}"
      ;;
    --private-key=*)
      PRIVATE_KEY="${1#*=}"
      ;;
    --gas-budget=*)
      GAS_BUDGET="${1#*=}"
      ;;
    --gas-price=*)
      GAS_PRICE="${1#*=}"
      ;;
    --gas-sponsor=*)
      GAS_SPONSOR="${1#*=}"
      ;;
    --test)
      TEST_FLAG="--test"
      ;;
  esac
  shift
done

if [ -z "$PROJECT_PATH" ] || [ -z "$PRIVATE_KEY" ]; then
  echo "Error: Missing required arguments."
  echo "Usage: pnpm move:publish -- --project-path=<path> --private-key=<key> [--network=<network>]"
  exit 1
fi

if [[ ! "$PRIVATE_KEY" == suiprivkey* ]]; then
    echo "Error: Invalid private key format. Please provide the Bech32 encoded key (starts with 'suiprivkey')."
    exit 1
fi

# --- Environment Setup ---
RPC_URL=""
case $NETWORK in
  localnet) RPC_URL="http://127.0.0.1:9000" ;;
  devnet) RPC_URL="https://fullnode.devnet.sui.io:443" ;;
  testnet) RPC_URL="https://fullnode.testnet.sui.io:443" ;;
  mainnet) RPC_URL="https://fullnode.mainnet.sui.io:443" ;;
  *)
    echo "Error: Invalid network '${NETWORK}'. Must be localnet, devnet, testnet, or mainnet."
    exit 1
    ;;
esac

# Create a temporary, isolated directory for all operations
TEMP_SUI_DIR=$(mktemp -d)
trap 'rm -rf -- "$TEMP_SUI_DIR"' EXIT # Cleanup on exit

echo "Using temporary, isolated config directory: ${TEMP_SUI_DIR}"

# --- Non-interactive Configuration ---
export SUI_CONFIG_DIR="$TEMP_SUI_DIR"
KEYSTORE_PATH="${SUI_CONFIG_DIR}/sui.keystore"

# Manually create a valid client.yaml to avoid all interactive prompts
cat > "${SUI_CONFIG_DIR}/client.yaml" << EOF
---
keystore:
  File: "${KEYSTORE_PATH}"
envs:
  - alias: temp-publish-env
    rpc: "${RPC_URL}"
active_env: temp-publish-env
EOF

# Import the key non-interactively. It becomes the active address by default.
sui keytool import "${PRIVATE_KEY}" ed25519 > /dev/null
# Get the address of the key we just imported by getting the new active address
PUBLISHER_ADDRESS=$(sui client active-address)

if [[ ! "$PUBLISHER_ADDRESS" == 0x* ]]; then
    echo "Error: Could not determine publisher address after key import."
    exit 1
fi

echo "Publisher Address: ${PUBLISHER_ADDRESS}"

# --- Publishing ---
PROJECT_NAME=$(basename "$PROJECT_PATH")
TIMESTAMP=$(date -u +"%Y-%m-%dT%H%M%SZ")
LOG_DIR="logs/publish/${PROJECT_NAME}/${NETWORK}"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/${TIMESTAMP}.publish.log"

echo ""
echo "Publishing project '${PROJECT_NAME}' to ${NETWORK}..."

# Build the command arguments in an array for safety and flexibility
publish_args=("--yes" "publish")
if [ -n "$GAS_BUDGET" ]; then
    publish_args+=("--gas-budget" "$GAS_BUDGET")
else
    publish_args+=("--gas-budget" "500000000") # Default budget
fi
if [ -n "$GAS_PRICE" ]; then
    publish_args+=("--gas-price" "$GAS_PRICE")
fi
if [ -n "$GAS_SPONSOR" ]; then
    publish_args+=("--gas-sponsor" "$GAS_SPONSOR")
fi
if [ -n "$TEST_FLAG" ]; then
    publish_args+=("$TEST_FLAG")
fi
publish_args+=("${PROJECT_PATH}")

# Create a temporary file to store the publish output
output_file=$(mktemp)
# Ensure the temporary file is removed on script exit
trap 'rm -f -- "$output_file"' EXIT

# Execute the publish command. Capture STDOUT to the file for parsing,
# and also tee STDOUT to the console. STDERR will go directly to the console.
sui client "${publish_args[@]}" 2>&1 | tee "$output_file"
publish_output=$(<"$output_file")

echo "" # Add a newline for cleaner separation

# --- Result Parsing & Logging ---
# Use grep -i for a case-insensitive search for "Success"
if grep -iq "Status: success" "$output_file"; then
    echo "✅ Success! Parsing results..."
    
    # Use POSIX-compliant tools, reading from the file.
    digest=$(grep 'Transaction Digest:' "$output_file" | head -n 1 | awk '{print $NF}')
    # Find the line with PackageID and grab the 4th field. This is robust.
    package_id=$(grep 'PackageID:' "$output_file" | awk '{print $4}')

    log_content="----------------------------------------\n"
    log_content+=" Project: ${PROJECT_NAME}\n"
    log_content+=" Network: ${NETWORK}\n"
    log_content+=" Publisher: ${PUBLISHER_ADDRESS}\n"
    log_content+=" Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)\n"
    log_content+="----------------------------------------\n\n"
    log_content+="Digest: ${digest}\n"
    log_content+="Package ID: ${package_id}\n\n"
    log_content+="--- Raw Output ---\n"
    log_content+="${publish_output}"

    echo -e "${log_content}" > "${LOG_FILE}"
    echo "Publish details saved to ${LOG_FILE}"
else
    echo "❌ Publish failed. See output above for details."
    # Overwrite the log file with just the raw output on failure
    echo -e "${publish_output}" > "${LOG_FILE}"
    exit 1
fi 