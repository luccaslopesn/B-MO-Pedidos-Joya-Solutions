# Especificação: Gestão de Pedidos (B-MO)

Versão 1 · 13/11/2026 · status: rascunho para revisão

Este documento descreve **o que** o B-MO deve fazer e **como saberemos que está pronto**. O **como implementar** fica no `docs/plan.md`. Se este documento e o código discordarem, um dos dois está errado, e a correção começa aqui.

---

## 1. Objetivo

O B-MO registra e consulta pedidos de clientes. Um atendente escolhe o cliente, monta o pedido com produtos do catálogo, e o sistema só aceita o pedido se houver estoque para tudo. Depois disso, qualquer pessoa consegue encontrar pedidos por cliente e por período, e descobrir quais clientes mais compraram num intervalo de tempo.

O foco não é a complexidade das regras, e sim entregar poucas regras muito bem feitas: validadas, testadas e fáceis de entender.

---

## 2. Conceitos

Antes das regras, o vocabulário. Os mesmos nomes aparecem no banco, no código e na tela.

| Termo | Significado |
|---|---|
| **Cliente** | Quem faz pedidos. É identificado pelo seu número (`Id`). Dois clientes podem ter o mesmo nome. |
| **Produto** | Item do catálogo, com preço atual e quantidade em estoque. |
| **Pedido** | Uma compra feita por um cliente, numa data, com um ou mais itens. |
| **Item do pedido** | Um produto dentro de um pedido: qual produto, quantas unidades e o preço unitário cobrado. |
| **Valor total** | Soma de `quantidade × preço unitário` de todos os itens do pedido. Não é gravado: é sempre calculado a partir dos itens. |
| **Período** | Intervalo de dias com data inicial e data final, ambas incluídas. |

---

## 3. Escopo

**Dentro do escopo**

- Criar um pedido com seus itens.
- Listar pedidos, com filtro por cliente e por período, em páginas.
- Consultar um pedido pelo número.
- Relatório dos 5 clientes que mais compraram num período.
- Listas de clientes e produtos, para alimentar a tela de criação.

**Fora do escopo**

- Login, usuários e permissões.
- Cadastro, edição e exclusão de clientes e produtos (eles vêm da carga inicial do banco).
- Editar, cancelar ou excluir pedidos.
- Status, pagamento e entrega de pedidos.

---

## 4. Modelo de dados

```mermaid
erDiagram
  Clientes ||--o{ Pedidos : faz
  Pedidos ||--|{ ItensPedido : contem
  Produtos ||--o{ ItensPedido : aparece_em
```

| Tabela | Coluna | Tipo | Regras |
|---|---|---|---|
| **Clientes** | Id | int | chave primária, gerado pelo banco |
| | Nome | nvarchar(150) | obrigatório, **pode repetir** |
| | Email | nvarchar(200) | obrigatório, único |
| | DataCadastro | datetime2 | obrigatório, padrão: agora (UTC) |
| **Produtos** | Id | int | chave primária, gerado pelo banco |
| | Nome | nvarchar(150) | obrigatório |
| | Preco | decimal(18,2) | obrigatório, maior que zero |
| | Estoque | int | obrigatório, nunca negativo |
| **Pedidos** | Id | int | chave primária, gerado pelo banco |
| | ClienteId | int | obrigatório, referencia `Clientes` |
| | DataPedido | datetime2 | obrigatório, definida pelo servidor (UTC) |
| **ItensPedido** | PedidoId | int | referencia `Pedidos`; parte da chave primária |
| | ProdutoId | int | referencia `Produtos`; parte da chave primária |
| | Quantidade | int | obrigatório, maior que zero |
| | PrecoUnitario | decimal(18,2) | obrigatório, copiado do produto na criação |

Três escolhas que merecem explicação:

- **A chave de `ItensPedido` é o par (PedidoId, ProdutoId).** Isso faz o próprio banco impedir o mesmo produto duas vezes no pedido (regra RN-04) e guarda os itens de um pedido fisicamente juntos, o que acelera as consultas que somam itens por pedido.
- **O preço é copiado para o item.** O preço do produto pode mudar amanhã; o que o cliente pagou, não (regra RN-08).
- **O valor total não é gravado em `Pedidos`.** Um número calculado e guardado em dois lugares pode divergir. Calculando sempre a partir dos itens, existe uma única fonte da verdade.

