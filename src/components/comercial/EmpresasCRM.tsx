import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Building2, ChevronDown, ChevronRight, Pencil, Star, User, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AreaDeTrabalho,
  CampoDeFormulario,
  EstadoVazio,
  GrupoDeCampos,
  Painel,
  botao,
  campo,
  campoTexto,
  etiqueta,
  foco,
  juntar,
  superficie,
  texto,
} from "@/components/sistema";
import {
  type Contato,
  type Empresa,
  type Lead,
  CAMPOS_DA_EMPRESA,
  dinheiro,
  fichaDaEmpresa,
  rotuloDoEstagio,
  salvarContato,
  salvarEmpresa,
  ultimoErroDoComercial,
} from "@/lib/comercial";
import { CampoDeBusca } from "@/components/sistema";
import { ehTexto, useEstadoDoComercial } from "./useEstadoDoComercial";

/**
 * As fichas de empresa: a metade do CRM que uma lista de leads nao tem.
 *
 * O funil mostra o negocio de agora. Esta tela mostra a EMPRESA ao longo do
 * tempo: quantas vezes a casa conversou com ela, quem sao as pessoas, o que
 * fechou e o que nao fechou. E o que faz a segunda conversa comecar de onde
 * a primeira parou.
 *
 * A ficha nasce no BANCO a partir do lead (gatilho da migration
 * 20260917200000); aqui ela se completa. Salvar grava o que tiver: só o nome
 * é exigido.
 */

interface Props {
  empresas: Empresa[];
  contatos: Contato[];
  leads: Lead[];
  onAbrirLead: (lead: Lead) => void;
  onMudou: () => Promise<unknown>;
  /** Controles da página na mesma fileira da busca (ex.: Negócios | Empresas). */
  filtrosAntes?: ReactNode;
  /** Muda (1, 2, 3...) quando a página pede "Nova empresa" pelo botão do cabeçalho. */
  pedidoDeNova?: number;
  /** Lugar da página para a fileira de filtros (a linha das Etapas, de 1280 px para cima). */
  destinoDosFiltros?: HTMLElement | null;
}

