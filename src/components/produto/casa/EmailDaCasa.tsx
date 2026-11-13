import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, Pencil, Plus } from "lucide-react";
import {
  carregarEmail,
  casa,
  diaLegivel,
  fraseDoErro,
  listarContasDaCasa,
  ROTULO_DO_ESTADO_DO_DOMINIO,
  ROTULO_DO_PROVEDOR,
  type CaixaDeEmail,
  type DominioDeEmail,
  type EstadoDoDominio,
  type EtapaDaMigracao,
  type ProvedorDeEmail,
} from "@/lib/produto/api";
import {
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  GrupoDeCampos,
  JanelaCentral,
  Secao,
  SeletorCompacto,
  botao,
  campo,
  campoTexto,
  etiqueta,
  foco,
  juntar,
  lista,
  texto,
} from "@/components/sistema";
import ChecagemDoDominio from "../ChecagemDoDominio";
import { chaveDasContas } from "./ContasDaCasa";

const ESTADOS: EstadoDoDominio[] = ["levantamento", "preparando", "virada", "concluido", "pausado"];
const PROVEDORES: ProvedorDeEmail[] = ["zoho", "google", "microsoft", "outro"];
const ESTADOS_DA_CAIXA: CaixaDeEmail["estado"][] = ["pedida", "criada", "copiando", "ativa", "removida"];
const ROTULO_DA_CAIXA: Record<CaixaDeEmail["estado"], string> = { pedida: "Pedida", criada: "Criada", copiando: "Copiando", ativa: "Ativa", removida: "Removida" };

/** Os registros de DNS que o provedor pede, prontos para colar no painel de DNS. */
export function registrosParaPublicar(d: Pick<DominioDeEmail, "dominio" | "provedor" | "dkim_seletor">): string {
  const linhas: string[] = [];
  if (d.provedor === "zoho") {
    linhas.push(`${d.dominio}.  MX  10  mx.zoho.com.`, `${d.dominio}.  MX  20  mx2.zoho.com.`, `${d.dominio}.  MX  50  mx3.zoho.com.`, `${d.dominio}.  TXT  "v=spf1 include:zoho.com ~all"`);
  } else if (d.provedor === "google") {
    linhas.push(`${d.dominio}.  MX  1  smtp.google.com.`, `${d.dominio}.  TXT  "v=spf1 include:_spf.google.com ~all"`);
  } else if (d.provedor === "microsoft") {
    linhas.push(`${d.dominio}.  MX  0  ${d.dominio.replace(/\./g, "-")}.mail.protection.outlook.com.`, `${d.dominio}.  TXT  "v=spf1 include:spf.protection.outlook.com ~all"`);
  } else {
    linhas.push(`${d.dominio}.  MX  10  (servidor do provedor)`, `${d.dominio}.  TXT  "v=spf1 (servidor do provedor) ~all"`);
  }
  const seletor = d.dkim_seletor || (d.provedor === "zoho" ? "zmail" : d.provedor === "google" ? "google" : "selector1");
  linhas.push(`${seletor}._domainkey.${d.dominio}.  TXT  (a chave que o provedor gera)`);
  linhas.push(`_dmarc.${d.dominio}.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@${d.dominio}"`);
  return linhas.join("\n");
}

/**
 * A migração e a operação do e-mail profissional de cada empresa: o domínio,
 * o passo a passo, as caixas e a conferência do DNS. O passo a passo nasce
 * pronto com o domínio; aqui a casa marca o que fez e anota.
 */
