#!/usr/bin/env bash
#
# scripts_sh/deploy-factory-7702.sh <rpc url> [<rpc url>...]
# FORK_URLS="<rpc url>,<rpc url>" scripts_sh/deploy-factory-7702.sh

set -uo pipefail

cd "$(dirname "$0")/.."
source scripts_sh/lib.sh

deploy_one() {
  local url=$1 id=$2
  FORK_URL=$url npx hardhat run --network mainnet scripts/deploy-factory-7702.ts >&2 || return 1
  json_field "deployments/7702/chain-$id.json" KiteFactoryProxy
}

parse_args "$@" || exit 1
if [ ${#EXTRA_ARGS[@]} -gt 0 ]; then
  echo "deploy-factory-7702 takes no extra arguments; set options in the environment" >&2
  exit 1
fi

deploy_all
