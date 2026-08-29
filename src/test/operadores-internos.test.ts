import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A camada de Operadores internos (Hermes): Vértice, Registro, Prisma e
 * Augusto como cidadãos do painel, sem fingir que são gente.
 *
 * Cada regra abaixo veio literal do pedido do dono, e cada uma quebraria
 * em silêncio num refactor: operador sem e-mail/senha, responsável humano
 * intocável, feito só com evidência, auditoria imutável, trava de
 * execução simultânea, notificação só de exceção, flag com rollback.
 */

const raiz = resolve(__dirname, "../..");
const migracao = readFileSync(
  resolve(raiz, "supabase/migrations/20260827200000_operadores_internos.sql"), "utf8",
);
const servicos = readFileSync(
  resolve(raiz, "supabase/functions/_shared/aceleriq-operators-services.ts"), "utf8",
);
const ferramentas = readFileSync(
  resolve(raiz, "supabase/functions/_shared/mcp-tools.ts"), "utf8",
);
const pagina = readFileSync(resolve(raiz, "src/pages/AdminExecucao.tsx"), "utf8");
const organograma = readFileSync(
  resolve(raiz, "src/components/execucao/OrganogramaAgentes.tsx"), "utf8",
);

describe("operador interno e outra entidade, nao gente ficticia", () => {
  it("a tabela nao tem e-mail, senha nem cliente atribuido", () => {
    const bloco = migracao.slice(
      migracao.indexOf("create table if not exists public.internal_operators"),
      migracao.indexOf("alter table public.internal_operators"),
    );
    expect(bloco).not.toMatch(/email|password|senha|client_id/);
    // E tem o que o pedido listou.
    for (const campo of ["slug", "display_name", "role", "status", "scope", "permissions", "hermes_profile_ref", "created_at", "last_run_at"]) {
      expect(bloco, `campo ${campo} ausente`).toContain(campo);
    }
  });

  it("os quatro do piloto nascem na migration, idempotentes", () => {
    for (const slug of ["'vertice'", "'registro'", "'prisma'", "'augusto'"]) {
      expect(migracao).toContain(slug);
    }
    expect(migracao).toContain("on conflict (slug) do nothing");
    // Augusto e o coordenador.
    const augusto = migracao.slice(migracao.indexOf("('augusto'"));
    expect(augusto.slice(0, 220)).toContain("true");
  });

  it("o responsavel humano e intocavel: nada escreve em assigned_to", () => {
    // A regra mais importante do pedido. Nenhuma peca da camada pode
    // escrever assigned_to — nem migration, nem servico, nem RPC.
    expect(migracao).not.toMatch(/update\s+public\.tasks|set\s+assigned_to/i);
    // O servico LE assigned_to para mostrar o humano; escrever em tasks,
    // jamais: o unico uso de from('tasks') e um select.
    const usosDeTasks = servicos.match(/from\('tasks'\)[\s\r\n]*\.(\w+)/g) ?? [];
    expect(usosDeTasks.length).toBeGreaterThan(0);
    for (const uso of usosDeTasks) expect(uso).toContain(".select");
    // A leitura MOSTRA o humano (e o que mantem ele no centro), so nao muda.
    expect(servicos).toContain("responsavel_humano");
  });
});

describe("execucao com trava, idempotencia e retomada", () => {
  it("duas execucoes simultaneas da mesma tarefa colidem", () => {
    expect(migracao).toContain("operator_task_links_uma_ativa");
    expect(migracao).toContain("operator_runs_uma_viva");
    // E o servico traduz a colisao em instrucao, nao em susto.
    expect(servicos).toContain("ja tem uma execucao EM ANDAMENTO");
  });

  it("idempotencia por execucao: (operador, run_key) e unico", () => {
    expect(migracao).toContain("unique (operator_id, run_key)");
    expect(migracao).toContain("on conflict (operator_id, run_key) do update");
  });

  it("run sem heartbeat vira timeout visivel e libera a trava", () => {
    expect(migracao).toContain("operator_expire_stale_runs");
    expect(migracao).toContain("make_interval(secs => r.timeout_seconds)");
    // A leitura do quadro expira antes de listar: deteccao sem cron novo.
    expect(servicos).toContain("rpc('operator_expire_stale_runs')");
    expect(pagina).toContain('rpc("operator_expire_stale_runs")');
  });

  it("nao se promete zero falha: incidentes e ultima falha sao visiveis", () => {
    expect(servicos).toContain("incidentes");
    expect(servicos).toContain("ultima_falha");
    expect(pagina).toContain("incidente(s) de execução");
  });
});

describe("feito de verdade tem evidencia", () => {
  it("done sem evidencia e rebaixado para review no banco", () => {
    expect(migracao).toContain("then 'review' else 'done'");
  });

  it("o relatorio separa feito, revisao, aguardando e bloqueado", () => {
    expect(pagina).toContain("Feito COM evidencia");
    expect(pagina).toContain("inclui feito sem evidencia");
    expect(pagina).toContain("Aguardando insumo");
    expect(pagina).toContain("Bloqueado");
  });

  it("evidencia nunca carrega credencial", () => {
    // URL assinada perde a query string na gravacao.
    expect(migracao).toContain("query removida: continha credencial");
    expect(migracao).toMatch(/token\|signature\|x-amz/);
  });
});

