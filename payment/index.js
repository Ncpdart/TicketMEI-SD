const express = require("express");
const Database = require("better-sqlite3");
const client = require("prom-client");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8004;

app.use(express.json());

// Database
const databaseDirectory = path.join(__dirname, "database");
fs.mkdirSync(databaseDirectory, { recursive: true });

const db = new Database(
  path.join(databaseDirectory, "payment.db")
);

db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL
        CHECK (status IN ('SUCCESS', 'FAILED')),
    processed_at TEXT NOT NULL DEFAULT (datetime('now','utc'))
  )
`);

// Prometheus
client.collectDefaultMetrics();

const paymentRequests = new client.Counter({
  name: "payment_requests_total",
  help: "Total number of payment requests",
  labelNames: ["http_status"],
});

const paymentProcessingDuration = new client.Histogram({
  name: "payment_processing_duration_seconds",
  help: "Duration of payment processing in seconds",
  buckets: [0.1, 0.5, 1, 2, 5, 10, 15, 30],
});

// Fault simulation
let faultConfig = {
  errorRate: 0,
  latencyMs: 0,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// POST /payments
app.post("/payments", async (req, res) => {
  const endTimer = paymentProcessingDuration.startTimer();
  let httpStatus = 500;

  try {
    const { order_id, amount } = req.body;

    if (
      !Number.isInteger(order_id) ||
      order_id <= 0 ||
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      httpStatus = 400;

      return res.status(httpStatus).json({
        error: "Invalid payment data",
      });
    }

    // Simulated external payment latency
    if (faultConfig.latencyMs > 0) {
      await sleep(faultConfig.latencyMs);
    }

    // Simulated payment failure
    const shouldFail = Math.random() < faultConfig.errorRate;
    const status = shouldFail ? "FAILED" : "SUCCESS";

    const result = db.prepare(`
      INSERT INTO payments (order_id, amount, status)
      VALUES (?, ?, ?)
    `).run(order_id, amount, status);

    const payment = db.prepare(`
      SELECT * FROM payments WHERE id = ?
    `).get(result.lastInsertRowid);

    if (shouldFail) {
      httpStatus = 500;

      return res.status(httpStatus).json({
        error: "Payment processing failed",
        payment,
      });
    }

    httpStatus = 201;
    return res.status(httpStatus).json(payment);

  } catch (error) {
    console.error("Error processing payment:", error);

    httpStatus = 500;

    return res.status(httpStatus).json({
      error: "Unable to process payment",
    });

  } finally {
    paymentRequests.inc({
      http_status: String(httpStatus),
    });

    endTimer();
  }
});

// POST /payments/configure-faults
app.post("/payments/configure-faults", (req, res) => {
  const { error_rate, latency_ms } = req.body;

  if (
    typeof error_rate !== "number" ||
    !Number.isFinite(error_rate) ||
    error_rate < 0 ||
    error_rate > 1 ||
    !Number.isInteger(latency_ms) ||
    latency_ms < 0
  ) {
    return res.status(400).json({
      error: "Invalid fault configuration",
      expected: {
        error_rate: "Number between 0 and 1",
        latency_ms: "Non-negative integer",
      },
    });
  }

  faultConfig = {
    errorRate: error_rate,
    latencyMs: latency_ms,
  };

  return res.json({
    message: "Fault configuration updated",
    configuration: {
      error_rate: faultConfig.errorRate,
      latency_ms: faultConfig.latencyMs,
    },
  });
});

// GET /metrics
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Payment service running on port ${PORT}`);
});