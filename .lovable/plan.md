# Studio v3 — Fluxo Fordista (Agente → Notas → GPT)

Reorganizar o `StudioPanel` em três estágios claros, lado a lado, com sync bidirecional e saída em documento branded.

## Layout (staff/admin only — cliente só recebe espelho read-only)

```text
┌──────────────────────────────────────────────────────────────────┐
│  Studio · [Cliente ▾ / Projeto ▾]        ◧ ▬ ◨ ⛶  [Baixar PDF]  │
├────────────┬─────────────────────────────┬───────────────────────┤
│ 1. AGENTE  │      2. NOTAS (centro)      │  3. GPT EXTERNO       │
│ (esquerda) │      documento vivo         │  (direita)            │
│            │                             │                       │
│ contexto+  │  H1/H2/H3, listas, check,   │  recomendação de qual │
│ chat curto │  auto-formata, auto-plano   │  GPT usar, copiar ctx,│
│ manda→notas│  edge interno, bidirecional │  colar resposta→notas │
└────────────┴─────────────────────────────┴───────────────────────┘
```

Fluxo:

1. **Agente (E)**
  **Se pedir pra atualizar o plano, ou seja, a gente tem um projeto, a gente vai atualizar o projeto. Vai pra etapas automaticamente. Ele já pega o projeto existente e ele automaticamente já faz algo interno sozinho, tá, e já faz tudo isso: já atualiza, já implementa, já cria outros projetos em cima daquele cliente, assim por diante, tá** puxa contexto (cliente, pasta, arquivos, roteiro, notas atuais) e conversa. Botão **"Enviar para Notas"** transforma a última resposta em bloco estruturado (headline + subheadline + bullets + checklist + próximos passos) e injeta no doc central.
2. **Notas (centro)** = documento vivo com formatação rica (Tiptap-like via `contenteditable` + toolbar leve já existente). Enquanto o usuário digita, um "edge interno" (debounce 1.5s) chama `workspace-agent` em modo `mode: "enrich"` que devolve: correções, próximos blocos sugeridos, checklist, plano executável — inseridos como sugestões aceitáveis (chips no rodapé "Aceitar / Descartar"). Sempre orientado a **ação**, não só teoria.
3. **GPT (D)** lista personas do escopo com badge "⭐ recomendado" (roteador escolhe com base no conteúdo atual das notas). Clicar abre GPT externo com contexto copiado. Botão **"Colar resposta"** faz merge automático no doc central preservando estrutura.

## Documento vivo → PDF Aceleriq

- Renderização em `NotesDocument.tsx` com estilos branded (verde neon `#00FF66`, dark `#0D0D0D`, Outfit + JetBrains Mono, logo no topo).
- Botão **"Baixar PDF"** usa `html2pdf.js` (bun add) com `pagebreak: { mode: ['avoid-all','css','legacy'] }` e classes `.no-break` em headings/checklists.
- Auto-save no `workspace_nodes.metadata.notes` (já existe) + nova coluna `metadata.doc_blocks` (JSONB) para blocos estruturados.

## Bidirecional + Cliente

- Realtime channel `studio:{project_id}` — qualquer save no doc dispara `postgres_changes` em `workspace_nodes`.
- Cliente vê **espelho read-only** na aba do projeto (`ProjectView.tsx` → nova aba "Documento") — apenas se `metadata.doc_published = true` (toggle "Publicar para cliente" no header do Studio).
- Staff vê tudo; cliente só vê publicado.

## Backend

- `supabase/functions/workspace-agent/index.ts`: adicionar `mode: "enrich" | "chat" | "structure"`:
  - `enrich`: recebe doc atual → devolve JSON `{ corrections[], suggestions[], checklist[], next_actions[] }`.
  - `structure`: recebe texto bruto do agente → devolve markdown formatado (H1/H2/lista/check).
- `workspace-agent-recommend` (nova): recebe doc + catálogo → devolve `persona_id` recomendado + razão.

## Frontend

- `src/components/workspace/StudioPanel.tsx`: reorganizar em 3 colunas (grid `grid-cols-[280px_1fr_300px]` em desktop; tabs em mobile). Header limpo com breadcrumb Cliente/Projeto e ações compactas.
- `src/components/workspace/NotesDocument.tsx` (novo): editor rico com toolbar + suggestion chips + branded print CSS.
- `src/components/workspace/StudioAgentColumn.tsx` (novo): chat compacto + botão "→ Notas".
- `src/components/workspace/StudioGptColumn.tsx` (novo): lista personas com recomendação, copy-context, paste-back.
- `src/components/client/tabs/TabDocument.tsx` (novo): read-only view do doc publicado.

## Design

- Grid limpo, dividers sutis (`border-border/40`), cada coluna com header próprio (ícone + título + ação).
- Chips de sugestão animados com framer-motion (fade+slide).
- PDF: capa com logo Aceleriq, rodapé com "aceleriq.online · confidencial", numeração de página.

## Escopo desta entrega

Vou implementar em uma passada: layout 3-colunas, doc rico com auto-enrich, recomendação de GPT, PDF branded, publicação para cliente + aba read-only. Sem alterar business logic fora do Studio.