Os índices e o motivo de cada um estão no `docs/plan.md`.

---

## 5. Regras de negócio

### 5.1 Criação de pedido

| Código | Regra |
|---|---|
| **RN-01** | O cliente informado precisa existir. |
| **RN-02** | O pedido precisa ter pelo menos um item. |
| **RN-03** | A quantidade de cada item é um número inteiro maior que zero. |
| **RN-04** | Um produto aparece no máximo uma vez por pedido. Para pedir mais unidades, aumenta-se a quantidade da linha. |
| **RN-05** | Todo produto do pedido precisa existir. |
| **RN-06** | Cada item precisa ter estoque suficiente. Ao criar o pedido, o estoque de cada produto diminui na quantidade pedida. |
| **RN-07** | **Tudo ou nada.** Se qualquer item falhar, nada é gravado e nenhum estoque muda. |
| **RN-08** | O preço unitário de cada item é o preço do produto no momento da criação. Quem chama a API não informa preço. Mudanças futuras de preço não alteram pedidos já feitos. |
| **RN-09** | A data do pedido é definida pelo servidor, em UTC, no momento da criação. |
| **RN-10** | Pedidos feitos ao mesmo tempo nunca deixam o estoque negativo. Se dois pedidos disputam a última unidade, um é aceito e o outro é recusado por estoque insuficiente. |
| **RN-11** | Se o cliente não existe (RN-01) ou o pedido não tem itens (RN-02), a resposta traz só esse problema. Caso contrário, **todos** os problemas dos itens voltam juntos, um por item, para que a tela marque cada linha de uma vez. |

Por que RN-04 importa: sem ela, duas linhas de 3 unidades de um produto com estoque 5 passariam numa verificação feita linha a linha, e o estoque terminaria em -1.

### 5.2 Consultas

| Código | Regra |
|---|---|
| **RN-12** | No filtro de período, as duas datas são incluídas e valem o dia inteiro. Um pedido às 23:59:59 do dia final entra; um pedido às 00:00:00 do dia seguinte, não. |
| **RN-13** | A data inicial não pode ser posterior à data final. |
| **RN-14** | A listagem vem do pedido mais recente para o mais antigo. Em caso de empate na data, o número do pedido maior vem primeiro. Esse desempate garante que a paginação nunca repita nem pule pedidos. |
| **RN-15** | Paginação: página padrão 1, tamanho padrão 20, tamanho máximo 100. |
| **RN-16** | O relatório de top clientes agrupa pelo **cliente** (seu `Id`, nunca pelo nome), soma o valor dos itens dos pedidos do período, ordena do maior para o menor valor, desempata pelo menor `Id` e devolve no máximo 5 clientes. Clientes sem pedidos no período não aparecem. |
| **RN-17** | As datas dos filtros são interpretadas em UTC. Limitação conhecida: um pedido feito às 22h de 31/12 em São Paulo é gravado como 01/01 em UTC. |

---

## 6. API

### 6.1 Convenções

- Corpo em JSON com nomes em `camelCase`.
- Datas em ISO 8601. Datas com hora vêm em UTC (`2026-11-13T13:05:00Z`); filtros de data usam só o dia (`2026-11-13`).
- Valores em dinheiro com duas casas decimais.
- Erros seguem o formato **ProblemDetails** (RFC 9457).

O status do erro diz que tipo de problema aconteceu:

| Status | Significado | Exemplo |
|---|---|---|
| **400** | Não foi possível ler a requisição. | JSON malformado, campo obrigatório ausente, data inicial depois da final |
| **404** | O recurso pedido no endereço não existe. | `GET /pedidos/999999` |
| **422** | A requisição foi entendida, mas viola uma regra de negócio. | Cliente inexistente, estoque insuficiente |

