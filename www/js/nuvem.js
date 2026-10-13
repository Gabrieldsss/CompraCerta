/* CompraCerta — cópia na nuvem (Supabase), funcionando primeiro no aparelho.
   O app grava tudo localmente (funciona sem internet no mercado). Este módulo envia as
   mudanças quando há conexão e restaura da nuvem se os dados locais se perderem.
   Funciona no navegador (window.CCNuvem) e no Node (require) para os testes. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.CCNuvem = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CHAVE_META = 'compracerta-nuvem-v1';
  const PAGINA = 1000;

  /* ---------- Conversões entre o formato do app e as tabelas ---------- */

  const iso = v => (v ? new Date(v).toISOString() : null);
  const numOuNulo = v => (v === null || v === undefined ? null : Number(v));

  function produtoParaLinha(p, userId, agora) {
    return {
      user_id: userId, id: p.id, nome: p.nome, unidade: p.unidade || '', categoria: p.categoria || 'Outros',
      criado_em: p.criadoEm, atualizado_em: agora
    };
  }

  function linhaParaProduto(l) {
    return { id: l.id, nome: l.nome, unidade: l.unidade || '', categoria: l.categoria || 'Outros', criadoEm: iso(l.criado_em) };
  }

  function linhaParaCompra(l) {
    const itens = (l.compra_itens || []).slice().sort((a, b) => a.posicao - b.posicao).map(i => ({
      produtoId: i.produto_id,
      nomeProdutoSnapshot: i.nome_produto,
      unidade: i.unidade || '',
      categoria: i.categoria || 'Outros',
      quantidade: Number(i.quantidade),
      precoUnitarioRealCentavos: numOuNulo(i.preco_unitario_centavos),
      subtotalCentavos: numOuNulo(i.subtotal_centavos),
      pego: !!i.pego,
      precoReferenciaCentavos: numOuNulo(i.preco_referencia_centavos),
      dataPrecoReferencia: iso(i.data_preco_referencia)
    }));
    return {
      id: l.id, nome: l.nome || '', criadaEm: iso(l.criada_em), finalizadaEm: iso(l.finalizada_em), status: 'concluida',
      itens: itens,
      totalRealCentavos: Number(l.total_real_centavos),
      totalEstimadoCentavos: numOuNulo(l.total_estimado_centavos),
      quantidadeItens: Number(l.quantidade_itens),
      quantidadeItensPegos: Number(l.quantidade_itens_pegos),
      quantidadeItensSemPreco: Number(l.quantidade_itens_sem_preco),
      possuiItensSemPreco: !!l.possui_itens_sem_preco
    };
  }

  /** Monta o estado do app (formato v3) a partir das linhas da nuvem. */
  function estadoDaNuvem(produtos, compras, linhaLista) {
    return {
      versao: 3,
      produtos: produtos.map(linhaParaProduto),
      compras: compras.map(linhaParaCompra),
      listaAtual: linhaLista && linhaLista.lista ? linhaLista.lista : null,
      preferencias: (linhaLista && linhaLista.preferencias) || { limiteCentavos: null }
    };
  }

  /** Impressão digital curta de um valor (para saber se algo mudou desde o último envio). */
  function resumoDe(valor) {
    const s = JSON.stringify(valor);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return s.length + ':' + (h >>> 0).toString(36);
  }

  function estaVazio(e) {
    return !e.compras.length && !e.produtos.length && !e.listaAtual.itens.length;
  }

  /** Erro de dados (o banco recusou o conteúdo): não adianta reenviar. Erros de rede/sessão, sim. */
  function erroDeDados(erro) {
    return !!(erro && typeof erro.code === 'string' && /^(22|23)/.test(erro.code));
  }

  function mensagemDeErro(erro) {
    const texto = String((erro && (erro.message || erro.msg)) || erro || '');
    if (/anonymous sign-ins are disabled/i.test(texto)) return 'O login anônimo está desligado no Supabase (Authentication → Sign In / Providers).';
    if (/failed to fetch|network|load failed/i.test(texto)) return 'Sem conexão com a nuvem.';
    if (/relation .* does not exist|could not find the (table|function)/i.test(texto)) return 'As tabelas não foram criadas no Supabase (rode supabase/schema.sql).';
    if (/invalid api key|no api key/i.test(texto)) return 'Chave do Supabase inválida em js/config.js.';
    return texto || 'Erro desconhecido.';
  }

  /* ---------- Sincronizador ---------- */

  /** opcoes: { cliente (supabase-js), obterEstado(), substituirEstado(novo), aoMudarStatus(status),
                armazenamento (como localStorage), online() } */
  function criarSincronizador(o) {
    const cli = o.cliente;
    const online = o.online || (() => true);
    let timer = null, rodando = null, pendente = false, tentativas = 0, restauracaoVerificada = false;
    let status = { tipo: 'aguardando', mensagem: '', ultima: null, usuario: null };

    function mudar(parcial) {
      status = Object.assign({}, status, parcial);
      if (o.aoMudarStatus) o.aoMudarStatus(status);
    }

    function lerMeta(userId) {
      let m = null;
      try { m = JSON.parse(o.armazenamento.getItem(CHAVE_META) || 'null'); } catch (_) { m = null; }
      // Outro usuário (ou nada salvo): considera que nada foi enviado ainda.
      if (!m || m.userId !== userId) {
        m = { userId: userId, produtosEnviados: [], produtosResumo: '', listaResumo: '', comprasEnviadas: [], comprasRecusadas: [] };
      }
      return m;
    }
    function gravarMeta(m) { try { o.armazenamento.setItem(CHAVE_META, JSON.stringify(m)); } catch (_) { /* sem espaço: reenvia depois */ } }

    function verificar(resposta) {
      if (resposta.error) throw resposta.error;
      return resposta.data;
    }

    async function garantirSessao() {
      const atual = verificar(await cli.auth.getSession());
      if (atual && atual.session) return atual.session.user.id;
      return verificar(await cli.auth.signInAnonymously()).user.id;
    }

    async function buscarTodas(montarConsulta) {
      const linhas = [];
      for (let de = 0; ; de += PAGINA) {
        const pagina = verificar(await montarConsulta().range(de, de + PAGINA - 1)) || [];
        linhas.push(...pagina);
        if (pagina.length < PAGINA) return linhas;
      }
    }

    /** Aparelho vazio mas nuvem com dados (ex.: armazenamento local corrompido): restaura antes
        de enviar qualquer coisa, para nunca apagar a cópia da nuvem com um estado vazio. */
    async function talvezRestaurar(userId, meta) {
      if (!estaVazio(o.obterEstado())) return false;
      const produtos = await buscarTodas(() => cli.from('produtos').select('*').eq('user_id', userId).order('criado_em').order('id'));
      const compras = await buscarTodas(() => cli.from('compras').select('*, compra_itens(*)').eq('user_id', userId).order('finalizada_em'));
      const lista = verificar(await cli.from('listas_atuais').select('*').eq('user_id', userId).maybeSingle());
      const listaTemItens = !!(lista && lista.lista && Array.isArray(lista.lista.itens) && lista.lista.itens.length);
      if (!produtos.length && !compras.length && !listaTemItens) return false;
      o.substituirEstado(estadoDaNuvem(produtos, compras, lista));
      meta.produtosEnviados = produtos.map(p => p.id);
      meta.comprasEnviadas = compras.map(c => c.id);
      meta.produtosResumo = ''; // reenvia catálogo e lista já validados pelo app (operações idempotentes)
      meta.listaResumo = '';
      gravarMeta(meta);
      return true;
    }

    async function executar() {
      if (!online()) {
        mudar({ tipo: 'offline', mensagem: 'Sem internet. Tudo continua salvo no aparelho e será enviado depois.' });
        return;
      }
      mudar({ tipo: 'sincronizando', mensagem: '' });
      const userId = await garantirSessao();
      const meta = lerMeta(userId);
      let restaurado = false;
      if (!restauracaoVerificada) {
        restaurado = await talvezRestaurar(userId, meta);
        restauracaoVerificada = true;
      }
      const e = o.obterEstado();
      const agora = new Date().toISOString();

      // 1. Catálogo de produtos
      const resumoProdutos = resumoDe(e.produtos);
      if (resumoProdutos !== meta.produtosResumo) {
        const linhas = e.produtos.map(p => produtoParaLinha(p, userId, agora));
        for (let i = 0; i < linhas.length; i += 500) {
          verificar(await cli.from('produtos').upsert(linhas.slice(i, i + 500), { onConflict: 'user_id,id' }));
        }
        const atuais = new Set(e.produtos.map(p => p.id));
        const excluidos = meta.produtosEnviados.filter(id => !atuais.has(id));
        if (excluidos.length) verificar(await cli.from('produtos').delete().eq('user_id', userId).in('id', excluidos));
        meta.produtosEnviados = Array.from(atuais);
        meta.produtosResumo = resumoProdutos;
        gravarMeta(meta);
      }

      // 2. Compras finalizadas: cada uma é enviada uma vez (o banco ignora repetições).
      const enviadas = new Set(meta.comprasEnviadas);
      const recusadas = new Set(meta.comprasRecusadas);
      for (const compra of e.compras) {
        if (enviadas.has(compra.id) || recusadas.has(compra.id)) continue;
        const r = await cli.rpc('registrar_compra', { p_compra: compra });
        if (r.error && erroDeDados(r.error)) {
          meta.comprasRecusadas.push(compra.id); // conteúdo inválido para o banco: não tenta de novo
          gravarMeta(meta);
          continue;
        }
        verificar(r);
        meta.comprasEnviadas.push(compra.id);
        gravarMeta(meta);
      }

      // 3. Lista atual e preferências
      const resumoLista = resumoDe([e.listaAtual, e.preferencias]);
      if (resumoLista !== meta.listaResumo) {
        verificar(await cli.from('listas_atuais').upsert(
          { user_id: userId, lista: e.listaAtual, preferencias: e.preferencias, atualizada_em: agora },
          { onConflict: 'user_id' }));
        meta.listaResumo = resumoLista;
        gravarMeta(meta);
      }

      tentativas = 0;
      mudar({ tipo: 'ok', mensagem: restaurado ? 'Dados restaurados da nuvem.' : '', ultima: agora, usuario: userId,
        recusadas: meta.comprasRecusadas.length, restaurado: restaurado });
    }

    function sincronizar() {
      if (rodando) { pendente = true; return rodando; }
      rodando = (async () => {
        try {
          await executar();
        } catch (erro) {
          tentativas++;
          mudar({ tipo: 'erro', mensagem: mensagemDeErro(erro), restaurado: false });
          agendar(Math.min(300000, 15000 * Math.pow(2, tentativas - 1))); // 15 s, 30 s, 1 min… até 5 min
        } finally {
          rodando = null;
          if (pendente) { pendente = false; agendar(300); }
        }
      })();
      return rodando;
    }

    function agendar(ms) {
      clearTimeout(timer);
      timer = setTimeout(sincronizar, ms === undefined ? 1500 : ms);
      if (timer && timer.unref) timer.unref(); // Node (testes): não segura o processo aberto
    }

    return { agendar: agendar, sincronizar: sincronizar, status: () => status };
  }

  /** No navegador/APK: cria o cliente com a configuração de js/config.js. Sem configuração, retorna null. */
  function iniciar(config, opcoes) {
    const lib = typeof supabase !== 'undefined' ? supabase : null;
    if (!config || !config.supabaseUrl || !config.supabaseChave || !lib) {
      if (opcoes.aoMudarStatus) opcoes.aoMudarStatus({ tipo: 'desligada', mensagem: 'Nuvem não configurada: os dados ficam só neste aparelho.' });
      return null;
    }
    const cliente = lib.createClient(config.supabaseUrl, config.supabaseChave, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'compracerta-auth' }
    });
    const s = criarSincronizador(Object.assign({
      cliente: cliente, armazenamento: window.localStorage, online: () => navigator.onLine !== false
    }, opcoes));
    window.addEventListener('online', () => s.agendar(0));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') s.agendar(0); });
    s.agendar(0);
    return s;
  }

  return {
    CHAVE_META, produtoParaLinha, linhaParaProduto, linhaParaCompra, estadoDaNuvem, resumoDe, estaVazio,
    erroDeDados, mensagemDeErro, criarSincronizador, iniciar
  };
});
