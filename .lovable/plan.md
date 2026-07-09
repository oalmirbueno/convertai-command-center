# Workspace — Drive operacional interno

Módulo `/workspace` acessível só para admin/equipe. Estrutura Global + por Cliente, pastas livres, upload de qualquer arquivo (com foco em vídeo), player nativo com streaming HTTP range direto do storage (Supabase entrega range headers nativamente → sem transcodificação, sem servidor extra) e botão "Enviar para aprovação" que promove o item para a área de Arquivos do cliente sem duplicar o binário.

## Estrutura de dados

Duas tabelas novas em `public`:

**`workspace_nodes`** — árvore única de pastas + arquivos
- `id`, `parent_id` (self-ref, null = raiz), `scope` (`global` | `client`), `client_id` (nullable, obrigatório se scope=client)
- `kind` (`folder` | `file`), `name`, `mime`, `size_bytes`, `storage_path`, `thumb_path` (nullable), `duration_sec` (nullable, vídeos)
- `created_by`, `created_at`, `updated_at`, `sort_index`
- `sent_for_approval_file_id` (nullable → `files.id`) para rastrear promoção

**`workspace_shares`** (fase 2, não bloqueia MVP) — links temporários públicos

Bucket novo `workspace` (privado) para binários. Signed URLs por request. RLS: apenas `is_staff(auth.uid())` lê/escreve; equipe só vê nós de clientes onde tem tarefa atribuída ou scope=global; admin vê tudo. Grants completos para authenticated e service_role.

## UI

Rota `/workspace` no AppLayout (item de menu com ícone `FolderTree`, só renderiza pra staff).

Layout:
- Sidebar esquerda (240px): árvore recolhível → `📁 Global` e `👥 Clientes` (lista de clientes ativos, cada um expansível).
- Área central: breadcrumb + grid/lista de nós da pasta atual, com toggle grid↔lista, ordenação (nome/data/tamanho), busca por nome.
- Drawer direito ao clicar num arquivo: preview (player pra vídeo, `<img>` pra imagem, PDF embed), metadados, botões **Baixar**, **Renomear**, **Mover**, **Enviar para aprovação**, **Excluir**.

Ações de barra superior: **Novo** (pasta / upload arquivos / upload vídeo), drag-and-drop pra soltar arquivos direto no grid, upload com progresso (barra por arquivo, cancelamento).

Estética Aceleriq: fundo `#0D0D0D`, cards `#121212`, acento neon `#00FF66`, Outfit/JetBrains Mono, cantos arredondados, sem gradientes genéricos. Ícones por tipo (Film pra vídeo em verde, Image, FileText, Archive). Thumb de vídeo gerada no cliente via `<video>` + canvas no primeiro segundo, salva em `thumb_path`.

## Vídeo

Upload direto do browser pro bucket via SDK Supabase (chunked). Player `<video controls preload="metadata">` recebendo signed URL de 1h — Supabase Storage responde a `Range` headers, então o browser faz seek/streaming sem baixar tudo. Duração + thumb extraídas no cliente antes do upload e salvas no node.

Limite: 500MB por arquivo (validação client-side + policy no bucket). Formatos: mp4, webm, mov, mkv, mp3, wav, além de tudo que Arquivos já aceita.

## Envio para aprovação

Botão "Enviar para aprovação" abre modal: escolher projeto do cliente, pasta destino em Arquivos (usa as `CLIENT_FOLDERS` existentes), legenda opcional. Ao confirmar:
- Cria row em `files` com `file_url` = signed URL longa (ou copia storage_path referenciando o mesmo binário do bucket workspace — mais eficiente, sem duplicar bytes)
- `approval_status = 'pending'`, `uploaded_by = staff atual`
- Escreve `sent_for_approval_file_id` no node pra mostrar badge "Enviado ✓" no workspace
- Dispara `notify-admin`/notificação pro cliente igual fluxo atual

Cliente continua vendo tudo em `/documentos` sem saber da existência do workspace. Fluxo tradicional (upload direto em Arquivos) segue intacto.

## Permissões

- Admin: CRUD total, todos os escopos
- Equipe (design/traffic/manager): CRUD total em `global` + em `client` onde `client_id` aparece em alguma task atribuída a ela. Sem restrição de delete (mais fluido pro operacional; auditoria via `created_by`)
- Cliente: sem rota, sem policy — 100% invisível

## Arquivos afetados

Novos:
- Migration: tabelas + bucket + policies + grants
- `src/pages/Workspace.tsx` (shell + roteamento)
- `src/components/workspace/WorkspaceSidebar.tsx`
- `src/components/workspace/WorkspaceGrid.tsx`
- `src/components/workspace/NodePreviewDrawer.tsx`
- `src/components/workspace/UploadDropzone.tsx`
- `src/components/workspace/SendToApprovalModal.tsx`
- `src/hooks/useWorkspace.ts` (queries + mutations React Query)
- `src/lib/videoThumb.ts` (extrai thumb + duração)

Editados:
- `src/App.tsx` — rota
- `src/components/AppLayout.tsx` — item de menu (staff-only)

## Fora do escopo desta entrega

- Compartilhamento público com link expirável (fase 2)
- Comentários/anotações por arquivo (usa Arquivos quando promovido)
- Transcodificação server-side (não necessária pra streaming — Supabase já suporta Range)
- Busca full-text em PDFs

Confirma que posso seguir?