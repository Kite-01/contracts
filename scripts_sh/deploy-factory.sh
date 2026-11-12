#!/usr/bin/env bash
#
# scripts_sh/deploy-factory.sh <rpc url> [<rpc url>...] [-- <extra ignition args>]
# FORK_URLS="<rpc url>,<rpc url>" scripts_sh/deploy-factory.sh
#
# Extra args after -- go to every `hardhat ignition deploy`, e.g. `-- --deployment-id my-kite`
# (the chain id is appended to keep each chain's records apart). Everything else comes from
# .env as usual; each URL replaces FORK_URL for its run.

set -uo pipefail

cd "$(dirname "$0")/.."
source scripts_sh/lib.sh

deploy_one() {
  local url=$1 id=$2 args=() deployment="chain-$2" i
  for ((i = 0; i < ${#EXTRA_ARGS[@]}; i++)); do
    if [ "${EXTRA_ARGS[i]}" = "--deployment-id" ]; then
      deployment="${EXTRA_ARGS[i + 1]}-$id"
      args+=(--deployment-id "$deployment")
      i=$((i + 1))
    else
      args+=("${EXTRA_ARGS[i]}")
    fi
  done

  local status factory
  
  FORK_URL=$url npx hardhat ignition deploy ignition/modules/KiteFactory.ts \
    --parameters ignition/parameters/KiteFactory.json \
    --strategy create2 --network mainnet --verify ${args[@]+"${args[@]}"} >&2
  status=$?

  factory=$(json_field "ignition/deployments/$deployment/deployed_addresses.json" "KiteFactoryModule#KiteFactoryProxy")
  echo "$factory"
  [ "$status" -eq 0 ] && return 0
  [ -n "$factory" ] && return 2 # Ignition fails the run when only verification fails
  return 1
}

parse_args "$@" || exit 1
deploy_all
