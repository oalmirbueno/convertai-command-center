-- Extra variável sem percentual obrigatório (14/11/2026, pedido do dono).
--
-- "Faltou só a parte do variável, como comissão: eu atualizo conforme recebo e cadastra ali."
--
-- O extra de cobranca = 'comissao' passa a ser o "Variável": o dono lança o valor que recebeu, quando
-- receber, quantas vezes for no mês (pela extra_cobranca_salvar, que já existe). O percentual vira
-- apoio opcional para a conta; antes era obrigatório e travava o cadastro de quem só quer lançar valor.
--
-- Só solta uma trava de cadastro. Não mexe em cobrança, não envia nada a cliente.

ALTER TABLE public.client_extras DROP CONSTRAINT IF EXISTS client_extras_comissao_tem_percentual;
