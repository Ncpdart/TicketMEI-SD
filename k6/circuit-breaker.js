import http from "k6/http";
import { check } from "k6";

// Payment settings
const PAYMENT_URL = "http://host.docker.internal:8004";
const FAULT_MODE = __ENV.FAULT_MODE || "errors";

// Fault types
const FAULTS = {
  errors: { error_rate: 0.8, latency_ms: 0 },  // 80% de respostas HTTP 500
  latency: { error_rate: 0, latency_ms: 10000 }, // atraso de 10 s
};
const NO_FAULTS = { error_rate: 0, latency_ms: 0 };

export const options = {
  scenarios: {
    constant_orders: {
      executor: "constant-arrival-rate",
      rate: 50,
      timeUnit: "1s",
      duration: "5m",
      preAllocatedVUs: 100,
      maxVUs: 600,
    },
    // Inject fault at 1 min
    inject_fault: {
      executor: "per-vu-iterations",
      exec: "injectFault",
      vus: 1,
      iterations: 1,
      startTime: "1m",
    },
    // Restore Payment at 3 min
    restore_payment: {
      executor: "per-vu-iterations",
      exec: "restorePayment",
      vus: 1,
      iterations: 1,
      startTime: "3m",
    },
  },
};

export default function () {
  const payload = JSON.stringify({
    customer_id: `K6-${__VU}-${__ITER}`,
    event_id: "evt-102",
    quantity: 1,
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
    },
  };

  const response = http.post(
    "http://host.docker.internal:8000/orders",
    payload,
    params
  );

  check(response, {
    "request received a valid response": (r) =>
      [201, 502, 503].includes(r.status),
  });
}

// Configure Payment faults
function configurePayment(config) {
  const response = http.post(
    `${PAYMENT_URL}/payments/configure-faults`,
    JSON.stringify(config),
    { headers: { "Content-Type": "application/json" } }
  );

  check(response, {
    "payment configured": (r) => r.status === 200,
  });
}

// Scenario functions
export function injectFault() {
  configurePayment(FAULTS[FAULT_MODE]);
}

export function restorePayment() {
  configurePayment(NO_FAULTS);
}