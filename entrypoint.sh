#!/bin/sh
case "$1" in
  --auth)
    exec bun run dist/main.js auth
    ;;
  refresh-token)
    exec bun run dist/main.js refresh-token
    ;;
  *)
    exec bun run dist/main.js start -g "$GH_TOKEN" "$@"
    ;;
esac

