#!/bin/bash
# Memory search script
# Usage: ./search.sh "tema a buscar"

QUERY="$1"
MEMORY_DIR="${MEMORY_DIR:-${WORKSPACE_REPO_PATH:-/workspace/repo}/memory}"
MEMORY_FILE="${MEMORY_FILE:-}"

if [ -z "$QUERY" ]; then
    echo "Usage: $0 <search query>"
    exit 1
fi

echo "=== Buscando: $QUERY ==="
echo ""

# Search in daily notes
if [ -d "$MEMORY_DIR" ]; then
    echo "--- Notas diarias (memory/*.md) ---"
    grep -r -i -n -C 2 "$QUERY" "$MEMORY_DIR"/*.md 2>/dev/null || echo "(sin resultados)"
    echo ""
fi

# Search in long-term memory
if [ -n "$MEMORY_FILE" ] && [ -f "$MEMORY_FILE" ]; then
    echo "--- Memoria long-term (MEMORY.md) ---"
    grep -i -n -C 2 "$QUERY" "$MEMORY_FILE" 2>/dev/null || echo "(sin resultados)"
    echo ""
fi

echo "=== Búsqueda completada ==="
