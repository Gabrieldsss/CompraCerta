// Testes das regras de negócio. Executar com: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../www/js/core.js');

const brl = c => C.formatarMoeda(c).replace(/\s/g, ' ');

/** Adiciona um produto à lista atual, reaproveitando o catálogo pelo nome exato. */
function adicionar(estado, nome, quantidade) {
  let produto = C.encontrarProdutoExato(estado.produtos, nome);
  if (!produto) { produto = C.novoProduto(nome); estado.produtos.push(produto); }
  const item = C.novoItem(produto, quantidade);
  estado.listaAtual.itens.push(item);
  return item;
}

function precoDe(texto) {
  const r = C.interpretarPreco(texto);
  assert.ok(r.ok, texto);
  return r.centavos;
}

test('Teste 1 — primeira compra: sem estimativa, subtotal e histórico', () => {
  let estado = C.estadoInicial();
  const arroz = adicionar(estado, 'Arroz', 2);
  let resumo = C.calcularResumo(estado.listaAtual, estado.compras);
  assert.equal(resumo.totalEstimadoCentavos, null);
  assert.equal(resumo.linhas[arroz.id].referencia, null);

  arroz.precoUnitarioRealCentavos = precoDe('25,00');
  resumo = C.calcularResumo(estado.listaAtual, estado.compras);
  assert.equal(resumo.linhas[arroz.id].subtotalRealCentavos, 5000);
  assert.equal(brl(5000), 'R$ 50,00');

  const r = C.finalizarCompra(estado, '2026-10-01T15:00:00.000Z');
  estado = r.estado;
  assert.equal(estado.compras.length, 1);
  assert.equal(r.compra.totalRealCentavos, 5000);
  assert.equal(r.compra.itens[0].subtotalCentavos, 5000);
  assert.equal(r.compra.possuiItensSemPreco, false);
  assert.equal(estado.listaAtual.itens.length, 0, 'nova lista começa vazia');
});

test('Teste 2 e 7 — segunda compra usa a referência mais recente; histórico não muda', () => {
  let estado = C.estadoInicial();
  adicionar(estado, 'Arroz', 2).precoUnitarioRealCentavos = 2500;
  estado = C.finalizarCompra(estado, '2026-10-01T15:00:00.000Z').estado;

  const arroz2 = adicionar(estado, 'arroz', 3); // mesmo produto, outra grafia de maiúsculas
  let resumo = C.calcularResumo(estado.listaAtual, estado.compras);
  const linha = resumo.linhas[arroz2.id];
  assert.equal(linha.referencia.centavos, 2500);
  assert.equal(linha.referencia.data, '2026-10-01T15:00:00.000Z');
  assert.equal(linha.subtotalEstimadoCentavos, 7500);
  assert.equal(resumo.totalEstimadoCentavos, 7500);

  arroz2.precoUnitarioRealCentavos = 2700;
  resumo = C.calcularResumo(estado.listaAtual, estado.compras);
  assert.equal(resumo.linhas[arroz2.id].subtotalRealCentavos, 8100);
  assert.equal(resumo.totalEstimadoCentavos, 7500, 'estimativa continua separada do valor real');
  assert.deepEqual(
    { completa: resumo.comparacao.completa, diferenca: resumo.comparacao.diferencaCentavos },
    { completa: true, diferenca: 600 });

  estado = C.finalizarCompra(estado, '2026-10-08T15:00:00.000Z').estado;
  // Teste 7: compra antiga preserva preço e total originais.
  assert.equal(estado.compras[0].itens[0].precoUnitarioRealCentavos, 2500);
  assert.equal(estado.compras[0].totalRealCentavos, 5000);
  assert.equal(estado.compras[1].totalRealCentavos, 8100);
  assert.equal(estado.compras[1].itens[0].precoReferenciaCentavos, 2500);
  // A compra mais recente passa a ser a referência.
  assert.equal(C.referenciaDePreco(estado.compras, arroz2.produtoId).centavos, 2700);
});

test('Teste 3 — produto novo fica sem estimativa e sem preço automático', () => {
  let estado = C.estadoInicial();
  adicionar(estado, 'Arroz', 1).precoUnitarioRealCentavos = 2500;
  estado = C.finalizarCompra(estado).estado;
  const novo = adicionar(estado, 'Azeite', 1);
  const resumo = C.calcularResumo(estado.listaAtual, estado.compras);
  assert.equal(resumo.linhas[novo.id].referencia, null);
  assert.equal(resumo.linhas[novo.id].subtotalEstimadoCentavos, null);
  assert.equal(novo.precoUnitarioRealCentavos, null);
  assert.equal(resumo.quantidadeSemEstimativa, 1);
});

