// Testes da sincronização com a nuvem, usando um Supabase simulado em memória.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../www/js/core.js');
const N = require('../www/js/nuvem.js');

/** Supabase falso: tabelas em memória, sessão anônima, RPC registrar_compra e falhas de rede. */
function criarSupabaseFalso() {
  const db = { produtos: [], compras: [], compra_itens: [], listas_atuais: [] };
  const escritas = [];
  const f = { db, escritas, sessao: null, semRede: false, usuarios: 0 };
  const erroRede = () => ({ data: null, error: { message: 'TypeError: Failed to fetch' } });

  f.auth = {
    getSession: async () => (f.semRede ? erroRede() : { data: { session: f.sessao }, error: null }),
    signInAnonymously: async () => {
      if (f.semRede) return erroRede();
      f.sessao = { user: { id: 'usuario-' + (++f.usuarios) } };
      return { data: { user: f.sessao.user, session: f.sessao }, error: null };
    }
  };

  f.from = tabela => {
    const filtros = [];
    let op = 'select', linhas = null, chave = null, selecao = '*', intervalo = null, unico = false;
    const q = {
      select(s) { selecao = s; return q; },
      eq(c, v) { filtros.push(r => r[c] === v); return q; },
      in(c, vs) { filtros.push(r => vs.includes(r[c])); return q; },
      order() { return q; },
      range(a, b) { intervalo = [a, b]; return q; },
      maybeSingle() { unico = true; return q; },
      upsert(l, opcoes) { op = 'upsert'; linhas = [].concat(l); chave = opcoes.onConflict.split(','); return q; },
      delete() { op = 'delete'; return q; },
      then(ok, falha) { return executar().then(ok, falha); }
    };
    async function executar() {
      if (f.semRede) return erroRede();
      const casa = r => filtros.every(fn => fn(r));
      if (op === 'upsert') {
        escritas.push(tabela + ':upsert');
        for (const l of linhas) {
          const i = db[tabela].findIndex(r => chave.every(k => r[k] === l[k]));
          const copia = JSON.parse(JSON.stringify(l));
          if (i >= 0) db[tabela][i] = Object.assign(db[tabela][i], copia); else db[tabela].push(copia);
        }
        return { data: null, error: null };
      }
      if (op === 'delete') {
        escritas.push(tabela + ':delete');
        db[tabela] = db[tabela].filter(r => !casa(r));
        return { data: null, error: null };
      }
      let r = JSON.parse(JSON.stringify(db[tabela].filter(casa)));
      if (selecao.includes('compra_itens')) {
        r = r.map(c => Object.assign(c, { compra_itens: db.compra_itens.filter(i => i.user_id === c.user_id && i.compra_id === c.id) }));
      }
      if (intervalo) r = r.slice(intervalo[0], intervalo[1] + 1);
      return { data: unico ? (r[0] || null) : r, error: null };
    }
    return q;
  };

  // Imita a função SQL registrar_compra (idempotente).
  f.rpc = async (nome, { p_compra: c }) => {
    if (f.semRede) return erroRede();
    escritas.push('rpc:' + nome);
    if (c.totalRealCentavos < 0) return { data: null, error: { code: '23514', message: 'violates check constraint' } };
    const uid = f.sessao.user.id;
    if (db.compras.some(x => x.user_id === uid && x.id === c.id)) return { data: false, error: null };
    db.compras.push({ user_id: uid, id: c.id, nome: c.nome, criada_em: c.criadaEm, finalizada_em: c.finalizadaEm.replace('Z', '+00:00'),
      total_real_centavos: c.totalRealCentavos, total_estimado_centavos: c.totalEstimadoCentavos, quantidade_itens: c.quantidadeItens,
      quantidade_itens_pegos: c.quantidadeItensPegos, quantidade_itens_sem_preco: c.quantidadeItensSemPreco, possui_itens_sem_preco: c.possuiItensSemPreco });
    c.itens.forEach((i, posicao) => db.compra_itens.push({ user_id: uid, compra_id: c.id, posicao, produto_id: i.produtoId,
      nome_produto: i.nomeProdutoSnapshot, unidade: i.unidade, categoria: i.categoria, quantidade: String(i.quantidade),
      preco_unitario_centavos: i.precoUnitarioRealCentavos, subtotal_centavos: i.subtotalCentavos, pego: i.pego,
      preco_referencia_centavos: i.precoReferenciaCentavos, data_preco_referencia: i.dataPrecoReferencia }));
    return { data: true, error: null };
  };
  return f;
}

