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
- `manifests/session-app.yml` - eigener Namespace `apps`, Deployment,
  NodePort-Service (30080) und HorizontalPodAutoscaler (CPU-basiert,
  1-6 Replicas) fuer die Session-App (bewusst getrennt vom `infinispan`
  Namespace - erreicht Infinispan ueber den vollen Service-DNS-Namen
  `infinispan.infinispan.svc.cluster.local` namespace-uebergreifend)
- `manifests/kaniko-build.yml` - ConfigMap mit dem App-Quellcode + Kaniko-Job,
  baut das Image in-cluster und pusht es in die lokale Registry (kein
  Docker/Podman auf Node oder Mac noetig)
- `scripts/loadtest.js` - erzeugt Last gegen die Session-App (lokal am Mac
  ausfuehren), damit man Scale-up/Scale-down live beobachten kann
- `bootstrap/runner-rbac.yml` - ServiceAccount + Role/RoleBinding/ClusterRole
  fuer den GitHub Actions Self-hosted Runner. Bewusst NICHT in `manifests/`,
  da der CI-Workflow `kubectl apply -f manifests/` mit genau dieser
  ServiceAccount ausfuehrt - ein Account kann sich per RBAC nicht selbst
  mehr Rechte geben (Privilege-Escalation-Schutz), `kubectl apply` wuerde
  also mit "forbidden" auf die eigenen RBAC-Objekte fehlschlagen. Einmalig
  manuell anwenden: `kubectl apply -f bootstrap/runner-rbac.yml`
- `manifests/runner-build.yml`, `manifests/runner-deploy.yml` - Kaniko-Build
  und Deployment fuer den Self-hosted Runner selbst (Image = offizielles
  actions-runner-Image + kubectl)
- `.github/workflows/deploy.yml` - laeuft bei Push auf `main` mit
  Aenderungen unter `manifests/**`, fuehrt `kubectl apply -f manifests/`
  auf dem Self-hosted Runner aus

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

Dann Registry deployen und Image per Kaniko in-cluster bauen/pushen (kein
Docker/Podman noetig - der `app/`-Ordner selbst dient nur als Referenz/lokale
Ansicht, der tatsaechliche Build-Kontext liegt als ConfigMap in
`kaniko-build.yml`):

```bash
kubectl apply -f manifests/registry.yml
kubectl apply -f manifests/kaniko-build.yml
kubectl logs -n registry job/kaniko-session-app -f
```

Sobald der Job `Completed` ist, ist das Image in der Registry. Danach die
Session-App deployen:

```bash
kubectl apply -f manifests/session-app.yml
```

Hinweis: `app/Dockerfile`, `app/app.js`, `app/digest-auth.js` und die
`Dockerfile`/`app.js`/`digest-auth.js`-Keys in der ConfigMap muessen bei
Aenderungen am Code synchron gehalten werden - die ConfigMap ist der
tatsaechliche Build-Input, `app/` ist die lesbare Kopie im Repo.

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
kubectl get hpa -n apps -w
kubectl get pods -n apps -l app=session-app -o wide -w
```
