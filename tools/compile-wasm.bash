#!/usr/bin/env bash

set -euo pipefail

output_file=""

while getopts "i:o:" opt; do
  case $opt in
    o)
      output_file=$OPTARG
      ;;
    \?)
      echo "Invalid option: -$OPTARG" >&2
      exit 1
      ;;
  esac
done
shift $((OPTIND -1))
input_file=$1

# if [[ -z $input_file || -z $output_file ]]; then
#   echo "Usage: $0 <input_path> -o <output_file>"
#   exit 1
# fi

GOOS=js GOARCH=wasm go build -o ${output_file} ${input_file}
