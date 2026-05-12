const requestCounts = new Map();

const CLEANUP_INTERVAL = 60 * 1000;
let lastCleanup = Date.now();

function cleanup() {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL) return;
    lastCleanup = now;
    for (const [key, entry] of requestCounts) {
        if (now - entry.start > entry.window) {
            requestCounts.delete(key);
        }
    }
}

export function rateLimit(req, { maxRequests = 10, windowMs = 60000 } = {}) {
    cleanup();
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.headers['x-real-ip']
        || req.socket?.remoteAddress
        || 'unknown';

    const key = `${ip}:${req.url}`;
    const now = Date.now();
    const entry = requestCounts.get(key);

    if (!entry || now - entry.start > windowMs) {
        requestCounts.set(key, { count: 1, start: now, window: windowMs });
        return { allowed: true, remaining: maxRequests - 1 };
    }

    entry.count++;
    if (entry.count > maxRequests) {
        return { allowed: false, remaining: 0 };
    }

    return { allowed: true, remaining: maxRequests - entry.count };
}

export function maskCPF(cpf) {
    if (!cpf || cpf.length < 6) return '***';
    return `***${cpf.slice(-4)}`;
}
