-- Liberar o material ao cliente não pode tornar o carrossel inagendável.
--
-- MEDIDO NA BASE: os carrosséis do Verzelo têm 7 slides cada — todos
-- travados, todos aprovados pela agência — e visibility = 'client_shared',
-- porque o dono LIBEROU o material. A regra dos filhos em
-- editorial_file_is_publishable_media só aceitava visibility = 'approval'.
--
-- A raiz aceita os DOIS estados finais (aprovação concluída OU material
-- disponibilizado — "disponibilizar dispensa a aprovação" é a regra da casa,
-- documentada em isEditorialFilePublishable). Os filhos aceitavam só um.
-- Efeito: o ato de liberar o carrossel ao cliente o tirava da agenda. Na
-- base inteira, 98 slides estão nesse estado — o problema é sistêmico.
--
-- O patch alinha os filhos à regra da raiz: 'approval' OU 'client_shared'.
-- Todo o resto permanece: travado, agência aprovada, imagem, mesmo cliente
-- e projeto.

DO $patch$
DECLARE
  _fonte text;
  _alvo text;
  _sub text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _fonte
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'editorial_file_is_publishable_media';

  _alvo := E'            OR child.visibility <> ''approval''\n';
  _sub  := E'            OR child.visibility NOT IN (''approval'', ''client_shared'')\n';

  IF (length(_fonte) - length(replace(_fonte, _alvo, ''))) / length(_alvo) <> 1 THEN
    RAISE EXCEPTION 'patch filhos: alvo nao encontrado exatamente 1 vez';
  END IF;
  EXECUTE replace(_fonte, _alvo, _sub);
END
$patch$;