O 400 usa o formato padrão de validação do ASP.NET Core (`errors` por campo). O 422 usa o formato abaixo, com um código estável que o front e os testes podem usar sem depender do texto da mensagem:

```json
{
  "title": "O pedido não pôde ser criado.",
  "status": 422,
  "codigo": "PEDIDO_INVALIDO",
  "erros": [
    {
      "codigo": "ESTOQUE_INSUFICIENTE",
      "mensagem": "Estoque insuficiente para Kit coffee break: solicitado 8, disponível 5.",
      "produtoId": 3,
      "solicitado": 8,
      "disponivel": 5
    }
  ]
}
```

### 6.2 `POST /pedidos`: criar pedido

**Requisição**

```json
{
  "clienteId": 12,
  "itens": [
    { "produtoId": 3, "quantidade": 2 },
    { "produtoId": 7, "quantidade": 1 }
  ]
}
```

**Resposta de sucesso:** `201 Created`, com o cabeçalho `Location: /pedidos/{id}`

```json
{
  "id": 1234,
  "clienteId": 12,
  "clienteNome": "Produtora Aurora",
  "dataPedido": "2026-11-13T13:05:00Z",
  "valorTotal": 249.70,
  "itens": [
    { "produtoId": 3, "produtoNome": "Kit coffee break", "quantidade": 2, "precoUnitario": 99.90, "subtotal": 199.80 },
    { "produtoId": 7, "produtoNome": "Crachá personalizado", "quantidade": 1, "precoUnitario": 49.90, "subtotal": 49.90 }
  ]
}
```

**Erros de regra (422)**

| Código | Regra | Dados extras |
|---|---|---|
| `CLIENTE_NAO_ENCONTRADO` | RN-01 | |
| `PEDIDO_SEM_ITENS` | RN-02 | |
| `QUANTIDADE_INVALIDA` | RN-03 | `produtoId` |
| `PRODUTO_DUPLICADO` | RN-04 | `produtoId` |
| `PRODUTO_NAO_ENCONTRADO` | RN-05 | `produtoId` |
| `ESTOQUE_INSUFICIENTE` | RN-06, RN-10 | `produtoId`, `solicitado`, `disponivel` |

### 6.3 `GET /pedidos`: listar pedidos

**Parâmetros (todos opcionais)**

| Parâmetro | Tipo | Padrão | Observação |
|---|---|---|---|
| `clienteId` | int | | |
| `dataInicio` | data | | RN-12, RN-13 |
| `dataFim` | data | | RN-12, RN-13 |
| `pagina` | int | 1 | mínimo 1 |
| `tamanhoPagina` | int | 20 | de 1 a 100 |

Exemplo: `GET /pedidos?clienteId=7&dataInicio=2026-01-01&dataFim=2026-12-31&pagina=2`

**Resposta:** `200 OK`

```json
{
  "itens": [
    {
      "id": 1234,
      "dataPedido": "2026-11-13T13:05:00Z",
      "clienteId": 7,
      "clienteNome": "Produtora Aurora",
      "quantidadeItens": 2,
      "valorTotal": 249.70
    }
  ],
  "pagina": 2,
  "tamanhoPagina": 20,
  "totalItens": 153,
  "totalPaginas": 8
}
```

`quantidadeItens` é o número de linhas do pedido (produtos diferentes), não a soma das unidades.

Um filtro com `clienteId` inexistente devolve uma lista vazia, não um erro: filtrar é perguntar "quais pedidos atendem a isto?", e "nenhum" é uma resposta válida.

### 6.4 `GET /pedidos/{id}`: consultar um pedido

`200 OK` com o mesmo formato da resposta de criação, ou `404 Not Found`.

### 6.5 `GET /relatorios/top-clientes`: maiores compradores do período

**Parâmetros (ambos obrigatórios):** `dataInicio`, `dataFim`

Exemplo: `GET /relatorios/top-clientes?dataInicio=2026-01-01&dataFim=2026-12-31`

**Resposta:** `200 OK`, com no máximo 5 posições (RN-16)