function armazenamentoFalso() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

/** Um "aparelho": estado local + sincronizador ligado ao Supabase falso. */
function criarAparelho(nuvem, armazenamento) {
  const ap = { estado: C.estadoInicial(), status: null, substituicoes: 0, online: true };
  ap.sinc = N.criarSincronizador({
    cliente: nuvem,
    armazenamento: armazenamento || armazenamentoFalso(),
    obterEstado: () => ap.estado,
    substituirEstado: novo => { ap.estado = C.migrar(novo); ap.substituicoes++; },
    aoMudarStatus: s => { ap.status = s; },
    online: () => ap.online
  });
  return ap;
}

function comprar(estado, itens, quando) {
  for (const [nome, qtd, centavos] of itens) {
    let p = C.encontrarProdutoExato(estado.produtos, nome);
    if (!p) { p = C.novoProduto(nome); estado.produtos.push(p); }
    const item = C.novoItem(p, qtd);
    item.precoUnitarioRealCentavos = centavos;
    estado.listaAtual.itens.push(item);
  }
  return C.finalizarCompra(estado, quando).estado;
}

test('primeira sincronização envia catálogo, compra e lista; a seguinte não reenvia nada', async () => {
  const nuvem = criarSupabaseFalso();
  const ap = criarAparelho(nuvem);
  ap.estado = comprar(ap.estado, [['Arroz', 2, 2500], ['Café', 1, null]], '2026-10-01T15:00:00.000Z');
  ap.estado.listaAtual.itens.push(C.novoItem(ap.estado.produtos[0], 3));

  await ap.sinc.sincronizar();
  assert.equal(ap.status.tipo, 'ok', ap.status.mensagem);
  assert.equal(nuvem.db.produtos.length, 2);
  assert.equal(nuvem.db.compras.length, 1);
  assert.equal(nuvem.db.compra_itens.length, 2);
  assert.equal(nuvem.db.compra_itens[1].preco_unitario_centavos, null, 'preço não informado continua nulo');
  assert.equal(nuvem.db.listas_atuais[0].lista.itens.length, 1);

  nuvem.escritas.length = 0;
  await ap.sinc.sincronizar();
  assert.deepEqual(nuvem.escritas, [], 'nada mudou, nada é enviado');
});

test('compra é registrada uma única vez, mesmo com várias sincronizações e reenvio', async () => {
  const nuvem = criarSupabaseFalso();
  const armazenamento = armazenamentoFalso();
  const ap = criarAparelho(nuvem, armazenamento);
  ap.estado = comprar(ap.estado, [['Leite', 6, 499]]);
  await ap.sinc.sincronizar();
  await ap.sinc.sincronizar();
  // Perdeu o registro do que já foi enviado: reenvia, e o banco ignora a repetição.
  armazenamento.removeItem(N.CHAVE_META);
  await ap.sinc.sincronizar();
  assert.equal(nuvem.db.compras.length, 1);
  assert.equal(nuvem.db.compra_itens.length, 1);
});

