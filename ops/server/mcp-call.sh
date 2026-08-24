#!/bin/bash
# Shared helper: call one MCP tool locally against this box's own MCP
# HTTP transport (127.0.0.1:8090 -- no need to round-trip through
# Cloudflare for a same-box call) with a credentialJwt argument read
# from a file. Used by backup-db.sh and ops-heartbeat.sh instead of each
# hand-rolling the MCP Streamable HTTP initialize+tools/call handshake.
#
# Usage: mcp_call <jwt-file> <tool-name> <json-args-without-credentialJwt>
# Echoes the tool result text on stdout. Never exits non-zero on its own
# -- a monitoring call failing to report shouldn't itself become a
# second incident; callers check the output if they care.
set -uo pipefail

mcp_call() {
  local jwt_file="$1"
  local tool_name="$2"
  local args_json="$3"
  local jwt
  jwt=$(cat "$jwt_file") || return 1

  local merged_args
  merged_args=$(python3 -c "
import json, sys
extra = json.loads(sys.argv[1])
extra['credentialJwt'] = sys.argv[2]
print(json.dumps(extra))
" "$args_json" "$jwt")

  local resp
  resp=$(curl -sS --max-time 10 -X POST http://127.0.0.1:8090/ \
    -H "content-type: application/json" \
    -H "accept: application/json, text/event-stream" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool_name\",\"arguments\":$merged_args}}" 2>/dev/null)

  echo "$resp" | grep '^data: ' | sed 's/^data: //' | python3 -c "
import json, sys
try:
    line = sys.stdin.read().strip()
    obj = json.loads(line)
    content = obj.get('result', {}).get('content', [])
    print(content[0]['text'] if content else obj)
except Exception as e:
    print(f'mcp_call: failed to parse response: {e}', file=sys.stderr)
"
}
