
const express = require('express');
const client = require('prom-client');
const events = require('./data/events.json');

const app = express();
const PORT = 8001;

const register = new client.Registry();

client.collectDefaultMetrics({ register });

//Total number of requests received by Catalog
const requestsTotal = new client.Counter({
    name: 'catalog_requests_total',
    help: 'Total number of requests received by Catalog',
    labelNames: ['endpoint', 'http_status'],
    registers: [register]
});

// Duration of requests received by Catalog
const requestDuration = new client.Histogram({
    name: 'catalog_request_duration_seconds',
    help: 'Duration of Catalog HTTP requests in seconds',
    labelNames: ['endpoint'],
    registers: [register]
});

// Middleware to measure request duration and count
app.use((req, res, next) => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
        const duration = Number(process.hrtime.bigint() - start) / 1e9;

        requestsTotal.inc({
            endpoint: req.route?.path || req.path,
            http_status: String(res.statusCode)
        });

        requestDuration.observe(
            { endpoint: req.route?.path || req.path },
            duration
        );
    });

    next();
});

// Routes
app.get('/events', (req, res) => {
    res.json(events);
});

app.get('/events/:id', (req, res) => {
    const event = events.find(
        event => event.id === Number(req.params.id)
    );

    if (!event) {
        return res.status(404).json({
            error: 'Event not found'
        });
    }

    res.json(event);
});

app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
});

app.listen(PORT, () => {
    console.log(`Catalog running on port ${PORT}`);
});
