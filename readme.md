# TicketMEI

Plataforma eletrónica de venda de bilhetes para eventos, baseada em microsserviços.

Projeto desenvolvido no âmbito da unidade curricular de Sistemas Distribuídos do Mestrado em Engenharia Informática (Universidade da Madeira).

## Grupo

- Leonor Vieira (2140223)
- Raquel Freitas (2146623)
- Nicole Dias (2121322)

## Arquitetura

Todo o tráfego dos clientes passa pelo API Gateway, que encaminha os pedidos para o Catalog (consulta de eventos) e para o Order (compra de bilhetes). O Order envia uma mensagem para o RabbitMQ e o Notification consome-a para simular o envio do email de confirmação.

O API Gateway usa o Redis para o rate limiter, e o Prometheus e o Grafana recolhem e mostram as métricas dos serviços.

```
Cliente -> API Gateway -> Catalog
                       -> Order -> RabbitMQ -> Notification
```

## Requisitos

- Node.js + express (localmente)
- Docker Desktop com o Kubernetes ativo

## Executar com Docker Compose

```
docker compose up --build -d
```

Para parar: `docker compose down`

## Executar em Kubernetes

Os manifestos estão em `k8s/`. O Argo CD vigia essa pasta e mantém o cluster igual ao repositório.

1. Instalar o Argo CD:

   ```
   kubectl create namespace argocd
   kubectl apply -n argocd --server-side --force-conflicts -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
   ```

2. Criar a aplicação:

   ```
   kubectl apply -f argocd/application.yaml
   ```

3. Ver o estado (os pods ficam `Running` e a aplicação `Synced` e `Healthy`):

   ```
   kubectl get pods
   kubectl get applications -n argocd
   ```

4. Abrir os serviços (um comando por terminal):

   ```
   kubectl port-forward svc/api-gateway 8100:8000
   kubectl port-forward svc/grafana 3100:3000
   kubectl port-forward svc/prometheus 9091:9090
   kubectl port-forward svc/argocd-server -n argocd 8443:443
   ```

## Endereços

| Serviço | Docker Compose | Kubernetes |
|---|---|---|
| API Gateway | http://localhost:8000/events | http://localhost:8100/events |
| Catalog | http://localhost:8001/events/evt-101 | |
| Order | http://localhost:8002/orders/1 | |
| Notification | http://localhost:8003/metrics | |
| Prometheus | http://localhost:9090 | http://localhost:9091 |
| Grafana | http://localhost:3000 | http://localhost:3100 |
| RabbitMQ | http://localhost:15672 | |
| Argo CD | | https://localhost:8443 |

Credenciais:
- Grafana: `admin` / `admin`
- RabbitMQ: `guest` / `guest`
- Argo CD: `admin` e a password inicial, obtida com (PowerShell):

```
$p = kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}"
[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($p))
```

## Testes de carga (k6)

```
docker compose --profile testing run --rm k6 run load-test.js
```

## CI/CD

- `ci.yml`: valida o build, o ambiente Docker Compose e executa os testes k6.
- `build-push.yml`: identifica os serviços alterados, constrói as imagens, publica-as no GitHub Container Registry (GHCR) com o Git SHA como tag e atualiza as tags dos manifestos em `k8s/`.
- Argo CD: deteta a alteração em `k8s/` e atualiza o cluster automaticamente.

## Rate limiter

O API Gateway usa um rate limiter baseado em Redis, que limita o número de pedidos por IP de cliente no `POST /orders`. O tráfego excedente recebe HTTP 429 (Too Many Requests). O limite e a janela de tempo são configuráveis com as variáveis `RATE_LIMIT_MAX` e `RATE_LIMIT_WINDOW_SECONDS`.
