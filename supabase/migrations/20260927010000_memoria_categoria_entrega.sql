-- AP-01 (frente AP, 27/09/2026): aprendizado contínuo.
--
-- O que faz: o cérebro do cliente (public.agente_memoria) passa a aceitar a
-- categoria "entrega" (a memória de cada entrega do Estúdio: o padrão
-- entregue, com o motivo e a descrição visual).
--
-- Sem este SQL nada quebra: o código grava a entrega como categoria
-- "aprendizado" com fonte "entrega" e a leitura devolve "entrega" pela fonte
-- (supabase/functions/_shared/cerebro-do-cliente.ts, categoriaDaLinhaDeMemoria).
-- Depois deste SQL as entregas novas já gravam com a categoria certa; as
-- antigas continuam lidas pela fonte (a linha abaixo também as acerta).
--
-- Só amplia, idempotente. RLS de agente_memoria não muda (equipe lê e altera
-- via is_staff + can_access_client; as funções gravam com a chave de serviço).
-- Nenhuma tabela nova: a memória das entregas mora em
-- mesa/<cliente>/aprendizado/entregas.json e a memória editorial é lida das
-- tabelas que já existem (calendario_propostas, tasks, editorial_*,
-- social_post_metrics).

ALTER TABLE public.agente_memoria DROP CONSTRAINT IF EXISTS agente_memoria_categoria_check;
ALTER TABLE public.agente_memoria ADD CONSTRAINT agente_memoria_categoria_check
  CHECK (categoria IS NULL OR categoria IN ('preferencia', 'evitar', 'ajuste', 'reprovado', 'performou', 'aprendizado', 'entrega'));

-- As memórias de entrega gravadas antes deste SQL (categoria "aprendizado", fonte "entrega") ganham a categoria certa.
UPDATE public.agente_memoria
   SET categoria = 'entrega'
 WHERE fonte = 'entrega'
   AND categoria IS DISTINCT FROM 'entrega';

-- Conferência (só leitura):
-- select categoria, fonte, count(*) from public.agente_memoria where fonte in ('entrega', 'desempenho') group by 1, 2;
