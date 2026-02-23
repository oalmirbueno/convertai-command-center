

# ConvertAI ClientOS — Painel de Gestão para Agência Digital

## Visão Geral
Sistema de gestão de projetos premium para agência digital com dois perfis de acesso (Admin e Cliente), visual dark sofisticado estilo "command center" e navegação completa.

---

## Design System
- **Tema escuro** com fundo `#0a0b0f`, cards `#181920`
- **Fonte Outfit** (Google Fonts) em todo o sistema
- **Cor principal** roxo `#6c5ce7` com efeitos de glow
- Cards com bordas arredondadas de 16px e glassmorphism no header
- Animações de entrada fade + slide em todas as páginas
- Visual premium, zero aparência de template genérico

---

## Páginas e Funcionalidades

### 1. Tela de Login
- Logo "ConvertAI" com ícone gradiente roxo e subtítulo "Client Execution OS"
- Campos visuais de email e senha
- Botões de acesso rápido: "Entrar como Admin" e "Entrar como Cliente" (login mock via useState)
- Fundo com grid animado sutil e orbs de luz roxo/verde

### 2. Dashboard Admin
- 4 cards de estatísticas no topo: Projetos Ativos, Clientes, Tarefas Pendentes, Em Revisão (com ícones e números em fonte mono)
- Barra de ações rápidas: Novo Projeto, Novo Cliente, Gerar Plano IA, Upload Documento
- Grid de projetos ativos como cards com badge de tipo, status, barra de progresso e prazo
- Seções "Atualizações Recentes" (feed com dots coloridos) e "Tarefas Urgentes" lado a lado

### 3. Dashboard Cliente
- Mensagem de boas-vindas personalizada com nome da empresa
- Cards resumo: Projetos Ativos, Aguardando Aprovação, Concluídas
- Cards de projetos grandes e clicáveis
- Feed de atualizações recentes
- Somente visualização — sem edição

### 4. Sidebar Dinâmica
- Muda itens conforme perfil logado (Admin ou Cliente)
- **Admin:** Dashboard, Projetos, Kanban, Clientes, Equipe, Aprovações, IA Planner, Relatórios, Timeline, Financeiro, Arquivos, Config
- **Cliente:** Dashboard, Meus Projetos, Acompanhamento, Aprovações, Relatórios, Timeline, Pedidos, Documentos, Financeiro, Perfil
- Indicador de notificações não lidas no ícone do sino
- Rodapé com avatar, nome do usuário e botão de logout

### 5. Kanban (Admin)
- Board estilo Trello com 4 colunas: Backlog, Em Andamento, Revisão, Concluído
- Cards com título, projeto, prazo, badge de prioridade e avatar do responsável
- Arrastar/mover cards entre colunas

### 6. Página de Clientes (Admin)
- Tabela com avatar, empresa, email, badges de serviços ativos, quantidade de projetos e status
- Botões "Novo Cliente" e "Gerar Link Briefing"

### 7. Painel de Notificações
- Slide panel pela direita ao clicar no sino (header)
- Lista de notificações com indicador de lida/não lida
- Tipos: aprovação, relatório, cobrança, pedido

### 8. Páginas Placeholder (Fase 2)
- IA Planner, Relatórios, Timeline, Financeiro, Arquivos, Config, Equipe, Aprovações, Pedidos, Documentos, Perfil, Acompanhamento
- Tela bonita com ícone e mensagem "Em construção — Fase 2"

---

## Dados Mock
- 2 clientes: "Acerbi Associação" e "Cresol Cooperativa"
- 4 projetos: Social Media, Evento, Automação, Site
- 8 tarefas distribuídas nas colunas do Kanban
- 5 notificações e 4 atualizações no feed

---

## Técnico
- Autenticação mock com useState (sem backend)
- React Router para todas as rotas
- Tailwind CSS + shadcn/ui
- Responsivo (mobile-first)
- Transições suaves entre páginas

