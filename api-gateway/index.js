
const express = require('express');
const client = require('prom-client');
const { createClient } = require('redis');

const app = express();
const PORT = 8000;
const CATALOG_URL = process.env.CATALOG_URL || 'http://localhost:8001';
const ORDER_URL = process.env.ORDER_URL || 'http://localhost:8002';

const register = new client.Registry();

app.use(express.json())

client.collectDefaultMetrics({ register });

//Total number of requests received by the API Gateway
const requestsTotal = new client.Counter({
    name: 'gateway_requests_total',
    help: 'Total number of requests received by the API Gateway',
    labelNames: ['method', 'endpoint', 'http_status'],
    registers: [register]
});

// Duration of requests received by the API Gateway

const requestDuration = new client.Histogram({
    name: 'gateway_request_duration_seconds',
    help: 'Duration of API Gateway requests in seconds',
    labelNames: ['endpoint'],
    registers: [register]
});

// Rate limiter (redis)
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 100);
const RATE_LIMIT_WINDOW = Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 60);

const redis = createClient({ url: REDIS_URL, disableOfflineQueue: true });
redis.on('error', (e) => console.error('Redis error:', e.message));
redis.connect().catch((e) => console.error('Redis connect failed:', e.message));

const rateLimitedTotal = new client.Counter({
    name: 'gateway_rate_limited_total',
    help: 'Total number of requests rejected by the rate limiter',
    registers: [register]
});

async function rateLimiter(req, res, next) {
    if (req.path === '/metrics') return next();

    const bucket = Math.floor(Date.now() / 1000 / RATE_LIMIT_WINDOW);
    const key = `ratelimit:${req.ip}:${bucket}`;

    try {
        const [count] = await redis.multi().incr(key).expire(key, RATE_LIMIT_WINDOW).exec();

        res.set('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
        res.set('X-RateLimit-Remaining', String(Math.max(0, RATE_LIMIT_MAX - count)));

        if (count > RATE_LIMIT_MAX) {
            rateLimitedTotal.inc();
            res.set('Retry-After', String(RATE_LIMIT_WINDOW));
            return res.status(429).json({ error: 'Too many requests' });
        }
    } catch (e) {
        // Redis unavailable: allows request through instead of blocking
    }
    next();
}

// Middleware to measure request duration and count
app.use((req, res, next) => {
    // Skip metrics for the /metrics endpoint to avoid self-monitoring
    if (req.path === '/metrics') {
        return next();
    }
    const start = process.hrtime.bigint();

    res.on('finish', () => {
        const duration = Number(process.hrtime.bigint() - start) / 1e9;
        const endpoint = req.route?.path || req.path;
    
        requestsTotal.inc({
            method: req.method,
            endpoint,
            http_status: String(res.statusCode)
        });

        requestDuration.observe({ endpoint }, duration);
    });

    next();
});

app.use(rateLimiter);

// Routes
app.get('/events', async (req, res) => {
    try {
        const response = await fetch(`${CATALOG_URL}/events`);
        const data = await response.json();

        res.status(response.status).json(data);
    } catch (error) {
        console.error('Error communicating with Catalog:', error.message);

        res.status(502).json({
            error: 'Catalog service unavailable'
        });
    }
});

app.post('/orders', async (req, res) => {
    try {
        const response = await fetch(`${ORDER_URL}/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(req.body)
        });

        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        console.error('Error communicating with Order:', error.message);

        res.status(502).json({
            error: 'Order service unavailable'
        });
    }
});

app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
});

app.listen(PORT, () => {
    console.log(`API Gateway listening on port ${PORT}`);
});
