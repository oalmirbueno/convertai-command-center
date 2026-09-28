import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente IG (28/09): aba Instagram da Mesa. Regras em código (bio, nome,
 * destaques, grade, redes), o contrato da função mesa-instagram (Jev só duas
 * vezes, sem laço, caminho sempre) e o comportamento das telas.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), download: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: vi.fn(),
    from: () => {
      const q: any = {};
      for (const m of ["select", "eq", "in", "order", "limit", "is", "not", "upsert", "update"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: null, error: null });
      q.then = (ok: any) => Promise.resolve({ data: [], error: null }).then(ok);
      return q;
    },
    storage: {
      from: () => ({
        createSignedUrl: async (c: string) => ({ data: { signedUrl: `https://assinada.test/${c}` }, error: null }),
        download: mock.download,
      }),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import {
  caracteres,
  coresDoKit,
  corDoKitOuNulo,
  destaquesLimpos,
  lerEscolha,
  LIMITES_DO_PERFIL,
  nomeDoDestaque,
  perguntasDaBio,
  perguntasDaEscolha,
  promptDaCapa,
  sinaisDaBio,
  sugestoesLimpas,
  vereditoDaBio,
  conhecimentoDoPerfil,
} from "../../supabase/functions/_shared/conhecimento-perfil-instagram";
import {
  avisosDaSequencia,
  capaDoTrabalho,
  caminhoDoAgente,
  escolherConta,
  mover,
  ordemDoPlano,
  REDES_SOCIAIS,
  trocasDeData,
  usernameDe,
  type ItemPlanejado,
} from "../../supabase/functions/_shared/instagram-do-cliente";
import { AREAS_DO_PAINEL, AGENTES_DO_PAINEL, blocoDoMapaDoPainel } from "../../supabase/functions/_shared/mapa-do-painel";
import PreviaDoPerfil from "@/components/mesa/instagram/PreviaDoPerfil";
import BioENome from "@/components/mesa/instagram/BioENome";
import GeradorDeDestaques from "@/components/mesa/instagram/GeradorDeDestaques";
import PlanoDaGrade from "@/components/mesa/instagram/PlanoDaGrade";
import OutrasRedes from "@/components/mesa/instagram/OutrasRedes";
import { proximosPosts } from "@/components/mesa/instagram/ColunaDoCliente";
import { normalizarPainel, type AnaliseDaBio, type ItemDaGradeNaAba, type PerfilDaAba } from "@/components/mesa/instagram/instagramApi";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");
const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const TRAVESSAO = new RegExp("[" + String.fromCharCode(8212, 8211) + "]");

const catalogo: ModeloIa[] = [
  {
    id: "openai:texto", provedor: "openai", modelo_api: "texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low"], padrao_para: ["estrategista"], ativo: true,
  },
  {
    id: "openai:imagem", provedor: "openai", modelo_api: "imagem", tipo: "imagem", rotulo: "Imagem",
    preco_entrada_1m: 0, preco_saida_1m: 0, preco_cache_1m: null, preco_imagem: { baixa: 0.02, media: 0.05, alta: 0.2 },
    raciocinio: null, padrao_para: ["imagem"], ativo: true,
  },
];

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE, clientName: "AcelerIQ", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
  catalogo, catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <ConfirmDialogProvider>
            <MesaProvider valor={valorDaMesa()}>{filho}</MesaProvider>
          </ConfirmDialogProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const chamadasDe = (acao: string) =>
  mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-instagram" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

beforeEach(() => {
  mock.invoke.mockReset();
  mock.download.mockReset();
});

// ------------------------------------------------------------------ conhecimento: bio

