#!/usr/bin/env bash

mask_url() {
  local url=$1
  local host=${url#*://}
  host=${host%%/*}
  host=${host%%\?*}
  echo "${url%%://*}://${host}/…"
}

chain_id() {
  local response
  response=$(curl -s --max-time 15 -X POST -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$1") || return 1
  node -e 'const r = JSON.parse(process.argv[1]); if (!r.result) process.exit(1); console.log(Number(r.result))' "$response"
}

json_field() {
  [ -f "$1" ] || return 0
  node -e 'const v = require(require("path").resolve(process.argv[1]))[process.argv[2]]; if (v !== undefined) console.log(v)' "$1" "$2"
}

parse_args() {
  URLS=()
  EXTRA_ARGS=()
  while [ $# -gt 0 ]; do
    if [ "$1" = "--" ]; then
      shift
      EXTRA_ARGS=("$@")
      break
    fi
    URLS+=("$1")
    shift
  done

  if [ -n "${FORK_URLS:-}" ]; then
    local url
    for url in ${FORK_URLS//,/ }; do URLS+=("$url"); done
  fi

  if [ ${#URLS[@]} -eq 0 ]; then
    echo "Pass at least one RPC URL, or set FORK_URLS" >&2
    return 1
  fi
}

deploy_all() {
  local results=() failed=0 url id factory status
  local i=0
  for url in "${URLS[@]}"; do
    i=$((i + 1))
    echo
    echo "=== [$i/${#URLS[@]}] $(mask_url "$url") ==="

    if ! id=$(chain_id "$url"); then
      echo "Could not reach the RPC, skipping"
      results+=("FAILED   $(mask_url "$url")   RPC unreachable")
      failed=$((failed + 1))
      continue
    fi

    echo "Chain $id"
    factory=$(deploy_one "$url" "$id")
    status=$?
    if [ "$status" -eq 0 ]; then
      results+=("OK       chain $id   KiteFactoryProxy ${factory:-(see output above)}")
    elif [ "$status" -eq 2 ]; then
      results+=("PARTIAL  chain $id   KiteFactoryProxy $factory deployed, but a later step failed (e.g. verification)")
      failed=$((failed + 1))
    else
      results+=("FAILED   chain $id   (see output above)")
      failed=$((failed + 1))
    fi
  done

  echo
  echo "=== Summary ==="
  printf '%s\n' "${results[@]}"
  [ "$failed" -eq 0 ]
}
