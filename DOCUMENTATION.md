# Aceleriq Performance OS — Documentação Completa

> **Versão:** Fevereiro 2026  
> **Stack:** React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui + Lovable Cloud (Supabase)  
> **Repositório:** Gerenciado via Lovable  

---

## Índice

1. [Visão Geral](#1-visão-geral)
2. [Arquitetura Técnica](#2-arquitetura-técnica)
3. [Design System](#3-design-system)
4. [Autenticação e Autorização](#4-autenticação-e-autorização)
5. [Banco de Dados — Schema Completo](#5-banco-de-dados--schema-completo)
6. [RLS Policies (Row Level Security)](#6-rls-policies)
7. [Database Functions & Triggers](#7-database-functions--triggers)
8. [Rotas e Páginas](#8-rotas-e-páginas)
9. [Componentes Principais](#9-componentes-principais)
10. [Hooks Customizados](#10-hooks-customizados)
11. [Sistema de Webhooks (n8n)](#11-sistema-de-webhooks-n8n)
12. [Sistema de Notificações](#12-sistema-de-notificações)
13. [Onboarding / Tour Guiado](#13-onboarding--tour-guiado)
14. [Storage (Arquivos)](#14-storage-arquivos)
15. [Edge Functions](#15-edge-functions)
16. [Variáveis de Ambiente](#16-variáveis-de-ambiente)
17. [Dependências](#17-dependências)
18. [Estrutura de Pastas](#18-estrutura-de-pastas)

---

## 1. Visão Geral

**Aceleriq Performance OS** é um sistema de gestão de projetos premium para agências de marketing digital. Oferece dois portais:

| Portal | Acesso | Funcionalidades |
|--------|--------|----------------|
| **Admin/Equipe** | `admin`, `design`, `traffic`, `manager` | Dashboard de agência, Kanban, gestão de clientes, relatórios, financeiro, equipe, briefings, aprovações |
| **Cliente** | `client` | Canvas de projetos, aprovações de criativos, pedidos, documentos, financeiro, relatórios |

**Conceito visual:** "Clean Tech" — fundo escuro (#0D0D0D), verde primário (#00FF66), tipografia Outfit, estética de alta performance.

---

## 2. Arquitetura Técnica

### Stack Frontend

```
React 18.3 + TypeScript
Vite (bundler)
Tailwind CSS + tailwindcss-animate
shadcn/ui (Radix primitives)
React Router DOM 6
TanStack React Query 5
Recharts (gráficos)
Lucide React (ícones)
Sonner (toasts)
Framer Motion (animações pontuais)
```

### Stack Backend (Lovable Cloud / Supabase)

```
PostgreSQL (banco de dados)
Supabase Auth (autenticação)
Supabase Storage (arquivos e avatares)
Supabase Edge Functions (Deno)
Row Level Security (RLS) em todas as tabelas
```

### Fluxo de Dados

```
Browser → React Query → Supabase Client → PostgreSQL
                                        → Storage
                                        → Edge Functions
Webhooks → n8n (fire-and-forget)
```

---

## 3. Design System

### Tokens de Cor (index.css)

```css
:root {
  --background: 0 0% 5%;        /* #0D0D0D */
  --foreground: 0 0% 100%;      /* #FFFFFF */
  --card: 0 0% 10%;             /* #1A1A1A */
  --popover: 0 0% 7%;           /* #121212 */
  --primary: 145 100% 50%;      /* #00FF66 */
  --primary-foreground: 0 0% 5%;
  --secondary: 0 0% 13%;        /* #212121 */
  --muted: 0 0% 13%;
  --muted-foreground: 0 0% 40%; /* #666666 */
  --border: 0 0% 17%;           /* #2A2A2A */
  --destructive: 0 100% 62%;    /* #FF3B3B */
  --success: 145 100% 50%;      /* #00FF66 */
  --warning: 43 100% 50%;       /* #FFB800 */
  --info: 200 100% 50%;         /* #0099FF */
  --radius: 0.75rem;
}
```

### Tipografia

```ts
fontFamily: {
  outfit: ["Outfit", "sans-serif"],  // corpo e títulos
  mono: ["JetBrains Mono", "monospace"],  // dados numéricos
}
```

### Animações

```ts
keyframes: {
  "fade-in":      { "0%": { opacity: 0, translateY: 8px }, "100%": { opacity: 1, translateY: 0 } },
  "fade-in-left": { "0%": { opacity: 0, translateX: -10px }, "100%": { opacity: 1, translateX: 0 } },
  "slide-up":     { "0%": { opacity: 0, translateY: 20px }, "100%": { opacity: 1, translateY: 0 } },
}
```

### Utilitários CSS Customizados

```css
.label-sm       /* text-[11px] uppercase tracking-wide muted */
.heading-page   /* text-[14px] uppercase tracking-wider muted */
.tech-grid-bg   /* grid sutil de fundo */
.pulse-dot      /* pulsação em status "ativo" */
.stagger-children /* animação escalonada de filhos */
```

---

## 4. Autenticação e Autorização

### Roles do Sistema

```ts
type AppRole = "admin" | "client" | "design" | "traffic" | "manager";
```

| Role | Descrição |
|------|-----------|
| `admin` | Administrador da agência — acesso total |
| `client` | Cliente — vê apenas seus próprios dados |
| `design` | Designer — equipe interna, acesso a projetos e tarefas |
| `traffic` | Gestor de tráfego — equipe interna + relatórios + financeiro de ads |
| `manager` | Gerente de contas — equipe interna + relatórios |

### Fluxo de Autenticação

```
1. Login com email/senha → supabase.auth.signInWithPassword()
2. Signup → supabase.auth.signUp() com metadata { full_name, role, company_name }
3. Trigger handle_new_user() cria profile + user_role automaticamente
4. AuthContext busca profile + role após login
5. Rotas protegidas via <ProtectedRoute>
6. Redirecionamento baseado em role no AppRoutes
```

### AuthContext (`src/contexts/AuthContext.tsx`)

```tsx
interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  loginWithCredentials: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, fullName: string, companyName?: string, phone?: string) => Promise<void>;
  logout: () => Promise<void>;
}

interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  company_name?: string | null;
  avatar_url?: string | null;
  plan_renewal_date?: string | null;
  plan_status?: string;
  services_config?: any;
  onboarding_done?: boolean;
  role: AppRole;
}
```

### Criação de Clientes (Admin)

O admin cria clientes via `CreateClientModal`:
1. `supabase.auth.signUp()` com role "client"
2. Atualiza profile com telefone e serviços
3. Restaura sessão do admin
4. Exibe credenciais (email + senha gerada)
5. Dispara webhook `onboardClient`

---

## 5. Banco de Dados — Schema Completo

### Tabela: `profiles`

```sql
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY,           -- = auth.users.id
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  company_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  plan_name TEXT,
  plan_status TEXT DEFAULT 'active',
  plan_renewal_date DATE,
  services_config JSONB DEFAULT '{}',
  onboarding_done BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Tabela: `user_roles`

```sql
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,          -- ref: auth.users.id
  role app_role NOT NULL           -- ENUM: admin | client | design | traffic | manager
  -- UNIQUE(user_id, role)
);
```

### Tabela: `projects`

```sql
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  client_id UUID NOT NULL REFERENCES profiles(id),
  created_by UUID REFERENCES profiles(id),
  project_type TEXT NOT NULL,      -- social_media, trafego_pago, site, automacao, branding, evento, outro
  status TEXT DEFAULT 'planning',  -- planning | active | review | paused | done
  progress INTEGER DEFAULT 0,     -- 0-100
  start_date DATE NOT NULL,
  deadline DATE NOT NULL,
  objectives TEXT,
  scope TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Tabela: `tasks`

```sql
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'backlog',   -- backlog | in_progress | review | done
  priority TEXT DEFAULT 'medium',  -- low | medium | high | urgent
  assigned_to UUID REFERENCES profiles(id),
  due_date DATE,
  task_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Tabela: `milestones`

```sql
CREATE TABLE public.milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT,
  target_date DATE NOT NULL,
  status TEXT DEFAULT 'pending',   -- pending | in_progress | done
  milestone_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Tabela: `files`

```sql
CREATE TABLE public.files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  client_id UUID NOT NULL REFERENCES profiles(id),
  uploaded_by UUID NOT NULL REFERENCES profiles(id),
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  description TEXT,
  caption TEXT,
  carousel_text TEXT,
  feedback TEXT,
  approval_status TEXT DEFAULT 'none',  -- none | pending | approved | rejected
  folder TEXT,
  version INTEGER DEFAULT 1,
  parent_file_id UUID REFERENCES files(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Tabela: `updates`

```sql
CREATE TABLE public.updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  author_id UUID NOT NULL REFERENCES profiles(id),
  message TEXT NOT NULL,
  update_type TEXT NOT NULL,       -- status | task | milestone | general
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Tabela: `notifications`

```sql
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  message TEXT NOT NULL,
  notification_type TEXT NOT NULL,  -- system | approval | request | update
  link TEXT,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Tabela: `client_requests`

```sql
CREATE TABLE public.client_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES profiles(id),
  project_id UUID REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT DEFAULT 'normal',  -- low | normal | high | urgent
  status TEXT DEFAULT 'new',       -- new | in_progress | done | cancelled
  ai_draft TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Tabela: `briefings`

```sql
CREATE TABLE public.briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  client_id UUID REFERENCES profiles(id),
  project_id UUID REFERENCES projects(id),
  responses JSONB DEFAULT '{}',
  submitted BOOLEAN DEFAULT false,
  required BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Tabela: `billing`

```sql
CREATE TABLE public.billing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES profiles(id),
  amount NUMERIC NOT NULL,
  due_date DATE NOT NULL,
  paid_date DATE,
  status TEXT DEFAULT 'pending',   -- pending | paid | overdue
  type TEXT NOT NULL,              -- mensalidade | servico | ads_recharge
  description TEXT,
  platform TEXT,
  reminder_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Tabela: `ads_wallet`

```sql
CREATE TABLE public.ads_wallet (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES profiles(id),
  platform TEXT DEFAULT 'meta',    -- meta | google | tiktok
  balance NUMERIC DEFAULT 0,
  last_recharge_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Tabela: `recharge_requests`

```sql
CREATE TABLE public.recharge_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES profiles(id),
  requested_by UUID REFERENCES profiles(id),
  approved_by UUID REFERENCES profiles(id),
  amount NUMERIC NOT NULL,
  platform TEXT DEFAULT 'meta',
  reason TEXT,
  status TEXT DEFAULT 'pending',   -- pending | approved | rejected
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Tabela: `reports`

```sql
CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  client_id UUID NOT NULL REFERENCES profiles(id),
  created_by UUID REFERENCES profiles(id),
  title TEXT NOT NULL,
  summary TEXT,
  highlights TEXT,
  next_steps TEXT,
  internal_notes TEXT,
  metrics JSONB DEFAULT '{}',
  chart_data JSONB DEFAULT '[]',
  chart_type TEXT DEFAULT 'area',
  images JSONB DEFAULT '[]',
  file_url TEXT,
  period_start DATE,
  period_end DATE,
  status TEXT DEFAULT 'draft',     -- draft | published
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### ENUM

```sql
CREATE TYPE public.app_role AS ENUM ('admin', 'client', 'design', 'traffic', 'manager');
```

---

## 6. RLS Policies

### Padrão Geral

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|--------|--------|--------|--------|--------|
| `profiles` | Todos | Próprio `auth.uid() = id` | Próprio ou admin | Admin |
| `user_roles` | Próprio ou admin | Admin | Admin | Admin |
| `projects` | Cliente próprio ou admin | Admin | Admin | Admin |
| `tasks` | Todos | Todos | Admin ou assignee | Admin |
| `milestones` | Todos | Admin | Admin | — |
| `files` | Todos | Todos | Todos | Admin |
| `updates` | Todos | Todos | — | — |
| `notifications` | Próprio | Todos | Próprio | — |
| `client_requests` | Cliente próprio ou admin | Todos | Admin ou cliente | — |
| `briefings` | Todos (público) | Todos | Todos | — |
| `billing` | Cliente próprio ou admin | Admin | Admin | — |
| `ads_wallet` | Cliente, admin ou traffic | Admin ou traffic | Admin ou traffic | — |
| `recharge_requests` | Cliente, admin ou traffic | Todos | Admin ou cliente | — |
| `reports` | Cliente, admin, traffic, manager | Admin, traffic, manager | Admin | Admin |

### Função de Verificação de Role

```sql
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;
```

---

## 7. Database Functions & Triggers

### `handle_new_user()`

Trigger `AFTER INSERT ON auth.users`. Cria automaticamente:
- Registro em `profiles` (id, email, full_name, company_name)
- Registro em `user_roles` (user_id, role — padrão: client)

```sql
CREATE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, company_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(COALESCE(NEW.email, ''), '@', 1)),
    NEW.raw_user_meta_data->>'company_name'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id,
    COALESCE((NEW.raw_user_meta_data->>'role')::app_role, 'client')
  )
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;
```

### `get_admin_user_id()`

Retorna o UUID do primeiro admin. Usada para enviar notificações ao admin.

```sql
CREATE FUNCTION public.get_admin_user_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT user_id FROM public.user_roles WHERE role = 'admin' LIMIT 1
$$;
```

### `update_updated_at_column()`

Trigger genérico para atualizar `updated_at` antes de UPDATE.

```sql
CREATE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
```

---

## 8. Rotas e Páginas

### Mapa de Rotas (`src/App.tsx`)

| Rota | Componente | Acesso |
|------|-----------|--------|
| `/login` | `Login` | Público |
| `/briefing/:token` | `BriefingPublic` | Público |
| `/dashboard` | `AdminDashboard` / `ClientDashboard` | Autenticado (role-based) |
| `/projetos` | `Projects` | Autenticado |
| `/kanban` | `Kanban` | Autenticado |
| `/clientes` | `Clients` | Admin/Equipe |
| `/equipe` | `Team` | Admin/Equipe |
| `/arquivos` | `AdminFiles` | Admin/Equipe |
| `/aprovacoes` | `AdminApprovals` / `ClientApprovals` | Autenticado (role-based) |
| `/pedidos` | `AdminRequests` / `ClientRequests` | Autenticado (role-based) |
| `/briefings` | `AdminBriefings` | Admin/Equipe |
| `/relatorios` | `AdminReports` / `ClientReports` | Autenticado (role-based) |
| `/relatorios/novo` | `AdminReportCreate` | Admin/Equipe |
| `/relatorios/:id` | `ReportDetail` | Autenticado |
| `/timeline` | `TimelinePage` | Autenticado |
| `/financeiro` | `AdminFinanceiro` / `ClientFinanceiro` | Autenticado (role-based) |
| `/documentos` | `ClientDocuments` | Cliente |
| `/perfil` | `ProfilePage` | Autenticado |
| `/config` | `SettingsPage` | Admin/Equipe |

### Páginas por Role

**Admin/Equipe vê:** Dashboard (métricas + feed), Projetos (CRUD completo), Kanban, Clientes, Equipe, Aprovações (gerenciar), Pedidos (gerenciar), Briefings, Relatórios (CRUD), Timeline, Financeiro (billing + ads wallet), Arquivos, Config

**Cliente vê:** Dashboard (canvas de projetos), Projetos (read-only), Aprovações (aprovar/rejeitar), Pedidos (criar), Documentos, Relatórios (visualizar), Timeline, Financeiro (visualizar), Perfil

---

## 9. Componentes Principais

### Layout

| Componente | Arquivo | Descrição |
|-----------|---------|-----------|
| `AppLayout` | `src/components/AppLayout.tsx` | Layout principal com floating top nav, menu mobile, dropdown de usuário, notificações, onboarding tour |
| `NavLink` | `src/components/NavLink.tsx` | Link de navegação com indicador ativo |

### Admin

| Componente | Descrição |
|-----------|-----------|
| `CreateClientModal` | Modal de criação de cliente com geração de senha |
| `CreateProjectModal` | Modal de criação/edição de projeto |
| `CreateTaskModal` | Modal de criação de tarefa |
| `ProjectDrawer` | Drawer lateral com detalhes do projeto (status, progresso, marcos, equipe) |
| `EditClientDrawer` | Drawer de edição de dados do cliente |
| `BriefingLinkModal` | Modal para gerar link de briefing |
| `MeetingNotesModal` | Modal para notas de reunião |
| `MeetingToProjectModal` | Modal "Gerar Projeto com IA" via ata de reunião |
| `BriefingPdfModal` | Modal para visualizar respostas de briefing |

### Cliente

| Componente | Descrição |
|-----------|-----------|
| `ProjectCanvas` | Canvas interativo com cards de projetos |
| `ProjectView` | Visão expandida de projeto com abas |
| `CircularProgress` | Indicador circular de progresso |
| `RequestButton` | Botão flutuante de novo pedido |
| `TabOverview` | Aba de visão geral do projeto |
| `TabKanban` | Aba de tarefas do projeto |
| `TabTimeline` | Aba de timeline do projeto |
| `TabDeliveries` | Aba de entregas/arquivos |
| `TabUpdates` | Aba de atualizações |

### Briefing (Diagnóstico Estratégico)

| Componente | Descrição |
|-----------|-----------|
| `WelcomeScreen` | Tela de boas-vindas com logo Aceleriq proeminente. Detecta progresso salvo e exibe "Continuar Diagnóstico →" |
| `QuestionScreen` | 15 perguntas sequenciais com barra de progresso, navegação por dots clicáveis para saltar entre perguntas, botão "Voltar", atalhos de teclado (Enter/Esc) e salvamento automático de progresso via `localStorage` |
| `CompletionScreen` | Tela de conclusão com timeline dos próximos passos |
| `questions.ts` | Definição das 15 perguntas do diagnóstico organizadas em 5 blocos |

### Briefing — Funcionalidades

| Feature | Descrição |
|---------|-----------|
| **Navegação por dots** | Barra de indicadores clicáveis no topo. Pergunta atual = pill verde, respondidas = verde suave, pendentes = cinza. Permite saltar para qualquer pergunta já respondida |
| **Auto-save (localStorage)** | Respostas e índice atual são salvos automaticamente no `localStorage` a cada alteração, vinculados ao token do briefing |
| **Restaurar progresso** | Ao reabrir o link, o WelcomeScreen detecta progresso salvo e exibe mensagem + botão "Continuar Diagnóstico →". O QuestionScreen retoma na última pergunta |
| **Salvar manual** | Botão "Salvar" no topo com feedback visual "Salvo ✓" |
| **Limpeza automática** | Progresso é removido do `localStorage` ao finalizar ou quando o briefing já foi enviado |
| **Navegação por teclado** | Enter = próxima, Esc = voltar |

### Onboarding

| Componente | Descrição |
|-----------|-----------|
| `OnboardingTour` | Tour guiado com highlight de elementos, tooltip e navegação |
| `HelpButton` | Botão (?) flutuante para reiniciar tour |
| `tourConfigs.ts` | Configuração de tours: admin (17 steps), client (12 steps), team (8 steps) + page-specific tours |

### UI (shadcn/ui)

Componentes base em `src/components/ui/`: accordion, alert, avatar, badge, button, calendar, card, carousel, chart, checkbox, command, dialog, drawer, dropdown-menu, form, input, label, popover, progress, scroll-area, select, separator, sheet, skeleton, slider, switch, table, tabs, textarea, toast, toggle, tooltip.

Componente customizado: `ConfirmModal` — modal de confirmação reutilizável.

---

## 10. Hooks Customizados

### `src/hooks/useSupabaseData.ts`

```ts
useProjects()       // Lista todos os projetos (com refetch para clientes a cada 15s)
useTasks(projectId?) // Lista tarefas (opcionalmente por projeto, refetch 15s)
useNotifications()   // Últimas 30 notificações do usuário (refetch 10s)
useUpdates()         // Últimas 10 atualizações (refetch 15s)
useClients()         // Lista clientes (apenas para admin/equipe)
useMilestones(projectId?) // Marcos de um projeto
useFiles(projectId?, clientId?) // Arquivos filtráveis (refetch 20s)
useAllFiles()        // Todos os arquivos
useProjectUpdates(projectId?) // Atualizações de um projeto
useClientRequests()  // Pedidos de clientes
useTeamMembers()     // Membros da equipe (roles não-client)
```

### `src/hooks/useFinancialData.ts`

Hook para dados financeiros: billing, ads_wallet, recharge_requests.

### `src/hooks/use-mobile.tsx`

Detecta viewport mobile via media query.

### `src/hooks/use-toast.ts`

Hook para sistema de toasts (shadcn).

---

## 11. Sistema de Webhooks (n8n)

### Arquivo: `src/lib/webhooks.ts`

```ts
const WEBHOOK_BASE = import.meta.env.VITE_WEBHOOK_URL || '';

export const webhooks = {
  onboardClient:     `${WEBHOOK_BASE}/onboard-client`,
  processDiagnostic: `${WEBHOOK_BASE}/process-diagnostic`,
  meetingToPlan:     `${WEBHOOK_BASE}/meeting-to-plan`,
  creativeApproval:  `${WEBHOOK_BASE}/creative-approval`,
  clientRequest:     `${WEBHOOK_BASE}/client-request`,
  adsRecharge:       `${WEBHOOK_BASE}/ads-recharge`,
};

export const fireWebhook = async (url: string, payload: any) => {
  if (!WEBHOOK_BASE) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('Webhook error:', err);
  }
};
```

### Pontos de Disparo

| Evento | Webhook | Payload |
|--------|---------|---------|
| Admin cria cliente | `onboardClient` | `{ client_id, name, email, company, phone, services, send_welcome_email }` |
| Cliente envia diagnóstico | `processDiagnostic` | `{ diagnostic_id, client_name, company, answers }` |
| Admin gera projeto via ata | `meetingToPlan` | `{ client_id, project_type, meeting_notes }` |
| Cliente aprova/rejeita arquivo | `creativeApproval` | `{ file_id, file_name, project_id, client_id, client_name, action, feedback }` |
| Cliente cria pedido | `clientRequest` | `{ request_id, client_id, client_name, company, title, description, priority }` |
| Admin solicita recarga de ads | `adsRecharge` | `{ client_id, client_name, client_email, amount, platform, transaction_id }` |

### Regras

- **Fire-and-forget**: nunca espera resposta
- **Fail-safe**: erro no webhook NÃO quebra a funcionalidade
- **Condicional**: se `VITE_WEBHOOK_URL` estiver vazio, nada dispara

---

## 12. Sistema de Notificações

### Arquivo: `src/lib/notifyHelpers.ts`

```ts
getAdminId()      // Busca UUID do admin via RPC get_admin_user_id()
notifyAdmin(message, type, link)   // Envia notificação ao admin
notifyUser(userId, message, type, link) // Envia notificação a qualquer usuário
```

### Componente: `NotificationsPanel`

Painel deslizante com lista de notificações, marcação de lidas e links de ação.

### Polling

Notificações são buscadas via React Query com `refetchInterval: 10000` (10 segundos).

---

## 13. Onboarding / Tour Guiado

### Persistência

Flag `onboarding_done` no campo `profiles.onboarding_done` (banco de dados). O tour só aparece uma vez, independente do dispositivo.

### Tours Disponíveis

| Tour | Steps | Público |
|------|-------|---------|
| Admin completo | 17 | Administradores |
| Client completo | 12 | Clientes |
| Team completo | 8 | Designers, tráfego, gerentes |
| Page-specific | Varia | Todos (via botão ?) |

### Page Tours

Tours específicos por página: Dashboard, Projetos, Kanban, Clientes, Relatórios, Aprovações, Pedidos, Financeiro, Equipe, Timeline, Arquivos.

Cada page tour tem variações por role (admin, client, team).

### Ativação

- **Automático**: primeiro login (quando `onboarding_done = false`)
- **Manual**: botão (?) no canto inferior direito → "Tour completo" ou "Tour desta página"

---

## 14. Storage (Arquivos)

### Buckets

| Bucket | Público | Uso |
|--------|---------|-----|
| `files` | Sim | Arquivos de projetos, criativos, documentos |
| `avatars` | Sim | Fotos de perfil |

### Upload

Arquivos são enviados para Supabase Storage e a URL é salva na tabela `files`.

---

## 15. Edge Functions

### `supabase/functions/manage-team/index.ts`

Função para gerenciamento de equipe (criar/remover membros). Executa com `SUPABASE_SERVICE_ROLE_KEY` para operações administrativas.

### `supabase/functions/check-renewals/index.ts`

Função para verificar renovações de planos de clientes e disparar notificações/alertas de vencimento.

### `supabase/functions/process-meeting-notes/index.ts`

Função para processar atas de reunião com IA e gerar planos de projeto automaticamente.

---

## 16. Variáveis de Ambiente

### Automáticas (Lovable Cloud)

```
VITE_SUPABASE_URL           # URL do projeto Supabase
VITE_SUPABASE_PUBLISHABLE_KEY  # Anon key
VITE_SUPABASE_PROJECT_ID    # ID do projeto
```

### Manuais

```
VITE_WEBHOOK_URL            # URL base do n8n (ex: https://n8n.seudominio.com/webhook)
```

### Secrets (Edge Functions)

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_URL
SUPABASE_PUBLISHABLE_KEY
LOVABLE_API_KEY
```

---

## 17. Dependências

### Produção

| Pacote | Versão | Uso |
|--------|--------|-----|
| `react` | ^18.3.1 | UI framework |
| `react-dom` | ^18.3.1 | React DOM |
| `react-router-dom` | ^6.30.1 | Roteamento SPA |
| `@supabase/supabase-js` | ^2.97.0 | Cliente Supabase |
| `@tanstack/react-query` | ^5.83.0 | Data fetching + cache |
| `tailwindcss-animate` | ^1.0.7 | Animações Tailwind |
| `class-variance-authority` | ^0.7.1 | Component variants |
| `clsx` | ^2.1.1 | Class merging |
| `tailwind-merge` | ^2.6.0 | Tailwind class dedup |
| `lucide-react` | ^0.462.0 | Ícones |
| `recharts` | ^2.15.4 | Gráficos |
| `sonner` | ^1.7.4 | Toasts |
| `date-fns` | ^3.6.0 | Formatação de datas |
| `zod` | ^3.25.76 | Validação de schemas |
| `react-hook-form` | ^7.61.1 | Formulários |
| `@hookform/resolvers` | ^3.10.0 | Resolvers de validação |
| `vaul` | ^0.9.9 | Drawer mobile |
| `cmdk` | ^1.1.1 | Command palette |
| `next-themes` | ^0.3.0 | Tema (dark mode) |
| `input-otp` | ^1.4.2 | Input OTP |
| `embla-carousel-react` | ^8.6.0 | Carousel |
| `react-resizable-panels` | ^2.1.9 | Painéis redimensionáveis |
| `react-day-picker` | ^8.10.1 | Calendário |
| Radix UI (14+ pacotes) | Various | Primitives (dialog, popover, select, etc.) |

---

## 18. Estrutura de Pastas

```
├── public/
│   ├── favicon.ico
│   ├── placeholder.svg
│   └── robots.txt
├── src/
│   ├── assets/                    # Imagens estáticas
│   │   ├── consultant-hero.jpg
│   │   ├── consultant-hero-flipped.jpg
│   │   ├── consultant-avatar.jpg
│   │   └── logo-aceleriq.png       # Logo oficial (usada em TopNav, Login, Loading, Briefing)
│   ├── components/
│   │   ├── admin/                 # Modais e drawers administrativos
│   │   │   ├── BriefingLinkModal.tsx
│   │   │   ├── CreateClientModal.tsx
│   │   │   ├── CreateProjectModal.tsx
│   │   │   ├── CreateTaskModal.tsx
│   │   │   ├── EditClientDrawer.tsx
│   │   │   ├── MeetingNotesModal.tsx
│   │   │   ├── MeetingToProjectModal.tsx
│   │   │   └── ProjectDrawer.tsx
│   │   ├── briefing/              # Sistema de diagnóstico
│   │   │   ├── BriefingPdfModal.tsx
│   │   │   ├── CompletionScreen.tsx
│   │   │   ├── QuestionScreen.tsx
│   │   │   ├── WelcomeScreen.tsx
│   │   │   └── questions.ts
│   │   ├── client/                # Componentes do portal do cliente
│   │   │   ├── CircularProgress.tsx
│   │   │   ├── ProjectCanvas.tsx
│   │   │   ├── ProjectView.tsx
│   │   │   ├── RequestButton.tsx
│   │   │   └── tabs/
│   │   │       ├── TabDeliveries.tsx
│   │   │       ├── TabKanban.tsx
│   │   │       ├── TabOverview.tsx
│   │   │       ├── TabTimeline.tsx
│   │   │       └── TabUpdates.tsx
│   │   ├── onboarding/            # Tour guiado
│   │   │   ├── HelpButton.tsx
│   │   │   ├── OnboardingTour.tsx
│   │   │   └── tourConfigs.ts
│   │   ├── ui/                    # shadcn/ui components (40+)
│   │   ├── AppLayout.tsx          # Layout principal
│   │   ├── NavLink.tsx
│   │   └── NotificationsPanel.tsx
│   ├── contexts/
│   │   └── AuthContext.tsx         # Contexto de autenticação
│   ├── hooks/
│   │   ├── use-mobile.tsx
│   │   ├── use-toast.ts
│   │   ├── useFinancialData.ts
│   │   └── useSupabaseData.ts     # Hooks de dados (React Query)
│   ├── integrations/supabase/
│   │   ├── client.ts              # Cliente Supabase (auto-gerado)
│   │   └── types.ts               # Types do DB (auto-gerado)
│   ├── lib/
│   │   ├── notifyHelpers.ts       # Helpers de notificação
│   │   ├── utils.ts               # cn() utility
│   │   └── webhooks.ts            # Sistema de webhooks
│   ├── pages/                     # 22 páginas
│   │   ├── AdminApprovals.tsx
│   │   ├── AdminBriefings.tsx
│   │   ├── AdminDashboard.tsx
│   │   ├── AdminFiles.tsx
│   │   ├── AdminFinanceiro.tsx
│   │   ├── AdminReportCreate.tsx
│   │   ├── AdminReports.tsx
│   │   ├── AdminRequests.tsx
│   │   ├── BriefingPublic.tsx
│   │   ├── ClientApprovals.tsx
│   │   ├── ClientDashboard.tsx
│   │   ├── ClientDocuments.tsx
│   │   ├── ClientFinanceiro.tsx
│   │   ├── ClientReports.tsx
│   │   ├── ClientRequests.tsx
│   │   ├── Clients.tsx
│   │   ├── Index.tsx
│   │   ├── Kanban.tsx
│   │   ├── Login.tsx
│   │   ├── NotFound.tsx
│   │   ├── ProfilePage.tsx
│   │   ├── Projects.tsx
│   │   ├── ReportDetail.tsx
│   │   ├── SeedPage.tsx
│   │   ├── SettingsPage.tsx
│   │   ├── Team.tsx
│   │   └── TimelinePage.tsx
│   ├── styles/
│   │   └── responsive.css
│   ├── App.css
│   ├── App.tsx                    # Rotas e providers
│   ├── index.css                  # Design tokens
│   ├── main.tsx                   # Entry point
│   └── vite-env.d.ts
├── supabase/
│   ├── config.toml                # Config Supabase
│   ├── functions/
│   │   ├── check-renewals/
│   │   │   └── index.ts           # Edge function de renovações
│   │   ├── manage-team/
│   │   │   └── index.ts           # Edge function de equipe
│   │   └── process-meeting-notes/
│   │       └── index.ts           # Edge function de atas de reunião
│   └── migrations/                # Migrações SQL
├── .env                           # Variáveis de ambiente (auto-gerado)
├── components.json                # Config shadcn/ui
├── tailwind.config.ts             # Config Tailwind
├── vite.config.ts                 # Config Vite
├── tsconfig.json                  # Config TypeScript
└── vitest.config.ts               # Config testes
```

---

## Diagrama de Relacionamento (ER Simplificado)

```
auth.users (1) ←→ (1) profiles
profiles   (1) ←→ (N) user_roles
profiles   (1) ←→ (N) projects       [client_id]
profiles   (1) ←→ (N) projects       [created_by]
projects   (1) ←→ (N) tasks
projects   (1) ←→ (N) milestones
projects   (1) ←→ (N) files
projects   (1) ←→ (N) updates
projects   (1) ←→ (N) client_requests
projects   (1) ←→ (N) reports
profiles   (1) ←→ (N) notifications
profiles   (1) ←→ (N) billing
profiles   (1) ←→ (N) ads_wallet
profiles   (1) ←→ (N) recharge_requests
profiles   (1) ←→ (N) briefings
files      (1) ←→ (N) files          [parent_file_id] (versionamento)
```

---

*Documentação gerada automaticamente em 25/02/2026 — Aceleriq Performance OS*
