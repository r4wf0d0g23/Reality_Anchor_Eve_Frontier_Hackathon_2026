#!/bin/bash

set -e

MOVE_DIR="move"
PACKAGES_ARG=""

# --- Argument Parsing ---
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
    echo "The '${MOVE_DIR}' directory does not exist. Nothing to test."
    exit 0
fi

# --- Project Discovery ---
PROJECTS_TO_TEST=()
if [ -z "$PACKAGES_ARG" ]; then
    # If no packages are provided, find all projects
    echo "No specific packages provided. Testing all projects in '${MOVE_DIR}'..."
    ALL_PROJECTS=$(find "$MOVE_DIR" -mindepth 1 -maxdepth 1 -type d)
    if [ -z "$ALL_PROJECTS" ]; then
        echo "No projects found in the '${MOVE_DIR}' directory. Nothing to test."
        exit 0
    fi
    for p in $ALL_PROJECTS; do
        PROJECTS_TO_TEST+=("$p")
    done
else
    # If packages are provided, build the list of projects to test
    echo "Testing specified packages: ${PACKAGES_ARG}"
    IFS=',' read -ra PKG_NAMES <<< "$PACKAGES_ARG"
    for pkg_name in "${PKG_NAMES[@]}"; do
        project_path="${MOVE_DIR}/${pkg_name}"
        if [ ! -d "$project_path" ]; then
            echo ""
            echo "Error: The specified package '${pkg_name}' does not exist at '${project_path}'."
            exit 1
        fi
        PROJECTS_TO_TEST+=("${project_path}")
    done
fi

echo "Running tests for all specified Move projects with trace execution..."

for project_path in "${PROJECTS_TO_TEST[@]}"; do
    if [ ! -d "$project_path" ]; then
        echo ""
        echo "Warning: Project path '${project_path}' does not exist. Skipping."
        continue
    fi

    if [ -f "${project_path}/Move.toml" ]; then
        PROJECT_NAME=$(basename "$project_path")
        # Run tests for the project with trace execution
        echo "----------------------------------------"
        echo "Testing project: ${PROJECT_NAME}"
        
        LOG_DIR="logs/tests/${PROJECT_NAME}"
        mkdir -p "${LOG_DIR}"
        LOG_FILE="${LOG_DIR}/test.log"
        
        echo "Trace logs will be written to: ${LOG_FILE}"
        echo "----------------------------------------"

        if sui move test --trace --path "$project_path" > "${LOG_FILE}" 2>&1; then
            echo "Tests for '${PROJECT_NAME}' passed successfully."
        else
            echo "Tests for '${PROJECT_NAME}' failed. See ${LOG_FILE} for details."
            # We still want to move traces even if the test fails.
        fi

        # --- Move Traces and Clean Up ---
        TRACE_SOURCE_DIR="${project_path}/traces"
        if [ -d "$TRACE_SOURCE_DIR" ]; then
            echo "Found trace files. Moving them to the logs directory..."
            TRACE_DEST_DIR="${LOG_DIR}/traces"
            mkdir -p "$TRACE_DEST_DIR"
            # Move all content from the source to the destination
            mv "$TRACE_SOURCE_DIR"/* "$TRACE_DEST_DIR"/
            # Remove the now-empty source directory
            rmdir "$TRACE_SOURCE_DIR"
            echo "Traces moved to ${TRACE_DEST_DIR}"
        fi
    else
        echo ""
        echo "Skipping '${project_path}', as it does not contain a 'Move.toml' file."
    fi
done

echo ""
echo "----------------------------------------"
echo "All specified project tests have been executed."
echo "----------------------------------------" 