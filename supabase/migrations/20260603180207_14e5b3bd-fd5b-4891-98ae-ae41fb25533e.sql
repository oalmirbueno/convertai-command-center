
-- =============================================================
-- ONBOARDING & TASK CHECKLIST TEMPLATES
-- =============================================================

-- Catalog: service checklists
CREATE TABLE public.service_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type text NOT NULL,
  phase text NOT NULL,
  title text NOT NULL,
  description text,
  order_index int NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_checklists TO authenticated;
GRANT ALL ON public.service_checklists TO service_role;
ALTER TABLE public.service_checklists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage service_checklists" ON public.service_checklists
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.service_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES public.service_checklists(id) ON DELETE CASCADE,
  label text NOT NULL,
  hint text,
  order_index int NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_checklist_items TO authenticated;
GRANT ALL ON public.service_checklist_items TO service_role;
ALTER TABLE public.service_checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage service_checklist_items" ON public.service_checklist_items
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE INDEX idx_service_checklist_items_checklist ON public.service_checklist_items(checklist_id);

-- Per-client onboarding state
CREATE TABLE public.client_onboarding_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  template_item_id uuid NOT NULL REFERENCES public.service_checklist_items(id) ON DELETE CASCADE,
  is_done boolean NOT NULL DEFAULT false,
  value text,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_id, template_item_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_onboarding_items TO authenticated;
GRANT ALL ON public.client_onboarding_items TO service_role;
ALTER TABLE public.client_onboarding_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage client_onboarding_items" ON public.client_onboarding_items
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE INDEX idx_client_onboarding_items_client ON public.client_onboarding_items(client_id);

CREATE TRIGGER trg_client_onboarding_items_updated
BEFORE UPDATE ON public.client_onboarding_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Task checklist templates library
CREATE TABLE public.task_checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  title text NOT NULL,
  description text,
  service_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_checklist_templates TO authenticated;
GRANT ALL ON public.task_checklist_templates TO service_role;
ALTER TABLE public.task_checklist_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage task_checklist_templates" ON public.task_checklist_templates
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.task_checklist_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.task_checklist_templates(id) ON DELETE CASCADE,
  label text NOT NULL,
  order_index int NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_checklist_template_items TO authenticated;
GRANT ALL ON public.task_checklist_template_items TO service_role;
ALTER TABLE public.task_checklist_template_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage task_checklist_template_items" ON public.task_checklist_template_items
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE INDEX idx_task_checklist_template_items_template ON public.task_checklist_template_items(template_id);

-- Audit columns for voice
ALTER TABLE public.voice_command_log
  ADD COLUMN IF NOT EXISTS clarifications jsonb,
  ADD COLUMN IF NOT EXISTS preview jsonb;

-- =============================================================
-- SEED — service checklists
-- =============================================================
DO $$
DECLARE
  cid uuid;
