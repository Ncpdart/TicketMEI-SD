const express = require("express");
const Database = require("better-sqlite3");
const client = require("prom-client");
const axios = require("axios");
const amqp = require("amqplib");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8002;
const CATALOG_URL = process.env.CATALOG_URL || "http://localhost:8001";
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost";
const EXCHANGE_NAME = "orders.exchange";
const QUEUE_NAME = "order_created";
const ROUTING_KEY = "OrderCreated";
const PAYMENT_URL = process.env.PAYMENT_URL || "http://localhost:8004";
const PAYMENT_TIMEOUT = Number(process.env.PAYMENT_TIMEOUT || 5000);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Database connection
const databaseDirectory = path.join(__dirname, "database");
// Create the database directory if it doesn't exist
fs.mkdirSync(databaseDirectory, { recursive: true });

const db = new Database(path.join(databaseDirectory, "order.db"));

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
          CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'FAILED'))
    )
`);

// Prometheus metrics
client.collectDefaultMetrics();

// Order metrics
const ordersInitiated = new client.Counter({
  name: "orders_initiated_total",
  help: "Total number of orders initiated",
  labelNames: ["status"],
});

// Circuit Breaker metrics
const circuitBreakerState = new client.Gauge({
  name: "circuit_breaker_state",
  help: "Circuit Breaker state: 0=Closed, 1=Open, 2=Half-Open",
});

const circuitBreakerFallbacks = new client.Counter({
  name: "circuit_breaker_fallbacks_total",
  help: "Total number of requests rejected by the open Circuit Breaker",
});

const paymentClientRequests = new client.Counter({
  name: "payment_client_requests_total",
  help: "Total number of requests sent to the Payment service",
  labelNames: ["status"],
});

//Initialize the circuit breaker state to closed (0)
circuitBreakerState.set(0);

// Circuit Breaker configuration
const CIRCUIT_FAILURE_THRESHOLD = Number(process.env.CIRCUIT_FAILURE_THRESHOLD || 5);
const CIRCUIT_RESET_TIMEOUT = 15000;
const MAX_PAYMENT_ATTEMPTS = 2;

let circuitState = "CLOSED";
let consecutiveFailures = 0;
let nextAttemptTime = 0;
let halfOpenProbeInProgress = false;

function updateCircuitState(state) {
  circuitState = state;

  const values = {
    CLOSED: 0,
    OPEN: 1,
    HALF_OPEN: 2,
  };

  circuitBreakerState.set(values[state]);

  console.log(`Circuit Breaker state: ${state}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomJitter() {
  return Math.floor(Math.random() * 1000);
}

async function processPayment(order) {
  // Circuit OPEN: wait until reset timeout expires
  if (circuitState === "OPEN") {
    if (Date.now() < nextAttemptTime) {
      circuitBreakerFallbacks.inc();

      const error = new Error("CIRCUIT_OPEN");
      error.code = "CIRCUIT_OPEN";
      throw error;
    }

    updateCircuitState("HALF_OPEN");
  }

  // Only one request can test recovery in HALF_OPEN
  const isHalfOpen = circuitState === "HALF_OPEN";

  if (isHalfOpen) {
    if (halfOpenProbeInProgress) {
      circuitBreakerFallbacks.inc();

      const error = new Error("CIRCUIT_OPEN");
      error.code = "CIRCUIT_OPEN";
      throw error;
    }

    halfOpenProbeInProgress = true;
  }

  const attempts = isHalfOpen ? 1 : MAX_PAYMENT_ATTEMPTS;

  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      // Retry: if another request opened the circuit meanwhile, stop retrying immediately
      if (attempt > 1 && circuitState !== "CLOSED") {
        circuitBreakerFallbacks.inc();

        const error = new Error("CIRCUIT_OPEN");
        error.code = "CIRCUIT_OPEN";
        throw error;
      }

      try {
        const response = await axios.post(
          `${PAYMENT_URL}/payments`,
          {
            order_id: order.id,
            amount: order.total_amount,
          },
          {
            timeout: PAYMENT_TIMEOUT,
          },
        );

        paymentClientRequests.inc({
          status: String(response.status),
        });

        if (response.data.status !== "SUCCESS") {
          throw new Error("Payment unsuccessful");
        }

        consecutiveFailures = 0;
        updateCircuitState("CLOSED");

        return response.data;
      } catch (error) {
        const status = error.response
          ? String(error.response.status)
          : "timeout";

        paymentClientRequests.inc({ status });

        consecutiveFailures++;

        console.error(`Payment attempt ${attempt} failed:`, error.message);

        if (isHalfOpen || consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
          updateCircuitState("OPEN");
          nextAttemptTime = Date.now() + CIRCUIT_RESET_TIMEOUT;
          throw error;
        }

        if (attempt < attempts) {
          await sleep(randomJitter());
        }
      }
    }

    throw new Error("Payment failed after retries");
  } finally {
    if (isHalfOpen) {
      halfOpenProbeInProgress = false;
    }
  }
}

