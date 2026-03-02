// API para buscar dados do inscrito pelo CPF
import { google } from 'googleapis';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido' });
    }

    try {
        const { cpf } = req.body;

        if (!cpf) {
            return res.status(400).json({
                error: 'CPF obrigatório'
            });
        }

        // Limpar CPF (apenas números)
        const cpfLimpo = cpf.replace(/\D/g, '');

        if (cpfLimpo.length !== 11) {
            return res.status(400).json({
                error: 'CPF inválido'
            });
        }

        console.log('🔍 Buscando inscrito com CPF:', cpfLimpo);

        // Configurar Google Sheets
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

        // Buscar dados na planilha (até coluna BQ para pegar todas as 69 colunas)
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Inscrições!A:ZZ',
        });

        const rows = response.data.values;

        if (!rows || rows.length <= 1) {
            return res.status(404).json({
                error: 'Nenhuma inscrição encontrada'
            });
        }

        // Cabeçalhos (primeira linha)
        const headers = rows[0];
        const cpfIndex = headers.indexOf('cpf');

        if (cpfIndex === -1) {
            return res.status(500).json({
                error: 'Estrutura da planilha inválida'
            });
        }

        // Buscar TODOS os inscritos com este CPF
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

        // Se houver múltiplas inscrições, pegar sempre a MAIS RECENTE (última linha)
        const inscritoRow = inscritosComCPF[inscritosComCPF.length - 1];

        if (inscritosComCPF.length > 1) {
            console.log(`ℹ️ Encontradas ${inscritosComCPF.length} inscrições para o CPF ${cpfLimpo}. Retornando a mais recente.`);
        }

        // Montar objeto com dados do inscrito
        const inscrito = {};
        headers.forEach((header, index) => {
            inscrito[header] = inscritoRow[index] || '';
        });

        // Gerar informações das parcelas com STATUS REAL
        const numeroParcelas = parseInt(inscrito.numero_parcelas) || 1;
        const valorTotal = 450.00;
        const valorParcela = (valorTotal / numeroParcelas).toFixed(2);

        const parcelas = [];
        for (let i = 1; i <= numeroParcelas; i++) {
            // Buscar dados reais da parcela na planilha
            const parcelaKey = `parcela_${String(i).padStart(2, '0')}_paga`;
            const dataVencimentoKey = `data_pagamento_${String(i).padStart(2, '0')}`; // Data de vencimento
            const dataPagaKey = `data_paga_${String(i).padStart(2, '0')}`; // Data que efetivamente pagou

            const parcelaPaga = inscrito[parcelaKey];
            const dataVencimento = inscrito[dataVencimentoKey]; // Vencimento previsto
            const dataPaga = inscrito[dataPagaKey]; // Data real do pagamento

            // Status: 'pago' se parcela_XX_paga == 1, senão 'pendente'
            const isPaga = parcelaPaga === '1' || parcelaPaga === 1 || parcelaPaga === true;

            parcelas.push({
                numero: i,
                valor: parseFloat(valorParcela),
                vencimento: dataVencimento || 'Não definido', // Data de vencimento da parcela
                status: isPaga ? 'pago' : 'pendente',
                data_pagamento: isPaga ? dataPaga : null // Data que efetivamente pagou
            });
        }

        console.log('✅ Inscrito encontrado:', inscrito.nome_completo);

        // Retornar todos os dados do inscrito diretamente + array de parcelas
        return res.status(200).json({
            ...inscrito,
            nome_completo: inscrito.nome_completo,
            numero_parcelas: numeroParcelas,
            valor_parcela: parseFloat(valorParcela),
            valor_total: valorTotal,
            dia_vencimento: inscrito.dia_vencimento || '15',
            parcelas: parcelas // Array com status real de cada parcela
        });

    } catch (error) {
        console.error('❌ Erro ao buscar inscrito:', error);
        return res.status(500).json({
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
}