describe("auditoria imutavel", () => {
  it("update e delete sao recusados por trigger, para qualquer um", () => {
    expect(migracao).toContain("operator_audit_imutavel");
    expect(migracao).toContain("before update or delete on public.operator_audit_log");
    expect(migracao).toContain("e imutavel");
  });

  it("registra quem, qual operador, qual tarefa, acao, antes/depois, cron e aprovacao", () => {
    const bloco = migracao.slice(
      migracao.indexOf("create table if not exists public.operator_audit_log"),
      migracao.indexOf("alter table public.operator_audit_log"),
    );
    for (const campo of ["actor", "operator_id", "kanban_task_id", "action", "old_status", "new_status", "evidence", "from_cron", "approval_required", "run_key"]) {
      expect(bloco, `auditoria sem ${campo}`).toContain(campo);
    }
  });
});

describe("notificacao, como nasceu", () => {
  // A regra de origem era excecao apenas. O dono depois pediu o oposto —
  // "eu preciso saber de tudo" — e a migration 20260828010000 abriu para
  // todo evento menos heartbeat. Este bloco guarda o ponto de partida:
  // se alguem reescrever a migration ANTIGA, a historia muda por baixo.
  it("a versao original avisava so em marcos e excecoes", () => {
    expect(migracao).toContain(
      "_notifica := _event in ('started', 'done', 'failed', 'blocked', 'review')",
    );
    expect(migracao).toContain("or _approval_required");
  });

  it("a notificacao abre direto o vinculo na area de execucao", () => {
    expect(migracao).toContain("'/execucao?vinculo='");
    // E a pagina rola ate ele e destaca.
    expect(pagina).toContain('searchParams.get("vinculo")');
    expect(pagina).toContain("scrollIntoView");
  });
});

describe("flag com rollback documentado", () => {
  it("a flag existe, o RPC respeita e a pagina tambem", () => {
    expect(migracao).toContain("'operators_layer'");
    expect(migracao).toContain("flag_off: a camada de operadores esta desligada");
    expect(pagina).toContain('flag === "off"');
    expect(pagina).toContain("Nada foi apagado");
  });

  it("o rollback esta escrito na propria migration", () => {
    expect(migracao).toMatch(/ROLLBACK[\s\r\n-]*DOCUMENTADO/);
    expect(migracao).toContain("enabled = false");
  });

  it("a migration nao apaga nem sobrescreve nada existente", () => {
    expect(migracao).not.toMatch(/\bdrop\s+table\b/i);
    expect(migracao).not.toMatch(/\btruncate\b/i);
    // Os unicos UPDATE/DELETE tocam as tabelas NOVAS da propria camada.
    const escritas = migracao.match(/(?:update|delete from)\s+public\.(\w+)/gi) ?? [];
    for (const w of escritas) {
      expect(w, `escrita fora da camada: ${w}`).toMatch(
        /internal_operators|operator_task_links|operator_runs|operator_audit_log|feature_flags/,
      );
    }
  });
});

describe("o MCP expoe exatamente duas capacidades", () => {
  it("relatar e ler o quadro; nada de acao externa", () => {
    expect(ferramentas).toContain("'aceleriq_operator_report'");
    expect(ferramentas).toContain("'aceleriq_operator_board'");
    // A descricao avisa o agente do que NAO acontece por ali.
    expect(ferramentas).toContain("NAO atribui tarefa a humano");
    expect(ferramentas).toContain("NAO publica, NAO gasta, NAO altera financeiro");
  });

  it("o elenco NAO e fixo: nada de enum travando os quatro do piloto", () => {
    // A primeira versao cravou Vertice/Registro/Prisma/Augusto num enum, e
    // cada operador novo exigiria deploy. Quem valida agora e o banco.
    expect(ferramentas).not.toContain("z.enum(['vertice', 'registro', 'prisma', 'augusto'])");
    expect(ferramentas).toContain("'aceleriq_operator_register'");
  });

  it("slug desconhecido e ERRO, nunca criacao silenciosa", () => {
    // A trava que importa: se reportar com slug qualquer criasse operador,
    // "vertise" viraria um operador fantasma em vez de erro — a mesma
    // armadilha do uuid transposto. Criar e ato EXPLICITO.
    expect(migracao).toContain("operator_not_found");
    const servicoRegistro = servicos.slice(servicos.indexOf("export async function operatorRegister"));
    expect(servicoRegistro).toContain("insert({");
    // E o report nao insere operador em lugar nenhum.
    const servicoReport = servicos.slice(
      servicos.indexOf("export async function operatorReport"),
      servicos.indexOf("export async function operatorBoard"),
    );
    expect(servicoReport).not.toContain("internal_operators");
  });

  it("cadastrar duas vezes devolve o existente, e ha teto contra laco em fuga", () => {
    expect(servicos).toContain("ja_existia: true");
    expect(servicos).toContain("MAXIMO_DE_OPERADORES");
  });

  it("o nascimento do operador entra na trilha imutavel", () => {
    expect(servicos).toContain("operador registrado:");
    expect(servicos).toContain("operator_audit_log");
  });
});

