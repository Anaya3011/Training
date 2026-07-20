# k8s-infinispan-lab

Trainingsumgebung: Kubernetes-Cluster (kubeadm, containerd, Flannel) mit
Infinispan als StatefulSet fuer Skalierungs-Tests, spaeter Anbindung einer
Frontend-Applikation und GitHub Actions Runner.

## Cluster

- Kubernetes v1.31 (kubeadm)
- Control-Plane: k8s-control01 (192.168.8.250)
- Worker: k8s-worker01, k8s-worker02
- CNI: Flannel, Pod-CIDR 10.244.0.0/16
- Container-Runtime: containerd (SystemdCgroup aktiviert)

## Inhalt

- `scripts/prepare-node.sh` - Vorbereitung jeder Node vor `kubeadm init`/`join`
  (swap deaktivieren, kernel modules, sysctl, containerd, kubelet/kubeadm/kubectl)
- `manifests/infinispan.yml` - Namespace, Secret, Services, StatefulSet fuer
  einen 3-Node Infinispan-Cluster (DNS_PING ueber den Headless-Service fuer
  Cluster-Discovery ueber Node-Grenzen hinweg)

## Deploy

```bash
kubectl apply -f manifests/infinispan.yml
kubectl get pods -n infinispan -o wide -w
```

## Skalierung testen

```bash
kubectl scale statefulset infinispan -n infinispan --replicas=5
kubectl get pods -n infinispan -o wide -w
```
