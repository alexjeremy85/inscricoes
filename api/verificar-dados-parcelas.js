// Script para verificar dados de parcelas na planilha
import { google } from 'googleapis';

export default async function handler(req, res) {
    try {
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
        const headers = rows[0];

        // Encontrar índices das colunas
        const idIndex = headers.indexOf('id_inscricao');
        const nomeIndex = headers.indexOf('nome_completo');
        const numeroParcelasIndex = headers.indexOf('numero_parcelas');

        const problemas = [];

        // Verificar cada inscrição
        for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
            const row = rows[rowIdx];
            const idInscricao = row[idIndex];
            const nome = row[nomeIndex];
            const numParcelas = parseInt(row[numeroParcelasIndex]) || 0;

            // Verificar se todas as datas de vencimento existem
            for (let i = 1; i <= numParcelas; i++) {
                const dataVencKey = `data_pagamento_${String(i).padStart(2, '0')}`;
                const dataVencIndex = headers.indexOf(dataVencKey);

                if (dataVencIndex === -1) {
                    problemas.push({
                        linha: rowIdx + 1,
                        id: idInscricao,
                        nome: nome,
                        problema: `Coluna ${dataVencKey} não existe nos headers`
                    });
                    continue;
                }

                const dataVencValue = row[dataVencIndex];

                if (!dataVencValue || dataVencValue.trim() === '') {
                    problemas.push({
                        linha: rowIdx + 1,
                        id: idInscricao,
                        nome: nome,
                        parcela: i,
                        coluna: dataVencKey,
                        indiceColuna: dataVencIndex,
                        problema: 'Data de vencimento vazia ou undefined',
                        totalColunas: row.length,
                        totalHeaders: headers.length
                    });
                }
            }
        }

        return res.status(200).json({
            success: true,
            totalInscritos: rows.length - 1,
            totalProblemas: problemas.length,
            problemas: problemas,
            headers: headers.slice(20, 56) // Mostrar headers das parcelas
        });

    } catch (error) {
        console.error('Erro:', error);
        console.error('Erro verificar-dados-parcelas:', error.message);
        return res.status(500).json({ error: 'Erro interno do servidor' });
    }
}