describe("o trabalho do operador conta no progresso do cliente", () => {
  const progresso = readFileSync(
    resolve(raiz, "supabase/migrations/20260828000000_operador_conta_no_progresso.sql"), "utf8",
  );

  it("entrega concluida COM evidencia entra na historia do cliente", () => {
    // project_memory e o que o Ciclo, a Central e o Dossie ja leem. Sem
    // esta ponte, o agente entregava e o trabalho ficava numa ilha.
    expect(progresso).toContain("insert into public.project_memory");
    expect(progresso).toContain("'entrega'");
    expect(progresso).toContain("'operador'");
  });

  it("SO o done com evidencia: os outros eventos nao viram linha", () => {
    // Se cada passo virasse registro, a historia do cliente viraria log
    // de maquina e ninguem leria.
    const bloco = progresso.slice(
      progresso.indexOf("A ponte com o progresso do cliente"),
      progresso.indexOf("_notifica :="),
    );
    expect(bloco).toContain("if _status_novo = 'done' and _kanban_task_id is not null then");
    expect(bloco).not.toContain("'started'");
    expect(bloco).not.toContain("'progress'");
  });

  it("o cliente sai pelo PROJETO: tasks nao tem client_id", () => {
    expect(progresso).toContain("join public.projects pj on pj.id = t.project_id");
  });

  it("reportar done duas vezes nao duplica a linha", () => {
    expect(progresso).toContain("metadata->>'run_key' = _run_key");
    expect(progresso).toContain("if _memoria_id is null then");
  });

  it("o registro e interno: o cliente nao le 'operador Vertice'", () => {
    expect(progresso).toContain("'client_visible', false");
  });

  it("o agente fica sabendo que a entrega contou", () => {
    expect(progresso).toContain("'registrado_no_progresso'");
  });
});

describe("hierarquia por funcao, organizada pelo Hermes", () => {
  const hier = readFileSync(
    resolve(raiz, "supabase/migrations/20260828010000_hierarquia_e_notificacao_de_tudo.sql"), "utf8",
  );

  it("area, chefe e ordem viram coluna: agente novo nao pede deploy", () => {
    expect(hier).toContain("add column if not exists area text");
    expect(hier).toContain("add column if not exists parent_slug text");
    expect(hier).toContain("add column if not exists display_order integer");
  });

  it("quem ja existe nasce com area, e a area vem do papel gravado", () => {
    // Sem isto o organograma estrearia com todo mundo em "Sem area".
    expect(hier).toContain("set area = coalesce(area, nullif(trim(role), ''), 'Operacao')");
  });

  it("o Hermes edita o organograma, mas o slug e intocavel", () => {
    expect(hier).toContain("create or replace function public.operator_update");
    const corpo = hier.slice(hier.indexOf("update public.internal_operators set"));
    expect(corpo).not.toMatch(/^\s*slug\s*=/m);
  });

  it("ciclo no organograma e barrado antes de virar recursao no painel", () => {
    expect(hier).toContain("um agente nao pode coordenar a si mesmo");
    expect(hier).toContain("direta ou indiretamente");
    expect(hier).toContain("_saltos < 40");
  });

  it("o painel agrupa a base por funcao e le a ordem do banco", () => {
    expect(organograma).toContain('o.area?.trim() || "Sem área definida"');
    expect(pagina).toContain('.order("display_order", { ascending: true })');
  });

  it("o chefe aparece pelo nome, nao pelo slug", () => {
    expect(pagina).toContain("operadores.find((p) => p.slug === o.parent_slug)?.display_name");
  });
});

describe("o dono sabe de tudo", () => {
  const hier = readFileSync(
    resolve(raiz, "supabase/migrations/20260828010000_hierarquia_e_notificacao_de_tudo.sql"), "utf8",
  );

  it("todo passo notifica: nao e mais so excecao", () => {
    expect(hier).toContain("_notifica := _event <> 'heartbeat'");
  });

  it("heartbeat continua fora, e o motivo esta escrito", () => {
    // Pulso de cron de minuto em minuto transformaria o sino em
    // metronomo, e um sino que toca sempre para de ser lido.
    expect(hier).toContain("Heartbeat e o");
    expect(hier).toContain("metronomo");
  });

  it("o que esta pronto para o cliente sai marcado, e so com evidencia", () => {
    expect(hier).toContain("PRONTO PARA O CLIENTE");
    expect(hier).toContain("'operator_pronto'");
    expect(hier).toContain("'pronto_para_cliente', _pronto_cliente");
    // A marca so nasce dentro do ramo de done com cliente resolvido.
    const ramo = hier.slice(hier.indexOf("if _client_id is not null then"));
    expect(ramo.indexOf("_pronto_cliente := true;")).toBeGreaterThan(-1);
  });

  it("o aviso diz QUAL tarefa e de QUAL cliente", () => {
    expect(hier).toContain("nullif(trim(_titulo_tarefa), '')");
    expect(hier).toContain("coalesce(' · ' || _nome_cliente, '')");
  });
});

