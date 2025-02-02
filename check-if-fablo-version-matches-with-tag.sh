#!/usr/bin/env bash

set -euo

FULL_DOCKER_IMAGE_NAME=$1
FABLO_NODE_VERSION="$IMAGE_NAME:$(jq -r .version package.json)"

echo "Checking Fablo version"
echo "    FULL_DOCKER_IMAGE_NAME: $FULL_DOCKER_IMAGE_NAME"
echo "    FABLO_NODE_VERSION:  $FABLO_NODE_VERSION"

if [ "$FULL_DOCKER_IMAGE_NAME" != "$FABLO_NODE_VERSION" ]; then
  echo "Error!"
  echo "Tag obtained from the release does not match version from package.json"
  exit 1
fi