export default function EmailDaCasa() {
  const qc = useQueryClient();
  const contas = useQuery({ queryKey: chaveDasContas, queryFn: listarContasDaCasa });
  const email = useQuery({ queryKey: ["produto", "casa", "email"], queryFn: () => carregarEmail() });
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [editando, setEditando] = useState<DominioDeEmail | "novo" | null>(null);
  const reler = () => qc.invalidateQueries({ queryKey: ["produto", "casa", "email"] });

  if (email.isLoading || contas.isLoading) return <Carregando linhas={5} rotulo="Carregando o e-mail" />;
  if (email.isError || !email.data) return <EstadoDeErro acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void email.refetch()}>Tentar de novo</button>} />;

  const { dominios, caixas, etapas } = email.data;
  const nomeDaConta = (id: string) => ((contas.data || []).filter((c) => c.id === id)[0] || { nome: "Empresa" }).nome;
  const pedidas = caixas.filter((c) => c.estado === "pedida").length;
  const dominio = dominios.filter((d) => d.id === escolhido)[0] || dominios[0] || null;
  const novoDominio = (
    <button type="button" className={botao.icone} onClick={() => setEditando("novo")} aria-label="Novo domínio" title="Novo domínio" data-novo-dominio="">
      <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
    </button>
  );

  return (
    <div className="min-w-0 space-y-6" data-email-da-casa="">
      <Secao
        titulo="Domínios"
        descricao={`${dominios.length}${pedidas ? ` · ${pedidas} ${pedidas === 1 ? "caixa pedida" : "caixas pedidas"}` : ""}`}
        ajuda="Um domínio por empresa. Ao criar, o passo a passo da migração já vem pronto. A empresa precisa estar com o E-mail profissional marcado em Empresas para ver esta área no produto."
        acao={novoDominio}
      >
        {dominios.length === 0 ? (
          <EstadoVazio compacto titulo="Nenhum domínio cadastrado." descricao="Comece pelo domínio da empresa que vai migrar." acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => setEditando("novo")}>Novo domínio</button>} />
        ) : (
          <ul className={juntar(lista.aberta, lista.divisoria)} data-lista-de-dominios="">
            {dominios.map((d) => {
              const feitas = etapas.filter((e) => e.dominio_id === d.id && e.feito_em).length;
              const total = etapas.filter((e) => e.dominio_id === d.id).length;
              const pedidasAqui = caixas.filter((c) => c.dominio_id === d.id && c.estado === "pedida").length;
              return (
                <li key={d.id}>
                  <button type="button" className={juntar(lista.linha, "w-full text-left", dominio && dominio.id === d.id && lista.destaque)} onClick={() => setEscolhido(d.id)} aria-pressed={!!dominio && dominio.id === d.id}>
                    <span className="min-w-0 flex-1">
                      <span className={juntar(texto.corpo, "block truncate font-medium")}>{d.dominio}</span>
                      <span className={juntar(texto.auxiliar, "block truncate")}>{nomeDaConta(d.conta_id)} · {ROTULO_DO_PROVEDOR[d.provedor]} · {feitas} de {total} etapas</span>
                    </span>
                    {pedidasAqui > 0 && <span className={juntar(etiqueta, "ml-2 bg-warning/10 text-warning")}>{pedidasAqui} pedida{pedidasAqui === 1 ? "" : "s"}</span>}
                    <span className={juntar(etiqueta, "ml-2", d.estado === "concluido" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{ROTULO_DO_ESTADO_DO_DOMINIO[d.estado]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Secao>

      {dominio && (
        <>
          <Secao
            titulo={dominio.dominio}
            descricao={`${nomeDaConta(dominio.conta_id)} · ${ROTULO_DO_ESTADO_DO_DOMINIO[dominio.estado]}`}
            acao={
              <button type="button" className={botao.icone} onClick={() => setEditando(dominio)} aria-label="Editar o domínio" title="Editar o domínio">
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
            }
          >
            <p className={texto.auxiliar}>
              {[dominio.provedor_antigo ? `Sai de ${dominio.provedor_antigo}` : "", `vai para ${ROTULO_DO_PROVEDOR[dominio.provedor]}`, dominio.dns_em ? `DNS em ${dominio.dns_em}` : "", dominio.registro_em ? `registro em ${dominio.registro_em}` : ""].filter(Boolean).join(" · ")}
            </p>
            {dominio.observacao && <p className={juntar(texto.corpo, "mt-2 whitespace-pre-wrap")}>{dominio.observacao}</p>}
          </Secao>
          <PassoAPasso etapas={etapas.filter((e) => e.dominio_id === dominio.id)} aoMudar={reler} />
          <CaixasDaCasa dominio={dominio} caixas={caixas.filter((c) => c.dominio_id === dominio.id)} aoMudar={reler} />
          <Registros dominio={dominio} />
          <ChecagemDoDominio dominio={dominio} detalhado aoConferir={() => void reler()} />
        </>
      )}

      {editando && (
        <EditorDeDominio
          dominio={editando === "novo" ? null : editando}
          contas={(contas.data || []).map((c) => ({ id: c.id, nome: c.nome }))}
          onFechar={() => setEditando(null)}
          onSalvo={(id) => {
            void reler();
            setEscolhido(id);
            setEditando(null);
          }}
        />
      )}
    </div>
  );
}

function PassoAPasso({ etapas, aoMudar }: { etapas: EtapaDaMigracao[]; aoMudar: () => Promise<unknown> }) {
  const [anotando, setAnotando] = useState<EtapaDaMigracao | null>(null);
  const [nota, setNota] = useState("");
  const feitas = etapas.filter((e) => e.feito_em).length;
  const marcar = async (e: EtapaDaMigracao) => {
    try {
      await casa.marcarEtapa(e.id, !e.feito_em);
      await aoMudar();
    } catch (erro) {
      toast.error(fraseDoErro(erro));
    }
  };
  return (
    <Secao titulo="Passo a passo da migração" descricao={`${feitas} de ${etapas.length}`} ajuda="A ordem importa: só cancele o serviço antigo depois de testar envio e recebimento em todas as caixas e conferir o histórico.">
      <ol className={juntar(lista.aberta, lista.divisoria)} data-passo-a-passo="">
        {etapas.map((e) => (
          <li key={e.id} className={juntar(lista.linha, "items-start")}>
            <button
              type="button"
              role="checkbox"
              aria-checked={!!e.feito_em}
              aria-label={e.titulo}
              onClick={() => void marcar(e)}
              className={juntar("toque-compacto mr-3 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border", foco, e.feito_em ? "border-primary bg-primary text-primary-foreground" : "border-border")}
            >
              {e.feito_em && <Check className="h-3 w-3" aria-hidden="true" />}
            </button>
            <span className="min-w-0 flex-1">
              <span className={juntar(texto.corpo, "block font-medium", e.feito_em && "text-muted-foreground")}>{e.ordem}. {e.titulo}</span>
              <span className={juntar(texto.auxiliar, "block leading-5")}>{e.ajuda}</span>
              {e.nota && <span className={juntar(texto.corpo, "mt-1 block whitespace-pre-wrap")}>{e.nota}</span>}
              {e.feito_em && <span className={juntar(texto.auxiliar, "mt-0.5 block")}>Feito em {diaLegivel(e.feito_em, true)}</span>}
            </span>
            <button type="button" className={juntar(botao.icone, "ml-1")} aria-label={`Anotar na etapa ${e.titulo}`} title="Anotar" onClick={() => { setAnotando(e); setNota(e.nota || ""); }}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
      <JanelaCentral
        aberta={!!anotando}
        onFechar={() => setAnotando(null)}
        largura="sm"
        titulo={anotando ? anotando.titulo : "Anotação"}
        rodape={
          <button
            type="button"
            className={botao.primario}
            onClick={() => {
              const e = anotando;
              if (!e) return;
              void casa.marcarEtapa(e.id, !!e.feito_em, nota.trim()).then(() => aoMudar()).then(() => setAnotando(null)).catch((erro) => toast.error(fraseDoErro(erro)));
            }}
          >
            Salvar anotação
          </button>
        }
      >
        <textarea value={nota} onChange={(e) => setNota(e.target.value)} className={campoTexto} maxLength={1500} aria-label="Anotação da etapa" placeholder="O que foi feito, o que falta, com quem falar" />
      </JanelaCentral>
    </Secao>
  );
}

function CaixasDaCasa({ dominio, caixas, aoMudar }: { dominio: DominioDeEmail; caixas: CaixaDeEmail[]; aoMudar: () => Promise<unknown> }) {
  const [nova, setNova] = useState({ usuario: "", pessoa: "", tipo: "caixa" as CaixaDeEmail["tipo"], tamanho: "" });
  const [salvando, setSalvando] = useState(false);
  const criar = async () => {
    const nome = nova.usuario.trim().toLowerCase().replace(/@.*$/, "");
    if (!/^[a-z0-9._-]{1,60}$/.test(nome)) return void toast.error("Use letras, números, ponto ou traço no endereço.");
    setSalvando(true);
    try {
      await casa.salvarCaixa({ dominio_id: dominio.id, conta_id: dominio.conta_id, endereco: `${nome}@${dominio.dominio}`, pessoa: nova.pessoa.trim(), tipo: nova.tipo, tamanho_origem: nova.tamanho.trim() || null, estado: "criada" });
      setNova({ usuario: "", pessoa: "", tipo: "caixa", tamanho: "" });
      await aoMudar();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível cadastrar a caixa."));
    } finally {
      setSalvando(false);
    }
  };
  const mudarEstado = async (c: CaixaDeEmail, estado: CaixaDeEmail["estado"]) => {
    try {
      await casa.salvarCaixa({ id: c.id, dominio_id: c.dominio_id, conta_id: c.conta_id, endereco: c.endereco, estado });
      await aoMudar();
    } catch (e) {
      toast.error(fraseDoErro(e));
    }
  };
  return (
    <Secao titulo="Caixas" descricao={`${caixas.length}`} ajuda="Cadastre cada caixa que existe hoje e acompanhe: criada no provedor novo, copiando o histórico, ativa. O cliente vê a lista e a situação; a senha nunca passa por aqui.">
      {caixas.length > 0 && (
        <ul className={juntar(lista.aberta, lista.divisoria, "mb-3")} data-caixas-da-casa="">
          {caixas.map((c) => (
            <li key={c.id} className={lista.linha}>
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block truncate font-medium")}>{c.endereco}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>{[c.pessoa, c.tipo !== "caixa" ? c.tipo : "", c.tamanho_origem ? `${c.tamanho_origem} hoje` : ""].filter(Boolean).join(" · ") || "Sem responsável"}</span>
              </span>
              <select value={c.estado} onChange={(e) => void mudarEstado(c, e.target.value as CaixaDeEmail["estado"])} className={juntar(campo, "ml-2 h-8 w-auto text-[12px]")} aria-label={`Situação de ${c.endereco}`}>
                {ESTADOS_DA_CAIXA.map((e) => <option key={e} value={e}>{ROTULO_DA_CAIXA[e]}</option>)}
              </select>
            </li>
          ))}
        </ul>
      )}
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_110px_auto]">
        <input value={nova.usuario} onChange={(e) => setNova({ ...nova, usuario: e.target.value })} className={campo} placeholder={`nome @${dominio.dominio}`} aria-label="Endereço da caixa" autoCapitalize="none" />
        <input value={nova.pessoa} onChange={(e) => setNova({ ...nova, pessoa: e.target.value })} className={campo} placeholder="Quem usa" aria-label="Quem usa" />
        <select value={nova.tipo} onChange={(e) => setNova({ ...nova, tipo: e.target.value as CaixaDeEmail["tipo"] })} className={campo} aria-label="Tipo">
          <option value="caixa">Caixa</option>
          <option value="apelido">Apelido</option>
          <option value="grupo">Grupo</option>
        </select>
        <input value={nova.tamanho} onChange={(e) => setNova({ ...nova, tamanho: e.target.value })} className={campo} placeholder="Tamanho" aria-label="Tamanho hoje" />
        <button type="button" className={botao.secundario} onClick={() => void criar()} disabled={salvando || !nova.usuario.trim()}>Adicionar</button>
      </div>
    </Secao>
  );
}

function Registros({ dominio }: { dominio: DominioDeEmail }) {
  const textoDosRegistros = registrosParaPublicar(dominio);
  return (
    <Secao
      titulo="Registros para publicar"
      recolher="produto:email:registros"
      recolhidaDeInicio
      ajuda="O modelo do provedor escolhido. O DKIM e a verificação do domínio usam valores que o próprio provedor gera para a conta do cliente: copie de lá. Comece o DMARC em p=none e suba para quarantine depois de alguns dias sem erro."
      acao={
        <button
          type="button"
          className={botao.icone}
          aria-label="Copiar os registros"
          title="Copiar"
          onClick={() => void navigator.clipboard.writeText(textoDosRegistros).then(() => toast.success("Registros copiados.")).catch(() => toast.error("Não foi possível copiar."))}
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
        </button>
      }
    >
      <pre className="min-w-0 overflow-x-auto rounded-md bg-muted/50 p-3 text-[12px] leading-5 text-foreground" data-registros-de-dns="">{textoDosRegistros}</pre>
    </Secao>
  );
}

function EditorDeDominio({ dominio, contas, onFechar, onSalvo }: { dominio: DominioDeEmail | null; contas: Array<{ id: string; nome: string }>; onFechar: () => void; onSalvo: (id: string) => void }) {
  const [f, setF] = useState({
    conta_id: dominio ? dominio.conta_id : contas[0] ? contas[0].id : "",
    dominio: dominio ? dominio.dominio : "",
    provedor: (dominio ? dominio.provedor : "zoho") as ProvedorDeEmail,
    provedor_antigo: dominio ? dominio.provedor_antigo || "" : "",
    dns_em: dominio ? dominio.dns_em || "" : "Cloudflare",
    registro_em: dominio ? dominio.registro_em || "" : "",
    webmail_url: dominio ? dominio.webmail_url || "" : "",
    dkim_seletor: dominio ? dominio.dkim_seletor || "" : "",
    estado: (dominio ? dominio.estado : "levantamento") as EstadoDoDominio,
    observacao: dominio ? dominio.observacao || "" : "",
  });
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    const limpo = f.dominio.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(limpo)) return void toast.error("Escreva o domínio como suaempresa.com.br.");
    if (!f.conta_id) return void toast.error("Escolha a empresa.");
    setSalvando(true);
    try {
      const id = await casa.salvarDominio({
        ...(dominio ? { id: dominio.id } : {}),
        conta_id: f.conta_id,
        dominio: limpo,
        provedor: f.provedor,
        provedor_antigo: f.provedor_antigo.trim() || null,
        dns_em: f.dns_em.trim() || null,
        registro_em: f.registro_em.trim() || null,
        webmail_url: /^https:\/\//.test(f.webmail_url.trim()) ? f.webmail_url.trim() : null,
        dkim_seletor: f.dkim_seletor.trim() || null,
        estado: f.estado,
        observacao: f.observacao.trim() || null,
      });
      toast.success(dominio ? "Domínio salvo." : "Domínio criado, com o passo a passo.");
      onSalvo(id);
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar o domínio."));
    } finally {
      setSalvando(false);
    }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="md"
      titulo={dominio ? "Editar o domínio" : "Novo domínio"}
      rodape={<button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando} data-salvar-dominio="">{salvando ? "Salvando..." : "Salvar"}</button>}
    >
      <GrupoDeCampos>
        <CampoDeFormulario rotulo="Empresa" obrigatorio>
          <select value={f.conta_id} onChange={(e) => setF({ ...f, conta_id: e.target.value })} className={campo} disabled={!!dominio}>
            {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Domínio" obrigatorio>
          <input value={f.dominio} onChange={(e) => setF({ ...f, dominio: e.target.value })} className={campo} placeholder="suaempresa.com.br" autoCapitalize="none" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Provedor novo">
          <select value={f.provedor} onChange={(e) => setF({ ...f, provedor: e.target.value as ProvedorDeEmail })} className={campo}>
            {PROVEDORES.map((p) => <option key={p} value={p}>{ROTULO_DO_PROVEDOR[p]}</option>)}
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Provedor de hoje">
          <input value={f.provedor_antigo} onChange={(e) => setF({ ...f, provedor_antigo: e.target.value })} className={campo} placeholder="UOL Host, Locaweb..." />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="DNS em">
          <input value={f.dns_em} onChange={(e) => setF({ ...f, dns_em: e.target.value })} className={campo} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Registro do domínio em">
          <input value={f.registro_em} onChange={(e) => setF({ ...f, registro_em: e.target.value })} className={campo} placeholder="Registro.br" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Seletor do DKIM" apoio="Vazio usa o padrão do provedor">
          <input value={f.dkim_seletor} onChange={(e) => setF({ ...f, dkim_seletor: e.target.value })} className={campo} autoCapitalize="none" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Endereço do webmail" apoio="Vazio usa o do provedor">
          <input value={f.webmail_url} onChange={(e) => setF({ ...f, webmail_url: e.target.value })} className={campo} placeholder="https://" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Situação" largo>
          <SeletorCompacto rotulo="Situação do domínio" opcoes={ESTADOS.map((e) => ({ valor: e, rotulo: ROTULO_DO_ESTADO_DO_DOMINIO[e] }))} valor={f.estado} onEscolher={(v) => setF({ ...f, estado: v as EstadoDoDominio })} listaQuandoNaoCabe />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Anotações" largo>
          <textarea value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} className={campoTexto} maxLength={1500} />
        </CampoDeFormulario>
      </GrupoDeCampos>
    </JanelaCentral>
  );
}