describe("Estudio: rascunho sim, publicar nao", () => {
  const bloco = servicos.slice(servicos.indexOf("export async function studioDraft"));

  it("documento publicado recusa escrita, porque escrever nele e publicar", () => {
    // published = true faz o painel do cliente ler `notes` em tempo real
    // (canal realtime em TabDocument). Editar ali nao e editar: e publicar
    // ao vivo na tela de quem paga.
    expect(bloco).toContain("documento_publicado:");
    expect(bloco).toContain("le em tempo real");
  });

  it("published nunca entra no payload, nem para true nem para false", () => {
    // Despublicar tambem seria efeito externo: sumir com o documento da
    // tela do cliente.
    const payload = bloco.slice(bloco.indexOf("const campos"), bloco.indexOf(".upsert("));
    expect(payload).not.toMatch(/campos\.published|published\s*[:=]/);
    expect(bloco).toContain("nao pode\n  // criar um documento ja publicado");
  });

  it("a leitura avisa em qual dos dois estados o documento esta", () => {
    const leitura = servicos.slice(
      servicos.indexOf("export async function studioRead"),
      servicos.indexOf("export async function studioDraft"),
    );
    expect(leitura).toContain("Rascunho: o cliente nao ve");
    expect(leitura).toContain("continua sendo gesto humano");
  });

  it("o catalogo tem leitura e rascunho, e nenhuma ferramenta de publicar", () => {
    expect(ferramentas).toContain("'aceleriq_studio_read'");
    expect(ferramentas).toContain("'aceleriq_studio_draft'");
    expect(ferramentas).not.toContain("aceleriq_studio_publish");
  });
});

describe("consolidado para o segundo cerebro", () => {
  const inicioDigest = servicos.indexOf("export async function operatorDigest");
  const bloco = servicos.slice(inicioDigest);

  it("sai agrupado por area e por agente, com evidencia", () => {
    expect(bloco).toContain("por_area");
    expect(bloco).toContain("evidencias");
    expect(bloco).toContain("entregas_concluidas");
  });

  it("evidencia repetida nao entra, e vazia tambem nao", () => {
    expect(bloco).toContain("!linha.evidencias.includes(ev)");
  });

  it("diz quando a leitura bateu no teto, em vez de fingir que e tudo", () => {
    // Um consolidado truncado que se apresenta como completo e uma
    // mentira educada.
    expect(bloco).toContain("trilha_completa");
    expect(bloco).toContain("eventos.length < READ_LIMITS.maxPageSize");
  });

  it("agente parado aparece, senao some do relatorio quem nao trabalhou", () => {
    expect(bloco).toContain("agentes_sem_movimento");
  });
});

