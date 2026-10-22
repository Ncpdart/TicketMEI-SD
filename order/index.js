const express = require("express");
const Database = require("better-sqlite3");
const client = require("prom-client");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8002;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Database connection
const db = new Database(path.join(__dirname, "database", "order.db"));

//For date creation its being used the UTC time zone to avoid issues with time zones in different regions
db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','utc')),
        total_amount REAL NOT NULL,
        quantity INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING'
    )
`);

// Prometheus metrics
client.collectDefaultMetrics();

const ordersInitiated = new client.Counter({
  name: "orders_initiated_total",
  help: "Total number of orders initiated",
  labelNames: ["status"],
});

const API_GATEWAY_URL = process.env.API_GATEWAY_URL  || "http://localhost:8000";
// POST /orders
app.post("/orders", async (req, res) => {
  const { customer_id, event_id, quantity } = req.body;

  //RF2 - Quantity ticket limit
  if (
    !customer_id ||
    !Number.isInteger(event_id) ||
    !Number.isInteger(quantity) ||
    quantity <= 0 ||
    quantity > 4
  ) {
    return res.status(400).json({
      error: "Invalid order data",
    });
  }

  try {
    // Obtain event details from catalog throught the api-gateway service, to avoid direct communication between services
    const response = await fetch(`${API_GATEWAY_URL}/events`);

    if (!response.ok) {
      return res.status(502).json({
        error: "Catalog service unavailable",
      });
    }

    const events = await response.json();
    // Finds the selected event on the request
    const event = events.find((event) => event.id === event_id);

    if (!event) {
      return res.status(404).json({
        error: "Event not found",
      });
    }

    // Calculate total using the Catalog price
    const total_amount = Number((event.price * quantity).toFixed(2));

    const result = db
      .prepare(
        `
            INSERT INTO orders (
                customer_id,
                event_id,
                total_amount,
                quantity,
                status
            )
            VALUES (?, ?, ?, ?, 'PENDING')
        `,
      )
      .run(String(customer_id), String(event_id), total_amount, quantity);

    const order = db
      .prepare("SELECT * FROM orders WHERE id = ?")
      .get(result.lastInsertRowid);

    ordersInitiated.inc({ status: "PENDING" });

    return res.status(202).json(order);
  } catch (error) {
    console.error("Error creating order:", error);

    return res.status(502).json({
      error: "Unable to create order",
    });
  }
});

// GET /orders/:id
app.get("/orders/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: "Invalid order ID",
    });
  }

  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);

  if (!order) {
    return res.status(404).json({
      error: "Order not found",
    });
  }

  return res.json(order);
});

// GET /metrics
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Order service running on port ${PORT}`);
});
