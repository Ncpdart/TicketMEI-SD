# TicketMEI

Plataforma eletrónica de venda de bilhetes para eventos.

Projeto desenvolvido no âmbito da unidade curricular
de Sistemas Distribuídos do Mestrado em Engenharia Informática.

## Requirements
- Node.js + express (locally)
- Docker Desktop

## Execute
docker compose up --build -d

## Endpoints
- API Gateway: http://localhost:8000/events
- Catalog: http://localhost:8001/events
- Order: http://localhost:8002/orders/ID
- Notification: http://localhost:8003/metrics

(Monitorização)
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000
- RabbitMQ: http://localhost:15672/
