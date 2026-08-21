import { useMemo, useState } from "react";
import { Building2, ChevronDown, ChevronRight, Plus, Search, Star, User } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type Contato,
  type Empresa,
  type Lead,
  dinheiro,
  fichaDaEmpresa,
  rotuloDoEstagio,
  salvarContato,
  salvarEmpresa,
} from "@/lib/comercial";

/**
 * As fichas de empresa: a metade do CRM que uma lista de leads nao tem.
 *
 * O funil mostra o negocio de agora. Esta tela mostra a EMPRESA ao longo do
 * tempo: quantas vezes a casa conversou com ela, quem sao as pessoas, o que
 * fechou e o que nao fechou. E o que faz a segunda conversa comecar de onde
 * a primeira parou.
 */

interface Props {
  empresas: Empresa[];
  contatos: Contato[];
  leads: Lead[];
  onAbrirLead: (lead: Lead) => void;
  onMudou: () => Promise<unknown>;
}

export default function EmpresasCRM({
  empresas,
  contatos,
  leads,
  onAbrirLead,
  onMudou,
}: Props) {
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);
  const [editando, setEditando] = useState<Empresa | "nova" | null>(null);
  const [novoContatoEm, setNovoContatoEm] = useState<string | null>(null);

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

  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setEditando("nova")}
          className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-3.5 text-[12.5px] font-semibold text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          Nova empresa
        </button>
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar empresa"
            className="h-10 pl-9"
            aria-label="Buscar empresa"
          />
        </div>
      </div>

      {fichas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium text-foreground">Nenhuma empresa ainda</p>
          <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-relaxed text-muted-foreground">
            Toda empresa que entra no funil ganha ficha aqui, com as pessoas dela e o
            histórico de negócios. É o que faz a segunda conversa começar de onde a
            primeira parou.
          </p>
        </div>
      ) : (
        fichas.map((ficha) => {
          const expandida = aberta === ficha.empresa.id;
          return (
            <div
              key={ficha.empresa.id}
              className="rounded-2xl border border-border bg-card p-3"
            >
              <button
                type="button"
                onClick={() => setAberta(expandida ? null : ficha.empresa.id)}
                className="flex w-full items-start gap-2 text-left"
              >
                <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-foreground">
                    {ficha.empresa.name}
                  </span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">
                    {[
                      ficha.empresa.segment,
                      ficha.empresa.city,
                      `${ficha.contatos.length} ${ficha.contatos.length === 1 ? "contato" : "contatos"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[10.5px] font-semibold tabular-nums text-foreground">
                    {ficha.abertos > 0
                      ? `${ficha.abertos} em aberto`
                      : ficha.ganhos > 0
                        ? "cliente"
                        : "sem negócio"}
                  </span>
                  {ficha.mrrGanho > 0 && (
                    <span className="block text-[10px] tabular-nums text-success">
                      {dinheiro(ficha.mrrGanho)}/mês fechado
                    </span>
                  )}
                </span>
                {expandida ? (
                  <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </button>

              {expandida && (
                <div className="mt-3 space-y-3 border-t border-border pt-3">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Pessoas
                      </p>
                      <button
                        type="button"
                        onClick={() => setNovoContatoEm(ficha.empresa.id)}
                        className="text-[11px] font-semibold text-primary hover:underline"
                      >
                        Adicionar contato
                      </button>
                    </div>
                    <div className="mt-1.5 space-y-1">
                      {ficha.contatos.map((contato) => (
                        <div
                          key={contato.id}
                          className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5"
                        >
                          <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1 truncate text-[12px] font-medium text-foreground">
                              {contato.name}
                              {contato.is_primary && (
                                <Star
                                  className="h-3 w-3 shrink-0 fill-warning text-warning"
                                  aria-label="Contato principal"
                                />
                              )}
                            </span>
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {[contato.role, contato.email, contato.whatsapp]
                                .filter(Boolean)
                                .join(" · ") || "sem dados de contato"}
                            </span>
                          </span>
                        </div>
                      ))}
                      {ficha.contatos.length === 0 && (
                        <p className="rounded-lg border border-dashed border-border px-2.5 py-2 text-center text-[10.5px] text-muted-foreground">
                          Nenhuma pessoa cadastrada.
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Negócios ({ficha.negocios.length})
                    </p>
                    <div className="mt-1.5 space-y-1">
                      {ficha.negocios.map((negocio) => (
                        <button
                          key={negocio.id}
                          type="button"
                          onClick={() => onAbrirLead(negocio)}
                          className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-left hover:border-primary/40"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-medium text-foreground">
                              {negocio.name}
                            </span>
                            <span className="block text-[10px] text-muted-foreground">
                              {rotuloDoEstagio(negocio.stage)}
                              {negocio.monthly_value > 0 &&
                                ` · ${dinheiro(negocio.monthly_value)}/mês`}
                              {negocio.lost_reason ? ` · ${negocio.lost_reason}` : ""}
                            </span>
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                              negocio.stage === "ganho"
                                ? "bg-success/15 text-success"
                                : negocio.stage === "perdido"
                                  ? "bg-destructive/10 text-destructive"
                                  : "bg-secondary text-muted-foreground"
                            }`}
                          >
                            {negocio.stage === "ganho"
                              ? "ganho"
                              : negocio.stage === "perdido"
                                ? "perdido"
                                : "aberto"}
                          </span>
                        </button>
                      ))}
                      {ficha.negocios.length === 0 && (
                        <p className="rounded-lg border border-dashed border-border px-2.5 py-2 text-center text-[10.5px] text-muted-foreground">
                          Nenhum negócio ainda.
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setEditando(ficha.empresa)}
                    className="text-[11px] font-semibold text-primary hover:underline"
                  >
                    Editar dados da empresa
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}

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
  const [form, setForm] = useState({
    name: empresa?.name || "",
    segment: empresa?.segment || "",
    city: empresa?.city || "",
    site: empresa?.site || "",
    notes: empresa?.notes || "",
  });
  const [salvando, setSalvando] = useState(false);

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md">
        <DialogHeader>
          <DialogTitle>{empresa ? empresa.name : "Nova empresa"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Nome da empresa"
            className="h-10"
            autoFocus
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={form.segment}
              onChange={(e) => setForm({ ...form, segment: e.target.value })}
              placeholder="Ramo"
              className="h-10"
            />
            <Input
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              placeholder="Cidade"
              className="h-10"
            />
          </div>
          <Input
            value={form.site}
            onChange={(e) => setForm({ ...form, site: e.target.value })}
            placeholder="Site ou Instagram"
            className="h-10"
          />
          <Input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="O que é bom lembrar sobre ela"
            className="h-10"
          />
          <button
            type="button"
            disabled={salvando}
            onClick={async () => {
              if (form.name.trim().length < 2) {
                toast.error("A empresa precisa de um nome.");
                return;
              }
              setSalvando(true);
              const id = await salvarEmpresa({ id: empresa?.id, ...form });
              setSalvando(false);
              if (!id) {
                toast.error("Não foi possível salvar.");
                return;
              }
              toast.success("Empresa salva.");
              await onSalvo();
            }}
            className="h-11 w-full rounded-xl bg-primary text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            Salvar empresa
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

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

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md">
        <DialogHeader>
          <DialogTitle>Nova pessoa nesta empresa</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Nome"
            className="h-10"
            autoFocus
          />
          <Input
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            placeholder="Cargo ou papel na decisão"
            className="h-10"
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="E-mail"
              className="h-10"
            />
            <Input
              value={form.whatsapp}
              onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
              placeholder="WhatsApp"
              className="h-10"
            />
          </div>
          {/* Empresa com quatro contatos e nenhum principal nao diz por onde
              comecar, e cada pessoa da casa liga para um. */}
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2">
            <input
              type="checkbox"
              checked={form.is_primary}
              onChange={(e) => setForm({ ...form, is_primary: e.target.checked })}
              className="h-4 w-4"
            />
            <span className="text-[11.5px] text-foreground">
              É quem atende primeiro
            </span>
          </label>
          <button
            type="button"
            disabled={salvando}
            onClick={async () => {
              if (form.name.trim().length < 2) {
                toast.error("A pessoa precisa de um nome.");
                return;
              }
              setSalvando(true);
              const id = await salvarContato({ organization_id: organizationId, ...form });
              setSalvando(false);
              if (!id) {
                toast.error("Não foi possível salvar.");
                return;
              }
              toast.success("Contato salvo.");
              await onSalvo();
            }}
            className="h-11 w-full rounded-xl bg-primary text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            Salvar contato
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