test('aparelho com dados locais perdidos restaura tudo da nuvem, sem apagar a cópia', async () => {
  const nuvem = criarSupabaseFalso();
  const armazenamento = armazenamentoFalso();
  const ap = criarAparelho(nuvem, armazenamento);
  ap.estado = comprar(ap.estado, [['Arroz', 2, 2500]], '2026-10-01T15:00:00.000Z');
  ap.estado = comprar(ap.estado, [['Arroz', 3, 2700], ['Azeite', 1, null]], '2026-10-08T15:00:00.000Z');
  ap.estado.listaAtual.nome = 'Compra do mês';
  ap.estado.listaAtual.itens.push(C.novoItem(ap.estado.produtos[0], 1));
  ap.estado.preferencias.limiteCentavos = 30000;
  await ap.sinc.sincronizar();
  const original = JSON.parse(JSON.stringify(ap.estado));

  // Mesmo usuário (sessão e meta intactas), mas o estado local do app se perdeu.
  const ap2 = criarAparelho(nuvem, armazenamento);
  await ap2.sinc.sincronizar();
  assert.equal(ap2.substituicoes, 1);
  assert.equal(ap2.status.restaurado, true);
  assert.deepEqual(ap2.estado, original);
  assert.equal(nuvem.db.produtos.length, 2, 'catálogo da nuvem preservado');
  // A estimativa continua vindo da compra mais recente.
  assert.equal(C.referenciaDePreco(ap2.estado.compras, ap2.estado.produtos[0].id).centavos, 2700);
});

test('sem internet: avisa e não envia; quando volta, envia o que ficou pendente', async () => {
  const nuvem = criarSupabaseFalso();
  const ap = criarAparelho(nuvem);
  ap.online = false;
  ap.estado = comprar(ap.estado, [['Pão', 1, 800]]);
  await ap.sinc.sincronizar();
  assert.equal(ap.status.tipo, 'offline');
  assert.deepEqual(nuvem.escritas, []);

  ap.online = true;
  nuvem.semRede = true; // navegador diz "online", mas a rede falha
  await ap.sinc.sincronizar();
  assert.equal(ap.status.tipo, 'erro');
  assert.match(ap.status.mensagem, /conexão/);

  nuvem.semRede = false;
  await ap.sinc.sincronizar();
  assert.equal(ap.status.tipo, 'ok');
  assert.equal(nuvem.db.compras.length, 1);
});

test('produto excluído do catálogo é apagado na nuvem; compras continuam', async () => {
  const nuvem = criarSupabaseFalso();
  const ap = criarAparelho(nuvem);
  ap.estado = comprar(ap.estado, [['Arroz', 1, 2500]]);
  ap.estado.produtos.push(C.novoProduto('Produto digitado errado'));
  await ap.sinc.sincronizar();
  assert.equal(nuvem.db.produtos.length, 2);
  ap.estado.produtos = ap.estado.produtos.filter(p => p.nome !== 'Produto digitado errado');
  await ap.sinc.sincronizar();
  assert.deepEqual(nuvem.db.produtos.map(p => p.nome), ['Arroz']);
  assert.equal(nuvem.db.compras.length, 1);
});

test('compra recusada pelo banco não trava o envio das outras', async () => {
  const nuvem = criarSupabaseFalso();
  const ap = criarAparelho(nuvem);
  ap.estado = comprar(ap.estado, [['Arroz', 1, 2500]]);
  ap.estado.compras[0].totalRealCentavos = -1; // dado inválido para o banco
  ap.estado = comprar(ap.estado, [['Feijão', 1, 900]]);
  await ap.sinc.sincronizar();
  assert.equal(ap.status.tipo, 'ok');
  assert.equal(ap.status.recusadas, 1);
  assert.equal(nuvem.db.compras.length, 1);
  nuvem.escritas.length = 0;
  await ap.sinc.sincronizar();
  assert.deepEqual(nuvem.escritas, [], 'não fica tentando reenviar a recusada');
});

test('aparelho novo e nuvem vazia: nada é restaurado', async () => {
  const nuvem = criarSupabaseFalso();
  const ap = criarAparelho(nuvem);
  await ap.sinc.sincronizar();
  assert.equal(ap.substituicoes, 0);
  assert.equal(ap.status.tipo, 'ok');
});

test('mensagens de erro de configuração ficam compreensíveis', () => {
  assert.match(N.mensagemDeErro({ message: 'Anonymous sign-ins are disabled' }), /login anônimo/);
  assert.match(N.mensagemDeErro({ message: 'Could not find the table public.produtos in the schema cache' }), /schema\.sql/);
  assert.match(N.mensagemDeErro({ message: 'Invalid API key' }), /config\.js/);
});