describe("navegacao: o agente sabe onde as coisas ficam", () => {
  it("o mapa do painel vai junto do catalogo", () => {
    expect(ferramentas).toContain("MAPA_DO_PAINEL");
    expect(ferramentas).toContain("mapa_do_painel: MAPA_DO_PAINEL");
  });

  it("cada area diz rota, para que serve e por onde o MCP chega", () => {
    const mapa = ferramentas.slice(
      ferramentas.indexOf("const MAPA_DO_PAINEL"),
      ferramentas.indexOf("] as const;", ferramentas.indexOf("const MAPA_DO_PAINEL")),
    );
    const linhas = mapa.match(/\{ area: /g) ?? [];
    expect(linhas.length).toBeGreaterThanOrEqual(12);
    for (const campo of ["rota:", "para:", "pelo_mcp:"]) {
      expect(mapa.split(campo).length - 1).toBe(linhas.length);
    }
    // O cofre entra no mapa com o aviso colado, nao solto.
    expect(mapa).toContain("SEM senhas");
  });
});

describe("o catalogo do MCP compila", () => {
  it("toda ferramenta usa um construtor que existe de verdade", () => {
    // Escrevi `makeWrite(...)` uma vez achando que existia. O `npm run
    // typecheck` nao pega: as edge functions sao Deno e ficam fora do
    // tsconfig. So o deploy quebraria — depois de o dono ja ter colado o
    // SQL e publicado. Esta checagem custa milissegundos e fecha a porta.
    const usados = new Set(
      [...ferramentas.matchAll(/=\s*(make[A-Z]\w*)\(/g)].map((m) => m[1]),
    );
    expect(usados.size).toBeGreaterThan(0);
    for (const nome of usados) {
      expect(ferramentas, `${nome} e usado mas nao existe`)
        .toMatch(new RegExp(`(function|const)\\s+${nome}\\b`));
    }
  });
});

describe("cofre: ver sim, senha nao", () => {
  it("a senha nao entra no select — ausencia na origem, nao filtro depois", () => {
    // Filtrar depois deixaria um caminho em que a senha escapa. Aqui ela
    // simplesmente nao e buscada.
    const inicio = servicos.indexOf("export async function vaultOverview");
    const bloco = servicos.slice(inicio, servicos.indexOf("export async function", inicio + 30));
    expect(bloco).toContain("id, title, category, url, username, notes");
    expect(bloco).not.toMatch(/select\([^)]*password/);
  });

  it("o agente sabe que a senha existe, e por que nao a recebe", () => {
    expect(servicos).toContain("tem_senha_guardada: true");
    expect(servicos).toContain("NAO retornadas por construcao");
    expect(servicos).toContain("o estrago nao se desfaz");
  });

  it("nao existe escrita nem exclusao de cofre no catalogo", () => {
    expect(ferramentas).toContain("'aceleriq_vault_overview'");
    expect(ferramentas).not.toContain("aceleriq_vault_update");
    expect(ferramentas).not.toContain("aceleriq_vault_delete");
    const inicio = servicos.indexOf("export async function vaultOverview");
    const bloco = servicos.slice(inicio, servicos.indexOf("export async function", inicio + 30));
    expect(bloco).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});

describe("a area Execucao da equipe", () => {
  it("tem as oito visoes do pedido", () => {
    for (const visao of [
      "Fila por operador", "Em andamento", "Concluídas com evidência", "Em revisão",
      "Aguardando insumo", "Bloqueadas", "Aprovações pendentes", "Relatórios",
    ]) {
      expect(pagina, `visao ${visao} ausente`).toContain(visao);
    }
  });

  it("cada item mostra os campos do pedido", () => {
    for (const trecho of [
      "responsavel_humano", // no servico
    ]) {
      expect(servicos).toContain(trecho);
    }
    for (const trecho of ["humano:", "evidência:", "próximo passo:", "bloqueio:", "aprovação necessária", "prazo"]) {
      expect(pagina, `campo ${trecho} ausente no cartao`).toContain(trecho);
    }
  });

  it("e da equipe, atras de RBAC e da flag", () => {
    expect(pagina).toContain('["admin", "manager", "design", "traffic"]');
    const app = readFileSync(resolve(raiz, "src/App.tsx"), "utf8");
    expect(app).toContain('path="/execucao"');
    expect(app).toMatch(/execucao.*StaffRoute/);
  });

  it("a tela responde COM NUMEROS, nao so com listas", () => {
    // "Nada em execucao" e verdade que nao ajuda. O placar diz quanto ha
    // em cada estado, e a ponte com o Kanban diz quantas esperam alguem.
    expect(pagina).toContain("Prazo estourado");
    expect(pagina).toContain("tarefas abertas no Kanban");
    expect(pagina).toContain("ainda sem");
    expect(pagina).toContain("numerosDoOperador");
    expect(pagina).toContain("Esperando um operador");
  });

  it("o vazio ensina: mostra as tarefas reais e um jeito de despachar", () => {
    // A ancora mudou porque a tela mudou para melhor: antes o botao
    // copiava o UUID para alguem colar no grupo; agora encaminha de
    // verdade. A REGRA continua a mesma — o vazio nao pode ser so um
    // vazio, tem que mostrar o trabalho real que esta esperando alguem.
    expect(pagina).toContain("semOperador");
    expect(pagina).toContain("Esperando um operador");
    expect(pagina).toContain("Colocar esta tarefa na fila de um agente");
  });

  it("nao-consegui-ler nao e mais confundido com desligada", () => {
    // A tela chegou a anunciar "desligada" quando so nao tinha conseguido
    // ler a flag. Mensagem errada com ar de certeza manda consertar o que
    // nao esta quebrado.
    expect(pagina).toContain('flag === "erro"');
    expect(pagina).toContain("Não consegui ler a configuração desta área");
    expect(pagina).toContain('flag === "off"');
  });

  it("o quadro do MCP ensina o agente e aponta tarefa real", () => {
    // O Hermes le o quadro e precisa saber o que fazer com ele sem
    // depender de alguem ter colado as regras num prompt.
    expect(servicos).toContain("como_usar");
    expect(servicos).toContain("Nunca invente id");
    expect(servicos).toContain("tarefas_disponiveis");
    expect(servicos).toContain("resumo");
    // E os limites viajam junto do manual.
    expect(servicos).toContain("NAO estao neste catalogo");
  });

  it("o quadro tem colunas com rolagem PROPRIA", () => {
    // Sem rolagem por coluna, uma coluna cheia empurra a pagina e as
    // outras somem de vista — o quadro deixa de ser quadro.
    expect(pagina).toContain('visao === "quadro"');
    expect(pagina).toContain("max-h-[62vh] space-y-1.5 overflow-y-auto");
    expect(pagina).toContain("overflow-x-auto");
  });

  it("a mao humana move o quadro pelo RPC, e entra na MESMA trilha", () => {
    // Update solto na tabela deixaria a acao humana fora da auditoria
    // justamente nos casos que mais importam.
    expect(pagina).toContain('rpc("operator_human_action"');
    expect(pagina).not.toMatch(/from\("operator_task_links"\)[\s\S]{0,80}\.update\(/);
    const humana = readFileSync(
      resolve(raiz, "supabase/migrations/20260827230000_operador_acao_humana.sql"), "utf8",
    );
    expect(humana).toContain("insert into public.operator_audit_log");
    expect(humana).toContain("(humano)");
    // A regua da evidencia vale para quem clica tambem.
    expect(humana).toContain("_new_status = 'done' and coalesce(trim(_link.last_evidence)");
    // E so a equipe move.
    expect(humana).toContain("not_allowed: somente a equipe move o quadro");
  });

  it("entrar no agente mostra progresso, historico e o que melhorar", () => {
    const perfil = readFileSync(
      resolve(raiz, "src/components/execucao/PerfilDoAgente.tsx"), "utf8",
    );
    expect(perfil).toContain("Tudo o que ele fez");
    expect(perfil).toContain("O que melhorar");
    expect(perfil).toContain("operator_audit_log");
    // Conselho sai de numero, nao de opiniao.
    expect(perfil).toContain("numeros.semEvidencia > 0");
    expect(perfil).toContain("numeros.falhas > 0");
    // Taxa sem conclusao nenhuma nao inventa desempenho.
    expect(perfil).toContain("feitas.length ? Math.round");
  });

  it("a hierarquia poe o dono no topo e nao promete disparo que nao existe", () => {
    expect(organograma).toContain('nivel: "dono"');
    expect(organograma).toContain("Hermes");
    expect(organograma).toContain("Hierarquia da operação");
    // A honestidade do botao: o painel nao dispara o agente sozinho.
    expect(organograma).toContain("O painel não dispara o agente sozinho");
    expect(organograma).toContain("copiar o comando de acionamento");
  });

  it("atualizar recarrega TUDO, nao metade da tela", () => {
    const bloco = pagina.slice(pagina.indexOf("const atualizarTudo"), pagina.indexOf("const moverVinculo"));
    for (const chave of [
      "operador-vinculos", "operador-runs", "operadores-internos",
      "operador-tarefas-disponiveis", "agente-runs", "agente-trilha",
    ]) {
      expect(bloco, `atualizar esquece ${chave}`).toContain(chave);
    }
  });

  it("os relatorios saem dos MESMOS dados da tela", () => {
    // Gerados de vinculos+runs+tarefas ja carregados; nenhuma consulta
    // propria de relatorio que pudesse divergir do quadro.
    const bloco = pagina.slice(pagina.indexOf("const relatorio = useMemo"), pagina.indexOf("const copiar"));
    expect(bloco).toContain("vinculos.filter");
    expect(bloco).toContain("incidentes");
    expect(bloco).not.toContain("supabase");
  });
});

describe("no telefone, as opcoes correm para o lado", () => {
  it("a faixa rola em vez de empilhar, e volta a quebrar no desktop", () => {
    // Dez visoes em flex-wrap viravam quatro fileiras num aparelho de
    // 375px e comiam a tela antes do conteudo comecar. Medido na bancada:
    // 1 fileira e 44px de altura no telefone, 2 fileiras e 70px no
    // desktop, sem estourar a pagina em nenhum dos dois.
    expect(pagina).toContain("overflow-x-auto");
    expect(pagina).toContain("scrollbar-hidden");
    expect(pagina).toContain("md:flex-wrap");
    expect(pagina).toContain("md:overflow-visible");
  });

  it("cada aba mostra quantos itens tem, senao arrastar e as cegas", () => {
    expect(pagina).toContain("const contagemDaVisao");
    expect(pagina).toContain("contagemDaVisao[x.id]");
    // Relatorios nao e lista de vinculos: numero ali seria invencao.
    expect(pagina).toContain("relatorios: 0");
  });

  it("a aba escolhida por notificacao e trazida para a tela", () => {
    // Sem isso, tocar no aviso mudava uma visao que estava fora da faixa
    // e parecia que nada tinha acontecido.
    expect(pagina).toContain('abasRef.current[visao]?.scrollIntoView');
    expect(pagina).toContain('inline: "center"');
  });
});

describe("a hierarquia se le como estrutura, nao como grade", () => {
  it("os niveis se ligam por tronco, senao e so cartao solto com titulo", () => {
    expect(organograma).toContain("const Tronco");
    // Cor SOLIDA. O tronco era um gradiente que terminava em border/40 e,
    // num tema de fundo 5%, sumia no meio do caminho: a linha aparecia
    // cortada, que e pior do que nao ter linha.
    expect(organograma).toContain('"mx-auto w-px bg-border"');
  });

  it("cada grupo de funcao e uma caixa solida com nome, contagem e acento", () => {
    expect(organograma).toContain("rounded-xl border border-border bg-secondary");
    expect(organograma).toContain("acentoDaArea");
  });

  it("nenhuma superficie grande usa fundo translucido", () => {
    // A queixa foi literal: "sem ficar transparente no escuro". Este tema
    // e escuro-primeiro (fundo 5%, cartao 10%, muted 13%), entao um
    // bg-muted/20 vira 13% a um quinto de opacidade sobre 5% e some. A
    // hierarquia visual aqui se faz por DEGRAU de superficie solida.
    // Translucido so onde e enfeite pequeno sobre superficie solida:
    // selo, monograma, barra de acento.
    // Sem os comentarios: a explicacao acima CITA a classe proibida, e uma
    // busca ingenua casaria com o proprio aviso. Ja cai nessa hoje, numa
    // conferencia de SQL que deu "bug ainda existe" por causa de um
    // comentario meu. Codigo se audita sobre o codigo.
    const semComentario = (t: string) =>
      t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const grandes = semComentario(organograma)
      .match(/bg-(card|secondary|muted|background)\/(\[?[0-9.]+\]?)/g) ?? [];
    expect(grandes, `superficie translucida: ${grandes.join(", ")}`).toHaveLength(0);
    expect(semComentario(pagina).match(/bg-\w+\/\[0\.0[0-9]\]/g) ?? []).toHaveLength(0);
  });

  it("a cor de cada area e estavel, nao muda quando entra agente novo", () => {
    // Cor por posicao na lista dancaria a cada cadastro e destreinaria o
    // olho de quem usa todo dia. A chave e o NOME da area.
    expect(organograma).toContain("area.charCodeAt(i)");
  });

  it("o cabecalho resume o time em numeros", () => {
    expect(organograma).toContain("const ativos =");
    expect(organograma).toContain("const trabalhando =");
    expect(organograma).toContain("em andamento");
  });

  it("o cartao tem rosto, e as iniciais aguentam nome de uma palavra so", () => {
    expect(organograma).toContain("function iniciais");
    expect(organograma).toContain("partes.length === 1");
  });

  it("numero zerado nao vira selo: so aparece o que existe", () => {
    expect(organograma).toContain("].filter((n) => n.valor > 0)");
  });
});

describe("o despachante: alguem entrega a tarefa ao agente", () => {
  const fila = readFileSync(
    resolve(raiz, "supabase/migrations/20260828020000_fila_do_operador.sql"), "utf8",
  );

  it("existe um caminho para OFERECER tarefa, fora do proprio relato", () => {
    // A causa do quadro zerado: ate aqui so operator_report_event criava
    // vinculo, entao o agente precisava ja saber o UUID da tarefa.
    expect(fila).toContain("create or replace function public.operator_assign_task");
    expect(fila).toContain("'queued'");
    expect(fila).toContain("'painel'");
  });

  it("oferecer trabalho ao agente NAO tira a tarefa do humano", () => {
    // A regra mais importante da camada, valendo tambem no despacho.
    expect(fila).not.toMatch(/update\s+public\.tasks|set\s+assigned_to/i);
    // E a resposta devolve o humano intocado, como prova de quem chamou.
    expect(fila).toContain("responsavel_humano_intocado");
  });

  it("tarefa inexistente e recusada, em vez de virar fila fantasma", () => {
    expect(fila).toContain("task_not_found:");
  });

  it("dois agentes na mesma tarefa e recusado, dizendo com quem esta", () => {
    expect(fila).toContain("ja_atribuida:");
    expect(fila).toContain("_dono.display_name");
  });

  it("oferecer duas vezes devolve o mesmo vinculo", () => {
    expect(fila).toContain("'ja_existia', true");
  });

  it("a fila do agente traz o que ele precisa para comecar", () => {
    const bloco = servicos.slice(servicos.indexOf("export async function operatorQueue"));
    for (const campo of ["titulo", "descricao", "prazo", "prioridade", "projeto", "client_id", "run_key"]) {
      expect(bloco, `fila sem ${campo}`).toContain(campo);
    }
    // O run_key vem pronto: chave inventada na hora e como duas execucoes
    // da mesma tarefa colidem sem ninguem entender por que.
    expect(bloco).toContain("l.agent_run_id ?? `link:${l.id}`");
    // E o cliente sai pelo projeto, porque tasks nao tem client_id.
    expect(bloco).toContain("from('projects')");
  });

  it("fila vazia e dita como fila vazia, nao como erro", () => {
    expect(servicos).toContain("Fila vazia nao e erro: e fila vazia.");
  });

  it("slug errado ensina onde achar os validos", () => {
    expect(servicos).toContain("aceleriq_operator_board para ver os slugs validos");
  });

  it("o painel encaminha de verdade, em vez de copiar UUID para colar", () => {
    // O botao antigo copiava o ID para alguem colar no grupo. Isso nao e
    // integracao, e digitacao, e enquanto dependesse disso o quadro ia
    // continuar zerado.
    expect(pagina).toContain('rpc("operator_assign_task"');
    expect(pagina).toContain("encaminhar");
    expect(pagina).not.toContain('copiar(String(t.id), "ID da tarefa")');
  });

  it("as duas pontas estao no catalogo do MCP", () => {
    expect(ferramentas).toContain("'aceleriq_operator_queue'");
    expect(ferramentas).toContain("'aceleriq_operator_assign'");
  });
});

describe("o cliente vive em profiles, e nao existe tabela clients", () => {
  const conserto = readFileSync(
    resolve(raiz, "supabase/migrations/20260828030000_cliente_vive_em_profiles.sql"), "utf8",
  );

  it("nenhuma migration desta camada consulta uma tabela public.clients", () => {
    // Escrevi `from public.clients` de cabeca, sem conferir. A tabela nunca
    // existiu: projects.client_id aponta para profiles.id. E plpgsql so
    // resolve nome de tabela na PRIMEIRA EXECUCAO, entao o SQL foi criado
    // sem reclamar, a conferencia deu certo e a bomba ficou armada no
    // unico caminho que a camada existe para servir. Este teste e a
    // resposta a "por que ninguem viu": agora alguem ve.
    const daCamada = [
      "20260827200000_operadores_internos",
      "20260827230000_operador_acao_humana",
      "20260828000000_operador_conta_no_progresso",
      "20260828020000_fila_do_operador",
      "20260828030000_cliente_vive_em_profiles",
    ];
    for (const nome of daCamada) {
      const sql = readFileSync(resolve(raiz, `supabase/migrations/${nome}.sql`), "utf8");
      const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
      expect(codigo, `${nome} consulta public.clients, que nao existe`)
        .not.toMatch(/(from|join|into|update)\s+public\.clients\b/i);
    }
  });

  it("o conserto le o nome pela mesma regra da tela: empresa, senao pessoa", () => {
    expect(conserto).toContain("coalesce(nullif(trim(p.company_name), ''), p.full_name)");
    expect(conserto).toContain("from public.profiles p where p.id = _client_id");
  });

  it("o conserto reescreve a funcao inteira, nao so o trecho", () => {
    // Recriar por completo e o que garante que a versao no banco e a que
    // esta no arquivo, sem depender de qual migration rodou por ultimo.
    expect(conserto).toContain("create or replace function public.operator_report_event");
    expect(conserto).toContain("registrado_no_progresso");
    expect(conserto).toContain("PRONTO PARA O CLIENTE");
  });
});

describe("a Central deixa de ser uma parede de cartoes", () => {
  const perfil = readFileSync(
    resolve(raiz, "src/components/execucao/PerfilDoAgente.tsx"), "utf8",
  );

  it("os agentes sao agrupados por AREA, nao jogados numa grade", () => {
    // Catorze cartoes em quatro colunas viravam uma parede: o olho nao
    // tinha onde parar e nada dizia quem trabalha com quem.
    expect(pagina).toContain("const agrupadosPorArea");
    expect(pagina).toContain('o.area?.trim() || "Sem área definida"');
  });

  it("o cartao diz a funcao e a quem responde", () => {
    expect(pagina).toContain("{o.role}");
    expect(pagina).toContain("responde a ");
    expect(pagina).toContain("o.parent_slug");
  });

  it("evidencia tem numero proprio no cartao", () => {
    // E o que separa "feito" de "disse que fez".
    expect(pagina).toContain("comEvidencia: meus.filter((v) => Boolean(v.last_evidence)).length");
    expect(pagina).toContain("com evidência");
  });

  it("o perfil do agente abre CENTRALIZADO, e nao como gaveta", () => {
    expect(perfil).toContain("<Dialog open={Boolean(operador)}");
    expect(perfil).not.toContain('side="right"');
  });

  it("o perfil lista as tarefas, e nao so o quanto sao", () => {
    // Contava quantas eram e nao mostrava nenhuma: quem abria ficava com
    // o numero e sem o assunto.
    expect(perfil).toContain("Tarefas deste agente");
    expect(perfil).toContain("tarefas.get(String(v.kanban_task_id))");
  });

  it("o que trava vem primeiro, o que terminou por ultimo", () => {
    // Ordenar por data deixaria o bloqueio no meio do monte.
    expect(perfil).toContain('const ORDEM_DO_ESTADO = [');
    expect(perfil).toContain('"blocked", "awaiting_input", "review", "in_progress", "queued", "done",');
  });

  it("evidencia com endereco vira link; sem endereco, vira texto", () => {
    // String.raw porque a barra invertida sobrevive: numa string comum o
    // JavaScript come cada `\` e a comparação passa a procurar outra coisa.
    expect(perfil).toContain(
      String.raw`/^https?:\/\//.test(String(v.last_evidence).trim())`,
    );
    expect(perfil).toContain('target="_blank"');
    expect(perfil).toContain('rel="noreferrer noopener"');
  });

  it("concluida sem evidencia e denunciada na propria lista", () => {
    expect(perfil).toContain('v.status === "done" && !v.last_evidence');
    expect(perfil).toContain("concluída sem evidência");
  });

  it("da para abrir a tarefa no Kanban a partir do agente", () => {
    expect(perfil).toContain("/kanban?task=${tarefaId}");
  });
});
