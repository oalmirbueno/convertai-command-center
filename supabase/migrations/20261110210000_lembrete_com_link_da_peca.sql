-- Lembrete de aprovação com link direto (10/11/2026, dono: "o link direto do conteúdo que está esperando").
-- O {link} do modelo passa a abrir a peça mais antiga da lista: /aprovacoes?peca=<id>. A tela do cliente abre
-- aquela peça primeiro e as outras seguem na fila. Um link só por mensagem, para o WhatsApp montar o cartão.

CREATE OR REPLACE FUNCTION app_private.lembrete_texto(_modelo text, _cliente text, _itens jsonb) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  _n integer := jsonb_array_length(_itens);
  _lista text;
  _peca text := NULLIF(_itens->0->>'file_id', '');
BEGIN
  SELECT string_agg('• ' || (i->>'titulo') || CASE WHEN (i->>'dias')::int >= 1
                      THEN ' (há ' || (i->>'dias') || CASE WHEN (i->>'dias')::int = 1 THEN ' dia)' ELSE ' dias)' END ELSE '' END,
                    E'\n' ORDER BY o)
    INTO _lista
    FROM jsonb_array_elements(_itens) WITH ORDINALITY AS t(i, o)
   WHERE o <= 5;
  IF _n > 5 THEN _lista := _lista || E'\n• e mais ' || (_n - 5); END IF;
  RETURN app_private.mensagem_preencher(_modelo, jsonb_build_object(
    'cliente', _cliente,
    'pecas', _n || CASE WHEN _n = 1 THEN ' peça' ELSE ' peças' END,
    'lista', _lista,
    'link', 'https://aceleriq.online/aprovacoes' || CASE WHEN _peca IS NOT NULL THEN '?peca=' || _peca ELSE '' END));
END $$;
REVOKE ALL ON FUNCTION app_private.lembrete_texto(text, text, jsonb) FROM PUBLIC, anon, authenticated;
