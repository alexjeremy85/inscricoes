import { rateLimit } from './rate-limiter.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Método não permitido' });
    }

    const { allowed } = rateLimit(req, { maxRequests: 10, windowMs: 60000 });
    if (!allowed) {
        return res.status(429).json({ error: 'Muitas requisições' });
    }

    try {
        const envValue = (process.env.PAGBANK_ENV || '').trim().toLowerCase();
        const isProduction = envValue === 'production';

        const publicKey = process.env.PAGBANK_PUBLIC_KEY;

        if (!publicKey) {
            return res.status(500).json({
                error: 'Configuração incompleta',
                message: 'Chave pública do PagBank não configurada'
            });
        }

        return res.status(200).json({
            publicKey,
            environment: isProduction ? 'production' : 'sandbox'
        });

    } catch (error) {
        console.error('Erro ao obter chave pública:', error.message);
        return res.status(500).json({ error: 'Erro interno do servidor' });
    }
}
