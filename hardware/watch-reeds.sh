#!/usr/bin/env bash
# Watch reed magnets on the local device_bridge.py (port 8765).
echo "監聽 http://127.0.0.1:8765/state"
echo "把磁鐵靠近再移開。起飛應看到 takeoffCount +1，降落應看到 landCount +1，確認鈕應看到 confirmCount +1。"
echo "Ctrl+C 結束。"
echo

if ! curl -fsS --max-time 2 http://127.0.0.1:8765/state >/dev/null; then
  echo "8765 沒有在跑。請先啟動："
  echo "  python3 ~/SleepAirlineS3/hardware/device_bridge.py"
  exit 1
fi

prev=""
while true; do
  json="$(curl -fsS --max-time 1 http://127.0.0.1:8765/state 2>/dev/null || echo '{"error":"bridge lost"}')"
  if [ "$json" != "$prev" ]; then
    printf '%s  %s\n' "$(date +%H:%M:%S)" "$json"
    prev="$json"
  fi
  sleep 0.15
done
