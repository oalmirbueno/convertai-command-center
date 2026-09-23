-- Mesa do cliente: a equipe lê as pastas compartilhadas da agência no bucket mesa.
-- globais/ guarda as 1.386 referências do banco da agência (Pinterest) e
-- biblioteca/ as fontes e amostras da biblioteca. A regra "mesa: equipe le" só
-- libera pastas com o id de um cliente, então as URLs assinadas dessas duas
-- falhavam (imagens vazias em Campanhas e fontes "sem amostra"). Só leitura:
-- enviar, alterar e apagar continuam presos à pasta do cliente.
DROP POLICY IF EXISTS "mesa: equipe le compartilhados" ON storage.objects;
CREATE POLICY "mesa: equipe le compartilhados" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'mesa'
  AND (storage.foldername(name))[1] IN ('globais', 'biblioteca')
  AND COALESCE(public.is_staff((select auth.uid())), false)
);
