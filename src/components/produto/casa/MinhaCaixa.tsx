import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, LogOut, MailOpen } from "lucide-react";
import { Avatar, Card, Chip, EmptyState, PillTabs } from "@/components/ds";
import { CampoDeFormulario, Carregando, EstadoDeErro, GrupoDeCampos, botao, campo, juntar, texto } from "@/components/sistema";
import CaixaPorPrioridade from "@/components/correio/CaixaPorPrioridade";
import { QuadroDaCaixa } from "@/components/correio/AreasDoCorreio";
import { carregarEmail, fraseDoErro, listarContasDaCasa } from "@/lib/produto/api";
import { entrarPelaCasa, sairPelaCasa, type CaixaDoCorreio } from "@/lib/produto/email-central";
import { caixasParaEntrar, type CaixaParaEntrar } from "@/lib/produto/acessos";
import { central } from "@/lib/produto/central-de-acessos";

/**
 * Minha caixa (19/11/2026, pedido do dono: "entrar e ver exatamente como aparece para o cliente,
 * colocando o login e a senha e selecionando qual caixa eu quero"). A casa escolhe a caixa (o login é o
 * endereço dela), digita a senha e o correio abre com as mesmas telas do cliente (caixa por prioridade e
 * quadro). A senha não é gravada: fica na memória desta aba (email-central) e some ao sair da caixa,
 * ao trocar de tela ou ao recarregar. A função produto-correio confere a senha no provedor.
 */

type Area = "caixa" | "quadro";