describe("bio: regras em código e o veredito com o Jev", () => {
  it("conta caracteres como o Instagram (emoji conta 1) e acusa limite, hashtag e travessão", () => {
    expect(caracteres("ab😀")).toBe(3);
    const longa = sinaisDaBio("x".repeat(151));
    expect(longa.passouDoLimite).toBe(true);
    const s = sinaisDaBio("Dentista em Curitiba #dente #sorriso #clinica");
    expect(s.hashtags).toBe(3);
    expect(sinaisDaBio("").vazia).toBe(true);
    expect(sinaisDaBio("a " + String.fromCharCode(8212) + " b").temTravessao).toBe(true);
  });

  it("perguntas atômicas: Score com lista de níveis, Noul de sim ou não, e a de fidelidade só com contexto", () => {
    const sem = perguntasDaBio(false);
    const com = perguntasDaBio(true);
    expect(Object.keys(sem).sort()).toEqual(["atende_local", "chamada", "faz", "local", "nome_busca", "prova"]);
    expect(Object.keys(com)).toContain("fiel");
    for (const q of Object.values(com)) {
      if (q.type === "score") {
        expect(Array.isArray(q.criteria)).toBe(true);
        expect(q.criteria.length).toBeGreaterThanOrEqual(2);
        expect(q.criteria.length).toBeLessThanOrEqual(10);
      }
    }
  });

  it("bio boa: diz o que faz, chama, diz onde e bate com o negócio", () => {
    const v = vereditoDaBio(
      { faz: { score: 2.8 }, chamada: { noul: 0.9 }, local: { noul: 0.85 }, atende_local: { noul: 0.9 }, prova: { noul: 0.7 }, fiel: { score: 2.7 }, nome_busca: { noul: 0.8 } },
      sinaisDaBio("Clínica odontológica em Curitiba\nImplante e lente\n+2 mil sorrisos\nAgende no link"),
    );
    expect(v.boa).toBe(true);
    expect(v.pontos_fortes).toContain("diz o que o negócio faz");
    expect(v.nome_pode_melhorar).toBe(false);
  });

  it("bio fraca: não diz o que faz derruba mesmo com o resto bom; cidade só pesa para negócio local", () => {
    const fraca = vereditoDaBio({ faz: { score: 0.6 }, chamada: { noul: 0.9 }, local: { noul: 0.9 }, atende_local: { noul: 0.9 } }, sinaisDaBio("Viva o melhor de você"));
    expect(fraca.boa).toBe(false);
    expect(fraca.motivos.map((m) => m.codigo)).toContain("nao_diz");
    const online = vereditoDaBio({ faz: { score: 2.8 }, chamada: { noul: 0.9 }, local: { noul: 0.05 }, atende_local: { noul: 0.1 }, prova: { noul: 0.8 } }, sinaisDaBio("Curso online de inglês para adultos. Aula ao vivo. Matrícula no link"));
    expect(online.motivos.map((m) => m.codigo)).not.toContain("sem_local");
    expect(online.boa).toBe(true);
    const local = vereditoDaBio({ faz: { score: 2.8 }, chamada: { noul: 0.9 }, local: { noul: 0.05 }, atende_local: { noul: 0.9 }, prova: { noul: 0.8 } }, sinaisDaBio("Padaria artesanal. Pão de fermentação natural. Peça no link"));
    expect(local.motivos.map((m) => m.codigo)).toContain("sem_local");
  });

  it("sem Jev: não afirma que a bio está boa (o Jev é aviso, não trava)", () => {
    const v = vereditoDaBio(null, sinaisDaBio("Qualquer bio"));
    expect(v.sem_jev).toBe(true);
    expect(v.boa).toBe(false);
  });

  it("sugestões: no máximo 3, dentro do limite, sem repetir a atual nem travessão", () => {
    const t = String.fromCharCode(8212);
    const bios = sugestoesLimpas(
      [
        { texto: "Bio atual", por_que: "igual" },
        { texto: "x".repeat(151), por_que: "longa" },
        { texto: `Dentista ${t} Curitiba`, por_que: "ok" },
        { texto: "Dentista em Curitiba", por_que: "repetida sem travessão?" },
        { texto: "B", por_que: "" },
        { texto: "C", por_que: "" },
        { texto: "D", por_que: "" },
      ],
      "bio",
      "Bio atual",
    );
    expect(bios.length).toBe(3);
    expect(bios.every((b) => b.caracteres <= LIMITES_DO_PERFIL.bio && !TRAVESSAO.test(b.texto))).toBe(true);
    expect(bios.map((b) => b.texto)).not.toContain("Bio atual");
    const nomes = sugestoesLimpas([{ texto: "Nome muito comprido que passa de trinta letras", por_que: "" }, { texto: "Aceleriq | Marketing CWB", por_que: "" }], "nome", "");
    expect(nomes.map((n) => n.texto)).toEqual(["Aceleriq | Marketing CWB"]);
  });

  it("escolha: a atual concorre (vencer = 'a bio já está boa'); escolha fora da lista não vale", () => {
    const q = perguntasDaEscolha({ bio: "hoje", nome: "Nome" }, [{ id: "b1", texto: "nova", por_que: "", caracteres: 4 }], []);
    expect(q.bio.type).toBe("choice");
    expect(Object.keys((q.bio as any).criteria)).toEqual(["atual", "b1"]);
    expect(q.nome).toBeUndefined();
    expect(lerEscolha({ choice: "atual", confidence: 0.7, probabilities: { atual: 0.7, b1: 0.3 } }, ["atual", "b1"]).escolha).toBe("atual");
    expect(lerEscolha({ choice: "b9" }, ["atual", "b1"]).escolha).toBeNull();
  });

  it("o conhecimento cita as regras e não tem travessão", () => {
    const k = conhecimentoDoPerfil();
    expect(k).toContain("150");
    expect(k).toContain("Nome entra na busca");
    expect(k).toContain("3:4");
    expect(TRAVESSAO.test(k)).toBe(false);
  });
});

