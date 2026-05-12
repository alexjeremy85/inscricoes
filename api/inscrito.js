import { google } from 'googleapis';
import { rateLimit } from './rate-limiter.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido' });
    }

    const { allowed } = rateLimit(req, { maxRequests: 5, windowMs: 60000 });
    if (!allowed) {
        return res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });
    }

    try {
        const { cpf, email } = req.body;

        if (!cpf) {
            return res.status(400).json({ error: 'CPF obrigatório' });
        }

        const cpfLimpo = cpf.replace(/\D/g, '');

        if (cpfLimpo.length !== 11) {
            return res.status(400).json({ error: 'CPF inválido' });
        }

        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Inscrições!A:ZZ',
        });

        const rows = response.data.values;

        if (!rows || rows.length <= 1) {
            return res.status(404).json({ error: 'Nenhuma inscrição encontrada' });
        }

        const headers = rows[0];
        const cpfIndex = headers.indexOf('cpf');
        const emailIndex = headers.indexOf('email');

        if (cpfIndex === -1) {
            return res.status(500).json({ error: 'Erro interno' });
        }

        const inscritosComCPF = rows.slice(1).filter(row => {
            const rowCPF = (row[cpfIndex] || '').replace(/\D/g, '');
            return rowCPF === cpfLimpo;
        });

        if (inscritosComCPF.length === 0) {
            return res.status(404).json({
                error: 'CPF não encontrado',
                message: 'Verifique se você já realizou sua inscrição'
            });
        }

        const inscritoRow = inscritosComCPF[inscritosComCPF.length - 1];

        if (email) {
            const rowEmail = (inscritoRow[emailIndex] || '').toLowerCase().trim();
            if (rowEmail !== email.toLowerCase().trim()) {
                return res.status(403).json({
                    error: 'Dados não conferem',
                    message: 'CPF e email não correspondem a mesma inscrição'
                });
            }
        }

        const inscrito = {};
        headers.forEach((header, index) => {
            inscrito[header] = inscritoRow[index] || '';
        });

        const numeroParcelas = parseInt(inscrito.numero_parcelas) || 1;
        const valorTotal = 450.00;
        const valorParcela = (valorTotal / numeroParcelas).toFixed(2);

        const parcelas = [];
        for (let i = 1; i <= numeroParcelas; i++) {
            const parcelaKey = `parcela_${String(i).padStart(2, '0')}_paga`;
            const dataVencimentoKey = `data_pagamento_${String(i).padStart(2, '0')}`;
            const dataPagaKey = `data_paga_${String(i).padStart(2, '0')}`;

            const parcelaPaga = inscrito[parcelaKey];
            const dataVencimento = inscrito[dataVencimentoKey];
            const dataPaga = inscrito[dataPagaKey];

            const isPaga = parcelaPaga === '1' || parcelaPaga === 1 || parcelaPaga === true;

            parcelas.push({
                numero: i,
                valor: parseFloat(valorParcela),
                vencimento: dataVencimento || 'Não definido',
                status: isPaga ? 'pago' : 'pendente',
                data_pagamento: isPaga ? dataPaga : null
            });
        }

        return res.status(200).json({
            id_inscricao: inscrito.id_inscricao,
            nome_completo: inscrito.nome_completo,
            email: inscrito.email,
            telefone: inscrito.telefone,
            cidade_pais: inscrito.cidade_pais,
            numero_parcelas: numeroParcelas,
            valor_parcela: parseFloat(valorParcela),
            valor_total: valorTotal,
            dia_vencimento: inscrito.dia_vencimento || '15',
            forma_pagamento: inscrito.forma_pagamento,
            inscricao_confirmada: inscrito.inscricao_confirmada,
            parcelas: parcelas
        });

    } catch (error) {
        console.error('Erro ao buscar inscrito:', error.message);
        return res.status(500).json({ error: 'Erro interno do servidor' });
    }
}