test('Teste 4 — item sem preço deixa o total parcial e não vale R$ 0,00', () => {
  const estado = C.estadoInicial();
  adicionar(estado, 'Leite', 2).precoUnitarioRealCentavos = 599;
  adicionar(estado, 'Café', 1);
  const resumo = C.calcularResumo(estado.listaAtual, estado.compras);
  assert.equal(resumo.totalRegistradoCentavos, 1198);
  assert.equal(resumo.quantidadeSemPreco, 1);
  assert.equal(resumo.totalCompleto, false);
  const compra = C.finalizarCompra(estado).compra;
  assert.equal(compra.possuiItensSemPreco, true);
  assert.equal(compra.itens[1].precoUnitarioRealCentavos, null);
  assert.equal(compra.itens[1].subtotalCentavos, null);
});

test('Teste 4b — preço zero informado é diferente de preço ausente', () => {
  assert.deepEqual(C.interpretarPreco('0'), { ok: true, centavos: 0 });
  assert.deepEqual(C.interpretarPreco(''), { ok: true, centavos: null });
  const estado = C.estadoInicial();
  adicionar(estado, 'Brinde', 1).precoUnitarioRealCentavos = 0;
  const resumo = C.calcularResumo(estado.listaAtual, estado.compras);
  assert.equal(resumo.quantidadeSemPreco, 0);
  assert.equal(resumo.totalCompleto, true);
});

test('Teste 5 — marcar como pego não informa preço', () => {
  const estado = C.estadoInicial();
  const a = adicionar(estado, 'Pão', 1);
  adicionar(estado, 'Manteiga', 1);
  a.pego = true;
  let resumo = C.calcularResumo(estado.listaAtual, estado.compras);
  assert.equal(resumo.quantidadeItensPegos, 1);
  assert.equal(a.precoUnitarioRealCentavos, null);
  assert.equal(resumo.quantidadeSemPreco, 2);
  a.pego = false;
  resumo = C.calcularResumo(estado.listaAtual, estado.compras);
  assert.equal(resumo.quantidadeItensPegos, 0);
});

test('Teste 6 — dados sobrevivem a serializar e carregar (persistência)', () => {
  let estado = C.estadoInicial();
  adicionar(estado, 'Arroz', 2).precoUnitarioRealCentavos = 2500;
  estado = C.finalizarCompra(estado).estado;
  adicionar(estado, 'Feijão', 1);
  const recarregado = C.migrar(JSON.parse(JSON.stringify(estado)));
  assert.deepEqual(recarregado, estado);
});

test('Teste 8 — valores monetários brasileiros', () => {
  assert.equal(precoDe('5,99'), 599);
  assert.equal(precoDe('12,50'), 1250);
  assert.equal(precoDe('12,5'), 1250);
  assert.equal(precoDe('R$ 1.234,56'), 123456);
  assert.equal(precoDe('5.99'), 599);
  assert.equal(C.interpretarPreco('-1').ok, false);
  assert.equal(C.interpretarPreco('abc').ok, false);
  assert.equal(C.interpretarPreco('1,999').ok, false);
  assert.equal(brl(599), 'R$ 5,99');
  assert.equal(brl(1250), 'R$ 12,50');
  assert.equal(brl(123456), 'R$ 1.234,56');
  // 0,1 + 0,2 sem erro de ponto flutuante; 3 × 5,99 = 17,97
  assert.equal(C.multiplicar(3, 599), 1797);
  assert.equal(C.multiplicar(1, 10) + C.multiplicar(1, 20), 30);
  assert.equal(C.multiplicar(1.5, 1250), 1875);
  assert.equal(C.multiplicar(0.333, 1000), 333);
  assert.equal(C.centavosParaCampo(599), '5,99');
});

test('quantidade — validação', () => {
  assert.deepEqual(C.interpretarQuantidade('2'), { ok: true, valor: 2 });
  assert.deepEqual(C.interpretarQuantidade('1,5'), { ok: true, valor: 1.5 });
  assert.equal(C.interpretarQuantidade('0').ok, false);
  assert.equal(C.interpretarQuantidade('-3').ok, false);
  assert.equal(C.interpretarQuantidade('').ok, false);
  assert.equal(C.interpretarQuantidade('dois').ok, false);
});

