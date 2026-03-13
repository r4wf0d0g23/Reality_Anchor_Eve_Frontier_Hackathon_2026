#!/bin/bash

# Exit on any error
set -e

# Detect OS
OS="$(uname -s)"

echo "Detected OS: ${OS}"

# Check for existing Sui installation
# On Apple Silicon, prefer ~/.local/bin/sui (arm64) over system sui (might be x86_64)
if [[ "$(uname -s)" == "Darwin" ]] && sysctl -n hw.optional.arm64 2>/dev/null | grep -q "1"; then
    if [[ -x "${HOME}/.local/bin/sui" ]]; then
        echo "Sui CLI (arm64) is already installed at ~/.local/bin/sui. Skipping installation."
        exit 0
    fi
fi

# Check for existing Sui installation
# On Apple Silicon, prefer ~/.local/bin/sui (arm64) over system sui (might be x86_64)
if [[ "$(uname -s)" == "Darwin" ]] && sysctl -n hw.optional.arm64 2>/dev/null | grep -q "1"; then
    if [[ -x "${HOME}/.local/bin/sui" ]]; then
        echo "Sui CLI (arm64) is already installed at ~/.local/bin/sui. Skipping installation."
        exit 0
    fi
fi

if command -v sui &> /dev/null; then
    echo "Sui CLI is already installed. Skipping installation."
    exit 0
fi

case "${OS}" in
    Linux*|Darwin*)
        if [[ "${OS}" == "Linux"* ]]; then
            echo "Running on Linux or WSL."
            TARGET_OS="ubuntu"
        else
            echo "Running on macOS."
            TARGET_OS="macos"
        fi

        ARCH=$(uname -m)
        echo "Detected Architecture (from uname): ${ARCH}"
        
        # On macOS, check actual hardware architecture (not shell architecture)
        if [[ "${TARGET_OS}" == "macos" ]]; then
            # Check if this is actually Apple Silicon hardware
            if sysctl -n hw.optional.arm64 2>/dev/null | grep -q "1"; then
                ACTUAL_ARCH="arm64"
                echo "Detected Apple Silicon hardware (arm64)"
            else
                ACTUAL_ARCH="${ARCH}"
                echo "Detected Intel Mac (${ARCH})"
            fi
        else
            ACTUAL_ARCH="${ARCH}"
        fi

        # If on macOS Apple Silicon, download arm64 binary directly
        if [[ "${TARGET_OS}" == "macos" && "${ACTUAL_ARCH}" == "arm64" ]]; then
            echo "Detected macOS on Apple Silicon. Attempting direct download of arm64 binary to avoid Rosetta issues..."
            
            # Create local bin directory
            mkdir -p ~/.local/bin
            
            # Fetch the latest release tag
            LATEST_RELEASE=$(curl -s https://api.github.com/repos/MystenLabs/sui/releases/latest | grep '"tag_name":' | sed -E 's/.*"tag_name": "([^"]+)".*/\1/')
            
            if [ -z "${LATEST_RELEASE}" ]; then
                echo "Failed to fetch latest release tag. Defaulting to testnet-v1.61.1"
                LATEST_RELEASE="testnet-v1.61.1"
            fi
            
            echo "Latest Sui Release: ${LATEST_RELEASE}"
            
            # Construct download URL for arm64
            DOWNLOAD_URL="https://github.com/MystenLabs/sui/releases/download/${LATEST_RELEASE}/sui-${LATEST_RELEASE}-macos-arm64.tgz"
            echo "Downloading from: ${DOWNLOAD_URL}"
            
            # Download and extract
            TEMP_DIR=$(mktemp -d)
            curl -L -o "${TEMP_DIR}/sui.tgz" "${DOWNLOAD_URL}"
            tar -xzf "${TEMP_DIR}/sui.tgz" -C "${TEMP_DIR}"
            
            # Find and install binary
            SUI_BIN=$(find "${TEMP_DIR}" -name sui -type f | head -1)
            if [ -f "${SUI_BIN}" ]; then
                cp "${SUI_BIN}" ~/.local/bin/sui
                chmod +x ~/.local/bin/sui
                echo "✓ Sui arm64 binary installed to ~/.local/bin/sui"
                
                # Verify
                FILE_INFO=$(file ~/.local/bin/sui)
                echo "Binary info: ${FILE_INFO}"
                
                # Add ~/.local/bin to PATH if not already present
                if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
                    echo "Adding ~/.local/bin to PATH..."
                    
                    # Detect shell and config file
                    SHELL_NAME=$(basename "$SHELL" 2>/dev/null || echo "bash")
                    if [[ "$SHELL_NAME" == "zsh" ]]; then
                        SHELL_CONFIG="$HOME/.zshrc"
                    elif [[ "$SHELL_NAME" == "bash" ]]; then
                        # Check for .bash_profile first (macOS default), then .bashrc
                        if [[ -f "$HOME/.bash_profile" ]]; then
                            SHELL_CONFIG="$HOME/.bash_profile"
                        else
                            SHELL_CONFIG="$HOME/.bashrc"
                        fi
                    else
                        SHELL_CONFIG="$HOME/.${SHELL_NAME}rc"
                    fi
                    
                    # Add PATH export if not already present
                    PATH_EXPORT='export PATH="$HOME/.local/bin:$PATH"'
                    if ! grep -qF "$PATH_EXPORT" "$SHELL_CONFIG" 2>/dev/null; then
                        echo "" >> "$SHELL_CONFIG"
                        echo "# Added by sui-pod-zk install script" >> "$SHELL_CONFIG"
                        echo "$PATH_EXPORT" >> "$SHELL_CONFIG"
                        echo "✓ Added ~/.local/bin to PATH in $SHELL_CONFIG"
                        echo "Run 'source $SHELL_CONFIG' or restart your terminal to use it immediately."
                    else
                        echo "✓ ~/.local/bin is already in your PATH configuration."
                    fi
                else
                    echo "✓ ~/.local/bin is already in your PATH."
                fi
                
                rm -rf "${TEMP_DIR}"
                exit 0
            else
                echo "Failed to find sui binary in downloaded archive. Falling back to Homebrew..."
                rm -rf "${TEMP_DIR}"
            fi
        fi

        echo "Checking for Homebrew..."
        if ! command -v brew &> /dev/null; then
            echo "Homebrew not found. Installing Homebrew..."
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
            
            # Add brew to path for this script's execution
            if [[ "${OS}" == "Linux"* ]]; then
                 eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
            else
                 eval "$(/opt/homebrew/bin/brew shellenv)"
            fi
        else
            echo "Homebrew is already installed."
        fi

        echo "Installing Sui CLI using Homebrew..."
        brew install sui
        ;;
    CYGWIN*|MINGW*|MSYS*)
        echo "Running on Windows."
        echo "This script must be run from within WSL (Windows Subsystem for Linux)."
        echo "Please install WSL and run this script again from your WSL terminal."
        echo "For WSL installation instructions, see: https://docs.microsoft.com/en-us/windows/wsl/install"
        exit 1
        ;;
    *)
        echo "Unsupported operating system: ${OS}. Please install Sui manually."
        echo "See: https://docs.sui.io/guides/developer/getting-started/sui-install"
        exit 1
        ;;
esac

echo "Sui CLI has been installed successfully." 