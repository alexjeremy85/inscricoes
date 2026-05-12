import { rateLimit } from './rate-limiter.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido' });
    }

    try {
        const {
            id_inscricao, // Aceitar id_inscricao
            nome_completo,
            email,
            cpf,
            telefone,
            valor_total,
            cartao_encrypted,
            cartao_titular,
            cartao_numero_final,
            cartao_bandeira,
            numero_parcelas_cartao = 1 // Número de parcelas no cartão (1-11x)
        } = req.body;

        // Validações
        if (!id_inscricao || !nome_completo || !email || !cpf || !telefone || !valor_total || !cartao_encrypted) {
            return res.status(400).json({
                error: 'Dados incompletos',
                message: 'Todos os campos são obrigatórios (incluindo id_inscricao)'
            });
        }

        // Validar número de parcelas no cartão
        const parcelasCartao = parseInt(numero_parcelas_cartao);
        if (parcelasCartao < 1 || parcelasCartao > 18) {
            return res.status(400).json({
                error: 'Número de parcelas inválido',
                message: 'Escolha entre 1 e 18 parcelas no cartão'
            });
        }

        const { allowed } = rateLimit(req, { maxRequests: 5, windowMs: 60000 });
        if (!allowed) {
            return res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });
        }

        console.log('💳 Processando pagamento com cartão - ID:', id_inscricao);

        const pagBankToken = process.env.PAGBANK_TOKEN;

        if (!pagBankToken) {
            console.error('❌ PAGBANK_TOKEN não configurado');
            return res.status(500).json({
                error: 'Configuração incompleta',
                message: 'Token do PagBank não configurado'
            });
        }

        // Limpar CPF e telefone
        const cpfLimpo = cpf.replace(/\D/g, '');
        const telefoneLimpo = telefone.replace(/\D/g, '');

        // Validar CPF (deve ter 11 dígitos)
        if (cpfLimpo.length !== 11) {
            console.error('❌ CPF inválido:', cpfLimpo);
            return res.status(400).json({
                error: 'CPF inválido',
                message: 'CPF deve conter 11 dígitos'
            });
        }

        // Extrair DDD e número do telefone
        const ddd = telefoneLimpo.substring(0, 2);
        const numeroTelefone = telefoneLimpo.substring(2);

        // Validar telefone (DDD + 8 ou 9 dígitos)
        if (ddd.length !== 2 || (numeroTelefone.length !== 8 && numeroTelefone.length !== 9)) {
            console.error('❌ Telefone inválido. DDD:', ddd, 'Número:', numeroTelefone);
            return res.status(400).json({
                error: 'Telefone inválido',
                message: 'Telefone deve estar no formato: DDD + 8 ou 9 dígitos'
            });
        }

        // Converter valor para centavos
        const valorCentavos = Math.round(parseFloat(valor_total) * 100);

        console.log('📋 Valor (centavos):', valorCentavos, '- Parcelas:', numero_parcelas_cartao);

        // Reference ID = ID da inscrição (para rastreamento)
        const referenceId = id_inscricao;
        const timestamp = Date.now(); // Para reference_id da charge
        console.log('🔖 Reference ID (order):', referenceId);

        // Preparar payload para PagBank - Pagamento com Cartão
        const pagBankPayload = {
            reference_id: referenceId, // ID da inscrição
            customer: {
                name: nome_completo,
                email: email,
                tax_id: cpfLimpo,
                phones: [
                    {
                        country: "55",
                        area: ddd,
                        number: numeroTelefone,
                        type: "MOBILE"
                    }
                ]
            },
            items: [
                {
                    reference_id: "INSCRICAO_ACAMPAMENTO",
                    name: "Inscricao Acampamento Terra do Saber 2026",
                    quantity: 1,
                    unit_amount: valorCentavos
                }
            ],
            charges: [
                {
                    reference_id: `CHARGE_${Date.now()}`, // ← ID único para a cobrança
                    description: "Inscricao Acampamento",
                    amount: {
                        value: valorCentavos,
                        currency: "BRL"
                    },
                    payment_method: {
                        type: "CREDIT_CARD",
                        installments: parcelasCartao,
                        capture: true,
                        soft_descriptor: "ACAMPAMENTO",
                        card: {
                            encrypted: cartao_encrypted,
                            store: false
                        },
                        holder: {
                            name: cartao_titular || nome_completo,
                            tax_id: cpfLimpo
                        }
                    }
                }
            ],
            notification_urls: [
                `${process.env.WEBHOOK_URL || 'https://inscricoes-sigma.vercel.app/api/webhook-pagbank'}`
            ]
        };

        console.log('📤 Enviando requisição para PagBank (Cartão)...');

        // Fazer requisição para PagBank
        // Determinar ambiente (sandbox ou produção)
        const envValue = (process.env.PAGBANK_ENV || '').trim().toLowerCase();
        const isProduction = envValue === 'production';
        const pagBankUrl = isProduction
            ? 'https://api.pagseguro.com/orders'  // URL CORRETA de produção
            : 'https://sandbox.api.pagseguro.com/orders';

        console.log('🌐 Ambiente:', isProduction ? 'PRODUCTION' : 'SANDBOX');

        const response = await fetch(pagBankUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${pagBankToken}`
            },
            body: JSON.stringify(pagBankPayload)
        });

        // Capturar resposta como texto primeiro
        const responseText = await response.text();
        console.log('📊 Status HTTP PagBank:', response.status);

        // Tentar fazer parse do JSON
        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch (parseError) {
            console.error('❌ Erro ao parsear resposta PagBank. Status:', response.status);
            return res.status(500).json({
                error: 'Erro ao processar pagamento',
                message: 'Erro na comunicação com o gateway de pagamento'
            });
        }

        if (!response.ok) {
            console.error('❌ Erro PagBank - Status:', response.status);
            return res.status(response.status).json({
                error: 'Erro ao processar pagamento',
                message: responseData.error_messages?.[0]?.description || 'Erro no processamento do pagamento'
            });
        }

        // Verificar se o pagamento foi aprovado imediatamente
        const charge = responseData.charges?.[0];
        const paymentStatus = charge?.status;

        console.log('✅ Pedido criado com sucesso!');
        console.log('Order ID:', responseData.id);
        console.log('Status do pagamento:', paymentStatus);

        // Se pagamento APROVADO, atualizar planilha IMEDIATAMENTE
        if (paymentStatus === 'PAID') {
            console.log('💳 Pagamento aprovado! Atualizando planilha...');
            console.log('🆔 ID Inscrição a atualizar:', id_inscricao);

            try {
                const { atualizarStatusPagamentoCartao } = await import('./webhook-pagbank.js');

                await atualizarStatusPagamentoCartao({
                    id_inscricao: id_inscricao, // Passar ID da inscrição
                    orderId: responseData.id,
                    chargeId: charge.id,
                    amount: charge.amount.value,
                    paidAt: charge.paid_at,
                    customerEmail: email,
                    installments: parcelasCartao
                });

                console.log('✅ Planilha atualizada com sucesso!');
            } catch (updateError) {
                console.error('⚠️ Erro ao atualizar planilha (não crítico):', updateError);
                // Não falhar a requisição se a atualização falhar
            }
        }

        // Retornar resposta
        return res.status(200).json({
            success: true,
            order_id: responseData.id,
            reference_id: referenceId,
            status: paymentStatus,
            charge_id: charge?.id,
            approved: paymentStatus === 'PAID',
            message: paymentStatus === 'PAID'
                ? 'Pagamento aprovado com sucesso!'
                : 'Aguardando confirmação do pagamento'
        });

    } catch (error) {
        console.error('❌ Erro ao processar pagamento:', error.message);
        return res.status(500).json({
            error: 'Erro interno do servidor',
            message: 'Erro ao processar o pagamento. Tente novamente.'
        });
    }
}