export default function EmpresasCRM({
  empresas,
  contatos,
  leads,
  onAbrirLead,
  onMudou,
  filtrosAntes,
  pedidoDeNova = 0,
  destinoDosFiltros = null,
}: Props) {
  const [busca, setBusca] = useEstadoDoComercial("empresas:busca", "", { validar: ehTexto });
  const [aberta, setAberta] = useEstadoDoComercial<string | null>("empresas:aberta", null, {
    validar: (v) => v === null || typeof v === "string",
  });
  const [editando, setEditando] = useState<Empresa | "nova" | null>(null);
  const [novoContatoEm, setNovoContatoEm] = useState<string | null>(null);

  // O botão "Nova empresa" mora no cabeçalho da página, na linha do título.
  const ultimoPedido = useRef(pedidoDeNova);
  useEffect(() => {
    if (pedidoDeNova !== ultimoPedido.current) {
      ultimoPedido.current = pedidoDeNova;
      if (pedidoDeNova > 0) setEditando("nova");
    }
  }, [pedidoDeNova]);

  const termo = busca.trim().toLowerCase();
  const fichas = useMemo(
    () =>
      empresas
        .filter((e) => !termo || e.name.toLowerCase().includes(termo))
        .map((e) => fichaDaEmpresa(e, contatos, leads))
        // Quem tem negocio aberto primeiro: e com quem a casa esta falando
        // agora. Ordem alfabetica pura enterraria isso no meio da lista.
        .sort((a, b) => {
          if (a.abertos !== b.abertos) return b.abertos - a.abertos;
          return a.empresa.name.localeCompare(b.empresa.name, "pt-BR");
        }),
    [empresas, contatos, leads, termo],
  );

  const emLinha = Boolean(destinoDosFiltros);
  const filtros = (
    <div
      className={emLinha ? "flex min-w-0 items-center [&>*+*]:ml-2" : "-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1"}
      role="group"
      aria-label="Filtros das empresas"
    >
      {filtrosAntes}
      <CampoDeBusca
        valor={busca}
        onMudar={setBusca}
        placeholder="Buscar empresa"
        rotulo="Buscar empresa"
        className={emLinha ? "w-[240px] desk:w-[300px]" : "min-w-[180px] flex-1 sm:max-w-[320px]"}
      />
    </div>
  );

  return (
    <>
      {destinoDosFiltros ? createPortal(filtros, destinoDosFiltros) : filtros}

      <AreaDeTrabalho className={emLinha ? "" : "mt-3"} rotuloDoPrincipal="Empresas" memoriaDaRolagem="comercial:empresas">
        {fichas.length === 0 ? (
          termo ? (
            <EstadoVazio
              compacto
              titulo="Nenhuma empresa com esse nome."
              acao={
                <button type="button" onClick={() => setBusca("")} className={botao.discreto}>
                  Limpar busca
                </button>
              }
            />
          ) : (
            <EstadoVazio
              icone={<Building2 className="h-5 w-5" />}
              titulo="Nenhuma empresa ainda"
              descricao="Toda empresa que entra no funil ganha ficha aqui, com as pessoas e os negócios."
              acao={
                <button type="button" onClick={() => setEditando("nova")} className={botao.primario}>
                  Nova empresa
                </button>
              }
            />
          )
        ) : (
          <Painel semEspaco as="section" aria-label="Fichas de empresa">
            <ul className="divide-y divide-border">
              {fichas.map((ficha) => {
                const expandida = aberta === ficha.empresa.id;
                return (
                  <li key={ficha.empresa.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => setAberta(expandida ? null : ficha.empresa.id)}
                      aria-expanded={expandida}
                      className={juntar("flex w-full min-w-0 items-center px-4 py-3 text-left transition-colors hover:bg-muted/40", foco)}
                    >
                      <Building2 className="mr-3 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="mr-3 min-w-0 flex-1">
                        <span className={juntar(texto.corpo, "block truncate font-medium")}>{ficha.empresa.name}</span>
                        <span className={juntar(texto.auxiliar, "block truncate")}>
                          {[
                            ficha.empresa.segment,
                            ficha.empresa.city,
                            `${ficha.contatos.length} ${ficha.contatos.length === 1 ? "contato" : "contatos"}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className="mr-2 shrink-0 text-right">
                        <span className="block text-[12px] font-medium tabular-nums text-foreground">
                          {ficha.abertos > 0
                            ? `${ficha.abertos} em aberto`
                            : ficha.ganhos > 0
                              ? "cliente"
                              : "sem negócio"}
                        </span>
                        {ficha.mrrGanho > 0 && (
                          <span className="block text-[11px] tabular-nums text-success">
                            {dinheiro(ficha.mrrGanho)}/mês fechado
                          </span>
                        )}
                      </span>
                      {expandida ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      )}
                    </button>

                    {expandida && (
                      <div className="grid min-w-0 gap-5 border-t border-border px-4 pb-4 pt-3 lg:grid-cols-3">
                        {/* A ficha em si: o que se sabe da empresa, em campos. */}
                        <div className="min-w-0">
                          <Subtitulo
                            acao={
                              <button type="button" onClick={() => setEditando(ficha.empresa)} className={juntar(botao.discreto, "h-7")} aria-label={`Editar dados de ${ficha.empresa.name}`}>
                                <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                                Editar
                              </button>
                            }
                          >
                            Dados da empresa
                          </Subtitulo>
                          {(() => {
                            const dados = CAMPOS_DA_EMPRESA
                              .map((campo) => ({ label: campo.label, valor: String((ficha.empresa as unknown as Record<string, unknown>)[campo.id] ?? "").trim() }))
                              .filter((d) => d.valor);
                            if (dados.length === 0 && !ficha.empresa.notes) {
                              return <p className={texto.auxiliar}>Ficha ainda sem dados.</p>;
                            }
                            return (
                              <div>
                                <dl className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
                                  {dados.map((d) => (
                                    <div key={d.label} className="min-w-0">
                                      <dt className={texto.rotulo}>{d.label}</dt>
                                      <dd className={juntar(texto.corpo, "break-words")}>{d.valor}</dd>
                                    </div>
                                  ))}
                                </dl>
                                {ficha.empresa.notes && (
                                  <p className={juntar(superficie.poco, texto.corpo, "mt-2 whitespace-pre-line break-words px-3 py-2 text-muted-foreground")}>
                                    {ficha.empresa.notes}
                                  </p>
                                )}
                              </div>
                            );
                          })()}
                        </div>

                        <div className="min-w-0">
                          <Subtitulo
                            acao={
                              <button type="button" onClick={() => setNovoContatoEm(ficha.empresa.id)} className={juntar(botao.discreto, "h-7")} aria-label={`Adicionar contato em ${ficha.empresa.name}`}>
                                <UserPlus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                                Adicionar
                              </button>
                            }
                          >
                            Pessoas
                          </Subtitulo>
                          {ficha.contatos.length === 0 ? (
                            <p className={texto.auxiliar}>Nenhuma pessoa cadastrada.</p>
                          ) : (
                            <ul className="divide-y divide-border">
                              {ficha.contatos.map((contato) => (
                                <li key={contato.id} className="flex min-w-0 items-center py-1.5">
                                  <User className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                  <span className="min-w-0 flex-1">
                                    <span className={juntar(texto.corpo, "flex min-w-0 items-center font-medium")}>
                                      <span className="truncate">{contato.name}</span>
                                      {contato.is_primary && (
                                        <Star className="ml-1 h-3 w-3 shrink-0 fill-warning text-warning" aria-label="Contato principal" />
                                      )}
                                    </span>
                                    <span className={juntar(texto.auxiliar, "block truncate")}>
                                      {[contato.role, contato.email, contato.whatsapp].filter(Boolean).join(" · ") || "sem dados de contato"}
                                    </span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div className="min-w-0">
                          <Subtitulo>Negócios ({ficha.negocios.length})</Subtitulo>
                          {ficha.negocios.length === 0 ? (
                            <p className={texto.auxiliar}>Nenhum negócio ainda.</p>
                          ) : (
                            <ul className="divide-y divide-border">
                              {ficha.negocios.map((negocio) => (
                                <li key={negocio.id} className="min-w-0">
                                  <button
                                    type="button"
                                    onClick={() => onAbrirLead(negocio)}
                                    className={juntar("flex w-full min-w-0 items-center rounded-sm py-1.5 text-left transition-colors hover:bg-muted/40", foco)}
                                  >
                                    <span className="mr-2 min-w-0 flex-1">
                                      <span className={juntar(texto.corpo, "block truncate font-medium")}>{negocio.name}</span>
                                      <span className={juntar(texto.auxiliar, "block truncate")}>
                                        {rotuloDoEstagio(negocio.stage)}
                                        {negocio.monthly_value > 0 && ` · ${dinheiro(negocio.monthly_value)}/mês`}
                                        {negocio.lost_reason ? ` · ${negocio.lost_reason}` : ""}
                                      </span>
                                    </span>
                                    <span
                                      className={juntar(
                                        etiqueta,
                                        negocio.stage === "ganho"
                                          ? "bg-success/15 text-success"
                                          : negocio.stage === "perdido"
                                            ? "bg-destructive/10 text-destructive"
                                            : "bg-muted text-muted-foreground",
                                      )}
                                    >
                                      {negocio.stage === "ganho" ? "ganho" : negocio.stage === "perdido" ? "perdido" : "aberto"}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Painel>
        )}
      </AreaDeTrabalho>

      {editando && (
        <EditorDeEmpresa
          empresa={editando === "nova" ? null : editando}
          onFechar={() => setEditando(null)}
          onSalvo={async () => {
            setEditando(null);
            await onMudou();
          }}
        />
      )}

      {novoContatoEm && (
        <EditorDeContato
          organizationId={novoContatoEm}
          onFechar={() => setNovoContatoEm(null)}
          onSalvo={async () => {
            setNovoContatoEm(null);
            await onMudou();
          }}
        />
      )}
    </>
  );
}

function Subtitulo({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="mb-1.5 flex h-7 min-w-0 items-center justify-between">
      <h4 className={juntar(texto.rotulo, "min-w-0 truncate")}>{children}</h4>
      {acao}
    </div>
  );
}

function EditorDeEmpresa({
  empresa,
  onFechar,
  onSalvo,
}: {
  empresa: Empresa | null;
  onFechar: () => void;
  onSalvo: () => Promise<void>;
}) {
  const [form, setForm] = useState<Record<string, string>>({
    name: empresa?.name || "",
    notes: empresa?.notes || "",
    ...Object.fromEntries(
      CAMPOS_DA_EMPRESA.map((campo) => [campo.id, String((empresa as unknown as Record<string, unknown> | null)?.[campo.id] ?? "")]),
    ),
  });
  const [salvando, setSalvando] = useState(false);

  // Salvar grava o que tiver: só o nome é exigido.
  const salvar = async () => {
    if (form.name.trim().length < 2) {
      toast.error("A empresa precisa de um nome.");
      return;
    }
    setSalvando(true);
    const id = await salvarEmpresa({ id: empresa?.id, ...form } as never);
    setSalvando(false);
    if (!id) {
      toast.error(`Não foi possível salvar.${ultimoErroDoComercial() ? ` ${ultimoErroDoComercial()}` : ""}`);
      return;
    }
    toast.success(empresa ? "Ficha atualizada." : "Empresa criada.");
    await onSalvo();
  };

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-xl overflow-y-auto pb-0">
        <DialogHeader>
          <DialogTitle className="text-[15px]">{empresa ? empresa.name : "Nova empresa"}</DialogTitle>
        </DialogHeader>
        {/* Uma coluna no celular, duas a partir do sm: campo espremido em
            meia tela e o que fazia o formulario "vazar". */}
        <GrupoDeCampos>
          <CampoDeFormulario rotulo="Nome da empresa" obrigatorio largo>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={campo} autoFocus />
          </CampoDeFormulario>
          {CAMPOS_DA_EMPRESA.map((campo) => (
            <CampoDeFormulario key={campo.id} rotulo={campo.label}>
              <input
                value={form[campo.id] || ""}
                onChange={(e) => setForm({ ...form, [campo.id]: e.target.value })}
                placeholder={campo.dica}
                className={campoDoFormulario}
              />
            </CampoDeFormulario>
          ))}
          <CampoDeFormulario rotulo="O que é bom lembrar sobre ela" largo>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={4} className={juntar(campoTexto, "resize-y")} />
          </CampoDeFormulario>
        </GrupoDeCampos>
        <div className="sticky bottom-0 z-10 -mx-6 flex items-center justify-end border-t border-border bg-background px-6 py-3 [&>*+*]:ml-2">
          <button type="button" onClick={onFechar} className={botao.secundario}>
            Cancelar
          </button>
          <button type="button" disabled={salvando} onClick={() => void salvar()} className={botao.primario}>
            {salvando ? "Salvando…" : empresa ? "Salvar ficha" : "Criar empresa"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Nome local: `campo` dentro do map acima é o campo da empresa (id, label, dica).
const campoDoFormulario = campo;

function EditorDeContato({
  organizationId,
  onFechar,
  onSalvo,
}: {
  organizationId: string;
  onFechar: () => void;
  onSalvo: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: "",
    role: "",
    email: "",
    whatsapp: "",
    is_primary: false,
  });
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    if (form.name.trim().length < 2) {
      toast.error("A pessoa precisa de um nome.");
      return;
    }
    setSalvando(true);
    const id = await salvarContato({ organization_id: organizationId, ...form });
    setSalvando(false);
    if (!id) {
      toast.error(`Não foi possível salvar.${ultimoErroDoComercial() ? ` ${ultimoErroDoComercial()}` : ""}`);
      return;
    }
    toast.success("Contato salvo.");
    await onSalvo();
  };

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Nova pessoa nesta empresa</DialogTitle>
        </DialogHeader>
        <GrupoDeCampos>
          <CampoDeFormulario rotulo="Nome" obrigatorio>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={campo} autoFocus />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Cargo ou papel na decisão">
            <input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="E-mail">
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="WhatsApp">
            <input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} className={campo} />
          </CampoDeFormulario>
        </GrupoDeCampos>
        {/* Empresa com quatro contatos e nenhum principal nao diz por onde
            comecar, e cada pessoa da casa liga para um. */}
        <label className="flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={form.is_primary}
            onChange={(e) => setForm({ ...form, is_primary: e.target.checked })}
            className="mr-2 h-4 w-4"
          />
          <span className={texto.corpo}>É quem atende primeiro</span>
        </label>
        <div className="flex items-center justify-end [&>*+*]:ml-2">
          <button type="button" onClick={onFechar} className={botao.secundario}>
            Cancelar
          </button>
          <button type="button" disabled={salvando} onClick={() => void salvar()} className={botao.primario}>
            Salvar contato
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
