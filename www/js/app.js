/* CompraCerta — interface. Depende de js/core.js (window.CCCore). */
(function () {
  'use strict';
  const C = window.CCCore;
  const CHAVE = 'compracerta-v3';
  // Chaves usadas pelo HTML antigo; o segundo valor indica se preço 0 significava "não informado".
  const CHAVES_ANTIGAS = [['compracerta-v2', false], ['compracerta-v1', true]];
  const TITULOS = { lista: 'Lista atual', historico: 'Histórico', produtos: 'Produtos', compra: 'Detalhes da compra' };

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const moeda = C.formatarMoeda;
  const qtd = C.formatarQuantidade;
  const qtdCampo = q => String(q).replace('.', ',');
  const dataCurta = iso => new Date(iso).toLocaleDateString('pt-BR');
  const dataHora = iso => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);
  const unidadeDe = u => (u ? ' ' + esc(u) : '');

  let estado = C.estadoInicial();
  let filtro = 'todos';
  let produtoEscolhidoId = null; // produto tocado nas sugestões do campo "Adicionar produto"
  let finalizando = false;
  let armazenamentoOk = true;
  let entradaInterna = false; // a tela de detalhes foi aberta a partir do próprio app
  let nuvem = null; // sincronizador com o Supabase (null = só no aparelho)
  const Cap = window.Capacitor;
  const nativo = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform()); // rodando dentro do APK

  /* ---------- Armazenamento ---------- */

  function avisoArmazenamento(msg) {
    const el = $('avisoArmazenamento');
    el.textContent = msg;
    el.hidden = !msg;
  }

  function carregar() {
    let bruto;
    try { bruto = localStorage.getItem(CHAVE); }
    catch (e) {
      armazenamentoOk = false;
      avisoArmazenamento('Este navegador bloqueou o armazenamento local. As alterações não serão salvas.');
      return;
    }
    if (bruto) {
      try { estado = C.migrar(JSON.parse(bruto)); }
      catch (e) {
        // Não descarta dados ilegíveis: guarda uma cópia antes de recomeçar.
        try { localStorage.setItem(CHAVE + '-ilegivel-' + Date.now(), bruto); } catch (_) { /* sem espaço */ }
        avisoArmazenamento('Os dados salvos não puderam ser lidos (' + e.message + '). Uma cópia foi preservada e o app começou vazio.');
      }
      return;
    }
    for (const [chave, zeroEhAusente] of CHAVES_ANTIGAS) {
      try {
        const antigo = localStorage.getItem(chave);
        if (antigo) {
          estado = C.migrar(JSON.parse(antigo), { zeroEhAusente });
          setTimeout(() => toast('Os dados da versão anterior foram importados.'), 300);
          return;
        }
      } catch (e) { /* formato antigo ilegível: ignora */ }
    }
  }

  /** Grava tudo. Retorna false (e mostra aviso) se o navegador recusar. */
  function salvar() {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(estado));
      if (!armazenamentoOk) { armazenamentoOk = true; avisoArmazenamento(''); }
      if (nuvem) nuvem.agendar(); // envia para a nuvem logo depois (agrupa alterações seguidas)
      return true;
    } catch (e) {
      armazenamentoOk = false;
      avisoArmazenamento('Não foi possível salvar neste aparelho (armazenamento cheio ou bloqueado). As últimas alterações podem se perder ao fechar o app.');
      return false;
    }
  }

  // Mantém duas abas abertas em sincronia.
  window.addEventListener('storage', e => {
    if (e.key !== CHAVE || !e.newValue) return;
    try { estado = C.migrar(JSON.parse(e.newValue)); mostrarTela(); } catch (_) { /* ignora */ }
  });

  /* ---------- Avisos e folhas (diálogos) ---------- */

  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('mostrar');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('mostrar'), 2800);
  }

  /** Abre a folha inferior e resolve com o `value` do botão tocado ('' se fechada sem escolha).
      opcoes.validar(valor, form) pode retornar false para manter a folha aberta. */
  let folhaAberta = false;
  let concluirFolhaAtual = null;

  /** Fecha a folha aberta na hora (sem esperar o evento "close"), resolvendo com ''. */
  function fecharFolha() { if (concluirFolhaAtual) concluirFolhaAtual(''); }

  function abrirFolha(html, opcoes) {
    opcoes = opcoes || {};
    const dlg = $('folha');
    const form = $('folhaForm');
    if (folhaAberta) return Promise.resolve(''); // nunca empilha folhas (ex.: toque duplo)
    folhaAberta = true;
    form.innerHTML = '<div class="alca" aria-hidden="true"></div>' + html;
    return new Promise(resolve => {
      const concluir = valor => {
        if (!folhaAberta) return;
        folhaAberta = false;
        concluirFolhaAtual = null;
        form.removeEventListener('click', aoClicar);
        form.removeEventListener('submit', aoEnviar);
        dlg.removeEventListener('close', aoFechar);
        if (dlg.open) dlg.close();
        resolve(valor);
      };
      const aoClicar = e => {
        const btn = e.target.closest('button[value]');
        if (!btn) return;
        e.preventDefault();
        if (btn.disabled || (opcoes.validar && opcoes.validar(btn.value, form) === false)) return;
        concluir(btn.value);
      };
      const aoEnviar = e => {
        e.preventDefault();
        const padrao = form.querySelector('button[data-padrao]');
        if (padrao) padrao.click();
      };
      // Fechada por Esc, botão "voltar" do Android ou toque fora. O evento "close" chega
      // de forma assíncrona; se a folha já foi reaberta, ele é de uma folha anterior e é ignorado.
      const aoFechar = () => { if (!dlg.open) concluir(''); };
      concluirFolhaAtual = concluir;
      form.addEventListener('click', aoClicar);
      form.addEventListener('submit', aoEnviar);
      dlg.addEventListener('close', aoFechar);
      dlg.showModal();
      const foco = form.querySelector('[data-foco]');
      if (foco) foco.focus();
    });
  }

  // Tocar fora da folha fecha sem escolher nada.
  $('folha').addEventListener('click', e => { if (e.target === $('folha')) $('folha').close(); });

  async function confirmar(titulo, mensagem, textoOk, perigo) {
    const r = await abrirFolha(
      '<h2 id="folhaTitulo">' + esc(titulo) + '</h2><p class="sub">' + esc(mensagem) + '</p>' +
      '<div class="botoes"><button class="btn ' + (perigo ? 'perigo' : 'primario') + '" value="ok">' + esc(textoOk) + '</button>' +
      '<button class="btn texto" value="">Cancelar</button></div>');
    return r === 'ok';
  }

  function mostrarErro(el, msg) { el.textContent = msg; el.hidden = !msg; }

  // Botões − / + de quantidade (formulário principal e folhas).
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-passo]');
    if (!b) return;
    const input = b.parentElement.querySelector('input');
    const q = C.interpretarQuantidade(input.value);
    const atual = q.ok ? q.valor : 1;
    const novo = Math.round((atual + Number(b.dataset.passo)) * 1000) / 1000;
    input.value = qtdCampo(novo > 0 ? novo : atual);
    input.classList.remove('invalido');
  });

  function baixar(conteudo, nomeArquivo, tipo) {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo + ';charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function compartilhar(texto, titulo, nomeArquivo) {
    try {
      if (navigator.share) { await navigator.share({ title: titulo, text: texto }); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(texto);
        toast('Texto copiado para a área de transferência.');
        return;
      }
      baixar('﻿' + texto, nomeArquivo, 'text/plain');
    } catch (e) {
      if (e.name !== 'AbortError') toast('Não foi possível compartilhar.');
    }
  }

  /* ---------- Navegação ---------- */

  function rotaAtual() {
    const [tela, id] = location.hash.slice(1).split('/');
    return TITULOS[tela] ? { tela, id: id ? decodeURIComponent(id) : null } : { tela: 'lista', id: null };
  }

  function mostrarTela() {
    const { tela, id } = rotaAtual();
    $('telaLista').hidden = tela !== 'lista';
    $('telaHistorico').hidden = tela !== 'historico';
    $('telaProdutos').hidden = tela !== 'produtos';
    $('telaDetalhe').hidden = tela !== 'compra';
    $('barraResumo').hidden = tela !== 'lista';
    document.body.classList.toggle('sem-barra', tela !== 'lista');
    $('btnMenu').hidden = tela !== 'lista';
    $('btnVoltar').hidden = tela !== 'compra';
    $('tituloTela').textContent = TITULOS[tela];
    const abaAtiva = tela === 'compra' ? 'historico' : tela;
    document.querySelectorAll('.aba').forEach(a => {
      const ativa = a.dataset.tela === abaAtiva;
      a.classList.toggle('ativa', ativa);
      if (ativa) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (tela === 'historico') renderHistorico();
    else if (tela === 'produtos') renderProdutos();
    else if (tela === 'compra') renderDetalhe(id);
    else renderLista();
  }

  window.addEventListener('hashchange', () => { mostrarTela(); window.scrollTo(0, 0); });
  document.addEventListener('click', e => { if (e.target.closest('[data-interno]')) entradaInterna = true; });
  $('btnVoltar').addEventListener('click', () => {
    if (entradaInterna) history.back();
    else location.replace('#historico');
  });

  /* ---------- Lista atual ---------- */

  const acharItem = id => estado.listaAtual.itens.find(i => i.id === id);
  const categoriaDe = produtoId => (estado.produtos.find(p => p.id === produtoId) || {}).categoria || 'Outros';

  function htmlItem(item, linha) {
    const nome = esc(item.nomeProdutoSnapshot);
    const ref = linha.referencia;
    const estimativa = ref
      ? '<span class="ref">Estim. ' + moeda(linha.subtotalEstimadoCentavos) + ' · ref. ' + moeda(ref.centavos) + ' em ' + dataCurta(ref.data) + '</span>'
      : '<span class="sem-est">Sem estimativa</span>';
    const subtotal = linha.subtotalRealCentavos !== null
      ? '<span class="subtotal">Subtotal ' + moeda(linha.subtotalRealCentavos) + '</span>'
      : '<span class="subtotal pendente">Preço não informado</span>';
    return '<li class="item' + (item.pego ? ' pego' : '') + '" data-id="' + esc(item.id) + '">' +
      '<label class="marcar"><input type="checkbox" data-acao="pego"' + (item.pego ? ' checked' : '') +
        ' aria-label="Já pegou ' + nome + '?"><span class="caixa"></span></label>' +
      '<button class="info" type="button" data-acao="editar" aria-label="Editar ou remover ' + nome + '">' +
        '<span class="nome">' + nome + '<span class="lapis" aria-hidden="true"> ✎</span></span>' +
        '<span class="meta">Qtd. ' + qtd(item.quantidade) + unidadeDe(item.unidadeSnapshot) + ' · ' + estimativa + '</span>' +
        subtotal +
      '</button>' +
      '<div class="col-preco"><label class="campo-preco"><span>R$</span><input data-acao="preco" inputmode="decimal" enterkeyhint="next"' +
        ' autocomplete="off" placeholder="0,00" value="' + C.centavosParaCampo(item.precoUnitarioRealCentavos) + '"' +
        ' aria-label="Preço unitário de ' + nome + '"></label><small>preço unitário</small></div>' +
    '</li>';
  }

  function renderLista() {
    const lista = estado.listaAtual;
    const resumo = C.calcularResumo(lista, estado.compras);
    $('btnNomeLista').textContent = lista.nome || 'Lista de compras';
    $('dataLista').textContent = 'Criada em ' + dataHora(lista.criadaEm) +
      (estado.compras.length ? '' : ' · Primeira compra: as estimativas aparecem a partir da próxima lista.');
    const visiveis = lista.itens.filter(i => filtro === 'todos' || (filtro === 'pegos') === i.pego);
    let html;
    if (!lista.itens.length) {
      html = '<div class="vazio"><strong>Sua lista está vazia</strong>Adicione o primeiro produto acima.</div>';
    } else if (!visiveis.length) {
      html = '<div class="vazio">' + (filtro === 'pegos' ? 'Nenhum produto pego ainda.' : 'Todos os produtos já foram pegos. 🎉') + '</div>';
    } else {
      const grupos = new Map();
      for (const item of visiveis) {
        const cat = categoriaDe(item.produtoId);
        if (!grupos.has(cat)) grupos.set(cat, []);
        grupos.get(cat).push(item);
      }
      html = [...grupos.keys()].sort((a, b) => C.CATEGORIAS.indexOf(a) - C.CATEGORIAS.indexOf(b)).map(cat =>
        '<section class="grupo"><h3>' + esc(cat) + ' (' + grupos.get(cat).length + ')</h3><ul class="itens-lista">' +
        grupos.get(cat).map(i => htmlItem(i, resumo.linhas[i.id])).join('') + '</ul></section>').join('');
    }
    $('itens').innerHTML = html;
    renderResumo(resumo);
  }

  /** Atualiza só a linha alterada, sem recriar os campos (mantém o foco do teclado). */
  function atualizarItem(item) {
    const resumo = C.calcularResumo(estado.listaAtual, estado.compras);
    const li = $('itens').querySelector('.item[data-id="' + CSS.escape(item.id) + '"]');
    if (li) {
      const t = document.createElement('template');
      t.innerHTML = htmlItem(item, resumo.linhas[item.id]);
      li.querySelector('.info').innerHTML = t.content.querySelector('.info').innerHTML;
      const input = li.querySelector('input[data-acao="preco"]');
      if (document.activeElement !== input) input.value = C.centavosParaCampo(item.precoUnitarioRealCentavos);
      limparErroItem(li);
    }
    renderResumo(resumo);
  }

  function limparErroItem(li) {
    li.querySelector('.campo-preco').classList.remove('invalido');
    li.querySelector('input[data-acao="preco"]').removeAttribute('aria-invalid');
    const erro = li.querySelector('.erro');
    if (erro) erro.remove();
  }

  function renderResumo(r) {
    const pct = r.quantidadeItens ? Math.round(r.quantidadeItensPegos / r.quantidadeItens * 100) : 0;
    $('barraProgresso').style.width = pct + '%';
    $('rProgresso').textContent = r.quantidadeItensPegos + ' de ' + plural(r.quantidadeItens, 'produto pego', 'produtos pegos');
    $('rTotal').textContent = moeda(r.totalRegistradoCentavos);
    const pend = $('rPendentes');
    pend.textContent = !r.quantidadeItens ? '' : r.quantidadeSemPreco
      ? 'Parcial · ' + plural(r.quantidadeSemPreco, 'sem preço', 'sem preço') : 'Todos com preço';
    pend.classList.toggle('alerta', r.quantidadeSemPreco > 0);
    $('rEstimativa').textContent = r.totalEstimadoCentavos === null ? '—' : moeda(r.totalEstimadoCentavos);
    $('btnFinalizar').disabled = $('btnFinalizarResumo').disabled = !r.quantidadeItens || finalizando;

    const linhas = [];
    const add = (rotulo, valor, classe) => linhas.push('<div' + (classe ? ' class="' + classe + '"' : '') + '><dt>' + rotulo + '</dt><dd>' + valor + '</dd></div>');
    add('Produtos na lista', r.quantidadeItens);
    add('Produtos já pegos', r.quantidadeItensPegos + ' de ' + r.quantidadeItens);
    add('Itens sem preço', r.quantidadeSemPreco);
    add(r.totalCompleto ? 'Total registrado (todos com preço)' : 'Total registrado até agora', moeda(r.totalRegistradoCentavos), 'destaque');
    let estimativa;
    if (r.totalEstimadoCentavos !== null) {
      estimativa = moeda(r.totalEstimadoCentavos) + '<br><small class="sub">' + r.quantidadeComEstimativa + ' de ' + plural(r.quantidadeItens, 'item', 'itens') + ' com preço anterior</small>';
    } else {
      estimativa = '<small class="sub">' + (!estado.compras.length ? 'Sem estimativa (ainda não há compras anteriores)' : r.quantidadeItens ? 'Sem estimativa (nenhum produto tem preço anterior)' : '—') + '</small>';
    }
    add('Estimativa (preços anteriores)', estimativa);
    if (r.comparacao) {
      const d = r.comparacao.diferencaCentavos;
      const texto = d === 0 ? 'Igual à estimativa' : (d > 0 ? moeda(d) + ' acima' : moeda(-d) + ' abaixo') + ' da estimativa';
      add(r.comparacao.completa ? 'Diferença real × estimativa' : 'Diferença parcial (' + r.comparacao.itensComparados + ' de ' + r.quantidadeItens + ' itens)',
        '<span class="' + (d > 0 ? 'acima' : '') + '">' + texto + '</span>');
    }
    let html = linhas.join('');
    if (r.quantidadeSemPreco && r.quantidadeItens) {
      html += '<p class="aviso">O total é parcial: ' + plural(r.quantidadeSemPreco, 'produto ainda está', 'produtos ainda estão') +
        ' sem preço. Produtos sem preço não são contados como R$ 0,00.</p>';
    }
    $('resumoDetalhado').innerHTML = html;

    const limite = estado.preferencias.limiteCentavos;
    if (document.activeElement !== $('campoLimite')) $('campoLimite').value = limite ? C.centavosParaCampo(limite) : '';
    const msg = $('msgLimite');
    msg.classList.remove('acima');
    if (!limite) msg.textContent = 'Defina um valor para acompanhar quanto ainda pode gastar.';
    else if (r.totalRegistradoCentavos > limite) {
      msg.textContent = 'Você ultrapassou o limite em ' + moeda(r.totalRegistradoCentavos - limite) + '.';
      msg.classList.add('acima');
    } else {
      msg.textContent = 'Restam ' + moeda(limite - r.totalRegistradoCentavos) + ' do limite de ' + moeda(limite) + '.' +
        (r.totalEstimadoCentavos !== null && r.totalEstimadoCentavos > limite ? ' Atenção: a estimativa passa do limite.' : '');
    }
  }

  function definirFiltro(f) {
    filtro = f;
    document.querySelectorAll('#filtros .chip').forEach(b => {
      const ativo = b.dataset.filtro === f;
      b.classList.toggle('ativo', ativo);
      b.setAttribute('aria-pressed', String(ativo));
    });
    renderLista();
  }

  function destacar(itemId) {
    if (filtro !== 'todos') definirFiltro('todos');
    const li = $('itens').querySelector('.item[data-id="' + CSS.escape(itemId) + '"]');
    if (!li) return;
    li.scrollIntoView({ block: 'center', behavior: 'smooth' });
    li.classList.remove('piscar');
    void li.offsetWidth;
    li.classList.add('piscar');
  }

  $('filtros').addEventListener('click', e => {
    const b = e.target.closest('[data-filtro]');
    if (b) definirFiltro(b.dataset.filtro);
  });

  $('itens').addEventListener('change', e => {
    const li = e.target.closest('.item');
    const item = li && acharItem(li.dataset.id);
    if (!item) return;
    if (e.target.dataset.acao === 'pego') {
      item.pego = e.target.checked; // marcar não altera o preço
      salvar();
      if (filtro === 'todos') { li.classList.toggle('pego', item.pego); renderResumo(C.calcularResumo(estado.listaAtual, estado.compras)); }
      else renderLista();
    } else if (e.target.dataset.acao === 'preco') {
      const r = C.interpretarPreco(e.target.value);
      if (!r.ok) {
        li.querySelector('.campo-preco').classList.add('invalido');
        e.target.setAttribute('aria-invalid', 'true');
        let erro = li.querySelector('.erro');
        if (!erro) { erro = document.createElement('p'); erro.className = 'erro'; erro.setAttribute('role', 'alert'); li.appendChild(erro); }
        erro.textContent = r.erro + (item.precoUnitarioRealCentavos !== null ? ' O preço anterior (' + moeda(item.precoUnitarioRealCentavos) + ') foi mantido.' : '');
        return;
      }
      item.precoUnitarioRealCentavos = r.centavos;
      salvar();
      e.target.value = C.centavosParaCampo(r.centavos);
      atualizarItem(item);
    }
  });

  // "Próximo" no teclado do celular pula para o preço do item seguinte.
  $('itens').addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.target.dataset.acao !== 'preco') return;
    e.preventDefault();
    const campos = [...$('itens').querySelectorAll('input[data-acao="preco"]')];
    const proximo = campos[campos.indexOf(e.target) + 1];
    if (proximo) proximo.focus(); else e.target.blur();
  });

  $('itens').addEventListener('click', e => {
    const b = e.target.closest('[data-acao="editar"]');
    const item = b && acharItem(b.closest('.item').dataset.id);
    if (item) editarItem(item);
  });

  /* ---------- Adicionar produto ---------- */

  function renderSugestoes() {
    const ul = $('sugestoes');
    const texto = $('campoNome').value;
    const sugestoes = C.buscarSugestoes(estado.produtos, texto, 6);
    if (!sugestoes.length) { ul.hidden = true; $('campoNome').setAttribute('aria-expanded', 'false'); return; }
    const refs = C.mapaReferencias(estado.compras);
    ul.innerHTML = sugestoes.map(p => {
      const ref = refs.get(p.id);
      const naLista = estado.listaAtual.itens.some(i => i.produtoId === p.id);
      return '<li role="option"><button type="button" data-produto="' + esc(p.id) + '"><span>' + esc(p.nome) + '</span><small>' +
        (naLista ? 'já na lista' : ref ? 'último ' + moeda(ref.centavos) : 'sem preço anterior') + '</small></button></li>';
    }).join('');
    ul.hidden = false;
    $('campoNome').setAttribute('aria-expanded', 'true');
  }

  function fecharSugestoes() { $('sugestoes').hidden = true; $('campoNome').setAttribute('aria-expanded', 'false'); }

  $('campoNome').addEventListener('input', () => {
    produtoEscolhidoId = null;
    $('campoCategoria').disabled = false;
    $('campoNome').classList.remove('invalido');
    renderSugestoes();
  });
  $('campoNome').addEventListener('focus', () => { if (!produtoEscolhidoId) renderSugestoes(); });
  $('campoNome').addEventListener('keydown', e => { if (e.key === 'Escape') fecharSugestoes(); });
  $('campoNome').addEventListener('blur', () => setTimeout(fecharSugestoes, 150));
  $('sugestoes').addEventListener('mousedown', e => e.preventDefault()); // mantém o foco no campo
  $('sugestoes').addEventListener('click', e => {
    const b = e.target.closest('[data-produto]');
    const p = b && estado.produtos.find(x => x.id === b.dataset.produto);
    if (!p) return;
    $('campoNome').value = p.nome;
    produtoEscolhidoId = p.id;
    $('campoCategoria').value = p.categoria;
    $('campoCategoria').disabled = true; // a categoria pertence ao produto já cadastrado
    fecharSugestoes();
  });

  /** Encontra o produto do catálogo para um nome. Nomes parecidos só são unificados com confirmação. */
  async function resolverProduto(nome, extras) {
    const exato = C.encontrarProdutoExato(estado.produtos, nome);
    if (exato) return exato;
    const parecidos = C.produtosParecidos(estado.produtos, nome);
    if (parecidos.length) {
      const r = await abrirFolha(
        '<h2 id="folhaTitulo">Produto parecido no catálogo</h2>' +
        '<p class="sub">“' + esc(nome) + '” é o mesmo produto que algum destes? Isso define qual preço anterior será usado como estimativa.</p>' +
        '<div class="botoes">' + parecidos.map(p => '<button class="btn secundario" value="' + esc(p.id) + '">Usar “' + esc(p.nome) + '”</button>').join('') +
        '<button class="btn primario" value="novo">Criar novo produto “' + esc(nome) + '”</button>' +
        '<button class="btn texto" value="">Cancelar</button></div>');
      if (!r) return null;
      if (r !== 'novo') return estado.produtos.find(p => p.id === r) || null;
    }
    const produto = C.novoProduto(nome, extras);
    estado.produtos.push(produto);
    return produto;
  }

  $('formAdicionar').addEventListener('submit', async e => {
    e.preventDefault();
    fecharSugestoes();
    const nome = C.validarNome($('campoNome').value);
    const q = C.interpretarQuantidade($('campoQtd').value);
    $('campoNome').classList.toggle('invalido', !nome.ok);
    $('campoQtd').classList.toggle('invalido', !q.ok);
    if (!nome.ok || !q.ok) { mostrarErro($('erroAdicionar'), !nome.ok ? nome.erro : q.erro); return; }
    mostrarErro($('erroAdicionar'), '');
    let produto = produtoEscolhidoId ? estado.produtos.find(p => p.id === produtoEscolhidoId) : null;
    if (!produto) produto = await resolverProduto(nome.valor, { categoria: $('campoCategoria').value });
    if (!produto) return;
    const existente = estado.listaAtual.itens.find(i => i.produtoId === produto.id);
    if (existente) {
      salvar();
      toast('“' + produto.nome + '” já está na lista. Toque nele para mudar a quantidade.');
      destacar(existente.id);
      return;
    }
    estado.listaAtual.itens.push(C.novoItem(produto, q.valor));
    salvar();
    $('campoNome').value = '';
    $('campoQtd').value = '1';
    $('campoCategoria').disabled = false;
    produtoEscolhidoId = null;
    if (filtro === 'pegos') definirFiltro('todos'); else renderLista();
    toast('“' + produto.nome + '” adicionado.');
    $('campoNome').focus();
  });

  /* ---------- Editar / remover item ---------- */

  async function editarItem(item) {
    const ref = C.referenciaDePreco(estado.compras, item.produtoId);
    let dados = null;
    const r = await abrirFolha(
      '<h2 id="folhaTitulo">Editar item</h2>' +
      '<div class="grupo-campo"><label class="rotulo" for="edNome">Produto</label>' +
        '<input class="campo" id="edNome" maxlength="80" value="' + esc(item.nomeProdutoSnapshot) + '"></div>' +
      '<div class="grupo-campo"><label class="rotulo" for="edQtd">Quantidade' + (item.unidadeSnapshot ? ' (' + esc(item.unidadeSnapshot) + ')' : '') + '</label>' +
        '<div class="passo"><button type="button" data-passo="-1" aria-label="Diminuir">−</button>' +
        '<input class="campo" id="edQtd" inputmode="decimal" value="' + qtdCampo(item.quantidade) + '">' +
        '<button type="button" data-passo="1" aria-label="Aumentar">+</button></div></div>' +
      '<div class="grupo-campo"><label class="rotulo" for="edPreco">Preço unitário pago agora</label>' +
        '<label class="campo-preco largo"><span>R$</span><input id="edPreco" inputmode="decimal" placeholder="não informado" value="' +
        C.centavosParaCampo(item.precoUnitarioRealCentavos) + '"></label>' +
        '<p class="sub">' + (ref ? 'Estimativa baseada em ' + moeda(ref.centavos) + ', preço pago em ' + dataCurta(ref.data) + '.'
          : 'Sem estimativa: este produto ainda não tem preço em compras anteriores.') + ' Deixe vazio se ainda não souber o preço.</p></div>' +
      '<p class="erro" id="edErro" role="alert" hidden></p>' +
      '<div class="botoes"><button class="btn primario" value="salvar" data-padrao>Salvar</button>' +
      '<button class="btn perigo" value="remover">Remover da lista</button>' +
      '<button class="btn texto" value="">Cancelar</button></div>',
      {
        validar: (valor, form) => {
          if (valor !== 'salvar') return true;
          const nome = C.validarNome(form.querySelector('#edNome').value);
          const q = C.interpretarQuantidade(form.querySelector('#edQtd').value);
          const p = C.interpretarPreco(form.querySelector('#edPreco').value);
          form.querySelector('#edNome').classList.toggle('invalido', !nome.ok);
          form.querySelector('#edQtd').classList.toggle('invalido', !q.ok);
          form.querySelector('#edPreco').closest('.campo-preco').classList.toggle('invalido', !p.ok);
          const erro = !nome.ok ? nome.erro : !q.ok ? q.erro : !p.ok ? p.erro : '';
          mostrarErro(form.querySelector('#edErro'), erro);
          if (erro) return false;
          dados = { nome: nome.valor, quantidade: q.valor, centavos: p.centavos };
          return true;
        }
      });

    if (r === 'remover') {
      if (await confirmar('Remover “' + item.nomeProdutoSnapshot + '”?', 'O produto sai apenas da lista atual. O histórico de compras não é alterado.', 'Remover', true)) {
        estado.listaAtual.itens = estado.listaAtual.itens.filter(i => i !== item);
        salvar();
        renderLista();
        toast('Produto removido da lista.');
      }
      return;
    }
    if (r !== 'salvar' || !dados) return;
    item.quantidade = dados.quantidade;
    item.precoUnitarioRealCentavos = dados.centavos;
    if (dados.nome !== item.nomeProdutoSnapshot) {
      if (C.normalizarNome(dados.nome) === C.normalizarNome(item.nomeProdutoSnapshot)) {
        // Só mudou maiúsculas/espaços: corrige o nome no catálogo (o histórico guarda sua própria cópia).
        const produto = estado.produtos.find(p => p.id === item.produtoId);
        if (produto) produto.nome = dados.nome;
        item.nomeProdutoSnapshot = dados.nome;
      } else {
        const produto = await resolverProduto(dados.nome, { categoria: categoriaDe(item.produtoId) });
        if (produto && estado.listaAtual.itens.some(i => i !== item && i.produtoId === produto.id)) {
          toast('“' + produto.nome + '” já está na lista; o nome não foi alterado.');
        } else if (produto) {
          item.produtoId = produto.id;
          item.nomeProdutoSnapshot = produto.nome;
          item.unidadeSnapshot = produto.unidade || '';
        }
      }
    }
    salvar();
    renderLista();
    toast('Item atualizado.');
  }

  /* ---------- Menu da lista ---------- */

  async function renomearLista() {
    let nome = '';
    const r = await abrirFolha(
      '<h2 id="folhaTitulo">Nome da lista</h2>' +
      '<input class="campo" id="nmLista" maxlength="80" placeholder="Ex.: Compra do mês" data-foco value="' + esc(estado.listaAtual.nome) + '">' +
      '<p class="sub">Opcional. O nome aparece no histórico depois que a compra for finalizada.</p>' +
      '<div class="botoes"><button class="btn primario" value="ok" data-padrao>Salvar</button><button class="btn texto" value="">Cancelar</button></div>',
      { validar: (v, form) => { nome = C.limparNome(form.querySelector('#nmLista').value); return true; } });
    if (r !== 'ok') return;
    estado.listaAtual.nome = nome;
    salvar();
    renderLista();
  }

  function textoDaLista() {
    const lista = estado.listaAtual;
    const r = C.calcularResumo(lista, estado.compras);
    const linhas = lista.itens.map(i => {
      const l = r.linhas[i.id];
      let t = (i.pego ? '[x] ' : '[ ] ') + i.nomeProdutoSnapshot + ' — ' + qtd(i.quantidade) + (i.unidadeSnapshot ? ' ' + i.unidadeSnapshot : '');
      if (l.subtotalRealCentavos !== null) t += ' — ' + moeda(i.precoUnitarioRealCentavos) + ' cada = ' + moeda(l.subtotalRealCentavos);
      else if (l.referencia) t += ' — estimativa ' + moeda(l.subtotalEstimadoCentavos);
      return t;
    });
    return [(lista.nome || 'Lista de compras') + ' — CompraCerta', new Date().toLocaleDateString('pt-BR'), '']
      .concat(linhas, ['',
        'Total registrado: ' + moeda(r.totalRegistradoCentavos) + (r.quantidadeSemPreco ? ' (parcial: ' + plural(r.quantidadeSemPreco, 'item sem preço', 'itens sem preço') + ')' : ''),
        'Estimativa: ' + (r.totalEstimadoCentavos !== null ? moeda(r.totalEstimadoCentavos) : 'sem histórico de preços')])
      .join('\n');
  }

  $('btnNomeLista').addEventListener('click', renomearLista);
  $('btnMenu').addEventListener('click', async () => {
    const vazia = !estado.listaAtual.itens.length;
    const r = await abrirFolha(
      '<h2 id="folhaTitulo">Lista atual</h2><div class="botoes">' +
      '<button class="btn secundario" value="renomear">Renomear lista</button>' +
      '<button class="btn secundario" value="compartilhar"' + (vazia ? ' disabled' : '') + '>Compartilhar lista</button>' +
      '<button class="btn secundario" value="exportar"' + (vazia ? ' disabled' : '') + '>Exportar lista (.txt)</button>' +
      '<button class="btn perigo" value="descartar"' + (vazia ? ' disabled' : '') + '>Descartar lista e começar outra</button>' +
      '<button class="btn texto" value="">Fechar</button></div>');
    if (r === 'renomear') renomearLista();
    else if (r === 'compartilhar') compartilhar(textoDaLista(), 'Lista de compras', 'lista-de-compras.txt');
    else if (r === 'exportar') { baixar('﻿' + textoDaLista(), 'lista-de-compras.txt', 'text/plain'); toast('Lista exportada.'); }
    else if (r === 'descartar') {
      const n = estado.listaAtual.itens.length;
      const ok = await confirmar('Descartar a lista atual?',
        'Os ' + plural(n, 'produto', 'produtos') + ' desta lista serão apagados e ela não será salva no histórico. As compras já finalizadas continuam guardadas.',
        'Descartar lista', true);
      if (!ok) return;
      estado.listaAtual = C.novaLista();
      salvar();
      definirFiltro('todos');
      toast('Nova lista iniciada. O histórico foi mantido.');
    }
  });

  /* ---------- Limite de gastos ---------- */

  $('btnLimite').addEventListener('click', () => {
    const r = C.interpretarPreco($('campoLimite').value);
    $('campoLimite').closest('.campo-preco').classList.toggle('invalido', !r.ok);
    if (!r.ok) { toast(r.erro); return; }
    estado.preferencias.limiteCentavos = r.centavos || null;
    salvar();
    $('campoLimite').blur();
    renderLista();
    toast(r.centavos ? 'Limite definido.' : 'Limite removido.');
  });

  /* ---------- Finalizar compra ---------- */

  async function confirmarEFinalizar() {
    const lista = estado.listaAtual;
    if (!lista.itens.length) { toast('Adicione produtos antes de finalizar.'); return; }
    const r = C.calcularResumo(lista, estado.compras);
    const naoPegos = r.quantidadeItens - r.quantidadeItensPegos;
    const escolha = await abrirFolha(
      '<h2 id="folhaTitulo">Finalizar compra?</h2>' +
      '<dl class="linhas-resumo">' +
        '<div><dt>Produtos</dt><dd>' + r.quantidadeItens + '</dd></div>' +
        '<div><dt>Marcados como pegos</dt><dd>' + r.quantidadeItensPegos + ' de ' + r.quantidadeItens + '</dd></div>' +
        '<div class="destaque"><dt>' + (r.totalCompleto ? 'Total final' : 'Total registrado (incompleto)') + '</dt><dd>' + moeda(r.totalRegistradoCentavos) + '</dd></div>' +
      '</dl>' +
      (r.quantidadeSemPreco ? '<p class="aviso">' + plural(r.quantidadeSemPreco, 'produto está', 'produtos estão') + ' sem preço. ' +
        (r.quantidadeSemPreco === 1 ? 'Ele será salvo' : 'Eles serão salvos') + ' como “preço não informado” e o total ficará incompleto.</p>' : '') +
      (naoPegos ? '<p class="sub">' + plural(naoPegos, 'produto não foi marcado', 'produtos não foram marcados') + ' como pego.</p>' : '') +
      '<p class="sub">A compra vai para o histórico e não poderá mais ser editada. Os preços informados viram estimativa nas próximas listas.</p>' +
      '<div class="botoes">' + (r.quantidadeSemPreco
        ? '<button class="btn primario" value="voltar">Voltar e completar preços</button><button class="btn secundario" value="ok">Finalizar mesmo assim</button>'
        : '<button class="btn primario" value="ok">Finalizar e salvar</button><button class="btn texto" value="voltar">Voltar</button>') +
      '</div>');
    if (escolha === 'voltar' && r.quantidadeSemPreco) {
      const semPreco = lista.itens.find(i => i.precoUnitarioRealCentavos === null);
      location.hash = '#lista';
      destacar(semPreco.id);
      const campo = $('itens').querySelector('.item[data-id="' + CSS.escape(semPreco.id) + '"] input[data-acao="preco"]');
      if (campo) campo.focus({ preventScroll: true });
      return;
    }
    if (escolha !== 'ok') return;
    $('btnFinalizar').disabled = $('btnFinalizarResumo').disabled = true;
    try {
      const anterior = estado;
      const resultado = C.finalizarCompra(estado);
      estado = resultado.estado;
      if (!salvar()) {
        estado = anterior;
        toast('A compra NÃO foi salva: o armazenamento do navegador falhou.');
        return;
      }
      definirFiltro('todos');
      entradaInterna = false;
      location.hash = '#compra/' + encodeURIComponent(resultado.compra.id);
      toast('Compra salva no histórico. Uma nova lista foi iniciada.');
    } catch (e) {
      toast(e.message);
    }
  }

  /** Bloqueia novas chamadas desde o primeiro toque até o fim (evita confirmações e compras duplicadas). */
  async function finalizar() {
    if (finalizando) return;
    finalizando = true;
    try { await confirmarEFinalizar(); }
    finally {
      finalizando = false;
      renderResumo(C.calcularResumo(estado.listaAtual, estado.compras));
    }
  }

  $('btnFinalizar').addEventListener('click', finalizar);
  $('btnFinalizarResumo').addEventListener('click', finalizar);

  /* ---------- Histórico ---------- */

  const tituloCompra = c => c.nome || 'Compra de ' + dataCurta(c.finalizadaEm);

  function renderHistorico() {
    const compras = C.comprasRecentes(estado.compras);
    $('introHistorico').textContent = compras.length
      ? plural(compras.length, 'compra concluída', 'compras concluídas') + '. O preço mais recente de cada produto serve de estimativa para as próximas listas.'
      : '';
    $('listaHistorico').innerHTML = compras.length ? compras.map(c =>
      '<li><a class="cartao-link" href="#compra/' + encodeURIComponent(c.id) + '" data-interno>' +
        '<span><strong>' + esc(tituloCompra(c)) + '</strong><small>' + dataHora(c.finalizadaEm) + ' · ' + plural(c.quantidadeItens, 'produto', 'produtos') + '</small>' +
        (c.possuiItensSemPreco ? '<br><span class="selo">Total incompleto · ' + plural(c.quantidadeItensSemPreco, 'sem preço', 'sem preço') + '</span>' : '') + '</span>' +
        '<span class="valor">' + moeda(c.totalRealCentavos) + '</span></a></li>').join('')
      : '<li class="vazio"><strong>Nenhuma compra finalizada ainda</strong>Ao finalizar sua primeira lista, ela aparece aqui e os preços passam a servir de estimativa.</li>';
  }

  function renderDetalhe(id) {
    const c = estado.compras.find(x => x.id === id);
    const el = $('detalheCompra');
    if (!c) {
      el.innerHTML = '<div class="vazio"><strong>Compra não encontrada</strong><a href="#historico">Voltar ao histórico</a></div>';
      return;
    }
    $('tituloTela').textContent = tituloCompra(c);
    const comRef = c.itens.filter(i => C.precoValido(i.precoReferenciaCentavos)).length;
    const itens = c.itens.map(i => {
      const temPreco = C.precoValido(i.precoUnitarioRealCentavos);
      const base = qtd(i.quantidade) + unidadeDe(i.unidade);
      return '<div class="linha-det"><span class="nome">' + (i.pego ? '✓ ' : '') + esc(i.nomeProdutoSnapshot) + '</span>' +
        '<span class="valor">' + (temPreco ? moeda(i.subtotalCentavos) : '—') + '</span>' +
        '<span class="meta">' + (temPreco ? base + ' × ' + moeda(i.precoUnitarioRealCentavos) : base + ' · <span class="pendente">Preço não informado</span>') +
        (C.precoValido(i.precoReferenciaCentavos) ? ' · estimativa usada: ' + moeda(i.precoReferenciaCentavos) + ' (' + dataCurta(i.dataPrecoReferencia) + ')' : '') +
        '</span></div>';
    }).join('');
    el.innerHTML =
      '<section class="cartao"><h2>' + esc(tituloCompra(c)) + '</h2>' +
      '<p class="sub">Finalizada em ' + dataHora(c.finalizadaEm) + ' · somente leitura</p>' +
      '<dl class="linhas-resumo" style="margin-top:10px">' +
        '<div><dt>Produtos</dt><dd>' + c.quantidadeItens + '</dd></div>' +
        '<div><dt>Marcados como pegos</dt><dd>' + c.quantidadeItensPegos + ' de ' + c.quantidadeItens + '</dd></div>' +
        (c.totalEstimadoCentavos != null ? '<div><dt>Estimativa na época (' + comRef + ' de ' + plural(c.quantidadeItens, 'item', 'itens') + ')</dt><dd>' + moeda(c.totalEstimadoCentavos) + '</dd></div>' : '') +
        '<div class="destaque"><dt>' + (c.possuiItensSemPreco ? 'Total final registrado (incompleto)' : 'Total final') + '</dt><dd>' + moeda(c.totalRealCentavos) + '</dd></div>' +
      '</dl>' +
      (c.possuiItensSemPreco ? '<p class="aviso">' + plural(c.quantidadeItensSemPreco, 'produto ficou', 'produtos ficaram') + ' sem preço e não entra' +
        (c.quantidadeItensSemPreco === 1 ? '' : 'm') + ' no total.</p>' : '') +
      '</section>' +
      '<section class="cartao"><h2>Produtos</h2>' + itens + '</section>' +
      '<div class="botoes">' +
        '<button class="btn primario" type="button" data-repetir="' + esc(c.id) + '">Adicionar estes produtos à lista atual</button>' +
        '<button class="btn secundario" type="button" data-compartilhar-compra="' + esc(c.id) + '">Compartilhar</button>' +
        '<a class="btn secundario" href="#lista">Ir para a lista atual</a>' +
      '</div>';
  }

  function textoDaCompra(c) {
    return [tituloCompra(c) + ' — CompraCerta', 'Finalizada em ' + dataHora(c.finalizadaEm), '']
      .concat(c.itens.map(i => i.nomeProdutoSnapshot + ' — ' + qtd(i.quantidade) + (i.unidade ? ' ' + i.unidade : '') + ' — ' +
        (C.precoValido(i.precoUnitarioRealCentavos) ? moeda(i.precoUnitarioRealCentavos) + ' cada = ' + moeda(i.subtotalCentavos) : 'preço não informado')))
      .concat(['', 'Total' + (c.possuiItensSemPreco ? ' (incompleto)' : '') + ': ' + moeda(c.totalRealCentavos)])
      .join('\n');
  }

  /** Copia os produtos de uma compra antiga para a lista atual (sem preços: eles viram estimativa). */
  function repetirCompra(id) {
    const c = estado.compras.find(x => x.id === id);
    if (!c) return;
    let adicionados = 0, jaEstavam = 0;
    for (const i of c.itens) {
      let p = estado.produtos.find(x => x.id === i.produtoId);
      if (!p) {
        p = { id: i.produtoId, nome: i.nomeProdutoSnapshot, unidade: i.unidade || '', criadoEm: c.finalizadaEm,
          categoria: C.CATEGORIAS.includes(i.categoria) ? i.categoria : 'Outros' };
        estado.produtos.push(p);
      }
      if (estado.listaAtual.itens.some(x => x.produtoId === p.id)) { jaEstavam++; continue; }
      estado.listaAtual.itens.push(C.novoItem(p, i.quantidade));
      adicionados++;
    }
    salvar();
    location.hash = '#lista';
    toast(adicionados
      ? plural(adicionados, 'produto adicionado', 'produtos adicionados') + ' à lista atual' + (jaEstavam ? ' (' + jaEstavam + ' já estava' + (jaEstavam > 1 ? 'm' : '') + ' nela)' : '') + '.'
      : 'Todos esses produtos já estão na lista atual.');
  }

  $('detalheCompra').addEventListener('click', e => {
    const repetir = e.target.closest('[data-repetir]');
    if (repetir) { repetirCompra(repetir.dataset.repetir); return; }
    const comp = e.target.closest('[data-compartilhar-compra]');
    const c = comp && estado.compras.find(x => x.id === comp.dataset.compartilharCompra);
    if (c) compartilhar(textoDaCompra(c), tituloCompra(c), 'compra.txt');
  });

  /* ---------- Catálogo de produtos ---------- */

  function renderProdutos() {
    const refs = C.mapaReferencias(estado.compras);
    const busca = $('buscaProdutos').value;
    const produtos = busca.trim() ? C.buscarSugestoes(estado.produtos, busca, 1000)
      : estado.produtos.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    $('listaProdutos').innerHTML = produtos.length ? produtos.map(p => {
      const ref = refs.get(p.id);
      return '<li><button class="cartao-link" type="button" data-produto="' + esc(p.id) + '">' +
        '<span><strong>' + esc(p.nome) + '</strong><small>' + esc(p.categoria) + (p.unidade ? ' · ' + esc(p.unidade) : '') + '</small></span>' +
        '<span class="valor">' + (ref ? moeda(ref.centavos) + '<br><small>' + dataCurta(ref.data) + '</small>' : '<small>Sem preço registrado</small>') + '</span>' +
        '</button></li>';
    }).join('') : '<li class="vazio">' + (estado.produtos.length ? 'Nenhum produto encontrado.'
      : '<strong>Nenhum produto cadastrado</strong>Os produtos entram no catálogo quando você os adiciona à lista.') + '</li>';
  }

  async function editarProduto(produto) {
    const precos = C.historicoDePrecos(estado.compras, produto.id);
    const naLista = estado.listaAtual.itens.some(i => i.produtoId === produto.id);
    const podeExcluir = !naLista && !precos.length;
    const opcoes = (lista, atual, rotuloVazio) => lista.map(v => '<option value="' + esc(v) + '"' + (v === atual ? ' selected' : '') + '>' + esc(v || rotuloVazio) + '</option>').join('');
    let dados = null;
    const r = await abrirFolha(
      '<h2 id="folhaTitulo">' + esc(produto.nome) + '</h2>' +
      '<div class="grupo-campo"><label class="rotulo" for="pdNome">Nome</label><input class="campo" id="pdNome" maxlength="80" value="' + esc(produto.nome) + '"></div>' +
      '<div class="linha-form">' +
        '<select class="campo" id="pdCategoria" aria-label="Categoria">' + opcoes(C.CATEGORIAS, produto.categoria) + '</select>' +
        '<select class="campo" id="pdUnidade" aria-label="Unidade">' + opcoes(C.UNIDADES, produto.unidade, 'sem unidade') + '</select>' +
      '</div>' +
      '<p class="erro" id="pdErro" role="alert" hidden></p>' +
      '<h2 style="margin-top:14px">Preços registrados</h2>' +
      (precos.length ? precos.slice(0, 12).map(x => '<div class="linha-det"><span>' + dataCurta(x.data) + ' · ' + qtd(x.quantidade) + unidadeDe(produto.unidade) + '</span><span class="valor">' +
        (x.centavos !== null ? moeda(x.centavos) : '<span class="pendente">não informado</span>') + '</span></div>').join('')
        : '<p class="sub">Nenhuma compra finalizada com este produto.</p>') +
      '<p class="sub">Alterar o nome não muda compras já finalizadas, que guardam sua própria cópia.</p>' +
      '<div class="botoes"><button class="btn primario" value="salvar" data-padrao>Salvar</button>' +
      (podeExcluir ? '<button class="btn perigo" value="excluir">Excluir do catálogo</button>' : '') +
      '<button class="btn texto" value="">Fechar</button></div>',
      {
        validar: (valor, form) => {
          if (valor !== 'salvar') return true;
          const nome = C.validarNome(form.querySelector('#pdNome').value);
          const outro = nome.ok && C.encontrarProdutoExato(estado.produtos.filter(p => p !== produto), nome.valor);
          const erro = !nome.ok ? nome.erro : outro ? 'Já existe um produto chamado “' + outro.nome + '”.' : '';
          form.querySelector('#pdNome').classList.toggle('invalido', !!erro);
          mostrarErro(form.querySelector('#pdErro'), erro);
          if (erro) return false;
          dados = { nome: nome.valor, categoria: form.querySelector('#pdCategoria').value, unidade: form.querySelector('#pdUnidade').value };
          return true;
        }
      });
    if (r === 'excluir') {
      if (!(await confirmar('Excluir “' + produto.nome + '”?', 'O produto sai do catálogo. Ele não aparece em nenhuma compra nem na lista atual.', 'Excluir', true))) return;
      estado.produtos = estado.produtos.filter(p => p !== produto);
      salvar();
      renderProdutos();
      toast('Produto excluído.');
      return;
    }
    if (r !== 'salvar' || !dados) return;
    Object.assign(produto, dados);
    // A lista atual (rascunho) acompanha o catálogo; compras finalizadas não mudam.
    for (const item of estado.listaAtual.itens) {
      if (item.produtoId === produto.id) { item.nomeProdutoSnapshot = produto.nome; item.unidadeSnapshot = produto.unidade; }
    }
    salvar();
    renderProdutos();
    toast('Produto atualizado.');
  }

  $('buscaProdutos').addEventListener('input', renderProdutos);
  $('listaProdutos').addEventListener('click', e => {
    const b = e.target.closest('[data-produto]');
    const p = b && estado.produtos.find(x => x.id === b.dataset.produto);
    if (p) editarProduto(p);
  });

  /* ---------- Cópia de segurança ---------- */

  $('btnExportarDados').addEventListener('click', () => {
    baixar(JSON.stringify(estado, null, 2), 'compracerta-backup-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json');
    toast('Arquivo de backup gerado.');
  });
  $('btnImportarDados').addEventListener('click', () => $('arquivoImportar').click());
  $('arquivoImportar').addEventListener('change', async e => {
    const arquivo = e.target.files[0];
    e.target.value = '';
    if (!arquivo) return;
    let novo;
    try { novo = C.migrar(JSON.parse(await arquivo.text())); }
    catch (err) { toast('Arquivo inválido: ' + err.message); return; }
    const ok = await confirmar('Substituir os dados deste aparelho?',
      'O arquivo tem ' + plural(novo.compras.length, 'compra', 'compras') + ' e ' + plural(novo.produtos.length, 'produto', 'produtos') +
      '. A lista atual, o catálogo e as ' + plural(estado.compras.length, 'compra', 'compras') + ' deste aparelho serão substituídos. Se quiser, exporte um backup antes.',
      'Substituir dados', true);
    if (!ok) return;
    const anterior = estado;
    estado = novo;
    if (!salvar()) { estado = anterior; return; }
    mostrarTela();
    toast('Dados importados.');
  });

  /* ---------- Leitura de nota fiscal (foto + OCR no próprio aparelho) ---------- */

  // Mesmo teste de suporte a SIMD do Tesseract: escolhe a variante rápida do motor quando possível.
  const SIMD = (() => {
    try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); }
    catch (_) { return false; }
  })();
  const ETAPAS_OCR = {
    'loading tesseract core': 'Preparando o leitor…',
    'initializing tesseract': 'Preparando o leitor…',
    'loading language traineddata': 'Carregando o idioma português…',
    'initializing api': 'Preparando o leitor…',
    'recognizing text': 'Lendo o texto da nota…'
  };
  let leitorOcr = null;
  let aoProgressoOcr = null;

  function carregarScript(src) {
    return new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = ok;
      s.onerror = () => falha(new Error('Não foi possível carregar o leitor de notas. Verifique a internet e tente de novo.'));
      document.head.appendChild(s);
    });
  }

  /** Cria o leitor (OCR) uma vez e reaproveita. Os arquivos ficam em vendor/tesseract (nada de CDN). */
  async function obterLeitorOcr() {
    if (leitorOcr) return leitorOcr;
    if (!window.Tesseract) await carregarScript('vendor/tesseract/tesseract.min.js');
    const base = new URL('vendor/tesseract/', location.href).href;
    const leitor = await window.Tesseract.createWorker('por', 1, {
      workerPath: base + 'worker.min.js',
      corePath: base + (SIMD ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js'),
      langPath: base + 'lang',
      gzip: false, // arquivo do idioma já descompactado (ver scripts/build.js)
      logger: m => { if (aoProgressoOcr) aoProgressoOcr(m); }
    });
    // "Coluna única" (PSM 4) foi o modo que melhor leu cupons nos testes.
    await leitor.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' });
    leitorOcr = leitor;
    return leitor;
  }

  function carregarImagem(arquivo) {
    return new Promise((ok, falha) => {
      const url = URL.createObjectURL(arquivo);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); ok(img); };
      img.onerror = () => { URL.revokeObjectURL(url); falha(new Error('Não foi possível abrir a foto.')); };
      img.src = url;
    });
  }

  /** Tons de cinza, contraste esticado (papel térmico desbotado) e tamanho bom para o OCR. */
  async function prepararFoto(arquivo) {
    const img = await carregarImagem(arquivo);
    const maior = Math.max(img.naturalWidth, img.naturalHeight);
    const escala = maior > 2400 ? 2400 / maior : maior < 1200 ? 1600 / maior : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * escala);
    canvas.height = Math.round(img.naturalHeight * escala);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dados = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const p = dados.data;
    const histograma = new Uint32Array(256);
    for (let i = 0; i < p.length; i += 4) {
      const cinza = ((p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000) | 0;
      p[i] = cinza;
      histograma[cinza]++;
    }
    const corte = (p.length / 4) * 0.02;
    let soma = 0, escuro = 0, claro = 255;
    for (let v = 0; v < 256; v++) { soma += histograma[v]; if (soma >= corte) { escuro = v; break; } }
    soma = 0;
    for (let v = 255; v >= 0; v--) { soma += histograma[v]; if (soma >= corte) { claro = v; break; } }
    const faixa = Math.max(1, claro - escuro);
    for (let i = 0; i < p.length; i += 4) {
      const v = Math.max(0, Math.min(255, ((p[i] - escuro) * 255) / faixa));
      p[i] = p[i + 1] = p[i + 2] = v;
    }
    ctx.putImageData(dados, 0, 0);
    return canvas;
  }

  async function lerFotoDaNota(arquivo) {
    let cancelado = false, terminou = false;
    abrirFolha(
      '<h2 id="folhaTitulo">Lendo a nota fiscal</h2>' +
      '<p class="sub" id="ocrEtapa">Preparando a foto…</p>' +
      '<div class="progresso-ocr" aria-hidden="true"><div id="ocrBarra"></div></div>' +
      '<p class="sub">A leitura acontece no próprio aparelho: a foto não é enviada para lugar nenhum. ' +
      'Na primeira vez, o leitor é carregado e pode demorar um pouco mais.</p>' +
      '<div class="botoes"><button class="btn texto" value="cancelar">Cancelar</button></div>'
    ).then(() => {
      if (terminou) return;
      cancelado = true;
      if (leitorOcr) { leitorOcr.terminate(); leitorOcr = null; } // interrompe a leitura em andamento
    });
    aoProgressoOcr = m => {
      const etapa = $('ocrEtapa'), barra = $('ocrBarra');
      if (!etapa || !barra) return;
      etapa.textContent = ETAPAS_OCR[m.status] || 'Preparando o leitor…';
      const fracao = m.status === 'recognizing text' ? 0.3 + 0.7 * (m.progress || 0) : 0.3 * (m.progress || 0);
      barra.style.width = Math.round(fracao * 100) + '%';
    };
    let resultado;
    try {
      const imagem = await prepararFoto(arquivo);
      if (cancelado) return;
      const leitor = await obterLeitorOcr();
      if (cancelado) return;
      const { data } = await leitor.recognize(imagem);
      resultado = window.CCNota.lerItensDaNota(data.text);
      resultado.texto = data.text;
    } catch (e) {
      if (!cancelado) {
        terminou = true;
        fecharFolha();
        toast((e && e.message) || 'Não foi possível ler a nota.');
      }
      return;
    } finally {
      aoProgressoOcr = null;
    }
    if (cancelado) return;
    terminou = true;
    fecharFolha();
    revisarNota(resultado);
  }

  function htmlTextoLido(texto) {
    return '<details class="texto-ocr"><summary>Ver o texto que foi lido da foto</summary><pre>' + esc(texto || '(vazio)') + '</pre></details>';
  }

  function htmlItemDaNota(it, i, sugestao, itensLista) {
    const opcoes = '<option value="">➕ Adicionar como item novo</option>' + itensLista.map(l =>
      '<option value="' + esc(l.id) + '"' + (sugestao === l.id ? ' selected' : '') + '>→ Preencher "' + esc(l.nomeProdutoSnapshot) + '" da lista</option>').join('');
    return '<div class="nota-item' + (it.conferir ? ' conferir' : '') + '" data-i="' + i + '">' +
      '<label class="marcar"><input type="checkbox" data-campo="incluir" checked aria-label="Incluir ' + esc(it.nome) + '"><span class="caixa"></span></label>' +
      '<div class="nota-campos">' +
        '<input class="campo" data-campo="nome" maxlength="80" value="' + esc(it.nome) + '" aria-label="Nome do produto">' +
        '<div class="nota-valores">' +
          '<input class="campo nota-qtd" data-campo="quantidade" inputmode="decimal" value="' + qtdCampo(it.quantidade) + '" aria-label="Quantidade">' +
          '<span class="sub">' + esc(it.unidade || 'un') + ' ×</span>' +
          '<label class="campo-preco"><span>R$</span><input data-campo="preco" inputmode="decimal" value="' +
            C.centavosParaCampo(it.precoUnitarioCentavos) + '" aria-label="Preço unitário"></label>' +
        '</div>' +
        '<p class="sub">Total impresso na nota: ' + moeda(it.totalCentavos) +
          (it.conferir ? ' · <strong class="pendente">⚠ confira: a conta não fecha</strong>' : '') + '</p>' +
        '<select class="campo" data-campo="destino" aria-label="Onde incluir este item">' + opcoes + '</select>' +
        '<p class="erro" data-campo="erro" hidden></p>' +
      '</div></div>';
  }

  async function revisarNota(r) {
    if (!r.itens.length) {
      const v = await abrirFolha(
        '<h2 id="folhaTitulo">Nenhum item reconhecido</h2>' +
        '<p class="sub">Não encontrei linhas de produtos nesta foto. Fotografe só a parte dos itens, de perto, com boa luz, ' +
        'o papel esticado e sem sombra.</p>' + htmlTextoLido(r.texto) +
        '<div class="botoes"><button class="btn primario" value="outra">📷 Tirar outra foto</button>' +
        '<button class="btn texto" value="">Fechar</button></div>');
      if (v === 'outra') $('fotoNotaCamera').click();
      return;
    }
    const itensLista = estado.listaAtual.itens.slice().sort((a, b) => a.nomeProdutoSnapshot.localeCompare(b.nomeProdutoSnapshot, 'pt-BR'));
    const sugestoes = window.CCNota.sugerirCorrespondencias(r.itens, estado.listaAtual.itens);
    let confirmados = null;
    const v = await abrirFolha(
      '<h2 id="folhaTitulo">Itens lidos da nota (' + r.itens.length + ')</h2>' +
      '<p class="sub">A leitura automática pode errar: confira nomes, quantidades e preços. Desmarque o que não quiser incluir.</p>' +
      r.avisos.map(a => '<p class="aviso">' + esc(a) + '</p>').join('') +
      '<div class="nota-itens">' + r.itens.map((it, i) => htmlItemDaNota(it, i, sugestoes[i], itensLista)).join('') + '</div>' +
      htmlTextoLido(r.texto) +
      '<div class="botoes">' +
        '<button class="btn primario" value="ok" data-padrao>Preencher a lista</button>' +
        '<button class="btn secundario" value="mais">Preencher e ler outra parte da nota</button>' +
        '<button class="btn texto" value="">Cancelar</button>' +
      '</div>',
      {
        validar: (valor, form) => {
          if (valor !== 'ok' && valor !== 'mais') return true;
          confirmados = [];
          let erros = 0;
          form.querySelectorAll('.nota-item').forEach(el => {
            const campo = nome => el.querySelector('[data-campo="' + nome + '"]');
            if (!campo('incluir').checked) { mostrarErro(campo('erro'), ''); return; }
            const nome = C.validarNome(campo('nome').value);
            const q = C.interpretarQuantidade(campo('quantidade').value);
            const p = C.interpretarPreco(campo('preco').value);
            const erro = !nome.ok ? nome.erro : !q.ok ? q.erro : !p.ok ? p.erro : p.centavos === null ? 'Informe o preço.' : '';
            mostrarErro(campo('erro'), erro);
            if (erro) { erros++; return; }
            confirmados.push({ nome: nome.valor, quantidade: q.valor, precoCentavos: p.centavos,
              unidade: r.itens[Number(el.dataset.i)].unidade, destino: campo('destino').value || null });
          });
          if (erros) { toast('Corrija os itens marcados em vermelho.'); return false; }
          if (!confirmados.length) { toast('Nenhum item marcado para incluir.'); return false; }
          return true;
        }
      });
    if ((v !== 'ok' && v !== 'mais') || !confirmados) return;
    const resultado = window.CCNota.aplicarNaLista(estado, confirmados);
    salvar();
    if (rotaAtual().tela !== 'lista') location.hash = '#lista';
    definirFiltro('todos');
    toast('Nota lida: ' + (resultado.preenchidos ? plural(resultado.preenchidos, 'item preenchido', 'itens preenchidos') : '') +
      (resultado.preenchidos && resultado.adicionados ? ' e ' : '') +
      (resultado.adicionados ? plural(resultado.adicionados, 'item adicionado', 'itens adicionados') : '') + '. Confira e finalize.');
    if (v === 'mais') $('fotoNotaCamera').click();
  }

  $('btnLerNota').addEventListener('click', async () => {
    const v = await abrirFolha(
      '<h2 id="folhaTitulo">Ler nota fiscal</h2>' +
      '<p class="sub">Os itens da nota entram na lista atual com a quantidade e o preço reais, já marcados como pegos. ' +
      'Antes de incluir, você confere tudo.</p>' +
      '<ul class="dicas">' +
        '<li>Fotografe <strong>só a parte dos produtos</strong>, de perto, com o papel esticado.</li>' +
        '<li>Boa luz, sem sombra e sem reflexo.</li>' +
        '<li>Nota comprida: leia em partes, uma foto de cada vez.</li>' +
      '</ul>' +
      '<div class="botoes">' +
        '<button class="btn primario" value="camera">📷 Tirar foto da nota</button>' +
        '<button class="btn secundario" value="galeria">🖼️ Escolher foto da galeria</button>' +
        '<button class="btn texto" value="">Cancelar</button>' +
      '</div>');
    if (v === 'camera') $('fotoNotaCamera').click();
    else if (v === 'galeria') $('fotoNotaGaleria').click();
  });

  ['fotoNotaCamera', 'fotoNotaGaleria'].forEach(id => $(id).addEventListener('change', e => {
    const arquivo = e.target.files && e.target.files[0];
    e.target.value = '';
    if (arquivo) lerFotoDaNota(arquivo);
  }));

  /* ---------- Cópia na nuvem ---------- */

  const ROTULOS_NUVEM = { offline: '☁ offline', sincronizando: '☁ enviando…', ok: '☁ salvo', erro: '☁ erro' };

  function renderNuvem(s) {
    const selo = $('statusNuvem');
    selo.hidden = !ROTULOS_NUVEM[s.tipo];
    selo.textContent = ROTULOS_NUVEM[s.tipo] || '';
    selo.className = 'status-nuvem ' + s.tipo;
    let situacao;
    if (s.tipo === 'desligada') situacao = s.mensagem;
    else if (s.tipo === 'ok') {
      situacao = 'Tudo enviado. Última cópia: ' + dataHora(s.ultima) + '.' +
        (s.recusadas ? ' ' + plural(s.recusadas, 'compra foi recusada', 'compras foram recusadas') + ' pelo banco e não está na nuvem.' : '');
    } else if (s.tipo === 'sincronizando') situacao = 'Enviando alterações…';
    else situacao = s.mensagem + (s.tipo === 'erro' ? ' Uma nova tentativa será feita automaticamente.' : '');
    $('nuvemSituacao').textContent = situacao;
    $('nuvemExplicacao').textContent = s.tipo === 'desligada' ? '' :
      'Sem login: a cópia fica ligada a este aparelho' + (s.usuario ? ' (código ' + s.usuario.slice(0, 8) + ')' : '') +
      '. Se o app for desinstalado ou os dados dele forem apagados, essa cópia não pode ser recuperada em outro aparelho. ' +
      'Para trocar de celular, use Exportar dados.';
    $('btnSincronizar').hidden = s.tipo === 'desligada';
    $('btnSincronizar').disabled = s.tipo === 'sincronizando';
    if (s.restaurado) toast('Seus dados foram restaurados da cópia na nuvem.');
  }

  $('btnSincronizar').addEventListener('click', () => { if (nuvem) nuvem.sincronizar(); });

  /* ---------- Celular: botão voltar do Android e teclado ---------- */

  if (nativo && Cap.Plugins && Cap.Plugins.App) {
    Cap.Plugins.App.addListener('backButton', ({ canGoBack }) => {
      if ($('folha').open) { $('folha').close(); return; }
      if (!$('sugestoes').hidden) { fecharSugestoes(); return; }
      if (rotaAtual().tela !== 'lista') {
        if (canGoBack) history.back(); else location.hash = '#lista';
        return;
      }
      if (Cap.Plugins.App.minimizeApp) Cap.Plugins.App.minimizeApp(); else Cap.Plugins.App.exitApp();
    });
  }

  // Com o teclado aberto (o app encolhe), esconde as abas para sobrar espaço para a lista.
  let alturaMaxima = window.innerHeight;
  window.addEventListener('resize', () => {
    alturaMaxima = Math.max(alturaMaxima, window.innerHeight);
    document.body.classList.toggle('teclado-aberto', window.innerHeight < alturaMaxima * 0.75);
  });
  window.addEventListener('orientationchange', () => { alturaMaxima = 0; });

  /* ---------- Atualização automática (APK) ---------- */

  const ATUALIZACAO_BAIXADA = 'compracerta-atualizacao-baixada';
  const AVISO_APK = 'compracerta-aviso-apk';
  let ultimaVerificacao = 0;

  /** "3.10.0" > "3.9.2" */
  function compararVersoes(a, b) {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    }
    return 0;
  }

  function lerLocal(chave) { try { return localStorage.getItem(chave); } catch (_) { return null; } }
  function gravarLocal(chave, valor) { try { localStorage.setItem(chave, valor); } catch (_) { /* sem espaço */ } }

  async function avisarApkNovo(novo, urlApk) {
    const hoje = new Date().toISOString().slice(0, 10);
    if (lerLocal(AVISO_APK) === novo.versao + '|' + hoje) return; // no máximo um aviso por dia
    gravarLocal(AVISO_APK, novo.versao + '|' + hoje);
    const v = await abrirFolha(
      '<h2 id="folhaTitulo">Nova versão do app: ' + esc(novo.versao) + '</h2>' +
      '<p class="sub">Esta atualização precisa ser instalada pelo APK. Seus dados continuam no aparelho.</p>' +
      '<ol class="dicas"><li>Toque em <strong>Baixar agora</strong>.</li><li>Abra o arquivo baixado e toque em <strong>Instalar</strong> (por cima do app atual).</li></ol>' +
      '<div class="botoes"><button class="btn primario" value="baixar">Baixar agora</button><button class="btn texto" value="">Depois</button></div>');
    if (v === 'baixar') location.href = urlApk; // abre no navegador do celular, que faz o download
  }

  /** Procura uma versão nova no GitHub Pages. Se só o conteúdo mudou, baixa em segundo plano e aplica
      na próxima abertura; se a parte nativa mudou, avisa para instalar o APK novo. */
  async function verificarAtualizacao() {
    const Atualizador = Cap && Cap.Plugins && Cap.Plugins.CapacitorUpdater;
    const info = window.CC_VERSAO;
    if (!nativo || !Atualizador || !info || !info.urlAtualizacao) return;
    if (navigator.onLine === false || Date.now() - ultimaVerificacao < 6 * 3600 * 1000) return;
    ultimaVerificacao = Date.now();
    try {
      const resposta = await fetch(info.urlAtualizacao + '?t=' + Date.now(), { cache: 'no-store' });
      if (!resposta.ok) return;
      const novo = await resposta.json();
      if (!novo || compararVersoes(novo.versao, info.app) <= 0) return; // já está na versão mais nova
      const app = Cap.Plugins.App && Cap.Plugins.App.getInfo ? await Cap.Plugins.App.getInfo() : null;
      const apkInstalado = app ? Number(app.build) : 0;
      if (novo.apkMinimo && apkInstalado < novo.apkMinimo) {
        avisarApkNovo(novo, novo.urlApk || info.urlApk);
        return;
      }
      if (lerLocal(ATUALIZACAO_BAIXADA) === novo.versao) return; // já baixada, aguardando a próxima abertura
      const baixado = await Atualizador.download({
        url: new URL(novo.url, info.urlAtualizacao).href,
        version: novo.versao,
        checksum: novo.checksum
      });
      await Atualizador.next({ id: baixado.id });
      gravarLocal(ATUALIZACAO_BAIXADA, novo.versao);
      toast('Atualização ' + novo.versao + ' baixada. Ela entra em uso na próxima vez que você abrir o app.');
    } catch (e) {
      ultimaVerificacao = 0; // sem internet ou falha no download: tenta de novo na próxima vez
    }
  }

  if (nativo && Cap.Plugins && Cap.Plugins.CapacitorUpdater) {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') verificarAtualizacao(); });
    setTimeout(verificarAtualizacao, 3000);
  }

  /* ---------- Início ---------- */

  $('campoCategoria').innerHTML = C.CATEGORIAS.map(c => '<option>' + esc(c) + '</option>').join('');
  carregar();
  salvar();
  mostrarTela();
  // O app abriu sem erros: confirma ao atualizador. Se uma atualização quebrar a abertura,
  // esta linha não é alcançada e o plugin volta sozinho para a versão anterior.
  if (nativo && Cap.Plugins && Cap.Plugins.CapacitorUpdater) Cap.Plugins.CapacitorUpdater.notifyAppReady().catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  // No APK os arquivos já estão no aparelho; o service worker só é usado na versão web.
  if (!nativo && 'serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* app funciona sem modo offline */ });
  }
  nuvem = window.CCNuvem ? window.CCNuvem.iniciar(window.CC_CONFIG, {
    obterEstado: () => estado,
    substituirEstado: novo => { estado = C.migrar(novo); salvar(); mostrarTela(); },
    aoMudarStatus: renderNuvem
  }) : null;
})();
