#!/usr/bin/env bash

set -euo pipefail

wasm_path=$(go env GOROOT)/misc/wasm/wasm_exec.js
if [[ -e $wasm_path ]]; then
  echo "Copying wasm_exec.js"
  cp "${wasm_path}" src/
else
  echo "Downloading wasm_exec.js"
  version=$(go env GOVERSION)
  curl -L "https://raw.githubusercontent.com/golang/go/${version}/misc/wasm/wasm_exec.js" -o src/wasm_exec.js
fi
