-- Cláusulas extras e termo aditivo da Aceleriq, versão 1 (frente CON2, 30/09/2026).
--
-- Gerado de supabase/functions/_shared/contrato-modelo-extras-v1.ts (a fonte do
-- texto). O teste src/test/con2-contratos.test.ts confere que cada cláusula
-- daqui é igual à do arquivo. Texto próprio, em português do Brasil, com a
-- marca interna "v1 · revisão jurídica pendente" (só a equipe vê).
-- Depende de 20260930195100 (as CHECKs ampliadas aceitam os tipos extras e aditivo).
-- Idempotente: ON CONFLICT DO NOTHING (versão publicada não muda).

-- Cláusulas extras
INSERT INTO public.contrato_modelos (chave, tipo, servico, nome, versao, revisao_juridica, variaveis)
VALUES ('clausulas_extras', 'extras', NULL, 'Cláusulas extras', 1, 'v1 · revisão jurídica pendente', '[{"nome":"extra_confidencialidade","rotulo":"Confidencialidade reforçada","tipo":"escolha","padrao":"nao","opcoes":[{"valor":"sim","rotulo":"Sim"},{"valor":"nao","rotulo":"Não"}],"grupo":"extras","ajuda":"Sigilo estendido à equipe e a parceiros, devolução do material no fim e multa por quebra."},{"nome":"extra_confidencialidade_multa","rotulo":"Multa por quebra de sigilo","tipo":"moeda","grupo":"extras","ajuda":"Só vale com a confidencialidade reforçada ligada."},{"nome":"extra_exclusividade","rotulo":"Exclusividade no segmento","tipo":"escolha","padrao":"nao","opcoes":[{"valor":"sim","rotulo":"Sim"},{"valor":"nao","rotulo":"Não"}],"grupo":"extras","ajuda":"A agência não atende concorrente direto do cliente no segmento e na região combinados."},{"nome":"extra_exclusividade_segmento","rotulo":"Segmento da exclusividade","tipo":"texto","grupo":"extras","ajuda":"Ex.: padarias artesanais."},{"nome":"extra_exclusividade_regiao","rotulo":"Região da exclusividade","tipo":"texto","grupo":"extras","ajuda":"Ex.: cidade de Londrina/PR."},{"nome":"extra_sla","rotulo":"Prazo de resposta (SLA)","tipo":"escolha","padrao":"nao","opcoes":[{"valor":"sim","rotulo":"Sim"},{"valor":"nao","rotulo":"Não"}],"grupo":"extras","ajuda":"Tempo máximo para a agência dar o primeiro retorno no canal oficial."},{"nome":"extra_sla_horas","rotulo":"Prazo de resposta (horas úteis)","tipo":"inteiro","grupo":"extras","feminino":true},{"nome":"extra_marca_portfolio","rotulo":"Uso da marca do cliente em portfólio","tipo":"escolha","padrao":"nao","opcoes":[{"valor":"sim","rotulo":"Sim"},{"valor":"nao","rotulo":"Não"}],"grupo":"extras","ajuda":"O cliente autoriza citar o nome e mostrar a marca como case."}]'::jsonb)
ON CONFLICT (chave, versao) DO NOTHING;
INSERT INTO public.contrato_clausulas (modelo_id, ordem, chave, titulo, texto, quando)
SELECT m.id, v.ordem, v.chave, v.titulo, v.texto, v.quando
  FROM public.contrato_modelos AS m
  CROSS JOIN (VALUES
  (1, 'confidencialidade_reforcada', 'Confidencialidade reforçada', 'Além da cláusula de confidencialidade, a CONTRATADA faz cada pessoa da equipe e cada parceiro que tiver acesso a informação confidencial do CONTRATANTE assumir o mesmo dever de sigilo, por escrito.
No fim do contrato, ou quando o CONTRATANTE pedir, a CONTRATADA devolve ou elimina o material confidencial recebido, salvo a guarda exigida por lei, e confirma por escrito.
A parte que revelar informação confidencial em desacordo com este contrato paga à outra multa de {{extra_confidencialidade_multa}}, sem prejuízo da indenização do dano que passar desse valor.', '{"variavel":"extra_confidencialidade","igual":"sim"}'::jsonb),
  (2, 'exclusividade', 'Exclusividade', 'Durante a vigência deste contrato, a CONTRATADA não presta os mesmos serviços a concorrente direto do CONTRATANTE no segmento de {{extra_exclusividade_segmento}}, na região de {{extra_exclusividade_regiao}}.
A exclusividade não alcança clientes que a CONTRATADA já atendia antes da assinatura, nem serviços diferentes dos contratados, e termina junto com o contrato.', '{"variavel":"extra_exclusividade","igual":"sim"}'::jsonb),
  (3, 'sla_resposta', 'Prazo de resposta', 'A CONTRATADA dá o primeiro retorno às mensagens do CONTRATANTE no canal oficial em até {{extra_sla_horas}} horas úteis, em dias úteis e no horário comercial.
Esse é o prazo do primeiro retorno. O prazo de execução de cada pedido segue o anexo do serviço, e urgência fora do horário comercial depende de combinação prévia.', '{"variavel":"extra_sla","igual":"sim"}'::jsonb),
  (4, 'marca_em_portfolio', 'Uso da marca do CONTRATANTE em portfólio', 'O CONTRATANTE autoriza a CONTRATADA a citar o nome dele e a mostrar a marca e as entregas já publicadas no portfólio, em apresentações comerciais, no site e nas redes sociais da CONTRATADA, como caso de trabalho, sem custo, durante o contrato e depois dele.
A autorização não inclui imagem de pessoas, dados internos nem números de resultado sem autorização escrita, e pode ser revogada para usos futuros pelo canal oficial.', '{"variavel":"extra_marca_portfolio","igual":"sim"}'::jsonb)
  ) AS v(ordem, chave, titulo, texto, quando)
 WHERE m.chave = 'clausulas_extras' AND m.versao = 1
ON CONFLICT (modelo_id, chave) DO NOTHING;

-- Termo aditivo
INSERT INTO public.contrato_modelos (chave, tipo, servico, nome, versao, revisao_juridica, variaveis)
VALUES ('termo_aditivo', 'aditivo', NULL, 'Termo aditivo', 1, 'v1 · revisão jurídica pendente', '[{"nome":"aditivo_descricao","rotulo":"O que muda","tipo":"textoLongo","obrigatoria":true,"grupo":"aditivo","ajuda":"Em uma ou duas frases, a mudança de escopo, valor ou prazo."},{"nome":"aditivo_inicio_efeitos","rotulo":"A partir de quando vale","tipo":"data","obrigatoria":true,"grupo":"aditivo"},{"nome":"aditivo_valor_mensal_novo","rotulo":"Novo valor mensal","tipo":"moeda","grupo":"aditivo"},{"nome":"aditivo_valor_adicional","rotulo":"Valor adicional (projeto)","tipo":"moeda","grupo":"aditivo"},{"nome":"aditivo_vigencia_fim_nova","rotulo":"Nova data de fim da vigência","tipo":"data","grupo":"aditivo"},{"nome":"aditivo_servicos_retirados","rotulo":"Serviços que saem","tipo":"texto","grupo":"aditivo"}]'::jsonb)
ON CONFLICT (chave, versao) DO NOTHING;
INSERT INTO public.contrato_clausulas (modelo_id, ordem, chave, titulo, texto, quando)
SELECT m.id, v.ordem, v.chave, v.titulo, v.texto, v.quando
  FROM public.contrato_modelos AS m
  CROSS JOIN (VALUES
  (1, 'objeto', 'Objeto do aditivo', 'Este termo aditivo altera o contrato nº {{contrato_mae_numero}}, versão {{contrato_mae_versao}}, assinado entre as mesmas partes em {{contrato_mae_data}}, com o código de integridade {{contrato_mae_codigo}}.
O que muda: {{aditivo_descricao}}', NULL::jsonb),
  (2, 'servicos_incluidos', 'Serviços incluídos', 'Passam a fazer parte do contrato, a partir de {{aditivo_inicio_efeitos}}, os serviços {{aditivo_servicos_incluidos}}, descritos nos anexos deste aditivo e regidos pelas condições gerais do contrato.', '{"variavel":"aditivo_servicos_incluidos","preenchida":true}'::jsonb),
  (3, 'servicos_retirados', 'Serviços que saem', 'Deixam de fazer parte do contrato, a partir de {{aditivo_inicio_efeitos}}, os serviços: {{aditivo_servicos_retirados}}. As entregas já aprovadas e pagas continuam valendo, com a regra de direitos do contrato.', '{"variavel":"aditivo_servicos_retirados","preenchida":true}'::jsonb),
  (4, 'valor_mensal', 'Novo valor mensal', 'A partir de {{aditivo_inicio_efeitos}}, o valor mensal passa a ser {{aditivo_valor_mensal_novo}}, com o mesmo dia de vencimento, a mesma forma de pagamento e o mesmo reajuste do contrato.', '{"variavel":"aditivo_valor_mensal_novo","preenchida":true}'::jsonb),
  (5, 'valor_adicional', 'Valor adicional', 'Pelo que este aditivo inclui, o CONTRATANTE paga o valor adicional de {{aditivo_valor_adicional}}, na forma de pagamento do contrato.', '{"variavel":"aditivo_valor_adicional","preenchida":true}'::jsonb),
  (6, 'vigencia', 'Vigência', 'A vigência do contrato passa a terminar em {{aditivo_vigencia_fim_nova}}, mantidas as regras de renovação, aviso prévio e rescisão.', '{"variavel":"aditivo_vigencia_fim_nova","preenchida":true}'::jsonb),
  (7, 'ratificacao', 'O que continua valendo', 'Continuam valendo, sem mudança, todas as cláusulas do contrato e dos anexos que este aditivo não alterou. Este aditivo faz parte do contrato para todos os efeitos, e havendo conflito entre os dois, vale o aditivo no que ele alterou.', NULL::jsonb)
  ) AS v(ordem, chave, titulo, texto, quando)
 WHERE m.chave = 'termo_aditivo' AND m.versao = 1
ON CONFLICT (modelo_id, chave) DO NOTHING;

-- Conferência (só leitura, depois de aplicar):
-- select chave, versao, ativo, (select count(*) from public.contrato_clausulas c where c.modelo_id = m.id) as clausulas
--   from public.contrato_modelos m where chave in ('clausulas_extras', 'termo_aditivo'); -- 4 e 7 cláusulas
