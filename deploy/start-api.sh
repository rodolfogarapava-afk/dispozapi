#!/usr/bin/env bash
set -euo pipefail

set -a
source /opt/dispozapi/shared/api.env
set +a

exec node /opt/dispozapi/current/apps/api/dist/main.js

