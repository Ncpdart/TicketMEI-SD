const express = require("express");
const amqp = require("amqplib");
const client = require("prom-client");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8003;
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost";
const QUEUE_NAME = "order_created";

// Database
const db = new Database(path.join(__dirname, "database", "notification.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL
  )
`);

// Prometheus metrics
client.collectDefaultMetrics();

const notificationsProcessed = new client.Counter({
  name: "notifications_processed_total",
  help: "Total number of notifications processed",
  labelNames: ["status"],
});

const notificationDuration = new client.Histogram({
  name: "notification_processing_duration_seconds",
  help: "Duration of notification processing in seconds",
  labelNames: ["status"],
  buckets: [0.05, 0.1, 0.2, 0.5, 1],
});

// Simulate email sending with 100ms delay
async function sendEmail() {
  return new Promise((resolve) => {
    setTimeout(() => {
      // Simulate occasional failure (10% chance)
      const success = Math.random() > 0.1;
      resolve(success);
    }, 100);
  });
}

// Consume messages from RabbitMQ
async function startConsumer() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();
    await channel.assertQueue(QUEUE_NAME, { durable: true });

    // Process one message at a time
    channel.prefetch(1);

    console.log("Notification service connected to RabbitMQ, waiting for messages...");

    channel.consume(QUEUE_NAME, async (msg) => {
      if (!msg) return;

      const end = notificationDuration.startTimer();
      const order = JSON.parse(msg.content.toString());
      const email = `customer_${order.customer_id}@example.com`;

      try {
        const success = await sendEmail();
        const status = success ? "SENT" : "FAILED";

        // Save to database
        db.prepare(
          "INSERT INTO notifications (order_id, email, status) VALUES (?, ?, ?)"
        ).run(order.order_id, email, status);

        console.log(
          `Notification ${status} | order_id=${order.order_id} email=${email}`
        );

        notificationsProcessed.inc({ status });
        end({ status });

        channel.ack(msg);
      } catch (error) {
        console.error(`Error processing notification for order ${order.order_id}:`, error.message);

        db.prepare(
          "INSERT INTO notifications (order_id, email, status) VALUES (?, ?, ?)"
        ).run(order.order_id, email, "FAILED");

        notificationsProcessed.inc({ status: "FAILED" });
        end({ status: "FAILED" });
        channel.ack(msg);
      }
    });

    connection.on("close", () => {
      console.warn("RabbitMQ connection closed, retrying in 5s...");
      setTimeout(startConsumer, 5000);
    });
  } catch (error) {
    console.error("Failed to connect to RabbitMQ, retrying in 5s...", error.message);
    setTimeout(startConsumer, 5000);
  }
}

startConsumer();

// GET /metrics
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Notification service running on port ${PORT}`);
});
