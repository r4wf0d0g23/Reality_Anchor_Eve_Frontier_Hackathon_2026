#!/bin/bash

set -e

MOVE_DIR="move"
PACKAGES_ARG=""

# --- Argument Parsing ---
# This loop handles arguments passed after '--' from pnpm
while [ $# -gt 0 ]; do
  case "$1" in
    --packages=*)
      PACKAGES_ARG="${1#*=}"
      ;;
  esac
  shift
done

# Check if the 'move' directory exists
if [ ! -d "$MOVE_DIR" ]; then
    echo "The '${MOVE_DIR}' directory does not exist. Nothing to clean."
    exit 0
fi

# --- Project Discovery ---
PROJECTS_TO_CLEAN=()
if [ -z "$PACKAGES_ARG" ]; then
    # If no packages are provided, find all projects
    echo "No specific packages provided. Cleaning all projects in '${MOVE_DIR}'..."
    ALL_PROJECTS=$(find "$MOVE_DIR" -mindepth 1 -maxdepth 1 -type d)
    if [ -z "$ALL_PROJECTS" ]; then
        echo "No projects found in the '${MOVE_DIR}' directory. Nothing to clean."
        exit 0
    fi
    for p in $ALL_PROJECTS; do
        PROJECTS_TO_CLEAN+=("$p")
    done
else
    # If packages are provided, build the list of projects to clean
    echo "Cleaning specified packages: ${PACKAGES_ARG}"
    IFS=',' read -ra PKG_NAMES <<< "$PACKAGES_ARG"
    for pkg_name in "${PKG_NAMES[@]}"; do
        project_path="${MOVE_DIR}/${pkg_name}"
        if [ ! -d "$project_path" ]; then
            echo ""
            echo "Warning: The specified package '${pkg_name}' does not exist at '${project_path}'. Skipping."
            continue
        fi
        PROJECTS_TO_CLEAN+=("${project_path}")
    done
fi

echo "Cleaning selected Move projects..."

for project_path in "${PROJECTS_TO_CLEAN[@]}"; do
    if [ -f "${project_path}/Move.toml" ]; then
        echo ""
        echo "----------------------------------------"
        echo "Cleaning project at: ${project_path}"
        echo "----------------------------------------"
        # Delete build folder and .sui folder if they exist
        if [ -d "${project_path}/build" ]; then
            rm -rf "${project_path}/build"
            echo "  ✓ Deleted build/ folder"
        fi
        if [ -d "${project_path}/.sui" ]; then
            rm -rf "${project_path}/.sui"
            echo "  ✓ Deleted .sui/ folder"
        fi
        # Also try sui move clean if available (for any other artifacts)
        if sui move clean --path "$project_path" 2>/dev/null; then
            echo "  ✓ Additional cleanup via sui move clean"
        fi
        echo "✓ Successfully cleaned ${project_path}"
    else
        echo ""
        echo "Skipping '${project_path}', as it does not contain a 'Move.toml' file."
    fi
done

echo ""
echo "----------------------------------------"
echo "All selected projects have been cleaned."
echo "----------------------------------------"

