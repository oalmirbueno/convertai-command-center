-- Dados opcionais: as duas marcas da Acerbi (pedido do dono em 25/09).
--
-- NAO APLICADO. Rodar DEPOIS de 01_cliente_marcas.sql, no SQL Editor.
-- Idempotente: rodar de novo nao duplica nem muda o que ja foi editado.
--
-- Cliente Acerbi: 39ebda82-637c-498b-a23a-b622f645e852
--   - Acerbi (principal): projeto "Presença Digital Estratégica Acerbi 2026".
--     Usa o kit que a Acerbi ja tem (cliente_kit_marca) e fica tambem com o
--     projeto "Site + Blog + Sistema SPC Acerbi", que nao e de nenhuma marca.
--   - CME: projeto "CME Acerbi | Conteúdo e Empreendedorismo Feminino 2026".
--     Kit proprio, vazio aqui: logo, cores, estilo e as referencias da CME
--     entram pela aba Contexto da Mesa com a marca CME escolhida no topo.
-- Os projetos sao achados pelo nome dentro do cliente (nao apagados). Se nao
-- achar exatamente um de cada, para com erro e nao grava nada.

BEGIN;

DO $dados$
DECLARE
  _cliente constant uuid := '39ebda82-637c-498b-a23a-b622f645e852';
  _proj_acerbi uuid;
  _proj_cme uuid;
  _n integer;
BEGIN
  SELECT count(*), min(p.id::text)::uuid INTO _n, _proj_acerbi
  FROM public.projects p
  WHERE p.client_id = _cliente AND p.deleted_at IS NULL
    AND p.name ILIKE 'Presen%a Digital Estrat%gica Acerbi%';
  IF _n <> 1 THEN
    RAISE EXCEPTION 'Projeto Presenca Digital da Acerbi: esperado 1, achados %', _n;
  END IF;

  SELECT count(*), min(p.id::text)::uuid INTO _n, _proj_cme
  FROM public.projects p
  WHERE p.client_id = _cliente AND p.deleted_at IS NULL
    AND p.name ILIKE 'CME Acerbi%';
  IF _n <> 1 THEN
    RAISE EXCEPTION 'Projeto CME da Acerbi: esperado 1, achados %', _n;
  END IF;

  INSERT INTO public.cliente_marcas (client_id, project_id, nome, principal, ordem)
  VALUES (_cliente, _proj_acerbi, 'Acerbi', true, 0)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.cliente_marcas (client_id, project_id, nome, principal, ordem)
  VALUES (_cliente, _proj_cme, 'CME', false, 1)
  ON CONFLICT DO NOTHING;
END
$dados$;

COMMIT;

-- Conferencia (so leitura):
-- select m.nome, m.principal, p.name
-- from public.cliente_marcas m left join public.projects p on p.id = m.project_id
-- where m.client_id = '39ebda82-637c-498b-a23a-b622f645e852' order by m.ordem;
