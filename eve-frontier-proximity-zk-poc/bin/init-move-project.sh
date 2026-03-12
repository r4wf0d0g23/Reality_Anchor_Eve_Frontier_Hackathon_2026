#!/bin/bash

set -e

# --- Argument Parsing ---
PROJECT_NAME=""
for arg in "$@"
do
    case $arg in
        --name=*)
        PROJECT_NAME="${arg#*=}"
        shift # Remove --name=VALUE from processing
        ;;
    esac
done

if [ -z "$PROJECT_NAME" ]; then
    echo "Error: Project name is required. Please provide it using the --name flag."
    echo "Usage: pnpm sui:move:init -- --name=my-awesome-project"
    exit 1
fi

# --- Script Logic ---
MOVE_DIR="move"
PROJECT_PATH="${MOVE_DIR}/${PROJECT_NAME}"

echo "Initializing new Move project named '${PROJECT_NAME}'..."

# Create the base 'move' directory if it doesn't exist
if [ ! -d "$MOVE_DIR" ]; then
    echo "Base 'move' directory not found. Creating it now..."
    mkdir "$MOVE_DIR"
fi

# Check if a project with the same name already exists
if [ -d "$PROJECT_PATH" ]; then
    echo "Error: A project named '${PROJECT_NAME}' already exists in the '${MOVE_DIR}' directory."
    exit 1
fi

# Create the new project using the Sui CLI
(
    cd "$MOVE_DIR"
    sui move new "$PROJECT_NAME"
)

echo ""
echo "Successfully created new Move project at: ${PROJECT_PATH}" 