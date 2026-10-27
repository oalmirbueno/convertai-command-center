-- PLANO REVISÁVEL. NÃO APLICADO. Não colocar no diretório de migrations.
-- Supabase existente: jjjtkowvxemvituvywvf. Não executar db push.
-- SOMENTE LEITURA. A conferência visual encontrou gratuito=false; revisar dados antes de propor alterações.

-- 1. PREFLIGHT SOMENTE LEITURA. Conferir e salvar as linhas para rollback lógico.
SELECT id, titulo, categoria, descricao, formato, capa_url, estado, gratuito,
       destaque, ordem, tipo_produto, em_venda, cta, checkout_url, condicoes
FROM public.membros_produtos
WHERE titulo = 'Boas-vindas à biblioteca: Produto de teste'
  AND categoria = 'Teste';

SELECT m.id, m.produto_id, m.titulo, m.tipo, m.texto, m.arquivo,
       m.estado, m.ordem, m.modulo_id, m.aula_id
FROM public.membros_materiais m
JOIN public.membros_produtos p ON p.id = m.produto_id
WHERE p.titulo = 'Boas-vindas à biblioteca: Produto de teste'
  AND p.categoria = 'Teste'
ORDER BY m.ordem, m.id;

SELECT id, titulo, estado, gratuito, ordem
FROM public.membros_produtos
WHERE gratuito OR titulo IN ('CRM Aceleriq', 'Orçamento em Movimento | Kit de aplicação anual')
ORDER BY ordem, titulo;