// RabbitMQ connection
let rabbitChannel = null;

async function connectRabbitMQ() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    rabbitChannel = await connection.createConfirmChannel();

    // Declare exchange
    await rabbitChannel.assertExchange(EXCHANGE_NAME, "direct", {
      durable: true,
    });

    // Declare queue
    await rabbitChannel.assertQueue(QUEUE_NAME, { durable: true });

    // Bind queue to exchange
    await rabbitChannel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, ROUTING_KEY);

    console.log("Connected to RabbitMQ");

    connection.on("close", () => {
      console.warn("RabbitMQ connection closed, retrying in 5s...");
      rabbitChannel = null;
      setTimeout(connectRabbitMQ, 5000);
    });
  } catch (error) {
    console.error(
      "Failed to connect to RabbitMQ, retrying in 5s...",
      error.message,
    );
    setTimeout(connectRabbitMQ, 5000);
  }
}

connectRabbitMQ();

// POST /orders
app.post("/orders", async (req, res) => {
  const { customer_id, event_id, quantity } = req.body;

  //RF2 - Quantity ticket limit
  if (
    !customer_id ||
    typeof event_id !== "string" ||
    !event_id.trim() ||
    !Number.isInteger(quantity) ||
    quantity <= 0 ||
    quantity > 4
  ) {
    return res.status(400).json({
      error: "Invalid order data",
    });
  }

  try {
    // Obtain event details from catalog
    const response = await fetch(
      `${CATALOG_URL}/events/${encodeURIComponent(event_id)}`,
    );

    if (response.status === 404) {
      return res.status(404).json({
        error: "Event not found",
      });
    }

    if (!response.ok) {
      return res.status(502).json({
        error: "Catalog service unavailable",
      });
    }

    const event = await response.json();

    // Calculate total using the Catalog price
    const total_amount = Number((event.price_eur * quantity).toFixed(2));

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

    // Publish OrderCreated message to RabbitMQ

    // Process payment
    try {
      await processPayment(order);
    } catch (error) {
      db.prepare(
        `
    UPDATE orders
    SET status = 'FAILED'
    WHERE id = ?
  `,
      ).run(order.id);

      ordersInitiated.inc({ status: "FAILED" });

      if (error.code === "CIRCUIT_OPEN") {
        return res.status(503).json({
          error: "Payment system unavailable, try again later",
        });
      }

      return res.status(502).json({
        error: "Payment processing failed",
      });
    }

    // Payment succeeded: confirm order
    db.prepare(
      `
  UPDATE orders
  SET status = 'CONFIRMED'
  WHERE id = ?
`,
    ).run(order.id);

    const confirmedOrder = db
      .prepare("SELECT * FROM orders WHERE id = ?")
      .get(order.id);

    ordersInitiated.inc({ status: "CONFIRMED" });

    // Publish OrderCreated to RabbitMQ
    if (!rabbitChannel) {
      console.error(`Order ${order.id} confirmed, but RabbitMQ is unavailable`);

      return res.status(201).json({
        ...confirmedOrder,
        notification_status: "PENDING",
      });
    }

    const message = {
      order_id: confirmedOrder.id,
      customer_id: confirmedOrder.customer_id,
      event_id: confirmedOrder.event_id,
      total_amount: confirmedOrder.total_amount,
      quantity: confirmedOrder.quantity,
      created_at: confirmedOrder.created_at,
    };

    try {
      rabbitChannel.publish(
        EXCHANGE_NAME,
        ROUTING_KEY,
        Buffer.from(JSON.stringify(message)),
        {
          persistent: true,
          contentType: "application/json",
        },
      );

      await rabbitChannel.waitForConfirms();
    } catch (error) {
      console.error(
        `Failed to publish OrderCreated for order ${order.id}:`,
        error.message,
      );

      return res.status(201).json({
        ...confirmedOrder,
        notification_status: "PENDING",
      });
    }

    return res.status(201).json(confirmedOrder);
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