BEGIN
  -- GERAL — Contrato
  INSERT INTO public.service_checklists (service_type, phase, title, description, order_index)
  VALUES ('geral','contrato','Contrato assinado','Enviar minuta, coletar assinatura e arquivar.',10)
  RETURNING id INTO cid;
  INSERT INTO public.service_checklist_items (checklist_id, label, hint, order_index) VALUES
    (cid,'Enviar minuta do contrato','Personalizar com escopo e valores',1),
    (cid,'Coletar assinatura digital','Link público de assinatura',2),
    (cid,'Arquivar contrato assinado','Pasta /Contratos do cliente',3);

  -- GERAL — Briefing
  INSERT INTO public.service_checklists (service_type, phase, title, description, order_index)
  VALUES ('geral','briefing','Briefing entregue','Enviar e validar briefing do cliente.',20)
  RETURNING id INTO cid;
  INSERT INTO public.service_checklist_items (checklist_id, label, hint, order_index) VALUES
    (cid,'Enviar link do briefing','Briefing público diagnóstico',1),
    (cid,'Cliente preencheu briefing',NULL,2),
    (cid,'Revisar respostas e gerar plano',NULL,3);

  -- META ADS — Acessos
  INSERT INTO public.service_checklists (service_type, phase, title, description, order_index)
  VALUES ('meta_ads','acessos','Acessos Meta Ads','Setup técnico para iniciar campanhas.',30)
  RETURNING id INTO cid;
  INSERT INTO public.service_checklist_items (checklist_id, label, hint, order_index) VALUES
    (cid,'Acesso à BM (Business Manager)','Admin ou parceria',1),
    (cid,'Acesso à conta de anúncios','Nível anunciante mínimo',2),
    (cid,'Pixel instalado e validado','Verificar eventos no Events Manager',3),
    (cid,'Domínio verificado','Para iOS 14+ e CAPI',4),
    (cid,'Cartão de crédito validado',NULL,5),
    (cid,'Públicos base criados','Lookalike, retargeting site',6);

  -- GOOGLE ADS — Acessos
  INSERT INTO public.service_checklists (service_type, phase, title, description, order_index)
  VALUES ('google_ads','acessos','Acessos Google Ads','Setup técnico Google Ads.',30)
  RETURNING id INTO cid;
  INSERT INTO public.service_checklist_items (checklist_id, label, hint, order_index) VALUES
    (cid,'Vincular conta ao MCC',NULL,1),
    (cid,'GTM instalado no site',NULL,2),
    (cid,'Conversões configuradas','Compra, lead, contato',3),
    (cid,'Faturamento configurado',NULL,4),
    (cid,'Search Console + Analytics conectados',NULL,5);

  -- SOCIAL MEDIA — Acessos
  INSERT INTO public.service_checklists (service_type, phase, title, description, order_index)
  VALUES ('social_media','acessos','Acessos Social Media','Acessos e definições editoriais.',30)
  RETURNING id INTO cid;
  INSERT INTO public.service_checklist_items (checklist_id, label, hint, order_index) VALUES
    (cid,'Acesso Instagram (parceria/login)',NULL,1),
    (cid,'Acesso Facebook (página)',NULL,2),
    (cid,'Acesso TikTok / outras redes ativas',NULL,3),
    (cid,'Identidade visual recebida','Logo, paleta, fontes',4),
    (cid,'Linha editorial aprovada','Pilares, tom de voz',5),
    (cid,'Calendário de postagens aprovado',NULL,6);

  -- VIDEO — Acessos
  INSERT INTO public.service_checklists (service_type, phase, title, description, order_index)
  VALUES ('video','acessos','Pré-produção de vídeo','Tudo necessário antes da gravação.',30)
  RETURNING id INTO cid;
  INSERT INTO public.service_checklist_items (checklist_id, label, hint, order_index) VALUES
    (cid,'Briefing audiovisual preenchido',NULL,1),
    (cid,'Roteiro aprovado',NULL,2),
    (cid,'Locação definida',NULL,3),
    (cid,'Talentos confirmados',NULL,4),
    (cid,'Equipamentos reservados',NULL,5),
    (cid,'Cronograma de gravação compartilhado',NULL,6);

  -- SITE — Acessos
  INSERT INTO public.service_checklists (service_type, phase, title, description, order_index)
  VALUES ('site','acessos','Acessos Site','Acessos técnicos e conteúdo.',30)
  RETURNING id INTO cid;
  INSERT INTO public.service_checklist_items (checklist_id, label, hint, order_index) VALUES
    (cid,'Domínio (registrador + DNS)',NULL,1),
    (cid,'Hospedagem definida',NULL,2),
    (cid,'Conteúdo base entregue','Textos, fotos, vídeos',3),
    (cid,'Integrações listadas','Pixel, GA, CRM, formulários',4),
    (cid,'Identidade visual e referências',NULL,5);

  -- AUTOMATION — Acessos
  INSERT INTO public.service_checklists (service_type, phase, title, description, order_index)
  VALUES ('automation','acessos','Acessos Automação','Setup de ferramentas e mapeamento.',30)
  RETURNING id INTO cid;
  INSERT INTO public.service_checklist_items (checklist_id, label, hint, order_index) VALUES
    (cid,'Ferramentas definidas (n8n, Make, CRM)',NULL,1),
    (cid,'Credenciais e APIs disponíveis',NULL,2),
    (cid,'Fluxos atuais mapeados',NULL,3),
    (cid,'Fluxos a automatizar priorizados',NULL,4),
    (cid,'Acesso ao ambiente de testes',NULL,5);

  -- GERAL — Kickoff
  INSERT INTO public.service_checklists (service_type, phase, title, description, order_index)
  VALUES ('geral','kickoff','Kickoff do projeto','Alinhamento inicial com cliente.',40)
  RETURNING id INTO cid;
  INSERT INTO public.service_checklist_items (checklist_id, label, hint, order_index) VALUES
    (cid,'Reunião de kickoff agendada',NULL,1),
    (cid,'Grupo de comunicação criado','WhatsApp / Slack',2),
    (cid,'Cronograma compartilhado com cliente',NULL,3),
    (cid,'Time interno alinhado e responsabilidades definidas',NULL,4);
