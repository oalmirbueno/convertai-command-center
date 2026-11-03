-- Alinha freela_* ao padrão da casa: policy restritiva membros_sem_papel_sem_operacao
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['freela_contatos','freela_propostas','freela_projetos','freela_parcelas']
  LOOP
    EXECUTE format(
      'CREATE POLICY membros_sem_papel_sem_operacao ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''client''::app_role) OR is_staff(auth.uid())) WITH CHECK (has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''client''::app_role) OR is_staff(auth.uid()))',
      t
    );
  END LOOP;
END $$;