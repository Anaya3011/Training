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
- `manifests/registry.yml` - lokale Docker-Registry (registry:2) im Cluster,
  NodePort 30500, fuer eigene Images ohne externen Registry-Account
- `scripts/configure-insecure-registry.sh` - auf jeder Node ausfuehren, damit
  containerd von der Registry ohne TLS pullen darf
- `app/` - "Session-App" (Node.js, kein Framework): schreibt/liest pro
  Session-ID einen Zaehler in Infinispan per REST (Digest-Auth), Antwort
  zeigt den Pod-Hostnamen, der geantwortet hat
- `manifests/session-app.yml` - Deployment, NodePort-Service (30080) und
  HorizontalPodAutoscaler (CPU-basiert, 1-6 Replicas) fuer die Session-App
- `scripts/loadtest.js` - erzeugt Last gegen die Session-App (lokal am Mac
  ausfuehren), damit man Scale-up/Scale-down live beobachten kann

## Deploy Infinispan

```bash
kubectl apply -f manifests/infinispan.yml
kubectl get pods -n infinispan -o wide -w
```

## Skalierung von Infinispan testen

```bash
kubectl scale statefulset infinispan -n infinispan --replicas=5
kubectl get pods -n infinispan -o wide -w
```

## Session-App aufsetzen (zeigt: Session-Daten unabhaengig vom Pod abrufbar)

Voraussetzung: metrics-server im Cluster installiert (fuer die HPA), siehe
unten. Auf jeder Node einmalig:

```bash
scripts/configure-insecure-registry.sh
```

Dann Registry deployen, Image bauen und pushen (von einer Node mit Docker
oder ueber `nerdctl`/`buildctl`, je nachdem was verfuegbar ist):

```bash
kubectl apply -f manifests/registry.yml
docker build -t 192.168.8.250:30500/session-app:1.0 app/
docker push 192.168.8.250:30500/session-app:1.0
kubectl apply -f manifests/session-app.yml
```

Test manuell (Pod-Hostname in der Antwort beachten):

```bash
curl "http://192.168.8.250:30080/?session=test"
```

## metrics-server installieren (Voraussetzung fuer die HPA)

kubeadm-Cluster haben standardmaessig keinen metrics-server. Version 0.8.x
(nicht `latest`/0.9.x, die K8s 1.34+ voraussetzen):

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.8.1/components.yaml
kubectl patch deployment metrics-server -n kube-system --type='json' \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
kubectl top nodes
```
(`--kubelet-insecure-tls` ist noetig, weil kubeadm-Kubelet-Zertifikate nicht
von einer CA signiert sind, der metrics-server standardmaessig vertraut -
fuer ein Lab ok, nicht fuer Produktion.)

## Load-Test fahren und Scale-up/down beobachten

```bash
TARGET=http://192.168.8.250:30080 DURATION_S=180 CONCURRENCY=30 node scripts/loadtest.js
```

Parallel dazu beobachten:

```bash
kubectl get hpa -n infinispan -w
kubectl get pods -n infinispan -l app=session-app -o wide -w
```