// ------------------------------------------------------------------ destaques

describe("destaques: nome curto e trava da marca", () => {
  it("nome até 15, avisa acima de 10; lista sem repetido e no máximo 7", () => {
    expect(nomeDoDestaque("Depoimentos de clientes").nome.length).toBe(15);
    expect(nomeDoDestaque("Depoimentos").corta).toBe(true);
    expect(nomeDoDestaque("Preços").corta).toBe(false);
    const l = destaquesLimpos(["Serviços", "serviços", "Preços", "A", "B", "C", "D", "E", "F"]);
    expect(l.length).toBe(7);
    expect(l[0]).toEqual({ nome: "Serviços", icone: "lista com três itens" });
  });

  it("só cor do kit entra na capa; o prompt pede ícone sem texto e sem logo", () => {
    const kit = coresDoKit([{ hex: "#0A7C66", nome: "Verde" }, { hex: "azul" }, { hex: "#ffffff" }]);
    expect(kit.map((c) => c.hex)).toEqual(["#0a7c66", "#ffffff"]);
    expect(corDoKitOuNulo("#FF0000", kit)).toBeNull();
    expect(corDoKitOuNulo("#0A7C66", kit)).toBe("#0a7c66");
    const p = promptDaCapa({ nome: "Preços", icone: "etiqueta de preço" }, { fundo: "#0a7c66", desenho: "#ffffff", traco: "linha" }, null);
    expect(p).toContain("#0a7c66");
    expect(p).toContain("#ffffff");
    expect(p).toContain("no text");
    expect(p).toContain("no logo");
  });
});

// ------------------------------------------------------------------ grade, contas, redes, caminho

const item = (id: string, data: string | null, formato = "carrossel"): ItemPlanejado => ({ id, data, formato, origem: "arte", titulo: `Post ${id}` });

describe("grade: ordem de ir ao ar e troca de datas", () => {
  it("ordem salva primeiro, o resto por data (sem data no fim)", () => {
    const itens = [item("a", "2026-10-03T12:00:00Z"), item("b", null), item("c", "2026-10-01T12:00:00Z")];
    expect(ordemDoPlano(itens, ["b"]).map((i) => i.id)).toEqual(["b", "c", "a"]);
    expect(ordemDoPlano(itens, null).map((i) => i.id)).toEqual(["c", "a", "b"]);
  });

  it("reordenar troca as datas só entre quem já tem data", () => {
    const itens = [item("a", "2026-10-01T12:00:00Z"), item("b", null), item("c", "2026-10-03T12:00:00Z")];
    const nova = mover(itens, 2, 0);
    expect(nova.map((i) => i.id)).toEqual(["c", "a", "b"]);
    expect(trocasDeData(nova)).toEqual([
      { id: "c", titulo: "Post c", de: "2026-10-03T12:00:00Z", para: "2026-10-01T12:00:00Z" },
      { id: "a", titulo: "Post a", de: "2026-10-01T12:00:00Z", para: "2026-10-03T12:00:00Z" },
    ]);
    expect(trocasDeData(itens)).toEqual([]);
  });

  it("avisa três do mesmo formato seguidos", () => {
    expect(avisosDaSequencia([item("a", null), item("b", null), item("c", null)]).length).toBe(1);
    expect(avisosDaSequencia([item("a", null), item("b", null, "foto"), item("c", null)]).length).toBe(0);
  });

  it("capa do trabalho: a última versão da primeira lâmina", () => {
    expect(capaDoTrabalho([{ ordem: 2, versao: 3, storage_path: "l2v3" }, { ordem: 1, versao: 1, storage_path: "l1v1" }, { ordem: 1, versao: 2, storage_path: "l1v2" }])).toBe("l1v2");
    expect(capaDoTrabalho(null)).toBeNull();
  });

  it("próximos posts: só os com data de agora em diante, em ordem", () => {
    const base = { formato: "carrossel", origem: "arte" as const, data_confirmada: true, imagem: null, estado: "", peca: null, publicacao: null, dia_da_peca: null, task_id: null };
    const lista = [
      { ...base, id: "1", titulo: "passado", data: "2026-09-01T12:00:00Z" },
      { ...base, id: "2", titulo: "depois", data: "2026-10-05T12:00:00Z" },
      { ...base, id: "3", titulo: "antes", data: "2026-10-02T12:00:00Z" },
      { ...base, id: "4", titulo: "sem", data: null },
    ];
    expect(proximosPosts(lista, new Date("2026-09-28T12:00:00Z")).map((p) => p.titulo)).toEqual(["antes", "depois"]);
  });
});

