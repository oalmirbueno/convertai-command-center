-- Plano de contingência revisável. NÃO executar sem aprovação em produção.
-- Preserva compras, progresso, checklist, papéis e arquivos; não abre bucket nem apaga dados.
BEGIN;
UPDATE public.membros_produtos SET estado='rascunho' WHERE estado='publicado';
UPDATE public.membros_vinculos_venda SET ativo=false WHERE ativo;
REVOKE EXECUTE ON FUNCTION public.membros_conciliar_pagamento(uuid,text,text,text,text) FROM service_role;
-- Reverter o frontend para o commit anterior pela publicação aprovada.
-- Não devolver acesso operacional automático a novos cadastros. Conceder papéis pelo fluxo
-- administrativo existente apenas a quem realmente deve operar o painel.
-- As políticas antigas e os papéis já existentes continuam válidos. Não remover barreiras
-- nem transformar os arquivos privados em públicos para contornar um erro.
COMMIT;
