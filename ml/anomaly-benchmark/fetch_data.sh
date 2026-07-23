#!/usr/bin/env bash
# Fetch the NAB (Numenta Anomaly Benchmark) real AWS CloudWatch series used by
# benchmark.py. NAB is AGPL-licensed, so we download rather than vendor it.
set -e
BASE="https://raw.githubusercontent.com/numenta/NAB/master"
cd "$(dirname "$0")/data" 2>/dev/null || { mkdir -p "$(dirname "$0")/data" && cd "$(dirname "$0")/data"; }

curl -sSfL -o combined_windows.json "$BASE/labels/combined_windows.json"
for f in rds_cpu_utilization_cc0c53 rds_cpu_utilization_e47b3b ec2_cpu_utilization_24ae8d; do
  curl -sSfL -o "$f.csv" "$BASE/data/realAWSCloudwatch/$f.csv"
done
echo "NAB data ready in $(pwd)"