export default function MinhaCaixa() {
  const qc = useQueryClient();
  const email = useQuery({ queryKey: ["produto", "casa", "email", "todas"], queryFn: () => carregarEmail() });
  const contas = useQuery({ queryKey: ["produto", "casa", "contas"], queryFn: listarContasDaCasa });
  const [escolhida, setEscolhida] = useState("");
  const [senha, setSenha] = useState("");
  const [ver, setVer] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const [erro, setErro] = useState("");
  const [aberta, setAberta] = useState<CaixaParaEntrar | null>(null);
  const [area, setArea] = useState<Area>("caixa");

  const caixas = useMemo(() => {
    const nomes: Record<string, string> = {};
    (contas.data || []).forEach((c) => {
      nomes[c.id] = c.nome;
    });
    return email.data ? caixasParaEntrar(email.data.caixas, email.data.dominios, nomes) : [];
  }, [email.data, contas.data]);
  const empresas = useMemo(() => {
    const grupos: Array<{ empresa: string; caixas: CaixaParaEntrar[] }> = [];
    caixas.forEach((c) => {
      const g = grupos.filter((x) => x.empresa === c.empresa)[0];
      if (g) g.caixas.push(c);
      else grupos.push({ empresa: c.empresa, caixas: [c] });
    });
    return grupos;
  }, [caixas]);
  const selecionada = caixas.filter((c) => c.id === escolhida)[0] || null;
  // A senha guardada no cofre (central de acessos): preencher sem digitar. Ler fica no histórico da empresa.
  const guardada = !!selecionada && !!email.data && email.data.caixas.some((c) => c.id === selecionada.id && (c as { tem_segredo?: boolean }).tem_segredo === true);
  const [buscandoNoCofre, setBuscandoNoCofre] = useState(false);
  const usarDoCofre = async () => {
    if (!selecionada) return;
    setBuscandoNoCofre(true);
    setErro("");
    try {
      setSenha((await central.mostrarSenha(selecionada.id)).senha);
    } catch (e) {
      setErro(fraseDoErro(e, "Não foi possível abrir o cofre agora."));
    } finally {
      setBuscandoNoCofre(false);
    }
  };

  // Ao sair desta tela, a senha some da memória e as mensagens lidas saem do cache.
  useEffect(
    () => () => {
      sairPelaCasa();
      qc.removeQueries({ queryKey: ["produto", "correio"] });
    },
    [qc],
  );

  const entrar = async () => {
    if (!selecionada) return setErro("Escolha a caixa.");
    if (!senha) return setErro("Digite a senha da caixa.");
    setEntrando(true);
    setErro("");
    try {
      await entrarPelaCasa(selecionada.id, senha);
      setSenha("");
      setArea("caixa");
      setAberta(selecionada);
    } catch (e) {
      setErro(fraseDoErro(e, "Não foi possível entrar agora."));
    } finally {
      setEntrando(false);
    }
  };
  const sair = () => {
    if (aberta) {
      sairPelaCasa(aberta.id);
      qc.removeQueries({ queryKey: ["produto", "correio"] });
    }
    setAberta(null);
  };

  if (email.isError) {
    return <EstadoDeErro titulo={fraseDoErro(email.error, "Não foi possível carregar as caixas.")} acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void email.refetch()}>Tentar de novo</button>} />;
  }

  if (aberta) {
    const caixa: CaixaDoCorreio = { id: aberta.id, endereco: aberta.endereco, pessoa: "", minha: false, dono: null, dominio: aberta.endereco.split("@")[1] || "", provedor: "", ligado: true };
    return (
      <div className="min-w-0 space-y-4" data-minha-caixa-aberta={aberta.id}>
        <div className="flex min-w-0 flex-wrap items-center [&>*]:mb-2">
          <span className="mr-4 flex min-w-0 flex-1 basis-[240px] items-center">
            <Avatar icon={<MailOpen className="h-4 w-4" />} tone="accent" className="mr-3" />
            <span className="min-w-0">
              <span className={juntar(texto.corpo, "block truncate font-medium")}>{aberta.endereco}</span>
              <span className={juntar(texto.auxiliar, "block truncate")}>{aberta.empresa}</span>
            </span>
          </span>
          <Chip tone="accent" dot className="mr-3">Como o cliente vê</Chip>
          <PillTabs<Area> label="Visão da caixa" variant="soft" size="sm" value={area} onChange={setArea} tabs={[{ value: "caixa", label: "Caixa" }, { value: "quadro", label: "Quadro" }]} className="mr-3" />
          <button type="button" className={botao.secundario} onClick={sair} data-sair-da-caixa="">
            <LogOut className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Sair da caixa
          </button>
        </div>
        {/* O correio do cliente é sempre claro: aqui também, para ver igual. */}
        <div className="light min-w-0 rounded-xl bg-background p-3 text-foreground sm:p-4" data-correio="como-o-cliente">
          {area === "quadro" ? <QuadroDaCaixa key={caixa.id} caixa={caixa} /> : <CaixaPorPrioridade key={caixa.id} caixa={caixa} eu={null} />}
        </div>
      </div>
    );
  }

  return (
    <Card title="Entrar numa caixa" icon={<Inbox className="h-4 w-4" />} help="O login é o endereço da caixa. Use a senha da caixa (a mesma do webmail). Ela não é guardada: vale enquanto esta tela estiver aberta. Cada entrada fica no histórico da empresa.">
      {email.isLoading || contas.isLoading ? (
        <Carregando linhas={3} rotulo="Carregando as caixas" />
      ) : !caixas.length ? (
        <EmptyState icon={<Inbox className="h-5 w-5" />} title="Nenhuma caixa criada ainda" description="As caixas aparecem aqui quando a migração criar as primeiras." />
      ) : (
        <form
          className="min-w-0"
          onSubmit={(e) => {
            e.preventDefault();
            void entrar();
          }}
          data-entrar-na-caixa=""
        >
          <GrupoDeCampos colunas={2}>
            <CampoDeFormulario rotulo="Login (caixa)" erro={erro && !selecionada ? erro : undefined}>
              <select className={campo} value={escolhida} onChange={(e) => { setEscolhida(e.target.value); setErro(""); }} data-escolher-caixa="">
                <option value="">Escolha a caixa</option>
                {empresas.map((g) => (
                  <optgroup key={g.empresa} label={g.empresa}>
                    {g.caixas.map((c) => (
                      <option key={c.id} value={c.id} disabled={!c.pronta}>
                        {c.endereco}{c.pronta ? "" : " (em preparação)"}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Senha" erro={erro && selecionada ? erro : undefined}>
              <span className="flex min-w-0 items-center">
                <input type={ver ? "text" : "password"} value={senha} onChange={(e) => setSenha(e.target.value)} className={juntar(campo, "min-w-0 flex-1")} autoComplete="off" aria-label="Senha da caixa" data-senha-da-caixa="" />
                <button type="button" className={juntar(botao.discreto, "ml-2 h-9")} onClick={() => setVer((v) => !v)} aria-pressed={ver}>
                  {ver ? "Ocultar" : "Mostrar"}
                </button>
              </span>
            </CampoDeFormulario>
          </GrupoDeCampos>
          <div className="mt-4 flex flex-wrap items-center justify-end [&>*]:mb-2">
            {guardada && (
              <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={() => void usarDoCofre()} disabled={buscandoNoCofre} data-senha-do-cofre="">
                {buscandoNoCofre ? "Abrindo o cofre..." : "Usar a senha do cofre"}
              </button>
            )}
            <button type="submit" className={botao.primario} disabled={entrando || !selecionada || !senha} data-entrar="">
              {entrando ? "Entrando..." : "Entrar na caixa"}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