END $$;

-- =============================================================
-- SEED — task checklist templates
-- =============================================================
DO $$
DECLARE tid uuid;
BEGIN
  INSERT INTO public.task_checklist_templates (category, title, description, service_type)
  VALUES ('campanha_meta','Subir campanha Meta Ads','Checklist completo para lançar uma campanha no Meta','meta_ads') RETURNING id INTO tid;
  INSERT INTO public.task_checklist_template_items (template_id,label,order_index,is_required) VALUES
    (tid,'Definir objetivo da campanha',1,true),
    (tid,'Configurar públicos e segmentações',2,true),
    (tid,'Subir criativos aprovados',3,true),
    (tid,'Configurar orçamento e cronograma',4,true),
    (tid,'Validar pixel e eventos de conversão',5,true),
    (tid,'Revisar copies e CTAs',6,false),
    (tid,'Ativar campanha e monitorar primeiras 24h',7,true);

  INSERT INTO public.task_checklist_templates (category,title,description,service_type)
  VALUES ('campanha_google','Subir campanha Google Ads','Checklist Google Ads (Search/Performance Max)','google_ads') RETURNING id INTO tid;
  INSERT INTO public.task_checklist_template_items (template_id,label,order_index,is_required) VALUES
    (tid,'Pesquisa de palavras-chave',1,true),
    (tid,'Estrutura de grupos de anúncios',2,true),
    (tid,'Anúncios responsivos (15 títulos, 4 descrições)',3,true),
    (tid,'Extensões (sitelink, chamada, snippet)',4,false),
    (tid,'Conversões importadas',5,true),
    (tid,'Lances e orçamento',6,true),
    (tid,'Revisar e publicar',7,true);

  INSERT INTO public.task_checklist_templates (category,title,description,service_type)
  VALUES ('reel','Produzir Reel','Roteiro → gravação → edição → publicação','social_media') RETURNING id INTO tid;
  INSERT INTO public.task_checklist_template_items (template_id,label,order_index,is_required) VALUES
    (tid,'Roteiro com hook nos primeiros 3s',1,true),
    (tid,'Gravação em vertical 9:16',2,true),
    (tid,'Edição com cortes dinâmicos',3,true),
    (tid,'Trilha sonora em alta',4,false),
    (tid,'Legenda + CTA',5,true),
    (tid,'Capa personalizada',6,false),
    (tid,'Aprovação do cliente',7,true),
    (tid,'Agendar publicação',8,true);

  INSERT INTO public.task_checklist_templates (category,title,description,service_type)
  VALUES ('post_carrossel','Carrossel para Instagram','Design + copy + aprovação','social_media') RETURNING id INTO tid;
  INSERT INTO public.task_checklist_template_items (template_id,label,order_index,is_required) VALUES
    (tid,'Definir tema e angle',1,true),
    (tid,'Estruturar storytelling (capa→desenvolvimento→CTA)',2,true),
    (tid,'Design de 8-10 slides',3,true),
    (tid,'Copy da legenda + hashtags',4,true),
    (tid,'Revisão ortográfica',5,true),
    (tid,'Aprovação do cliente',6,true),
    (tid,'Agendar publicação',7,true);

  INSERT INTO public.task_checklist_templates (category,title,description,service_type)
  VALUES ('video_curto','Vídeo curto / YouTube Shorts','Produção completa','video') RETURNING id INTO tid;
  INSERT INTO public.task_checklist_template_items (template_id,label,order_index,is_required) VALUES
    (tid,'Roteiro aprovado',1,true),
    (tid,'Gravação',2,true),
    (tid,'Edição (cortes + cores)',3,true),
    (tid,'Sound design',4,false),
    (tid,'Thumbnail',5,true),
    (tid,'Aprovação cliente',6,true),
    (tid,'Upload e SEO',7,true);

  INSERT INTO public.task_checklist_templates (category,title,description,service_type)
  VALUES ('landing_page','Landing page','Do wireframe ao deploy','site') RETURNING id INTO tid;
  INSERT INTO public.task_checklist_template_items (template_id,label,order_index,is_required) VALUES
    (tid,'Wireframe + copy aprovado',1,true),
    (tid,'Design visual aprovado',2,true),
    (tid,'Desenvolvimento responsivo',3,true),
    (tid,'Formulário + integração',4,true),
    (tid,'Pixel/GA/eventos',5,true),
    (tid,'Testes de performance (Lighthouse 90+)',6,true),
    (tid,'Publicação e teste em produção',7,true);

  INSERT INTO public.task_checklist_templates (category,title,description,service_type)
  VALUES ('automacao_n8n','Fluxo de automação n8n','Mapeamento → build → testes','automation') RETURNING id INTO tid;
  INSERT INTO public.task_checklist_template_items (template_id,label,order_index,is_required) VALUES
    (tid,'Mapear processo manual atual',1,true),
    (tid,'Definir gatilhos e ações',2,true),
    (tid,'Construir fluxo no n8n',3,true),
    (tid,'Testar com dados reais',4,true),
    (tid,'Tratamento de erros e logs',5,true),
    (tid,'Documentar fluxo',6,false),
    (tid,'Deploy em produção',7,true);

  INSERT INTO public.task_checklist_templates (category,title,description,service_type)
  VALUES ('relatorio_mensal','Relatório mensal de performance','Coleta → análise → entrega',NULL) RETURNING id INTO tid;
  INSERT INTO public.task_checklist_template_items (template_id,label,order_index,is_required) VALUES
    (tid,'Coletar dados de todas as plataformas',1,true),
    (tid,'Calcular KPIs principais (CTR, CPL, ROAS)',2,true),
    (tid,'Comparar com mês anterior',3,true),
    (tid,'Gerar insights e recomendações',4,true),
    (tid,'Montar deck/PDF visual',5,true),
    (tid,'Enviar para o cliente',6,true),
    (tid,'Agendar reunião de apresentação',7,false);

  INSERT INTO public.task_checklist_templates (category,title,description,service_type)
  VALUES ('briefing_envio','Enviar briefing ao cliente','Padrão de envio de briefing',NULL) RETURNING id INTO tid;
  INSERT INTO public.task_checklist_template_items (template_id,label,order_index,is_required) VALUES
    (tid,'Gerar link público do briefing',1,true),
    (tid,'Enviar por e-mail + WhatsApp',2,true),
    (tid,'Acompanhar preenchimento (lembrete em 48h)',3,true),
    (tid,'Revisar respostas',4,true),
    (tid,'Gerar plano inicial a partir das respostas',5,true);

  INSERT INTO public.task_checklist_templates (category,title,description,service_type)
  VALUES ('onboarding_cliente','Onboarding completo de cliente','Primeiros 5 dias',NULL) RETURNING id INTO tid;
  INSERT INTO public.task_checklist_template_items (template_id,label,order_index,is_required) VALUES
    (tid,'Contrato assinado e arquivado',1,true),
    (tid,'Briefing enviado e respondido',2,true),
    (tid,'Acessos coletados',3,true),
    (tid,'Grupo de comunicação criado',4,true),
    (tid,'Kickoff agendado',5,true),
    (tid,'Cronograma compartilhado',6,true);
END $$;
