# Padrão mobile app-like em toda a plataforma

O problema é o mesmo em quase todas as páginas: a página inteira rola no mobile, então o topo (título, abas, filtros) sobe junto e a experiência parece uma página web em vez de um app. A correção é padronizar um shell mobile com header fixo, abas fixas e apenas o conteúdo interno com scroll — e ajustar Kanban e Financeiro para deslizar cards no eixo horizontal como um app nativo.

## 1. Shell mobile padrão (base de tudo)

Criar um wrapper reutilizável `MobilePageShell` (usado apenas em `md:hidden`) com:

- Header sticky logo abaixo da TopBar do app (respeita `safe-area-inset-top` + 64px).
- Faixa de abas/filtros sticky abaixo do header, com scroll horizontal quando estourar largura.
- Área de conteúdo com `overflow-y-auto`, altura calculada por `100dvh - top - bottom nav`, com `overscroll-behavior: contain` para não puxar a página inteira.
- Padding inferior dinâmico usando `env(safe-area-inset-bottom) + 64px` (altura da MobileBottomNav).

Aplicar em: Dashboard (revisar), Projetos, Kanban, Clientes, Relatórios, Aprovações, Pedidos, Briefings, Quiz, Equipe, Timeline, Financeiro, Arquivos, Workspace, Cofre, Config, Perfil.

O desktop continua exatamente como está — o shell só troca o layout quando `md:hidden`.

## 2. Kanban mobile

- Fixar header do projeto e a barra de colunas no topo. Só o conteúdo de cada coluna rola verticalmente.
- Tornar as colunas um carrossel horizontal com snap (`snap-x snap-mandatory`), uma coluna por viewport, indicadores de posição no rodapé.
- Habilitar arrastar card entre colunas por long-press: usar sensor de toque com delay (250ms) + tolerância, para não conflitar com o scroll vertical. Card em drag ganha elevação e overlay; soltar em cima de outra coluna via auto-scroll horizontal do carrossel.
- Drawer do card em modal bottom-sheet, altura máxima 92dvh, com header e footer fixos e miolo scrollável. Fechar por arrastar para baixo ou pelo X.

## 3. Financeiro mobile

- Reorganizar KPIs como carrossel horizontal de cards com snap (1.1 card visível por vez), em vez de empilhar verticalmente.
- Abas (Recorrente / Projetos / Ads / Investidor / Capital) fixas no topo.
- Tabelas viram lista de cards colapsáveis, cada card com ações principais no rodapé.
- Formulário "Novo lançamento" em bottom-sheet full height, sem sair da página.

## 4. Correções pontuais adicionais

- Aprovações, Pedidos, Relatórios: botão "Voltar" fixo no header do detalhe (não usar back do browser como única saída).
- Cofre e Config: agrupar seções em abas horizontais fixas, cada seção com scroll interno.
- Garantir que ao abrir qualquer detalhe (drawer, modal, sheet) o scroll da página-pai fique travado (`overflow: hidden` no body enquanto aberto).

## Detalhes técnicos

- Novo componente `src/components/shared/MobilePageShell.tsx` expondo `<Shell.Header>`, `<Shell.Tabs>`, `<Shell.Body>`. Usa `100dvh` e CSS vars para as safe-areas.
- Kanban: substituir DnD atual no mobile por `@dnd-kit` com `TouchSensor({ activationConstraint: { delay: 250, tolerance: 8 } })`. Carrossel com `scroll-snap-type: x mandatory` e `scroll-snap-align: center` em cada coluna.
- Financeiro: KPIs em `flex overflow-x-auto snap-x` com cards `min-w-[85%] snap-center`.
- Bottom-sheets: usar `Sheet` do shadcn com `side="bottom"` e `h-[92dvh]`, header/footer com `shrink-0` e miolo `overflow-y-auto`.
- Regra global: nenhuma página mobile deve rolar como um todo — apenas o `<Shell.Body>`. `main` do `AppLayout` mantém padding, mas cada página mobile passa a controlar sua altura via shell.

## Fora de escopo

- Alterações de desktop.
- Redesign visual (cores, tipografia). Apenas layout/interação.
- Novos recursos de negócio.

## Ordem de entrega sugerida

1. `MobilePageShell` + aplicar em Projetos, Clientes, Relatórios, Aprovações, Pedidos, Briefings, Quiz, Equipe, Timeline, Cofre, Config (varredura rápida, mesmo padrão).
2. Kanban mobile (carrossel + long-press drag + bottom-sheet do card).
3. Financeiro mobile (KPIs em carrossel + abas fixas + cards colapsáveis + bottom-sheet de lançamento).
4. Passada final travando scroll do body em todos os drawers/modais abertos.
