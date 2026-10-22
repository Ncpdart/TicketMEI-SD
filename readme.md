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
- Order: http://localhost:8001/orders

(Monitorização)
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000

### Order template POST
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:8000/orders" `
  -ContentType "application/json" `
  -Body '{"customer_id":"145","event_id":2,"quantity":2}'
