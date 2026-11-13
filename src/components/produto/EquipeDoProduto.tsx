import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftRight, Camera, Crown, RefreshCw, Trash2, Trophy, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  ROTULO_DO_PAPEL,
  convidar,
  ehGestor,
  fraseDoErro,
  lerRanking,
  mudarMembro,
  reais,
  reenviarConvite,
  repassarNegocios,
  salvarConta,
  salvarPerfilDoMembro,
  type EstadoDoProduto,
  type LinhaDoRanking,
  type MembroDaConta,
  type PapelNaConta,
} from "@/lib/produto/api";
import { useRelerProduto } from "@/hooks/useProduto";
import { CabecalhoDePagina, CampoDeFormulario, Carregando, EstadoVazio, GrupoDeCampos, JanelaCentral, SeletorCompacto, botao, campo, etiqueta, foco, juntar, texto } from "@/components/sistema";
import { Barra, CartaoDoPainel, Foto } from "./pecas";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

const COR_DO_PAPEL: Record<PapelNaConta, string> = { admin: "bg-primary/10 text-primary", gerente: "bg-warning/10 text-warning", usuario: "bg-muted text-muted-foreground" };
const nomeDe = (m: { nome?: string | null; email?: string | null }) => m.nome || m.email || "Sem nome";

/** Reduz a foto para um quadrado pequeno (cabe no banco e carrega na hora). */
export function prepararFoto(arquivo: File, lado = 192): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(arquivo.type)) return reject(new Error("Escolha uma imagem."));
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
      img.onload = () => {
        const menor = Math.min(img.width, img.height);
        const tela = document.createElement("canvas");
        tela.width = lado;
        tela.height = lado;
        const ctx = tela.getContext("2d");
        if (!ctx) return reject(new Error("Não foi possível preparar a imagem."));
        ctx.drawImage(img, (img.width - menor) / 2, (img.height - menor) / 2, menor, menor, 0, 0, lado, lado);
        resolve(tela.toDataURL("image/jpeg", 0.82));
      };
      img.src = String(leitor.result);
    };
    leitor.readAsDataURL(arquivo);
  });
}

export interface GrupoDaEquipe {
  gerente: MembroDaConta | null;
  pessoas: MembroDaConta[];
}

/** A estrutura da empresa: quem administra, cada gerente com a equipe dele, e quem está sem gerente. */
export function estruturaDaEquipe(equipe: MembroDaConta[]): { admins: MembroDaConta[]; grupos: GrupoDaEquipe[]; semGerente: MembroDaConta[] } {
  const admins = equipe.filter((m) => m.papel === "admin");
  const lideres = equipe.filter((m) => m.papel === "gerente");
  const vendedores = equipe.filter((m) => m.papel === "usuario");
  const idsDeLider = admins.concat(lideres).map((m) => m.id);
  const grupos = lideres.map((g) => ({ gerente: g, pessoas: vendedores.filter((v) => v.gerente_id === g.id) }));
  admins.forEach((a) => {
    const dele = vendedores.filter((v) => v.gerente_id === a.id);
    if (dele.length) grupos.push({ gerente: a, pessoas: dele });
  });
  return { admins, grupos, semGerente: vendedores.filter((v) => !v.gerente_id || idsDeLider.indexOf(v.gerente_id) < 0) };
}

const MEDALHA = ["text-[hsl(45_95%_55%)]", "text-[hsl(215_15%_70%)]", "text-[hsl(28_60%_52%)]"];

/**
 * Equipe: o ranking do mês, a estrutura (quem lidera quem) e o perfil de cada
 * pessoa. O vendedor vê o ranking e edita o próprio perfil; o gerente define a
 * meta e repassa os negócios da equipe dele; quem administra convida, muda o
 * cargo, escolhe o gerente de cada um e remove.
 */
