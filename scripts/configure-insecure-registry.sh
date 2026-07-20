#!/usr/bin/env bash
set -euo pipefail

# Run on every node (control-plane and workers) so containerd will pull
# from the in-cluster registry without TLS.

REGISTRY="192.168.8.250:30500"
CERTS_DIR="/etc/containerd/certs.d/${REGISTRY}"

mkdir -p "${CERTS_DIR}"
cat <<EOF | tee "${CERTS_DIR}/hosts.toml"
server = "http://${REGISTRY}"

[host."http://${REGISTRY}"]
  capabilities = ["pull", "resolve", "push"]
EOF

# containerd 2.x (Ubuntu 26.04 default) uses the io.containerd.cri.v1.images
# plugin namespace; containerd 1.7.x uses io.containerd.grpc.v1.cri instead.
sed -i "/\[plugins\.'io\.containerd\.cri\.v1\.images'\.registry\]/,/^\[/{s|config_path = .*|config_path = '/etc/containerd/certs.d'|}" /etc/containerd/config.toml
sed -i '/\[plugins\."io\.containerd\.grpc\.v1\.cri"\.registry\]/,/^\[/{s|config_path = .*|config_path = "/etc/containerd/certs.d"|}' /etc/containerd/config.toml

systemctl restart containerd
