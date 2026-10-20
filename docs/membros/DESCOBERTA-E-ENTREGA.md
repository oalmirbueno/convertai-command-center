# Área de membros — desenvolvimento, 20/10/2026

## Descoberta

Base: main `00d55d38`. Continuidade encontrada em
`C:/Users/Usuario/Desktop/Projeto Aceleriq/Claude/convertai-command-center/CODEX-CONTINUIDADE-MESA.md`.
Arquitetura: `docs/architecture/ACELERIQ-CONTEXTO-CANONICO.md`; design: `docs/design/SISTEMA.md`.
Não foi localizado plano específico da biblioteca. Os documentos `Aceleriq-Ecossistema/01-fluxo-logico.md`
e `02-banco-de-dados.md` descrevem o painel operacional, não direitos de compra de produtos.
O briefing de Almir desta entrega complementa essas fontes.

Existentes: React/Vite, Supabase Auth, papéis operacionais, planos financeiros versionados,
contratos financeiros com vigência, painel do cliente, Laboratório/Canvas e `vendas-webhook`.
Kiwify e Asaas têm normalização de eventos e registro no CRM. Isso **não** representa concessão de
conteúdo. A assinatura Kiwify existente depende de formatos não confirmados oficialmente, como
registrado pelo próprio Claude no handoff de 19/10. Não ampliar essa confiança para liberar materiais.

Checkout do Claude preservado: alterações locais em VisaoDoBrandbook, CascaPublica e BriefingPublic,
e um teste de identidade. Trabalho desta entrega em branch separada `codex/area-membros` no checkout Codex.

## Regras

- Papel operacional e direito a material são dimensões diferentes. Cadastro novo não concede papel
  operacional; equipe concede esse papel pelo fluxo existente. Papéis existentes não são removidos.
- Uma compra é uma origem de direito. Outra compra, concessão manual e benefício de plano permanecem
  independentes. Benefício só existe após vínculo explícito a um plano financeiro.
- A vigência de plano usa `financial_client_terms` e sua versão de plano, não texto livre do perfil.
- Catálogo contém metadados. Materiais ficam em tabela protegida e bucket privado próprio, sem links
  públicos para arquivos. Links assinados duram 60 s; não equivalem a DRM e não impedem cópia pelo usuário autorizado.
- Compra só pode ser associada por e-mail confirmado da identidade Auth e confirmação do servidor.
  Nenhuma conta duplicada é criada. Nenhum papel operacional é inferido da compra.
- Kiwify: pendência de contrato oficial de assinatura/API e credenciais seguras. Não libera conteúdo.
- Asaas: conciliação GET do pagamento e comprador no servidor usando integração existente no Vault;
  somente integração da agência, mapeamento explícito e ação administrativa. Sem nova cobrança.

## Produção

Nenhuma migration, Edge Function, cobrança, credencial ou publicação desta entrega está autorizada
em produção. Migração e rollback serão revisáveis. O Supabase MCP pediu reautenticação na descoberta;
o acesso foi reconectado por Almir e as dependências de schema/políticas foram conferidas somente em leitura.
Não há tabelas `membros_%` nem integração ativa da agência para Kiwify/Asaas no banco real.
O ensaio local com PostgreSQL foi executado. Evidências e limites estão em `CONTINUIDADE.md`.
A ativação continua dependendo da aprovação de Almir e da validação das integrações reais.

Fontes oficiais consultadas:
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/storage/security/access-control
- https://ajuda.kiwify.com.br/pt-br/article/como-funcionam-os-webhooks-2ydtgl/
- https://ajuda.kiwify.com.br/pt-br/category/integracoes-1633r3w/
- https://docs.asaas.com/reference/recuperar-uma-unica-cobranca
- https://docs.asaas.com/docs/webhook-para-cobrancas
