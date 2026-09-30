/**
 * Dados da frente SYNC (30/09): o banco em memória com o encadeamento do
 * supabase-js e o cliente com duas marcas (Acerbi principal e CME). Usado
 * pelos testes do contexto completo e da sincronia.
 */

const CLIENTE = "c0000000-0000-4000-8000-000000000001";
const ACERBI = "a0000000-0000-4000-8000-00000000000a";
const CME = "b0000000-0000-4000-8000-00000000000b";
const PA = "p0000000-0000-4000-8000-00000000000a";
const PB = "p0000000-0000-4000-8000-00000000000b";

type Linha = Record<string, any>;

/** Banco em memória com o encadeamento do supabase-js que o pacote usa. */
export function bancoFalso(inicial: Record<string, Linha[]>) {
  const tabelas: Record<string, Linha[]> = {};
  for (const k of Object.keys(inicial)) tabelas[k] = inicial[k].map((l) => ({ ...l }));
  const chamadas: string[] = [];
  let n = 0;
  const from = (tabela: string) => {
    chamadas.push(tabela);
    const filtros: Array<(l: Linha) => boolean> = [];
    let op: "select" | "update" | "insert" = "select";
    let patch: Linha = {};
    let novo: Linha | null = null;
    let limite = Infinity;
    let contar = false;
    let cabeca = false;
    const base = () => (tabelas[tabela] = tabelas[tabela] || []);
    const alvo = () => base().filter((l) => filtros.every((f) => f(l))).slice(0, limite);
    const fim = () => {
      if (op === "update") {
        const a = base().filter((l) => filtros.every((f) => f(l)));
        a.forEach((l) => Object.assign(l, patch));
        return { data: a.map((l) => ({ id: l.id })), error: null };
      }
      if (op === "insert") return { data: novo, error: null };
      const d = alvo();
      return { data: cabeca ? null : d, error: null, count: contar ? d.length : null };
    };
    const q: any = {
      select: (_c?: string, o?: { count?: string; head?: boolean }) => {
        if (o && o.count) contar = true;
        if (o && o.head) cabeca = true;
        return q;
      },
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
      neq: (c: string, v: unknown) => (filtros.push((l) => l[c] !== v), q),
      gte: (c: string, v: unknown) => (filtros.push((l) => String(l[c] ?? "") >= String(v)), q),
      in: (c: string, v: unknown[]) => (filtros.push((l) => v.indexOf(l[c]) >= 0), q),
      is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), q),
      or: (expr: string) => {
        const partes = expr.split(",");
        filtros.push((l) =>
          partes.some((p) => {
            const [c, o, ...r] = p.split(".");
            const v = r.join(".");
            if (o === "is" && v === "null") return l[c] == null;
            if (o === "eq") return String(l[c]) === v;
            return false;
          }),
        );
        return q;
      },
      order: () => q,
      limit: (k: number) => ((limite = k), q),
      range: (de: number, ate: number) => ((limite = ate - de + 1), q),
      update: (p: Linha) => ((op = "update"), (patch = p), q),
      insert: (p: Linha) => {
        op = "insert";
        novo = { id: `d0000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, ativa: true, criado_em: new Date().toISOString(), ...p };
        base().push(novo);
        return q;
      },
      single: () => Promise.resolve(fim()),
      maybeSingle: () => Promise.resolve({ data: alvo()[0] ?? null, error: null }),
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(fim()).then(ok, erro),
    };
    return q;
  };
  return { db: { from }, tabelas, chamadas };
}

/** A Acerbi (principal) e a CME (outra marca) do mesmo cliente, com tudo o que o pacote lê. */
export function clienteComDuasMarcas() {
  return {
    profiles: [{ id: CLIENTE, company_name: "Acerbi Carnes" }],
    cliente_marcas: [
      { id: ACERBI, client_id: CLIENTE, project_id: PA, nome: "Acerbi", principal: true, ordem: 0, paleta: [], estilo: null, regras: null, tom: null, contexto: {}, contexto_extra: null, logo_path: null, logo_file_id: null, logo_alt_path: null, logo_alt_file_id: null },
      { id: CME, client_id: CLIENTE, project_id: PB, nome: "CME", principal: false, ordem: 1, paleta: [{ nome: "Azul", hex: "#0044ff", papel: "primaria" }], estilo: "azul limpo da escola", regras: null, tom: "técnico e didático", contexto: { negocio: "Cursos de corte da CME" }, contexto_extra: "A CME é a escola de cortes.", logo_path: null, logo_file_id: null, logo_alt_path: null, logo_alt_file_id: null },
    ],
    cliente_kit_marca: [{ client_id: CLIENTE, paleta: [{ nome: "Rosa", hex: "#ff00aa", papel: "primaria" }], estilo: "rosa da Acerbi", regras: "Logo sempre no canto", logo_path: `${CLIENTE}/logo.png`, logo_file_id: null, contexto: { negocio: "Pernil artesanal", publico: "famílias do bairro", tom_de_voz: "caloroso" } }],
    cliente_fontes: [
      { client_id: CLIENTE, nome: "Poppins", papel: "titulo", marca_id: null },
      { client_id: CLIENTE, nome: "Inter", papel: "titulo", marca_id: CME },
    ],
    client_dossiers: [
      { client_id: CLIENTE, is_current: true, project_id: null, dossier_type: "contexto", content: "Dossiê geral da Acerbi e do pernil.", summary: null, created_at: "2026-09-27T10:00:00Z" },
      { client_id: CLIENTE, is_current: true, project_id: PB, dossier_type: "projeto", content: "Dossiê da CME e dos cursos.", summary: null, created_at: "2026-09-26T10:00:00Z" },
    ],
    briefings: [
      { id: "e0000000-0000-4000-8000-000000000001", client_id: CLIENTE, marca_id: null, titulo: "Redes Acerbi", responses: { empresa: "Acerbi pernil" }, submitted: true, created_at: "2026-09-20T10:00:00Z", arquivado_em: null },
      { id: "e0000000-0000-4000-8000-000000000002", client_id: CLIENTE, marca_id: CME, titulo: "Cursos CME", responses: { empresa: "CME cursos online" }, submitted: true, created_at: "2026-09-25T10:00:00Z", enviado_em: "2026-09-28T10:00:00Z", arquivado_em: null },
    ],
    idv_projetos: [
      {
        id: "f0000000-0000-4000-8000-000000000001", client_id: CLIENTE, marca_id: null, titulo: "Rebranding Acerbi", estado: "ativo", versao: 3, atualizado_em: "2026-09-29T10:00:00Z",
        concluidas: ["inicio", "briefing", "pesquisa", "estrategia"],
        dados: {
          estrategia: { proposito: "Alimentar famílias com pernil de verdade", posicionamento: { publico: "famílias", categoria: "açougue de bairro", diferencial: "pernil artesanal" }, proposta_de_valor: { promessa: "Pernil macio sempre" }, tom: { atributos: ["caloroso", "simples"], fala_assim: ["Tem pernil fresquinho"] } },
          naming: { slogan: "O pernil da família" },
        },
      },
      { id: "f0000000-0000-4000-8000-000000000002", client_id: CLIENTE, marca_id: CME, titulo: "Identidade CME", estado: "ativo", versao: 1, atualizado_em: "2026-09-28T10:00:00Z", concluidas: ["inicio"], dados: { estrategia: { proposito: "Ensinar cortes para açougueiros" } } },
    ],
    project_memory: [
      { id: "g1", client_id: CLIENTE, kind: "decisao", source: "conselho", title: "Conselho: Natal", content: "ata", tags: ["conselho"], metadata: { resumo: "Foco no pernil de Natal" }, created_at: "2026-09-27T10:00:00Z" },
      { id: "g2", client_id: CLIENTE, kind: "decisao", source: "conselho", title: "Conselho: cursos", content: "ata", tags: ["conselho"], metadata: { resumo: "CME foca em cursos online", marca_id: CME }, created_at: "2026-09-28T10:00:00Z" },
      { id: "g3", client_id: CLIENTE, kind: "decisao", source: "conselho", title: "Desfeita: Conselho: preço", content: "ata", tags: ["conselho", "desfeita"], metadata: { resumo: "Baixar preço", desfeita_em: "2026-09-29" }, created_at: "2026-09-29T10:00:00Z" },
    ],
    agente_memoria: [
      { id: "h0000000-0000-4000-8000-000000000001", client_id: CLIENTE, ativa: true, agente: "diretor_arte", area: "arte", tipo: "evitar", categoria: "evitar", texto: "Nunca usar rosa na CME", fonte: "mesa_foto", evidencia: `marca:${CME}`, reforcos: 1, criado_em: "2026-09-20T00:00:00Z" },
      { id: "h0000000-0000-4000-8000-000000000002", client_id: CLIENTE, ativa: true, agente: "estrategista", area: "copy", tipo: "preferencia", categoria: "preferencia", texto: "Sempre citar o pernil na legenda", fonte: "agente_do_mes", referencia_id: ACERBI, reforcos: 2, criado_em: "2026-09-21T00:00:00Z" },
      { id: "h0000000-0000-4000-8000-000000000003", client_id: CLIENTE, ativa: true, agente: "geral", area: "geral", tipo: "evitar", categoria: "evitar", texto: "Evitar preço na arte", fonte: "painel", reforcos: 1, criado_em: "2026-09-22T00:00:00Z" },
      { id: "h0000000-0000-4000-8000-000000000004", client_id: CLIENTE, ativa: true, agente: "geral", area: "geral", tipo: "aprendizado", categoria: "aprendizado", texto: "Decisão do conselho (Natal): Foco no pernil de Natal", fonte: "conselho", reforcos: 1, criado_em: "2026-09-27T00:00:00Z" },
    ],
    external_accounts: [
      { id: "i0000000-0000-4000-8000-000000000001", client_id: CLIENTE, platform: "instagram", handle: "acerbicarnes", display_name: "Acerbi", status: "active" },
      { id: "i0000000-0000-4000-8000-000000000002", client_id: CLIENTE, platform: "instagram", handle: "cmeacerbi", display_name: "CME", status: "active" },
    ],
    project_external_accounts: [{ client_id: CLIENTE, project_id: PB, external_account_id: "i0000000-0000-4000-8000-000000000002" }],
    social_metrics_weekly: [{ client_id: CLIENTE, external_account_id: "i0000000-0000-4000-8000-000000000002", week_start: "2026-09-21", followers: 512, reach: 1800 }],
    cliente_referencias: [
      { client_id: CLIENTE, marca_id: null, ativa: true },
      { client_id: CLIENTE, marca_id: CME, ativa: true },
      { client_id: CLIENTE, marca_id: CME, ativa: true },
    ],
    cliente_imagens: [
      { client_id: CLIENTE, ativa: true, categoria: "produto", tags: [] },
      { client_id: CLIENTE, ativa: true, categoria: "ambiente", tags: [`marca:${CME}`] },
    ],
  } as Record<string, Linha[]>;
}
