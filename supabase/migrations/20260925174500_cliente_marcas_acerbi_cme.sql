-- Dados: as duas marcas da Acerbi (pedido do dono em 25/09). Fonte: docs/marcas/02_dados_acerbi_cme.sql.
-- Acerbi (principal, projeto Presença Digital; usa o kit do cliente e fica também com o Site + Blog + SPC).
-- CME (projeto CME, kit próprio vazio: logo, cores e referências entram pela aba Contexto com a CME escolhida).
-- Projetos achados pelo nome; se não achar exatamente um de cada, para com erro. Idempotente.

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