```json
[
  { "posicao": 1, "clienteId": 7, "nome": "Produtora Aurora", "totalPedidos": 12, "valorTotal": 15320.50 },
  { "posicao": 2, "clienteId": 31, "nome": "Eventos Lume", "totalPedidos": 9, "valorTotal": 11870.00 }
]
```

Sem pedidos no período, a resposta é uma lista vazia.

### 6.6 Endpoints de apoio

| Endpoint | Para que serve | Resposta |
|---|---|---|
| `GET /clientes?busca=` | Preencher o seletor de cliente. Filtra pelo nome, devolve até 50, em ordem alfabética. | `[{ "id", "nome" }]` |
| `GET /produtos` | Preencher o seletor de produto, mostrando preço e estoque. | `[{ "id", "nome", "preco", "estoque" }]` |
| `GET /health` | Dizer se a API está no ar e falando com o banco. Usado pelo Docker e pelo CI. | `200` ou `503` |

---

## 7. Telas

### 7.1 Lista de pedidos

É a tela inicial. Mostra uma tabela com número, data (no horário local de quem está vendo), cliente, quantidade de itens e valor total em reais.

- **Filtros:** cliente, data inicial e data final, com um botão para limpar. Os filtros ficam na URL, então recarregar a página ou compartilhar o link mantém a mesma consulta.
- **Paginação:** anterior e próxima, com a indicação "página X de Y".
- **Estados:** enquanto carrega, mostra um esqueleto da tabela; sem resultados, mostra uma mensagem dizendo que não há pedidos para os filtros escolhidos; se a API falhar, mostra o erro e um botão para tentar de novo.
- Um botão **Novo pedido** abre a tela de criação.

### 7.2 Novo pedido (modal)

- O usuário escolhe o cliente e adiciona linhas de item. Cada linha tem produto (com preço e estoque visíveis), quantidade e subtotal. O total do pedido aparece no rodapé.
- A tela já evita os erros óbvios antes de enviar: exige pelo menos um item, quantidade mínima de 1, quantidade até o estoque exibido, e desativa nas outras linhas um produto já escolhido.
- Mesmo assim, quem decide é o servidor. Se ele recusar, cada erro aparece **na linha do produto correspondente** (por exemplo, o estoque disponível atualizado, caso outra pessoa tenha comprado nesse meio-tempo).
- Ao salvar com sucesso, o modal fecha, aparece uma confirmação, e a lista se atualiza com o novo pedido no topo, sem recarregar a página.

---

## 8. Critérios de aceite

Cada critério diz em qual nível de teste ele é verificado: **U** (unitário), **I** (integração, contra um SQL Server real) e **E2E** (Playwright, pelo navegador).

### 8.1 Criar pedido

| ID | Cenário | Resultado esperado | Teste |
|---|---|---|---|
| CA-01 | Cliente existe; produto com estoque 10; pedido de 3 unidades. | `201`, cabeçalho `Location`, valor total igual a 3 × preço, estoque passa a 7. | U, I, E2E |
| CA-02 | Cliente não existe. | `422 CLIENTE_NAO_ENCONTRADO`; nada gravado. | U, I |
| CA-03 | Lista de itens vazia. | `422 PEDIDO_SEM_ITENS`. | U |
| CA-04 | Item com quantidade 0 ou negativa. | `422 QUANTIDADE_INVALIDA` naquele item. | U |
| CA-05 | Mesmo produto em duas linhas, mesmo que cada linha caiba no estoque sozinha. | `422 PRODUTO_DUPLICADO`. | U |
| CA-06 | Produto não existe. | `422 PRODUTO_NAO_ENCONTRADO` naquele item. | U |
| CA-07 | Quantidade maior que o estoque. | `422 ESTOQUE_INSUFICIENTE` com `solicitado` e `disponivel`. | U, I, E2E |
| CA-08 | Quantidade exatamente igual ao estoque. | Aceito; estoque passa a 0. | U, I |
| CA-09 | Dois itens: o primeiro tem estoque, o segundo não. | `422`, e o estoque do **primeiro** produto não mudou. | I |
| CA-10 | O preço do produto muda depois do pedido criado. | O pedido continua com o preço antigo. | I |
| CA-11 | Produto com estoque 1; duas requisições enviadas ao mesmo tempo. | Exatamente um `201` e um `422`; estoque final 0. | I |
| CA-12 | Pedido com dois itens inválidos por motivos diferentes. | Um único `422` listando os dois problemas. | U |
| CA-13 | JSON malformado ou `clienteId` ausente. | `400`. | I |

