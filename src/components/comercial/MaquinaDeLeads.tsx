import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, MessageCircle, Phone, Plus, Search, Sparkles, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { AjudaRecolhida, botao, campo, campoTexto, juntar, superficie, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { listarCampanhas } from "@/lib/comercial";
import {
  avaliarComJev,
  buscaAndando,
  type BuscaDeLeads,
  cancelarBusca,
  type CandidatoDeLead,
  chavesDaMaquina,
  criarBusca,
  custoDaAvaliacao,
  descartarCandidatos,
  estadoDaBusca,
  importarParaOCrm,
  lerCandidatos,
  linkDoWhatsapp,
  listarBuscas,
  type NovaBusca,
  ROTULO_DA_ORIGEM_DO_DADO,
  telefoneLegivel,
} from "@/lib/comercial/maquinaApi";
import { FONTES_DA_BUSCA, type FonteDaBusca, ROTULO_DA_FONTE, UFS } from "../../../supabase/functions/comercial-leads/regras";

/**
 * Máquina de leads (25/10/2026, dono: "junto disso a máquina de leads, e tudo organizado e de forma
 * intuitiva"). Nova busca (nicho, cidade, quantos, fontes, campanha e a chave "Entregar ao Mercúrio"), a
 * lista de buscas com o andamento ao vivo e, aberta uma busca, os candidatos com contato, fonte e a nota do
 * Jev, para avaliar, levar ao CRM ou descartar. Quem busca é o worker "leads" desta casa (workers/leads):
 * OpenStreetMap e o site da própria empresa, robots.txt respeitado e sem disfarce.
 */

const SUGESTOES_DE_NICHO = ["Restaurante", "Pizzaria", "Hamburgueria", "Cafeteria", "Padaria", "Academia", "Clínica médica", "Dentista", "Fisioterapia", "Clínica de estética", "Salão de beleza", "Barbearia", "Advocacia", "Contabilidade", "Imobiliária", "Oficina mecânica", "Pet shop", "Veterinária", "Loja de roupas", "Ótica", "Móveis", "Informática", "Escola", "Pousada", "Arquitetura"];
const QUANTOS = [20, 50, 100, 200];
type Filtro = "todos" | "novo" | "importado" | "descartado";
const FILTROS: Array<{ id: Filtro; rotulo: string }> = [
  { id: "todos", rotulo: "Todos" },
  { id: "novo", rotulo: "Novos" },
  { id: "importado", rotulo: "No CRM" },
  { id: "descartado", rotulo: "Descartados" },
];

function Opcao({ ativo, onClick, children, rotulo }: { ativo: boolean; onClick: () => void; children: ReactNode; rotulo?: string }) {
  return (
    <button type="button" aria-pressed={ativo} aria-label={rotulo} onClick={onClick} className={juntar(botao.barra, "border", ativo ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border")}>
      {children}
    </button>
  );
}

const usd = (v: number) => `US$ ${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`.replace(".", ",");
const dataCurta = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function FormularioDaBusca({ aoCriar, aoFechar }: { aoCriar: (b: BuscaDeLeads) => void; aoFechar: () => void }) {
  const qc = useQueryClient();
  const [nicho, setNicho] = useState("");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("");
  const [limite, setLimite] = useState(50);
  const [fontes, setFontes] = useState<FonteDaBusca[]>(["osm", "sites"]);
  const [urls, setUrls] = useState("");
  const [campanha, setCampanha] = useState("");
  const [mercurio, setMercurio] = useState(false);
  const campanhas = useQuery({ queryKey: ["comercial", "campanhas", "para-busca"], queryFn: listarCampanhas, staleTime: 60_000 });
  const soLista = fontes.length === 1 && fontes[0] === "lista";
  const criar = useMutation({
    mutationFn: () => {
      const b: NovaBusca = { nicho: nicho.trim(), cidade: cidade.trim(), uf: uf || null, fontes, limite, campanha_id: campanha || null, entregar_ao_mercurio: mercurio, urls: fontes.indexOf("lista") >= 0 ? urls.split(/[\s,;]+/).filter(Boolean) : [] };
      return criarBusca(b);
    },
    onSuccess: (b) => {
      void qc.invalidateQueries({ queryKey: chavesDaMaquina.buscas });
      toast.success("Busca na fila", { description: "A máquina começa em instantes; a lista mostra o andamento." });
      aoCriar(b);
    },
    onError: (e) => toast.error("Busca não criada", { description: textoDoErro(e) }),
  });
  const alternar = (f: FonteDaBusca) => setFontes((l) => (l.indexOf(f) >= 0 ? l.filter((x) => x !== f) : l.concat([f])));
  const pronta = fontes.length > 0 && (soLista ? urls.trim().length > 3 : nicho.trim().length >= 2 && cidade.trim().length >= 2);
  return (
    <section className={juntar(superficie.poco, "min-w-0 space-y-3 p-3")} aria-label="Nova busca de leads" data-nova-busca="">
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_88px]">
        <label className={juntar(texto.rotulo, "block min-w-0")}>
          Nicho
          <input list="nichos-da-maquina" value={nicho} onChange={(e) => setNicho(e.target.value)} placeholder="Ex.: pizzaria, dentista, pet shop" className={juntar(campo, "mt-1")} aria-label="Nicho" />
          <datalist id="nichos-da-maquina">
            {SUGESTOES_DE_NICHO.map((n) => <option key={n} value={n} />)}
          </datalist>
        </label>
        <label className={juntar(texto.rotulo, "block min-w-0")}>
          Cidade
          <input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Ex.: Curitiba" className={juntar(campo, "mt-1")} aria-label="Cidade" />
        </label>
        <label className={juntar(texto.rotulo, "block min-w-0")}>
          UF
          <select value={uf} onChange={(e) => setUf(e.target.value)} className={juntar(campo, "mt-1")} aria-label="UF">
            <option value="">Todas</option>
            {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
      </div>
      <div className="min-w-0">
        <span className={texto.rotulo}>Quantos</span>
        <div className="mt-1 flex min-w-0 flex-wrap gap-1" role="group" aria-label="Quantos leads">
          {QUANTOS.map((q) => <Opcao key={q} ativo={limite === q} onClick={() => setLimite(q)}>{q}</Opcao>)}
        </div>
      </div>
      <div className="min-w-0">
        <span className={juntar(texto.rotulo, "inline-flex items-center")}>
          Onde buscar
          <AjudaRecolhida className="ml-1" rotulo="De onde vêm os leads">
            Mapa: negócios do OpenStreetMap (base aberta, com nome, telefone, site e endereço). Site da empresa: a máquina lê a página inicial e até 2 páginas de contato ou sobre, e pega WhatsApp, telefone, e-mail, Instagram e CNPJ que a própria empresa publicou. CNPJ: razão social e situação pela BrasilAPI. Sites que eu colar: os endereços que você colar passam pela mesma leitura. Respeita o robots.txt de cada site, vai devagar e não usa Google, Instagram nem LinkedIn (os termos deles proíbem). Cada dado guarda de onde veio.
          </AjudaRecolhida>
        </span>
        <div className="mt-1 flex min-w-0 flex-wrap gap-1" role="group" aria-label="Fontes da busca">
          {FONTES_DA_BUSCA.map((f) => <Opcao key={f} ativo={fontes.indexOf(f) >= 0} onClick={() => alternar(f)}>{ROTULO_DA_FONTE[f]}</Opcao>)}
        </div>
      </div>
      {fontes.indexOf("lista") >= 0 && (
        <label className={juntar(texto.rotulo, "block min-w-0")}>
          Sites (um por linha)
          <textarea value={urls} onChange={(e) => setUrls(e.target.value)} rows={3} placeholder={"empresa1.com.br\nempresa2.com.br"} className={juntar(campoTexto, "mt-1")} aria-label="Sites colados" />
        </label>
      )}
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <label className={juntar(texto.rotulo, "block min-w-0")}>
          Campanha (opcional)
          <select value={campanha} onChange={(e) => setCampanha(e.target.value)} className={juntar(campo, "mt-1")} aria-label="Campanha da busca">
            <option value="">Sem campanha</option>
            {(campanhas.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex min-w-0 items-center gap-2 self-end text-[13px]">
          <input type="checkbox" checked={mercurio} onChange={(e) => setMercurio(e.target.checked)} aria-label="Entregar ao Mercúrio" />
          Entregar ao Mercúrio
          <AjudaRecolhida rotulo="O que é entregar ao Mercúrio">
            Marcar é a sua autorização para o Mercúrio, o agente comercial, fazer o primeiro contato com os leads que você levar ao CRM desta busca. Ele respeita o teto diário de primeiros contatos e o horário configurado, registra cada mensagem no lead e avisa na Caixa do comercial quem avançou ou fechou. Sem marcar, os leads entram no CRM só para a equipe.
          </AjudaRecolhida>
        </label>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2">
        <button type="button" className={botao.discreto} onClick={aoFechar}>Cancelar</button>
        <button type="button" className={botao.primario} onClick={() => criar.mutate()} disabled={!pronta || criar.isPending}>
          {criar.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          Buscar
        </button>
      </div>
    </section>
  );
}

function ContatosDoCandidato({ c }: { c: CandidatoDeLead }) {
  const link = "inline-flex max-w-full items-center gap-1 truncate text-[12px] text-primary hover:underline";
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      {c.whatsapp && (
        <a className={link} href={linkDoWhatsapp(c.whatsapp)} target="_blank" rel="noreferrer" aria-label={`WhatsApp de ${c.nome}`}>
          <MessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {telefoneLegivel(c.whatsapp)}
        </a>
      )}
      {c.telefone && c.telefone !== c.whatsapp && (
        <a className={link} href={`tel:${c.telefone}`} aria-label={`Telefone de ${c.nome}`}>
          <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {telefoneLegivel(c.telefone)}
        </a>
      )}
      {c.site && <a className={link} href={c.site} target="_blank" rel="noreferrer">{c.site.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 40)}</a>}
      {c.instagram && <a className={link} href={`https://instagram.com/${c.instagram}`} target="_blank" rel="noreferrer">@{c.instagram}</a>}
      {c.email && <a className={link} href={`mailto:${c.email}`}>{c.email}</a>}
      {!c.whatsapp && !c.telefone && !c.site && !c.email && !c.instagram && <span className={texto.auxiliar}>Sem contato público</span>}
    </div>
  );
}

function DeOndeVeio({ c }: { c: CandidatoDeLead }) {
  const [aberto, setAberto] = useState(false);
  const lista = (c.evidencias || []).filter((e) => e.campo && e.campo !== "credito");
  return (
    <div className="min-w-0">
      <button type="button" className="text-[11px] text-muted-foreground hover:underline" onClick={() => setAberto(!aberto)} aria-expanded={aberto}>
        {aberto ? "Fechar a origem" : "De onde veio"}
      </button>
      {aberto && (
        <ul className="mt-1 min-w-0 space-y-0.5" aria-label={`Origem dos dados de ${c.nome}`}>
          {lista.map((e, k) => (
            <li key={k} className="truncate text-[11px] text-muted-foreground">
              {e.campo}: {String(e.valor || "").slice(0, 80)} ·{" "}
              {e.url ? <a className="underline" href={e.url} target="_blank" rel="noreferrer">{ROTULO_DA_ORIGEM_DO_DADO[e.fonte || ""] || e.fonte}</a> : ROTULO_DA_ORIGEM_DO_DADO[e.fonte || ""] || e.fonte}
            </li>
          ))}
          {c.fonte === "osm" && <li className="text-[11px] text-muted-foreground">Dados do mapa: © OpenStreetMap contributors</li>}
        </ul>
      )}
    </div>
  );
}

function CandidatosDaBusca({ busca, aoAbrirLead }: { busca: BuscaDeLeads; aoAbrirLead?: (leadId: string) => void }) {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [marcados, setMarcados] = useState<string[]>([]);
  const [mercurio, setMercurio] = useState(busca.entregar_ao_mercurio);
  const lidos = useQuery({
    queryKey: chavesDaMaquina.candidatos(busca.id),
    queryFn: () => lerCandidatos(busca.id),
    refetchInterval: buscaAndando(busca) ? 5000 : false,
  });
  const todos = (lidos.data && lidos.data.candidatos) || [];
  const visiveis = filtro === "todos" ? todos.filter((c) => c.situacao !== "descartado") : todos.filter((c) => c.situacao === filtro);
  const escolhidos = visiveis.filter((c) => marcados.indexOf(c.id) >= 0);
  const novosEscolhidos = escolhidos.filter((c) => c.situacao === "novo");
  const reler = () => void qc.invalidateQueries({ queryKey: chavesDaMaquina.candidatos(busca.id) });
  const avaliar = useMutation({
    mutationFn: () => avaliarComJev(busca.id, (novosEscolhidos.length ? novosEscolhidos : visiveis.filter((c) => c.situacao === "novo")).map((c) => c.id)),
    onSuccess: (r) => {
      reler();
      toast.success("Avaliados pelo Jev", { description: `${r.avaliados.length} com nota de encaixe · ${usd(r.custo_usd || 0)}` });
    },
    onError: (e) => toast.error("O Jev não avaliou", { description: textoDoErro(e) }),
  });
  const importar = useMutation({
    mutationFn: () => importarParaOCrm(busca.id, novosEscolhidos.map((c) => c.id), mercurio),
    onSuccess: (r) => {
      reler();
      setMarcados([]);
      void qc.invalidateQueries({ queryKey: ["comercial"] });
      toast.success(`${r.importados.length} no CRM`, { description: r.repetidos.length ? `${r.repetidos.length} já estavam no CRM e foram ligados ao lead de lá.` : mercurio ? "O Mercúrio faz o primeiro contato." : undefined });
    },
    onError: (e) => toast.error("Não levei ao CRM", { description: textoDoErro(e) }),
  });
  const descartar = useMutation({
    mutationFn: (voltar: boolean) => descartarCandidatos(busca.id, escolhidos.map((c) => c.id), voltar),
    onSuccess: () => {
      reler();
      setMarcados([]);
    },
    onError: (e) => toast.error("Não mudei os candidatos", { description: textoDoErro(e) }),
  });
  const paraAvaliar = novosEscolhidos.length || visiveis.filter((c) => c.situacao === "novo").length;
  const todosMarcados = visiveis.length > 0 && escolhidos.length === visiveis.length;
  if (lidos.isLoading) return <p className={texto.auxiliar}><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />Lendo os candidatos…</p>;
  return (
    <section className="min-w-0 space-y-3" aria-label={`Candidatos de ${busca.nicho} em ${busca.cidade}`} data-candidatos-da-busca={busca.id}>
      <div className="flex min-w-0 flex-wrap items-center gap-1" role="group" aria-label="Filtro dos candidatos">
        {FILTROS.map((f) => (
          <Opcao key={f.id} ativo={filtro === f.id} onClick={() => { setFiltro(f.id); setMarcados([]); }}>
            {f.rotulo} {f.id === "todos" ? todos.filter((c) => c.situacao !== "descartado").length : todos.filter((c) => c.situacao === f.id).length}
          </Opcao>
        ))}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <input type="checkbox" checked={todosMarcados} onChange={(e) => setMarcados(e.target.checked ? visiveis.map((c) => c.id) : [])} aria-label="Marcar todos" />
          {escolhidos.length ? `${escolhidos.length} marcados` : "Marcar todos"}
        </label>
        <span className="flex-1" />
        <button type="button" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")} onClick={() => avaliar.mutate()} disabled={!paraAvaliar || avaliar.isPending} title="O Jev dá a nota de encaixe de 0 a 10 contra o perfil de cliente ideal">
          {avaliar.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
          Avaliar com Jev · {usd(custoDaAvaliacao(paraAvaliar))}
        </button>
        <label className="flex items-center gap-1.5 text-[12px]">
          <input type="checkbox" checked={mercurio} onChange={(e) => setMercurio(e.target.checked)} aria-label="Mercúrio faz o primeiro contato" />
          Mercúrio contata
        </label>
        <button type="button" className={juntar(botao.primario, "h-8 px-3 text-[12px]")} onClick={() => importar.mutate()} disabled={!novosEscolhidos.length || importar.isPending}>
          {importar.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
          Levar ao CRM{novosEscolhidos.length ? ` (${novosEscolhidos.length})` : ""}
        </button>
        {filtro === "descartado" ? (
          <button type="button" className={botao.icone} onClick={() => descartar.mutate(true)} disabled={!escolhidos.length || descartar.isPending} aria-label="Voltar os marcados" title="Voltar para os novos">
            <Undo2 className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className={botao.icone} onClick={() => descartar.mutate(false)} disabled={!escolhidos.filter((c) => c.situacao === "novo").length || descartar.isPending} aria-label="Descartar os marcados" title="Descartar os marcados">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {!visiveis.length ? (
        <p className={texto.auxiliar}>{buscaAndando(busca) ? "Buscando: os candidatos aparecem aqui conforme a máquina acha." : "Nada aqui."}</p>
      ) : (
        <ul className="min-w-0" aria-label="Candidatos">
          {visiveis.map((c) => (
            <li key={c.id} className="flex min-w-0 items-start gap-2 border-t border-border py-2 first:border-t-0" data-candidato={c.id} data-situacao={c.situacao}>
              <input type="checkbox" className="mt-1" checked={marcados.indexOf(c.id) >= 0} onChange={(e) => setMarcados((l) => (e.target.checked ? l.concat([c.id]) : l.filter((x) => x !== c.id)))} aria-label={`Marcar ${c.nome}`} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate text-[13px] font-medium">{c.nome}</span>
                  {c.categoria && <span className="shrink-0 text-[11px] text-muted-foreground">{c.categoria}</span>}
                  {c.nota != null && (
                    <span className={juntar("ml-auto shrink-0 text-[12px] font-medium tabular-nums", c.nota >= 7 ? "text-primary" : c.nota >= 4 ? "text-foreground" : "text-muted-foreground")} title={c.porque || undefined} aria-label={`Encaixe ${c.nota} de 10`}>
                      {c.nota.toFixed(1).replace(".", ",")}
                    </span>
                  )}
                </div>
                <ContatosDoCandidato c={c} />
                {c.porque && <p className="text-[11px] leading-4 text-muted-foreground">{c.porque}</p>}
                <div className="flex min-w-0 items-center gap-3">
                  <DeOndeVeio c={c} />
                  {c.situacao === "importado" && c.lead_id && (
                    <button type="button" className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline" onClick={() => aoAbrirLead && aoAbrirLead(c.lead_id as string)} disabled={!aoAbrirLead}>
                      No CRM
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function MaquinaDeLeads({ aoAbrirLead }: { aoAbrirLead?: (leadId: string) => void }) {
  const qc = useQueryClient();
  const [novaAberta, setNovaAberta] = useState(false);
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const buscas = useQuery({
    queryKey: chavesDaMaquina.buscas,
    queryFn: listarBuscas,
    refetchInterval: (q) => (((q.state.data as BuscaDeLeads[] | undefined) || []).some(buscaAndando) ? 4000 : false),
  });
  const lista = buscas.data || [];
  const aberta = useMemo(() => lista.filter((b) => b.id === abertaId)[0] || null, [lista, abertaId]);
  const cancelar = useMutation({
    mutationFn: (id: string) => cancelarBusca(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chavesDaMaquina.buscas }),
    onError: (e) => toast.error("Não cancelei", { description: textoDoErro(e) }),
  });
  return (
    <div className="min-w-0 space-y-4" data-maquina-de-leads="">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className={juntar(texto.tituloSecao, "min-w-0 flex-1 truncate")}>Máquina de leads</h2>
        <AjudaRecolhida rotulo="Como a Máquina de leads funciona">
          Diga o nicho e a cidade: a máquina desta casa acha os negócios no mapa aberto e lê o site de cada um atrás do contato que a própria empresa publicou. Depois, o Jev dá a nota de encaixe com o perfil de cliente ideal, você leva os melhores ao CRM e, se quiser, entrega ao Mercúrio para o primeiro contato. Nada é enviado a ninguém nesta tela.
        </AjudaRecolhida>
        {!novaAberta && (
          <button type="button" className={botao.primario} onClick={() => setNovaAberta(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Nova busca
          </button>
        )}
      </div>
      {novaAberta && <FormularioDaBusca aoFechar={() => setNovaAberta(false)} aoCriar={(b) => { setNovaAberta(false); setAbertaId(b.id); }} />}
      {buscas.isError && <p className="text-[12px] text-destructive">{textoDoErro(buscas.error)}</p>}
      {buscas.isLoading ? (
        <p className={texto.auxiliar}><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />Lendo as buscas…</p>
      ) : !lista.length ? (
        !novaAberta && <p className={texto.auxiliar}>Nenhuma busca ainda. Comece em Nova busca.</p>
      ) : (
        <ul className="min-w-0" aria-label="Buscas de leads">
          {lista.map((b) => {
            const andando = buscaAndando(b);
            const abertaAqui = abertaId === b.id;
            return (
              <li key={b.id} className="min-w-0 border-t border-border first:border-t-0" data-busca={b.id} data-situacao={b.situacao}>
                <div className="flex min-w-0 items-center gap-2 py-2">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setAbertaId(abertaAqui ? null : b.id)} aria-expanded={abertaAqui} aria-label={`Abrir a busca ${b.nicho} em ${b.cidade}`}>
                    {andando ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" /> : <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{b.nicho} em {b.cidade}{b.uf ? `/${b.uf}` : ""}</span>
                      <span className={juntar("block truncate text-[11px]", b.situacao === "falhou" ? "text-destructive" : "text-muted-foreground")}>
                        {estadoDaBusca(b)} · {dataCurta(b.created_at)}{b.entregar_ao_mercurio ? " · Mercúrio" : ""}
                      </span>
                    </span>
                  </button>
                  {andando && (
                    <button type="button" className={botao.icone} onClick={() => cancelar.mutate(b.id)} disabled={cancelar.isPending} aria-label={`Cancelar a busca ${b.nicho}`} title="Cancelar a busca (o que já achou fica)">
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                {abertaAqui && aberta && (
                  <div className="min-w-0 pb-3 pl-6">
                    <CandidatosDaBusca busca={aberta} aoAbrirLead={aoAbrirLead} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
