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

## Execute
docker compose up --build -d

## Endpoints
- API Gateway: http://localhost:8000/events
- Catalog: http://localhost:8001/events/evt-101
- Order: http://localhost:8002/orders/1
- Notification: http://localhost:8003/metrics

(Monitorização)
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000
- RabbitMQ: http://localhost:15672/