### 8.2 Listar e consultar pedidos

| ID | Cenário | Resultado esperado | Teste |
|---|---|---|---|
| CA-14 | Sem filtros. | Página 1 com até 20 pedidos, do mais recente para o mais antigo. | I |
| CA-15 | Filtro por cliente. | Só pedidos daquele cliente. | I, E2E |
| CA-16 | Período até 31/12/2026, com pedidos às 23:59:59 de 31/12 e às 00:00:00 de 01/01/2027. | O primeiro aparece; o segundo, não. | I |
| CA-17 | Data inicial depois da final. | `400`. | U, I |
| CA-18 | Percorrer todas as páginas de um resultado. | `totalItens` e `totalPaginas` corretos; nenhum pedido repetido ou ausente entre páginas. | I |
| CA-19 | `tamanhoPagina` igual a 101. | `400`. | U |
| CA-20 | `GET /pedidos/{id}` com número inexistente. | `404`. | I |

### 8.3 Relatório de top clientes

| ID | Cenário | Resultado esperado | Teste |
|---|---|---|---|
| CA-21 | Mais de 5 clientes com pedidos no período. | Exatamente 5, do maior para o menor valor. | I |
| CA-22 | Dois clientes diferentes com o mesmo nome. | Aparecem separados, cada um com seu próprio total. | I |
| CA-23 | Pedidos fora do período, inclusive nas bordas (CA-16). | Não entram na soma. | I |
| CA-24 | Dois clientes com o mesmo valor total. | O de menor `Id` vem primeiro. | I |
| CA-25 | Sem `dataInicio` ou `dataFim`. | `400`. | I |

### 8.4 Telas

| ID | Cenário | Resultado esperado | Teste |
|---|---|---|---|
| CA-26 | Criar um pedido pelo modal. | O modal fecha, aparece a confirmação e o pedido está no topo da lista, sem recarregar a página. | E2E |
| CA-27 | Aplicar filtros e recarregar a página. | Os filtros continuam aplicados (estão na URL). | E2E |
| CA-28 | Tentar salvar com quantidade acima do estoque real. | O erro aparece na linha do produto, com o estoque disponível. | E2E |

### 8.5 Ambiente

| ID | Cenário | Resultado esperado | Teste |
|---|---|---|---|
| CA-29 | Clonar o repositório numa pasta nova e rodar `docker compose up`. | Banco criado e com dados de exemplo, API e front no ar, sem nenhum passo manual. | Manual e CI |

---

## 9. Restrições técnicas

- **Banco:** SQL Server. Scripts de criação e carga de dados em `database/`, executados automaticamente ao subir o ambiente.
- **Backend:** .NET 10 (LTS).
- **Frontend:** React com TypeScript e shadcn/ui.
- **Execução:** a aplicação inteira sobe com `docker compose up`.
- **Testes:** unitários e de integração no backend (integração contra um SQL Server real) e ponta a ponta com Playwright no frontend.
- **Legibilidade:**
  - Os nomes do domínio são em português e iguais no banco, no código e na tela.
  - Cada fluxo principal tem uma explicação em prosa em `docs/fluxos/`, escrita para quem nunca viu o projeto.

---

## 10. Pontos para revisar

Decisões tomadas nesta versão que vale confirmar antes do plano:

1. **Fuso horário (RN-17).** O B-MO grava e filtra em UTC. Converter os filtros do horário de São Paulo resolve a limitação, mas adiciona uma regra a mais para testar.
2. **Tamanho do top clientes.** Fixo em 5, como pede o enunciado, sem parâmetro para mudar.
3. **Busca de cliente na listagem.** O filtro é por cliente escolhido num seletor (`clienteId`), não por texto livre com o nome.