describe("contas, redes e o caminho do agente", () => {
  it("@ limpo de link ou arroba; a conta principal é a que tem o nome do cliente", () => {
    expect(usernameDe("https://www.instagram.com/aceleriq/")).toBe("aceleriq");
    expect(usernameDe("@SiteBolt")).toBe("sitebolt");
    expect(usernameDe("nome com espaço")).toBe("");
    const contas = [
      { id: "s", username: "sitebolt", igUserId: "1", nome: null },
      { id: "a", username: "aceleriq", igUserId: "2", nome: null },
    ];
    expect(escolherConta(contas, null, "AcelerIQ")!.id).toBe("a");
    expect(escolherConta(contas, "s", "AcelerIQ")!.id).toBe("s");
    expect(escolherConta([], null, "X")).toBeNull();
  });

  it("cada rede diz o que permite e o que não; o Instagram não edita bio nem destaques", () => {
    const ig = REDES_SOCIAIS.find((r) => r.valor === "instagram")!;
    expect(ig.naoPermite.join(" ")).toContain("Editar bio");
    expect(ig.naoPermite.join(" ")).toContain("destaques");
    for (const r of REDES_SOCIAIS) {
      expect(r.fonte.indexOf("https://")).toBe(0);
      expect(r.permite.length + r.naoPermite.length).toBeGreaterThan(0);
      expect(TRAVESSAO.test(r.permite.concat(r.naoPermite).join(" "))).toBe(false);
    }
  });

  it("o agente sempre deixa o caminho: o bloco, a área citada ou a aba", () => {
    expect(caminhoDoAgente(CLIENTE, "destaques", "")).toEqual({ rotulo: "Ir para Destaques", destino: `/mesa?client=${CLIENTE}&aba=instagram&bloco=destaques` });
    const citado = caminhoDoAgente(CLIENTE, "nenhum", "Isso é na Mesa Ads (/mesa-ads).");
    expect(citado && citado.destino.indexOf("/mesa-ads")).toBe(0);
    expect(caminhoDoAgente(CLIENTE, "nenhum", "ok")).toEqual({ rotulo: "Ir para a aba Instagram", destino: `/mesa?client=${CLIENTE}&aba=instagram` });
  });

  it("mapa do painel: a aba vem depois de Contexto e o agente do Instagram mora na Mesa", () => {
    const mesa = AREAS_DO_PAINEL.find((a) => a.chave === "mesa")!;
    expect(mesa.etapas!.slice(0, 2)).toEqual(["contexto", "instagram"]);
    const ag = AGENTES_DO_PAINEL.find((a) => a.chave === "instagram")!;
    expect(ag.funcao).toBe("mesa-instagram");
    expect(blocoDoMapaDoPainel("instagram").length).toBeLessThan(3600);
  });
});

// ------------------------------------------------------------------ contrato da função e do registro da aba