test('finalizar duas vezes a mesma lista não duplica a compra', () => {
  const estado = C.estadoInicial();
  adicionar(estado, 'Arroz', 1).precoUnitarioRealCentavos = 2500;
  const primeira = C.finalizarCompra(estado);
  const segunda = C.finalizarCompra(Object.assign({}, primeira.estado, { listaAtual: estado.listaAtual }));
  assert.equal(segunda.duplicada, true);
  assert.equal(segunda.estado.compras.length, 1);
  assert.throws(() => C.finalizarCompra(primeira.estado), /vazia/);
});

test('referência ignora compra recente sem preço e usa a anterior com preço válido', () => {
  let estado = C.estadoInicial();
  adicionar(estado, 'Arroz', 1).precoUnitarioRealCentavos = 2500;
  estado = C.finalizarCompra(estado, '2026-10-01T10:00:00.000Z').estado;
  adicionar(estado, 'Arroz', 1); // sem preço
  estado = C.finalizarCompra(estado, '2026-10-05T10:00:00.000Z').estado;
  const ref = C.referenciaDePreco(estado.compras, estado.produtos[0].id);
  assert.equal(ref.centavos, 2500);
  assert.equal(ref.data, '2026-10-01T10:00:00.000Z');
});

test('compra finalizada é uma cópia: mudar catálogo ou lista não altera o histórico', () => {
  let estado = C.estadoInicial();
  const item = adicionar(estado, 'Arroz', 2);
  item.precoUnitarioRealCentavos = 2500;
  const r = C.finalizarCompra(estado);
  item.precoUnitarioRealCentavos = 9999;
  r.estado.produtos[0].nome = 'Arroz integral';
  assert.equal(r.compra.itens[0].precoUnitarioRealCentavos, 2500);
  assert.equal(r.compra.itens[0].nomeProdutoSnapshot, 'Arroz');
});

test('nomes parecidos são sugeridos, não unificados', () => {
  const produtos = [C.novoProduto('Feijão'), C.novoProduto('Arroz integral'), C.novoProduto('Salsicha')];
  assert.equal(C.encontrarProdutoExato(produtos, '  feijão '), produtos[0]);
  assert.equal(C.encontrarProdutoExato(produtos, 'feijao'), null);
  assert.deepEqual(C.produtosParecidos(produtos, 'feijao').map(p => p.nome), ['Feijão']);
  assert.deepEqual(C.produtosParecidos(produtos, 'arroz').map(p => p.nome), ['Arroz integral']);
  assert.deepEqual(C.produtosParecidos(produtos, 'arr').map(p => p.nome), ['Arroz integral']);
  assert.deepEqual(C.produtosParecidos(produtos, 'sal').map(p => p.nome), ['Salsicha']);
  assert.deepEqual(C.produtosParecidos(produtos, 'leite'), []);
  assert.deepEqual(C.buscarSugestoes(produtos, 'arr').map(p => p.nome), ['Arroz integral']);
});

test('migração dos dados do HTML antigo (compracerta-v2)', () => {
  const antigo = {
    items: [{ id: 'a', name: 'Arroz', qty: 3, category: 'Mercearia', price: null, done: false }],
    budget: 300,
    history: [{ date: '2026-09-01T12:00:00.000Z', total: 50, items: [{ name: 'arroz', qty: 2, category: 'Mercearia', price: 25, done: true }] }],
    listStartedAt: '2026-09-02T12:00:00.000Z'
  };
  const e = C.migrar(antigo);
  assert.equal(e.versao, C.VERSAO_DADOS);
  assert.equal(e.produtos.length, 1, 'mesmo produto pelo nome');
  assert.equal(e.compras.length, 1);
  assert.equal(e.compras[0].totalRealCentavos, 5000);
  assert.equal(e.listaAtual.itens.length, 1);
  assert.equal(e.preferencias.limiteCentavos, 30000);
  const resumo = C.calcularResumo(e.listaAtual, e.compras);
  assert.equal(resumo.totalEstimadoCentavos, 7500);
  assert.throws(() => C.migrar({ versao: 99 }), /mais nova/);
  assert.throws(() => C.migrar({ foo: 1 }), /não reconhecido/);
});
