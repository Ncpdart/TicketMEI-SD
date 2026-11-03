# TicketMEI

Plataforma eletrónica de venda de bilhetes para eventos.

Projeto desenvolvido no âmbito da unidade curricular
de Sistemas Distribuídos do Mestrado em Engenharia Informática.

## Grupo
- Leonor Vieira (2140223)
- Raquel Freitas (2146623)
- Nicole Dias (2121322)

## Requirements
- Node.js + express (locally)
- Docker Desktop

## Arquitetura
API Gateway > Order > RabbitMQ > Notification, com Catalog para eventos
O Gateway usa Redis para o rate limiter, Prometheus e Grafana para monitorização

## Execute
docker compose up --build -d

## Endpoints
- API Gateway: http://localhost:8000/events
- Catalog: http://localhost:8001/events/evt-101
- Order: http://localhost:8002/orders/1
- Notification: http://localhost:8003/metrics

(Monitorização)
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000 (admin/admin)
- RabbitMQ: http://localhost:15672/ (guest/guest)

## Executar no Kubernetes

1. Ativar Kubernetes no Docker Desktop

2. Instalar o Argo CD:
    kubectl create namespace argocd
    kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

3. Criar a aplicação:
       kubectl apply -f argocd/application.yaml

4. Aceder ao gateway: `kubectl port-forward svc/api-gateway 8000:8000`

5. Interface do Argo CD: `kubectl port-forward svc/argocd-server -n argocd 8080:443` e abrir https://localhost:8080