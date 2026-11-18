import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: {
    constant_orders: {
      executor: "constant-arrival-rate",
      rate: 50,
      timeUnit: "1s",
      duration: "2m",
      preAllocatedVUs: 100,
      maxVUs: 300,
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