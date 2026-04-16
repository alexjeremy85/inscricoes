// API para processar inscrição na planilha
import { google } from 'googleapis';

/**
 * Calcula o máximo de parcelas permitidas baseado na data atual
 */
function calcularMaximoParcelas() {
    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1; // Janeiro = 1, Fevereiro = 2, etc.
    const anoAtual = hoje.getFullYear();

    const mesEvento = 11; // Novembro
    const anoEvento = 2026;

    // Evento já passou
    if (anoAtual > anoEvento || (anoAtual === anoEvento && mesAtual > mesEvento)) {
        return 0;
    }

    // Meses disponíveis incluindo o mês atual
    // Março 2026: (11-3)+1 = 9 ✓  Abril: 8 ✓  Maio: 7 ✓
    const meses = (anoEvento - anoAtual) * 12 + (mesEvento - mesAtual) + 1;

    return Math.min(10, Math.max(1, meses));
}

/**
 * Salva inscrição na planilha Google Sheets
 */
async function salvarInscricao(dadosInscricao) {
    try {
        // Autenticar com Google Sheets
        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

        // Preparar dados conforme estrutura da planilha
        // Ajustar para fuso horário de São Paulo (GMT-3)
        const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        // CORREÇÃO: Gerar ID via código para preencher a Coluna A
        const timestamp = new Date().getTime();
        const idGerado = `INS-${timestamp}-${Math.floor(Math.random() * 1000)}`;

        // Calcular datas de vencimento das parcelas
        const diaVencimento = parseInt(dadosInscricao.dia_vencimento) || 10;
        const numeroParcelas = parseInt(dadosInscricao.numero_parcelas);
        const hoje = new Date();
        const diaAtual = hoje.getDate();

        // Calcular data base da primeira parcela
        let primeiraParcelaData;
        if (diaAtual >= diaVencimento) {
            // Já passou o dia escolhido, primeira parcela vence hoje
            primeiraParcelaData = new Date(hoje);
        } else {
            // Ainda não passou, primeira parcela vence no dia escolhido deste mês
            primeiraParcelaData = new Date();
            primeiraParcelaData.setDate(diaVencimento);
        }

        const datasVencimento = [];
        for (let i = 1; i <= 11; i++) { // Sempre preparar 11 espaços
            if (i <= numeroParcelas) {
                let ano, mes, dia;

                if (i === 1) {
                    ano = primeiraParcelaData.getFullYear();
                    mes = primeiraParcelaData.getMonth();
                    dia = diaVencimento;
                } else {
                    // Demais parcelas: incrementar meses a partir da primeira parcela
                    ano = primeiraParcelaData.getFullYear();
                    mes = primeiraParcelaData.getMonth() + (i - 1);
                    dia = diaVencimento;

                    // Ajustar ano se necessário
                    while (mes > 11) {
                        mes -= 12;
                        ano += 1;
                    }
                }

                // Criar data sem problemas de timezone (usando meio-dia para evitar shifts)
                const vencimento = new Date(ano, mes, dia, 12, 0, 0);

                // Formatar manualmente para evitar problemas de timezone
                const diaStr = String(vencimento.getDate()).padStart(2, '0');
                const mesStr = String(vencimento.getMonth() + 1).padStart(2, '0');
                const anoStr = vencimento.getFullYear();
                datasVencimento.push(`${diaStr}/${mesStr}/${anoStr}`);
            } else {
                datasVencimento.push(''); // Parcelas não usadas ficam vazias
            }
        }

        // Determinar método de pagamento (case-insensitive)
        const metodoPagamento = (dadosInscricao.metodo_pagamento || 'PIX').toUpperCase();
        const tipoPagamento = metodoPagamento === 'CARTAO' ? 'CARTAO' : 'PIX';

        // Limpar telefone: remover apenas formatação (manter dígitos)
        const telefoneLimpo = (dadosInscricao.telefone || '').replace(/\D/g, '');

        // Limpar código do país: remover apenas formatação (manter dígitos/sinal)
        const codPaisLimpo = (dadosInscricao.cod_pais || '+55').replace(/[^\d+]/g, '');

        const valores = [
            idGerado, // id_inscricao preenchido pelo sistema
            agora, // data_inscricao
            agora, // data_atualizacao
            dadosInscricao.nome_completo,
            dadosInscricao.cpf || '', // CPF sem formatação (como estava antes)
            dadosInscricao.maior_idade ? 1 : 0,
            dadosInscricao.email,
            telefoneLimpo, // Telefone (apenas DDD + número)
            dadosInscricao.cidade_pais,
            dadosInscricao.grupo_escolha || '',
            dadosInscricao.csa || '',
            dadosInscricao.possui_deficiencia ? 1 : 0,
            dadosInscricao.descricao_necessidades || '',
            0, // interesse_hospedagem (campo antigo, sempre 0)
            dadosInscricao.aceite_termo_lgpd ? 1 : 0,
            dadosInscricao.aceite_termo_desistencia ? 1 : 0,
            '', // observacoes (campo antigo, sempre vazio)
            450.00, // valor_total (fixo)
            dadosInscricao.numero_parcelas,
            (450.00 / dadosInscricao.numero_parcelas).toFixed(2), // valor_parcela
            dadosInscricao.dia_vencimento || 10,
            tipoPagamento, // forma_pagamento (PIX ou CARTAO baseado no request)
            0, // inscricao_confirmada (será 1 após primeiro pagamento)
            '', // data_confirmacao (vazio inicialmente)
            // Parcelas com: parcela_XX_paga, data_pagamento_XX (vencimento), data_paga_XX (pago em)
            0, datasVencimento[0], '', // parcela_01
            0, datasVencimento[1], '', // parcela_02
            0, datasVencimento[2], '', // parcela_03
            0, datasVencimento[3], '', // parcela_04
            0, datasVencimento[4], '', // parcela_05
            0, datasVencimento[5], '', // parcela_06
            0, datasVencimento[6], '', // parcela_07
            0, datasVencimento[7], '', // parcela_08
            0, datasVencimento[8], '', // parcela_09
            0, datasVencimento[9], '', // parcela_10
            0, datasVencimento[10], '', // parcela_11
            // Campos calculados (47 a 50)
            0, // total_parcelas_pagas
            0.00, // valor_total_pago
            450.00, // saldo_devedor
            0.00, // percentual_pago
            // Novos campos (51 a 53)
            '', // nome_social (não usado mais, sempre vazio)
            dadosInscricao.grupo_pessoas || '', // grupo_pessoas
            dadosInscricao.interesse_transfer ? 1 : 0, // interesse_transfer
            // Campos de pagamento (54 a 58)
            tipoPagamento, // tipo_pagamento (PIX ou CARTAO baseado no request)
            '', // parcelas_cartao (vazio inicialmente, preenchido pelo webhook)
            '', // transacao_id (vazio inicialmente, preenchido pelo webhook)
            codPaisLimpo, // cod_pais (código do país, ex: +55, +1, +351)
            '', // status_pagamento (vazio inicialmente, preenchido pelo webhook)
            dadosInscricao.pergunta1 || '', // pergunta1 (origem da inscrição)
            dadosInscricao.pergunta2 || '' // pergunta2 (dia do WhatsApp, se aplicável)
        ];

        // Mantenha o INSERT_ROWS que adicionamos antes, é importante
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Inscrições!A:A',
            valueInputOption: 'RAW', // RAW para preservar formato exato (CPF com zero à esquerda)
            insertDataOption: 'INSERT_ROWS',
            requestBody: {
                values: [valores]
            }
        });

        console.log('✅ Inscrição salva na planilha:', response.data);

        return {
            success: true,
            id_inscricao: idGerado, // Retornar ID gerado
            updatedRange: response.data.updates.updatedRange,
            updatedRows: response.data.updates.updatedRows
        };

    } catch (error) {
        console.error('❌ Erro ao salvar na planilha:', error);
        throw new Error(`Erro ao salvar inscrição: ${error.message}`);
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido' });
    }

    try {
        // Verificar variáveis de ambiente
        if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
            console.error('❌ GOOGLE_SERVICE_ACCOUNT_JSON não configurada');
            return res.status(500).json({
                error: 'Configuração incompleta',
                message: 'Credenciais do Google Sheets não configuradas no servidor'
            });
        }

        if (!process.env.GOOGLE_SHEETS_SPREADSHEET_ID) {
            console.error('❌ GOOGLE_SHEETS_SPREADSHEET_ID não configurada');
            return res.status(500).json({
                error: 'Configuração incompleta',
                message: 'ID da planilha não configurado no servidor'
            });
        }

        const dados = req.body;

        // Validações obrigatórias
        if (!dados.nome_completo || !dados.email || !dados.telefone || !dados.cidade_pais) {
            return res.status(400).json({
                error: 'Campos obrigatórios faltando',
                message: 'Preencha: nome completo, email, telefone e cidade/país'
            });
        }

        if (!dados.maior_idade) {
            return res.status(400).json({
                error: 'Idade insuficiente',
                message: 'É necessário ser maior de 18 anos para participar do evento'
            });
        }

        if (!dados.aceite_termo_lgpd) {
            return res.status(400).json({
                error: 'Termo LGPD não aceito',
                message: 'É necessário aceitar o termo de consentimento LGPD'
            });
        }

        if (!dados.aceite_termo_desistencia) {
            return res.status(400).json({
                error: 'Termo de desistência não aceito',
                message: 'É necessário estar ciente das condições de desistência'
            });
        }

        if (!dados.pergunta1) {
            return res.status(400).json({
                error: 'Pergunta obrigatória',
                message: 'Indique onde você recebeu o estímulo para se inscrever'
            });
        }

        if (dados.pergunta1 === 'WhatsApp' && !dados.pergunta2) {
            return res.status(400).json({
                error: 'Pergunta obrigatória',
                message: 'Indique em qual dia você recebeu a mensagem no WhatsApp'
            });
        }

        // Validar número de parcelas com base na data atual
        const maximoParcelasPermitido = calcularMaximoParcelas();

        if (!dados.numero_parcelas || dados.numero_parcelas < 1 || dados.numero_parcelas > maximoParcelasPermitido) {
            return res.status(400).json({
                error: 'Número de parcelas inválido',
                message: `Escolha entre 1 e ${maximoParcelasPermitido} parcelas`
            });
        }

        console.log('📝 Salvando inscrição na planilha...');

        // Salvar inscrição na planilha e capturar ID gerado
        const resultado = await salvarInscricao(dados);

        console.log('✅ Inscrição salva com sucesso!');
        console.log('🆔 ID gerado:', resultado.id_inscricao);

        // Calcular valor da parcela para retornar
        const valorParcela = (450.00 / dados.numero_parcelas).toFixed(2);

        return res.status(200).json({
            success: true,
            message: 'Inscrição realizada com sucesso!',
            inscricao: {
                id_inscricao: resultado.id_inscricao, // INCLUIR ID na resposta
                nome: dados.nome_completo,
                email: dados.email,
                numero_parcelas: dados.numero_parcelas,
                valor_parcela: `R$ ${valorParcela}`,
                valor_total: 'R$ 450,00'
            }
        });

    } catch (error) {
        console.error('❌ Erro ao processar inscrição:', error);
        return res.status(500).json({
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
}