describe("contrato da função mesa-instagram e da aba", () => {
  const f = ler("supabase/functions/mesa-instagram/index.ts");
  const pagina = ler("src/pages/MesaDoCliente.tsx");

  it("Jev só duas vezes (julgar a bio e escolher entre as sugestões), sem laço de correção", () => {
    expect((f.match(/jevPerguntar\(/g) || []).length).toBe(2);
    expect(f).not.toMatch(/while\s*\(/);
    // O texto gera 3 de cada de uma vez: uma chamada de texto na bio e uma na conversa.
    expect((f.match(/chamarTexto\(/g) || []).length).toBe(2);
    expect((f.match(/chamarImagem\(/g) || []).length).toBe(1);
  });

  it("ações longas com fôlego; token só no servidor; o agente monta o mapa e grava o caminho", () => {
    expect(f).toContain('const ACOES_LONGAS = new Set(["bio", "conversar", "gerar_capa"]);');
    expect(f).toContain('rpc("perfis_instagram_token"');
    expect(f).toContain('blocoDoMapaDoPainel("instagram")');
    expect(f).toContain("anexoDoCaminho(caminho)");
    expect(f).not.toContain("import.meta.main");
    expect(ler("supabase/config.toml")).toMatch(/\[functions\.mesa-instagram\]\s+verify_jwt = true/);
    expect(TRAVESSAO.test(f)).toBe(false);
  });

  it("gerar capa confere a cor no kit e recusa sem paleta (trava da marca)", () => {
    expect(f).toContain('"sem_paleta"');
    expect(f).toContain('"cor_fora_do_kit"');
    expect(f).toContain("corDoKitOuNulo(e.fundo, kit.paleta)");
  });

  it("a Mesa tem seis abas, Instagram logo depois de Contexto, com pré-carga", () => {
    const abas = pagina.slice(pagina.indexOf("const ABAS = ["), pagina.indexOf("] as const;"));
    const ordem = (abas.match(/valor: "([a-z]+)"/g) || []).map((x) => x.replace(/valor: "|"/g, ""));
    expect(ordem).toEqual(["contexto", "instagram", "mes", "campanhas", "estudio", "entrega"]);
    expect(pagina).toContain('lazyComPreCarga("mesa/instagram", carregarInstagram)');
    expect(ler("src/lib/mesa/preCarga.ts")).toContain('instagram: () => import("@/components/mesa/AbaInstagram")');
  });

  it("o Contexto puxa a logo da foto do perfil pela função, com a conferência do fundo", () => {
    const logos = ler("src/components/mesa/ContextoLogos.tsx");
    expect(logos).toContain('acao: "foto_do_perfil"');
    expect(logos).toContain("await conferir(blob, nome)");
    expect(logos).toContain("Usar como logo");
  });

  it("os arquivos novos da tela não têm travessão em texto", () => {
    for (const arq of [
      "src/components/mesa/AbaInstagram.tsx",
      "src/components/mesa/instagram/PreviaDoPerfil.tsx",
      "src/components/mesa/instagram/BioENome.tsx",
      "src/components/mesa/instagram/GeradorDeDestaques.tsx",
      "src/components/mesa/instagram/PlanoDaGrade.tsx",
      "src/components/mesa/instagram/MetricasDoPerfil.tsx",
      "src/components/mesa/instagram/ColunaDoCliente.tsx",
      "src/components/mesa/instagram/OutrasRedes.tsx",
      "src/components/mesa/instagram/AgenteDoInstagram.tsx",
    ]) {
      expect(TRAVESSAO.test(ler(arq)), arq).toBe(false);
    }
  });
});

// ------------------------------------------------------------------ telas

const perfil: PerfilDaAba = {
  username: "aceleriq",
  nome: "AcelerIQ",
  bio: "Marketing que não para no anúncio.",
  site: "https://aceleriq.com",
  seguidores: 1234,
  seguindo: 50,
  posts: 14,
  foto_url: "https://cdn.test/foto.jpg",
  midias: [
    { id: "m1", formato: "carrossel", imagem: "https://cdn.test/1.jpg", permalink: "https://instagram.com/p/1", data: "2026-09-20T12:00:00Z", curtidas: 10, comentarios: 1, legenda: "um" },
    { id: "m2", formato: "reel", imagem: "https://cdn.test/2.jpg", permalink: "https://instagram.com/p/2", data: "2026-09-18T12:00:00Z", curtidas: 5, comentarios: 0, legenda: "dois" },
  ],
  fonte: "conta_do_cliente",
  lido_em: "2026-09-28T12:00:00Z",
  aviso: null,
};

const planejado = (id: string, data: string | null, extra: Partial<ItemDaGradeNaAba> = {}): ItemDaGradeNaAba => ({
  id,
  titulo: `Post ${id}`,
  formato: "carrossel",
  origem: "arte",
  data,
  data_confirmada: !!data,
  imagem: { bucket: "mesa", caminho: `${CLIENTE}/estudio/${id}.png` },
  estado: "aprovado",
  peca: { id: `t-${id}`, status: "entregue", file_ids: ["f"], publicar_ao_aprovar: false },
  publicacao: null,
  dia_da_peca: null,
  task_id: null,
  ...extra,
});

describe("tela: prévia do perfil", () => {
  it("mostra @, números, nome, bio, link e a grade; o plano entra por cima quando pedido", () => {
    const aoMudar = vi.fn();
    const { rerender } = montar(<PreviaDoPerfil perfil={perfil} capas={[]} planejados={[planejado("a", "2026-10-01T12:00:00Z")]} mostrarPlano={false} onMostrarPlano={aoMudar} />);
    expect(screen.getByText("@aceleriq")).toBeTruthy();
    expect(screen.getByText("1.234")).toBeTruthy();
    expect(screen.getByText("Marketing que não para no anúncio.")).toBeTruthy();
    expect(screen.getByText("aceleriq.com")).toBeTruthy();
    const grade = screen.getByRole("list", { name: "Grade do perfil" });
    expect(within(grade).getAllByRole("listitem").length).toBe(2);
    expect(screen.getByText(/A API do Instagram não entrega os destaques/)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Mostrar os posts planejados na grade" }));
    expect(aoMudar).toHaveBeenCalledWith(true);
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <MesaProvider valor={valorDaMesa()}>
            <PreviaDoPerfil perfil={perfil} capas={[]} planejados={[planejado("a", "2026-10-01T12:00:00Z")]} mostrarPlano onMostrarPlano={aoMudar} />
          </MesaProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(within(screen.getByRole("list", { name: "Grade do perfil" })).getAllByRole("listitem").length).toBe(3);
    expect(screen.getByText("1º")).toBeTruthy();
  });
});

const analise = (boa: boolean): AnaliseDaBio => ({
  bio_lida: perfil.bio,
  nome_lido: perfil.nome,
  username: "aceleriq",
  veredito: {
    boa,
    nota: boa ? 0.9 : 0.4,
    motivos: boa ? [] : [{ codigo: "sem_local", texto: "Negócio local sem cidade ou bairro: perde a busca de quem está perto." }],
    pontos_fortes: boa ? ["diz o que o negócio faz", "tem chamada para ação"] : [],
    nome_pode_melhorar: !boa,
    sinais: {},
    sem_jev: false,
  },
  sugestoes: boa
    ? { bios: [], nomes: [], observacao: "" }
    : {
        bios: [
          { id: "b1", texto: "Marketing para negócio local em Curitiba", por_que: "diz a cidade", caracteres: 40 },
          { id: "b2", texto: "Tráfego, sites e vídeos em Curitiba", por_que: "mais direto", caracteres: 36 },
        ],
        nomes: [{ id: "n1", texto: "AcelerIQ | Marketing CWB", por_que: "palavra da busca", caracteres: 24 }],
        observacao: "",
      },
  escolha: boa ? { bio: null, nome: null } : { bio: { escolha: "b2", confianca: 0.6, probabilidades: { atual: 0.1, b1: 0.3, b2: 0.6 } }, nome: { escolha: "n1", confianca: 0.7, probabilidades: { atual: 0.3, n1: 0.7 } } },
  modelo_id: "openai:texto",
  gerado_em: "2026-09-28T12:00:00Z",
});

describe("tela: bio e nome", () => {
  it("bio boa: diz que segue com ela e não mostra sugestões", () => {
    montar(<BioENome perfil={perfil} analise={analise(true)} onAnalise={vi.fn()} />);
    expect(screen.getByText("A bio já está boa, sigo com ela.")).toBeTruthy();
    expect(screen.getByText(/diz o que o negócio faz, tem chamada para ação/)).toBeTruthy();
    expect(screen.queryByText("Bio: antes e depois")).toBeNull();
  });

  it("bio que precisa mudar: motivos, antes e depois com a escolha do Jev, e Copiar", async () => {
    const escrever = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
    montar(<BioENome perfil={perfil} analise={analise(false)} onAnalise={vi.fn()} />);
    expect(screen.getByText("A bio precisa mudar")).toBeTruthy();
    expect(screen.getByText(/sem cidade ou bairro/)).toBeTruthy();
    expect(screen.getByText("Escolha do Jev 60%")).toBeTruthy();
    // O "Depois" abre com a escolha do Jev (b2).
    const depois = screen.getAllByText("Tráfego, sites e vídeos em Curitiba");
    expect(depois.length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Copiar bio" }));
    await waitFor(() => expect(escrever).toHaveBeenCalledWith("Tráfego, sites e vídeos em Curitiba"));
    // Escolher outra sugestão muda o "Depois".
    fireEvent.click(screen.getByRole("button", { name: /Marketing para negócio local em Curitiba/ }));
    expect(screen.getAllByText("Marketing para negócio local em Curitiba").length).toBe(2);
    expect(screen.getByText("AcelerIQ | Marketing CWB", { selector: "p" })).toBeTruthy();
  });

  it("analisar chama a função com o modelo escolhido", async () => {
    mock.invoke.mockResolvedValue({ data: { analise: analise(true), custo_usd: 0.001 }, error: null });
    const aoAnalisar = vi.fn();
    montar(<BioENome perfil={perfil} analise={null} onAnalise={aoAnalisar} />);
    fireEvent.click(screen.getByRole("button", { name: /Analisar a bio/ }));
    await waitFor(() => expect(aoAnalisar).toHaveBeenCalled());
    expect(chamadasDe("bio")[0]).toMatchObject({ client_id: CLIENTE, modelo_id: "openai:texto", forcar: false });
  });
});

describe("tela: gerador de destaques", () => {
  const paleta = [{ hex: "#0a7c66", nome: "Verde" }, { hex: "#ffffff", nome: "Branco" }];

  it("sem paleta no kit: não gera e leva ao Contexto", () => {
    montar(<GeradorDeDestaques contaId={null} paleta={[]} logo={null} capas={[]} lista={[{ nome: "Preços", icone: "etiqueta" }]} onLista={vi.fn()} onNovaCapa={vi.fn()} onArquivada={vi.fn()} onPedirAoAgente={vi.fn()} nomeDoCliente="AcelerIQ" />);
    expect(screen.getByText(/ainda não tem cores no kit/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Definir a paleta em Contexto" }).getAttribute("href")).toContain("aba=contexto");
    expect(screen.queryByRole("button", { name: /Gerar/ })).toBeNull();
  });

  it("um clique gera as que faltam, uma por vez, com as cores do kit", async () => {
    mock.invoke.mockImplementation(async (_f: string, { body }: any) => ({
      data: { destaque: { id: `id-${body.nome}`, nome: body.nome, icone: body.icone, estilo: body.estilo, caminho: `c/${body.nome}.png` }, custo_usd: 0.02 },
      error: null,
    }));
    const novas: string[] = [];
    montar(
      <GeradorDeDestaques
        contaId="conta-1"
        paleta={paleta}
        logo={null}
        capas={[{ id: "ja", nome: "Sobre", icone: "casa", estilo: { fundo: "#0a7c66", desenho: "#ffffff", traco: "linha" }, caminho: "c/sobre.png" }]}
        lista={[{ nome: "Preços", icone: "etiqueta" }, { nome: "Sobre", icone: "casa" }, { nome: "Onde fica", icone: "mapa" }]}
        onLista={vi.fn()}
        onNovaCapa={(c) => novas.push(c.nome)}
        onArquivada={vi.fn()}
        onPedirAoAgente={vi.fn()}
        nomeDoCliente="AcelerIQ"
      />,
    );
    const botaoGerar = screen.getByRole("button", { name: /Gerar 2 capas/ });
    expect(botaoGerar.textContent).toContain("US$");
    await act(async () => {
      fireEvent.click(botaoGerar);
    });
    await waitFor(() => expect(novas).toEqual(["Preços", "Onde fica"]));
    const pedidos = chamadasDe("gerar_capa");
    expect(pedidos.map((p) => p.nome)).toEqual(["Preços", "Onde fica"]);
    expect(pedidos[0]).toMatchObject({ conta_id: "conta-1", modelo_id: "openai:imagem", qualidade: "baixa", estilo: { fundo: "#0a7c66", desenho: "#ffffff", traco: "linha" } });
  });

  it("avisa nome que corta (mais de 10 letras) e aceita sugestões típicas", () => {
    const aoMudar = vi.fn();
    montar(<GeradorDeDestaques contaId={null} paleta={paleta} logo={null} capas={[]} lista={[{ nome: "Depoimentos", icone: "balão" }]} onLista={aoMudar} onNovaCapa={vi.fn()} onArquivada={vi.fn()} onPedirAoAgente={vi.fn()} nomeDoCliente="AcelerIQ" />);
    expect(screen.getByText("11/10")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "+ Preços" }));
    expect(aoMudar).toHaveBeenCalledWith([{ nome: "Depoimentos", icone: "balão" }, { nome: "Preços", icone: "etiqueta de preço" }]);
  });
});

describe("tela: planejar a grade", () => {
  it("setas reordenam, a ordem é guardada e as datas trocadas pedem confirmação", async () => {
    mock.invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const aoOrdenar = vi.fn();
    const itens = [planejado("a", "2026-10-01T12:00:00Z"), planejado("b", "2026-10-03T12:00:00Z")];
    const { rerender } = montar(<PlanoDaGrade itens={itens} ordemSalva={[]} contaId="conta-1" podePublicar onOrdem={aoOrdenar} onVerNaPrevia={vi.fn()} onMudou={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pôr Post a depois" }));
    expect(aoOrdenar).toHaveBeenCalledWith(["b", "a"]);
    await waitFor(() => expect(chamadasDe("salvar_ordem")[0]).toMatchObject({ ordem: ["b", "a"], conta_id: "conta-1" }), { timeout: 2000 });
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <ConfirmDialogProvider>
            <MesaProvider valor={valorDaMesa()}>
              <PlanoDaGrade itens={itens} ordemSalva={["b", "a"]} contaId="conta-1" podePublicar onOrdem={aoOrdenar} onVerNaPrevia={vi.fn()} onMudou={vi.fn()} />
            </MesaProvider>
          </ConfirmDialogProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("Com esta ordem, as datas mudam assim:")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Aplicar as novas datas" })).toBeTruthy();
  });

  it("sem posts prontos: explica de onde eles vêm", () => {
    montar(<PlanoDaGrade itens={[]} ordemSalva={[]} contaId={null} podePublicar={false} onOrdem={vi.fn()} onVerNaPrevia={vi.fn()} onMudou={vi.fn()} />);
    expect(screen.getByText(/Agenda, do Estúdio e os posts de fotos da Mesa Foto/)).toBeTruthy();
  });
});

describe("tela: outras redes", () => {
  it("TikTok diz o que falta (app aprovado) e guarda o @ à mão", async () => {
    mock.invoke.mockResolvedValue({ data: { rede: { id: "r1", rede: "tiktok", endereco: "@cliente" } }, error: null });
    const aoMudar = vi.fn();
    montar(<OutrasRedes rede="tiktok" painel={normalizarPainel({ redes: { adicionadas: [], conectadas: [] } })} onMudou={aoMudar} />);
    expect(screen.getByText(/exige app aprovado no TikTok/)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: /@ ou link da conta de TikTok/ }), { target: { value: " @cliente " } });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar/ }));
    await waitFor(() => expect(aoMudar).toHaveBeenCalled());
    expect(chamadasDe("adicionar_rede")[0]).toMatchObject({ rede: "tiktok", endereco: "@cliente" });
  });
});

describe("tela: a aba inteira", () => {
  it("lê o painel uma vez, mostra os blocos e a coluna do cliente, e abre o bloco do caminho (?bloco=)", async () => {
    const { default: AbaInstagram } = await import("@/components/mesa/AbaInstagram");
    mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
      if (body.acao === "painel") {
        return {
          data: {
            contas: [{ id: "a", username: "aceleriq", conectada: true }, { id: "s", username: "sitebolt", conectada: true }],
            conta_id: "a",
            perfil,
            grade: { itens: [planejado("x", "2099-10-01T12:00:00Z")], ordem: [] },
            bio_analise: null,
            kit: { paleta: [{ hex: "#0a7c66" }], estilo: null, logo: null },
            resumo: { nome: "AcelerIQ", negocio: "Agência de marketing para negócio local", publico: "", oferta: "", tom_de_voz: "", diferenciais: [] },
            capas: [],
            redes: { adicionadas: [], conectadas: [{ rede: "instagram", endereco: "@aceleriq" }] },
            mensagens: [],
            sql_pendente: false,
            aviso_sql: null,
          },
          error: null,
        };
      }
      return { data: { ok: true }, error: null };
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={[`/mesa?client=${CLIENTE}&aba=instagram&bloco=destaques`]}>
        <QueryClientProvider client={qc}>
          <TooltipProvider>
            <ConfirmDialogProvider>
              <MesaProvider valor={valorDaMesa()}>
                <AbaInstagram />
              </MesaProvider>
            </ConfirmDialogProvider>
          </TooltipProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Prévia do perfil")).toBeTruthy();
    for (const t of ["Bio e nome", "Destaques", "Planejar a grade", "Métricas", "Próximos posts", "Pastas e arquivos"]) expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    expect(screen.getByText("Agência de marketing para negócio local")).toBeTruthy();
    expect(chamadasDe("painel").length).toBe(1);
    expect(chamadasDe("painel")[0]).toMatchObject({ client_id: CLIENTE });
    // Rede no topo (Instagram por padrão) e conta quando há mais de uma.
    expect(screen.getByRole("tab", { name: /Instagram/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByText("@sitebolt").length).toBeGreaterThan(0);
    // O bloco do caminho abre: o gerador de destaques aparece.
    expect(screen.getByText(/A API do Instagram não lê nem cria destaques/)).toBeTruthy();
  });
});
