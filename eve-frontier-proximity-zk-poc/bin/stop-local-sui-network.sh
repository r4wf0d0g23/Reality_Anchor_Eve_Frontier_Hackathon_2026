#!/bin/bash

# --- Main Logic ---
echo "Stopping local Sui network..."

# Use pkill to find and kill the process. The -f flag matches against the full command line.
if pkill -f "sui start --with-faucet --force-regenesis"; then
    echo "Sui local network process found and terminated."
else
    echo "Sui network process not found."
fi

echo "Sui network stopped."

exit 0 