export default function EquipeDoProduto({ estado }: { estado: EstadoDoProduto }) {
  const conta = estado.conta!;
  const eu = estado.eu!;
  const admin = eu.papel === "admin";
  const gestor = ehGestor(eu.papel);
  const reler = useRelerProduto();
  const qc = useQueryClient();
  const ranking = useQuery({ queryKey: ["produto", "ranking", conta.id], queryFn: () => lerRanking(), enabled: estado.crm, staleTime: 30_000 });
  const [convidando, setConvidando] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const estrutura = useMemo(() => estruturaDaEquipe(estado.equipe), [estado.equipe]);
  const linhas = ranking.data || [];
  const maiorVenda = Math.max(1, ...linhas.map((l) => l.vendido));
  const ocupados = estado.equipe.length;
  const cheio = ocupados >= conta.usuarios_contratados;
  const podeSeparar = !!estado.plano && estado.plano.limites.privacidade_por_vendedor;
  const pessoaAberta = aberto ? estado.equipe.filter((m) => m.id === aberto)[0] || null : null;
  const linhaDe = (m: MembroDaConta) => linhas.filter((l) => l.membro_id === m.id)[0] || null;

  const trocarVisibilidade = async (v: "todos" | "proprios") => {
    try {
      await salvarConta({ visibilidade: v });
      await reler();
      void qc.invalidateQueries({ queryKey: ["produto", "ranking"] });
      toast.success(v === "proprios" ? "Cada vendedor passa a ver só os próprios negócios." : "Todos veem todos os negócios.");
    } catch (e) {
      toast.error(fraseDoErro(e));
    }
  };

  const Pessoa = ({ m }: { m: MembroDaConta }) => {
    const l = linhaDe(m);
    return (
      <button type="button" onClick={() => setAberto(m.id)} className={juntar("flex w-full min-w-0 items-center rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50", foco)} data-pessoa={m.id}>
        <Foto nome={nomeDe(m)} foto={m.foto} apagada={m.estado === "convidado"} />
        <span className="ml-3 min-w-0 flex-1">
          <span className={juntar(texto.corpo, "block truncate font-medium")}>{nomeDe(m)}</span>
          <span className={juntar(texto.auxiliar, "block truncate")}>{m.estado === "convidado" ? "Convite enviado" : m.cargo || ROTULO_DO_PAPEL[m.papel]}</span>
        </span>
        {l && l.ganhos > 0 && <span className={juntar(texto.auxiliar, "ml-2 hidden shrink-0 tabular-nums sm:block")}>{reais(l.vendido)}</span>}
        <span className={juntar(etiqueta, "ml-2", COR_DO_PAPEL[m.papel])}>{ROTULO_DO_PAPEL[m.papel]}</span>
      </button>
    );
  };

  return (
    <div className="produto-entra-em-ordem mx-auto w-full min-w-0 max-w-[1480px] space-y-5" data-equipe-do-produto="">
      <CabecalhoDePagina
        titulo="Equipe"
        descricao={`${ocupados} de ${conta.usuarios_contratados} ${conta.usuarios_contratados === 1 ? "usuário" : "usuários"}`}
        ajuda="Administrador cuida da empresa inteira. Gerente lidera uma equipe: vê os negócios dela, define a meta e repassa contatos. Vendedor cuida dos próprios negócios."
        acoes={
          admin ? (
            <button type="button" className={botao.primario} onClick={() => setConvidando(true)} disabled={cheio} title={cheio ? "Aumente os usuários no plano para convidar" : undefined} data-convidar="">
              <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Convidar
            </button>
          ) : undefined
        }
      />

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <CartaoDoPainel titulo="Ranking do mês" apoio="Quem mais vendeu, pelo valor dos negócios ganhos" acao={<Trophy className="h-4 w-4 text-muted-foreground" aria-hidden="true" />} data-ranking="">
          {!estado.crm ? (
            <p className={texto.auxiliar}>O CRM está pausado.</p>
          ) : ranking.isLoading ? (
            <Carregando linhas={4} rotulo="Carregando o ranking" />
          ) : linhas.length === 0 ? (
            <EstadoVazio compacto titulo="Ninguém na disputa ainda." descricao="O ranking aparece quando a equipe entra." />
          ) : (
            <ol className="min-w-0 space-y-1">
              {linhas.map((l, i) => {
                const meta = l.meta_mensal > 0 ? l.vendido / l.meta_mensal : 0;
                return (
                  <li key={l.membro_id}>
                    <button type="button" onClick={() => setAberto(l.membro_id)} className={juntar("grid w-full min-w-0 grid-cols-[28px_auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/50", foco, l.user_id === (estado.equipe.filter((m) => m.id === eu.membro_id)[0] || { user_id: "" }).user_id && "bg-primary/[0.06]")}>
                      <span className={juntar("flex h-7 w-7 items-center justify-center text-[13px] font-semibold tabular-nums", i < 3 && l.vendido > 0 ? MEDALHA[i] : "text-muted-foreground")}>
                        {i === 0 && l.vendido > 0 ? <Crown className="h-4 w-4" aria-label="Primeiro lugar" /> : i + 1}
                      </span>
                      <Foto nome={l.nome} foto={l.foto} />
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center">
                          <span className={juntar(texto.corpo, "min-w-0 truncate font-medium")}>{l.nome}</span>
                          {l.cargo && <span className={juntar(texto.auxiliar, "ml-2 hidden min-w-0 truncate sm:block")}>{l.cargo}</span>}
                        </span>
                        <Barra parte={l.meta_mensal > 0 ? meta : l.vendido / maiorVenda} className="mt-1.5" cor={l.meta_mensal > 0 && meta >= 1 ? "hsl(var(--primary))" : undefined} />
                        <span className={juntar(texto.auxiliar, "mt-1 block truncate")}>
                          {l.ganhos} {l.ganhos === 1 ? "venda" : "vendas"}
                          {l.meta_mensal > 0 ? ` · ${Math.round(meta * 100)}% da meta de ${reais(l.meta_mensal)}` : ""}
                          {l.abertos !== null ? ` · ${l.abertos} em aberto` : ""}
                          {l.atrasadas ? ` · ${l.atrasadas} ${l.atrasadas === 1 ? "tarefa atrasada" : "tarefas atrasadas"}` : ""}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className={juntar(texto.corpo, "block font-semibold tabular-nums")}>{reais(l.vendido)}</span>
                        {l.em_jogo !== null && <span className={juntar(texto.auxiliar, "block tabular-nums")}>{reais(l.em_jogo)} em jogo</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </CartaoDoPainel>

        <div className="min-w-0 space-y-4">
          <CartaoDoPainel titulo="Estrutura" apoio="Quem lidera quem" data-estrutura="">
            <div className="min-w-0 space-y-4">
              <div>
                <p className={juntar(texto.rotulo, "mb-1")}>Administração</p>
                {estrutura.admins.map((m) => <Pessoa key={m.id} m={m} />)}
              </div>
              {estrutura.grupos.map((g) => (
                <div key={g.gerente ? g.gerente.id : "x"}>
                  <p className={juntar(texto.rotulo, "mb-1")}>Equipe de {g.gerente ? nomeDe(g.gerente).split(" ")[0] : ""}</p>
                  {g.gerente && g.gerente.papel === "gerente" && <Pessoa m={g.gerente} />}
                  <div className="ml-4 border-l border-border pl-2">
                    {g.pessoas.length === 0 ? <p className={juntar(texto.auxiliar, "px-2 py-2")}>Nenhum vendedor nesta equipe ainda.</p> : g.pessoas.map((m) => <Pessoa key={m.id} m={m} />)}
                  </div>
                </div>
              ))}
              {estrutura.semGerente.length > 0 && (
                <div>
                  <p className={juntar(texto.rotulo, "mb-1")}>{estrutura.grupos.length ? "Sem gerente" : "Vendedores"}</p>
                  {estrutura.semGerente.map((m) => <Pessoa key={m.id} m={m} />)}
                </div>
              )}
              {admin && cheio && <p className={texto.auxiliar}>Todos os lugares estão em uso. Para convidar, aumente os usuários no plano.</p>}
            </div>
          </CartaoDoPainel>

          {admin && (
            <CartaoDoPainel titulo="Quem vê o quê" data-visibilidade="">
              <SeletorCompacto
                rotulo="Visibilidade dos negócios"
                modo="segmentado"
                opcoes={[
                  { valor: "todos", rotulo: "Todos veem tudo" },
                  { valor: "proprios", rotulo: "Cada um vê os seus" },
                ]}
                valor={conta.visibilidade}
                onEscolher={(v) => (v === "proprios" && !podeSeparar ? toast.info("Separar por vendedor faz parte do plano Pro.") : void trocarVisibilidade(v as "todos" | "proprios"))}
              />
              <p className={juntar(texto.auxiliar, "mt-3")}>
                {conta.visibilidade === "proprios" && podeSeparar
                  ? "O vendedor vê os negócios dele e os sem responsável. O gerente vê também os da equipe dele. Quem administra vê tudo."
                  : podeSeparar
                    ? "Hoje a equipe inteira vê todos os negócios. Ao separar, o vendedor vê só os dele e o gerente vê os da equipe."
                    : "No plano atual a equipe inteira vê todos os negócios. Separar por vendedor e por equipe faz parte do Pro."}
              </p>
            </CartaoDoPainel>
          )}
        </div>
      </div>

      <JanelaDeConvite aberta={convidando} aoFechar={() => setConvidando(false)} estado={estado} />
      {pessoaAberta && <PerfilDaPessoa m={pessoaAberta} linha={linhaDe(pessoaAberta)} estado={estado} aoFechar={() => setAberto(null)} admin={admin} gestor={gestor} />}
    </div>
  );
}

function JanelaDeConvite({ aberta, aoFechar, estado }: { aberta: boolean; aoFechar: () => void; estado: EstadoDoProduto }) {
  const reler = useRelerProduto();
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [cargo, setCargo] = useState("");
  const [papel, setPapel] = useState<PapelNaConta>("usuario");
  const [gerente, setGerente] = useState("");
  const [enviando, setEnviando] = useState(false);
  const lideres = estado.equipe.filter((m) => m.papel === "gerente" && m.estado !== "removido");

  const enviar = async () => {
    setEnviando(true);
    try {
      const r = await convidar({ email: email.trim(), nome: nome.trim(), papel, cargo: cargo.trim(), gerente_id: papel === "usuario" && gerente ? gerente : null });
      await reler();
      aoFechar();
      setEmail("");
      setNome("");
      setCargo("");
      setPapel("usuario");
      setGerente("");
      toast.success(r.enviado ? "Convite enviado por e-mail." : "Pessoa adicionada. O e-mail não saiu agora: reenvie o convite.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível convidar."));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <JanelaCentral
      aberta={aberta}
      onFechar={aoFechar}
      largura="sm"
      titulo="Convidar para a equipe"
      ajuda="A pessoa recebe um e-mail com o botão de entrar. Na primeira vez ela escolhe a própria senha."
      rodape={
        <button type="button" className={botao.primario} onClick={() => void enviar()} disabled={enviando || email.trim().length < 5} data-enviar-convite="">
          {enviando ? "Enviando..." : "Enviar convite"}
        </button>
      }
    >
      <GrupoDeCampos colunas={1}>
        <CampoDeFormulario rotulo="E-mail" obrigatorio>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={campo} autoComplete="off" inputMode="email" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Nome">
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={campo} maxLength={120} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Nível de acesso" ajuda="Vendedor cuida dos próprios negócios. Gerente lidera uma equipe, repassa contatos, cria automações e campos. Administrador faz tudo, inclusive plano e cobrança.">
          <SeletorCompacto
            rotulo="Nível de acesso"
            modo="segmentado"
            opcoes={[
              { valor: "usuario", rotulo: "Vendedor" },
              { valor: "gerente", rotulo: "Gerente" },
              { valor: "admin", rotulo: "Administrador" },
            ]}
            valor={papel}
            onEscolher={(v) => setPapel(v as PapelNaConta)}
          />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Cargo" ajuda="O título da pessoa na empresa: Corretor, Consultora, SDR.">
          <input value={cargo} onChange={(e) => setCargo(e.target.value)} className={campo} maxLength={60} placeholder={papel === "gerente" ? "Gerente comercial" : "Consultor de vendas"} />
        </CampoDeFormulario>
        {papel === "usuario" && lideres.length > 0 && (
          <CampoDeFormulario rotulo="Gerente">
            <select value={gerente} onChange={(e) => setGerente(e.target.value)} className={campo}>
              <option value="">Sem gerente</option>
              {lideres.map((g) => <option key={g.id} value={g.id}>{nomeDe(g)}</option>)}
            </select>
          </CampoDeFormulario>
        )}
      </GrupoDeCampos>
    </JanelaCentral>
  );
}

function PerfilDaPessoa({ m, linha, estado, aoFechar, admin, gestor }: { m: MembroDaConta; linha: LinhaDoRanking | null; estado: EstadoDoProduto; aoFechar: () => void; admin: boolean; gestor: boolean }) {
  const eu = estado.eu!;
  const reler = useRelerProduto();
  const qc = useQueryClient();
  const proprio = m.id === eu.membro_id;
  const lidero = eu.papel === "gerente" && m.gerente_id === eu.membro_id;
  const editaPerfil = admin || proprio;
  const editaMeta = admin || lidero;
  const [nome, setNome] = useState(m.nome || "");
  const [cargo, setCargo] = useState(m.cargo || "");
  const [telefone, setTelefone] = useState(m.telefone || "");
  const [sobre, setSobre] = useState(m.sobre || "");
  const [foto, setFoto] = useState<string | null>(m.foto);
  const [meta, setMeta] = useState(m.meta_mensal ? String(m.meta_mensal) : "");
  const [gerente, setGerente] = useState(m.gerente_id || "");
  const [papel, setPapel] = useState<PapelNaConta>(m.papel);
  const [salvando, setSalvando] = useState(false);
  const [repassando, setRepassando] = useState(false);
  const [para, setPara] = useState("");
  const [nota, setNota] = useState("");
  const [removendo, setRemovendo] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);
  const lideres = estado.equipe.filter((x) => x.papel === "gerente" && x.id !== m.id && x.estado !== "removido");
  const destinos = estado.equipe.filter((x) => x.estado === "ativo" && x.user_id && x.id !== m.id);
  const podeRepassar = gestor && !!m.user_id && (admin || lidero || proprio) && estado.crm;

  const salvar = async () => {
    setSalvando(true);
    try {
      if (admin && papel !== m.papel) await mudarMembro(m.id, { papel });
      const dados: Parameters<typeof salvarPerfilDoMembro>[1] = {};
      if (editaPerfil) Object.assign(dados, { nome: nome.trim(), telefone: telefone.trim(), sobre: sobre.trim(), foto });
      if (editaPerfil || lidero) dados.cargo = cargo.trim();
      if (editaMeta) dados.meta_mensal = Number(String(meta).replace(/\./g, "").replace(",", ".")) || 0;
      if (admin && papel === "usuario") dados.gerente_id = gerente || null;
      await salvarPerfilDoMembro(m.id, dados);
      await reler();
      void qc.invalidateQueries({ queryKey: ["produto", "ranking"] });
      toast.success("Perfil salvo.");
      aoFechar();
    } catch (e) {
      toast.error(fraseDoErro(e));
    } finally {
      setSalvando(false);
    }
  };

  const escolherFoto = async (f: File | undefined) => {
    if (!f) return;
    try {
      setFoto(await prepararFoto(f));
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível usar essa imagem."));
    }
  };

  const repassar = async () => {
    setSalvando(true);
    try {
      const { data, error } = await db.from("crm_leads").select("id").eq("owner_id", m.user_id).is("archived_at", null).not("stage", "in", "(ganho,perdido)").limit(500);
      if (error) throw error;
      const ids = ((data || []) as Array<{ id: string }>).map((l) => l.id);
      if (!ids.length) {
        toast.info("Essa pessoa não tem negócio em aberto.");
        return;
      }
      const destino = estado.equipe.filter((x) => x.id === para)[0];
      const n = await repassarNegocios(ids, destino && destino.user_id ? destino.user_id : null, nota.trim());
      void qc.invalidateQueries();
      toast.success(`${n} ${n === 1 ? "negócio repassado" : "negócios repassados"}.`);
      setRepassando(false);
      aoFechar();
    } catch (e) {
      toast.error(fraseDoErro(e));
    } finally {
      setSalvando(false);
    }
  };

  const remover = async () => {
    try {
      await mudarMembro(m.id, { remover: true });
      await reler();
      toast.success("Pessoa removida.");
      aoFechar();
    } catch (e) {
      toast.error(fraseDoErro(e));
    }
  };

  const podeSalvar = editaPerfil || editaMeta;

  return (
    <JanelaCentral
      aberta
      onFechar={aoFechar}
      largura="md"
      titulo={nomeDe(m)}
      descricao={m.estado === "convidado" ? "Convite enviado, ainda não entrou" : m.cargo || ROTULO_DO_PAPEL[m.papel]}
      rodape={
        <>
          {admin && !proprio && (
            <button type="button" className={juntar(botao.discreto, "mr-auto text-destructive hover:text-destructive")} onClick={() => setRemovendo(true)} data-remover-pessoa="">
              <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Remover
            </button>
          )}
          {admin && m.estado === "convidado" && (
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => void reenviarConvite(m.id).then((r) => (r.enviado ? toast.success("Convite reenviado.") : toast.error("O e-mail não saiu agora. Tente de novo."))).catch((e) => toast.error(fraseDoErro(e)))}>
              <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Reenviar convite
            </button>
          )}
          {podeSalvar && (
            <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando} data-salvar-perfil="">
              {salvando ? "Salvando..." : "Salvar"}
            </button>
          )}
        </>
      }
    >
      <div className="flex min-w-0 items-center">
        <span className="relative shrink-0">
          <Foto nome={nomeDe(m)} foto={foto} tamanho="gg" />
          {editaPerfil && (
            <>
              <button type="button" onClick={() => arquivo.current && arquivo.current.click()} className={juntar("absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground", foco)} aria-label="Trocar a foto" title="Trocar a foto">
                <Camera className="h-4 w-4" aria-hidden="true" />
              </button>
              <input ref={arquivo} type="file" accept="image/*" className="hidden" onChange={(e) => void escolherFoto(e.target.files ? e.target.files[0] : undefined)} />
            </>
          )}
        </span>
        <div className="ml-4 min-w-0 flex-1">
          <span className={juntar(etiqueta, COR_DO_PAPEL[m.papel])}>{ROTULO_DO_PAPEL[m.papel]}</span>
          {m.email && <p className={juntar(texto.auxiliar, "mt-1 truncate")}>{m.email}</p>}
          {!editaPerfil && m.sobre && <p className={juntar(texto.corpo, "mt-1")}>{m.sobre}</p>}
        </div>
      </div>

      {linha && (
        <div className="mt-4 grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4" data-numeros-da-pessoa="">
          {[
            { r: "Vendido no mês", v: reais(linha.vendido) },
            { r: "Vendas", v: String(linha.ganhos) },
            { r: "Em aberto", v: linha.abertos === null ? "Reservado" : String(linha.abertos) },
            { r: "Em jogo", v: linha.em_jogo === null ? "Reservado" : reais(linha.em_jogo) },
          ].map((n) => (
            <div key={n.r} className="min-w-0 bg-card px-3 py-2.5">
              <p className={juntar(texto.rotulo, "truncate")}>{n.r}</p>
              <p className={juntar(texto.corpo, "truncate font-semibold tabular-nums")}>{n.v}</p>
            </div>
          ))}
        </div>
      )}

      {(editaPerfil || editaMeta) && (
        <GrupoDeCampos colunas={2} className="mt-4">
          {editaPerfil && (
            <CampoDeFormulario rotulo="Nome">
              <input value={nome} onChange={(e) => setNome(e.target.value)} className={campo} maxLength={120} />
            </CampoDeFormulario>
          )}
          {(editaPerfil || lidero) && (
            <CampoDeFormulario rotulo="Cargo">
              <input value={cargo} onChange={(e) => setCargo(e.target.value)} className={campo} maxLength={60} placeholder="Consultor de vendas" />
            </CampoDeFormulario>
          )}
          {editaPerfil && (
            <CampoDeFormulario rotulo="Telefone">
              <input value={telefone} onChange={(e) => setTelefone(e.target.value)} className={campo} maxLength={30} inputMode="tel" />
            </CampoDeFormulario>
          )}
          {editaMeta && (
            <CampoDeFormulario rotulo="Meta de vendas no mês" ajuda="Em reais. Aparece no ranking como porcentagem atingida.">
              <input value={meta} onChange={(e) => setMeta(e.target.value)} className={campo} inputMode="decimal" placeholder="0,00" />
            </CampoDeFormulario>
          )}
          {admin && !proprio && (
            <CampoDeFormulario rotulo="Nível de acesso">
              <select value={papel} onChange={(e) => setPapel(e.target.value as PapelNaConta)} className={campo} data-nivel-de-acesso="">
                <option value="usuario">Vendedor</option>
                <option value="gerente">Gerente</option>
                <option value="admin">Administrador</option>
              </select>
            </CampoDeFormulario>
          )}
          {admin && papel === "usuario" && (
            <CampoDeFormulario rotulo="Gerente" ajuda={lideres.length ? undefined : "Dê o nível Gerente a alguém para montar equipes."}>
              <select value={gerente} onChange={(e) => setGerente(e.target.value)} className={campo} disabled={!lideres.length} data-gerente-da-pessoa="">
                <option value="">Sem gerente</option>
                {lideres.map((g) => <option key={g.id} value={g.id}>{nomeDe(g)}</option>)}
              </select>
            </CampoDeFormulario>
          )}
          {editaPerfil && (
            <CampoDeFormulario rotulo="Sobre" className="sm:col-span-2">
              <textarea value={sobre} onChange={(e) => setSobre(e.target.value)} className={juntar(campo, "h-20 py-2")} maxLength={280} placeholder="Região que atende, especialidade, horário." />
            </CampoDeFormulario>
          )}
        </GrupoDeCampos>
      )}

      {podeRepassar && (
        <div className="mt-5 border-t border-border pt-4">
          {!repassando ? (
            <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => setRepassando(true)} data-repassar="">
              <ArrowLeftRight className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Repassar os negócios em aberto
            </button>
          ) : (
            <div className="min-w-0" data-repasse="">
              <p className={juntar(texto.corpo, "mb-2 font-medium")}>Repassar os negócios em aberto de {nomeDe(m).split(" ")[0]}</p>
              <GrupoDeCampos colunas={2}>
                <CampoDeFormulario rotulo="Para quem">
                  <select value={para} onChange={(e) => setPara(e.target.value)} className={campo}>
                    <option value="">Ninguém (ficam sem responsável)</option>
                    {destinos.map((d) => <option key={d.id} value={d.id}>{nomeDe(d)}</option>)}
                  </select>
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Recado para quem recebe">
                  <input value={nota} onChange={(e) => setNota(e.target.value)} className={campo} maxLength={200} placeholder="Opcional" />
                </CampoDeFormulario>
              </GrupoDeCampos>
              <div className="mt-3 flex items-center">
                <button type="button" className={juntar(botao.primario, "mr-2 h-8")} onClick={() => void repassar()} disabled={salvando} data-confirmar-repasse="">Repassar</button>
                <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => setRepassando(false)}>Cancelar</button>
              </div>
              <p className={juntar(texto.auxiliar, "mt-2")}>Os compromissos em aberto vão junto e a história de cada negócio guarda o repasse.</p>
            </div>
          )}
        </div>
      )}

      <JanelaCentral
        aberta={removendo}
        onFechar={() => setRemovendo(false)}
        largura="sm"
        titulo={`Remover ${nomeDe(m)}?`}
        descricao="Ela perde o acesso na hora"
        rodape={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => setRemovendo(false)}>Cancelar</button>
            <button type="button" className={botao.perigo} onClick={() => void remover()}>Remover</button>
          </>
        }
      >
        <p className={texto.corpo}>Os negócios e compromissos em aberto dela ficam sem responsável. O lugar volta a ficar livre.</p>
      </JanelaCentral>
    </JanelaCentral>
  );
}
