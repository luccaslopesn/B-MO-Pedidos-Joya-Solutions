# CLAUDE.md

Guia de trabalho para o Claude Code e para quem mexer neste repositório. As regras de negócio **não** ficam aqui: elas estão em [docs/spec.md](docs/spec.md). Este arquivo diz onde as coisas estão, como rodar e quais regras o código precisa seguir.

## O projeto

B-MO registra e consulta pedidos de clientes. A stack é SQL Server, .NET 10 (LTS), React com TypeScript e shadcn/ui, Docker Compose e Playwright.

A ordem de autoridade é esta:

1. [docs/spec.md](docs/spec.md) diz **o quê** fazer e como saber que está pronto (regras `RN-xx` e critérios `CA-xx`).
2. `docs/plan.md` diz **como** implementar (camadas, índices, bibliotecas).
3. O código segue os dois.

Se o código e a spec discordarem, pare e aponte a divergência. A correção começa na spec, em um commit próprio. Não invente regra de negócio que a spec não traz: pergunte. Ao implementar ou testar uma regra, cite o código dela (`RN-06`, `CA-11`) no teste e na descrição do commit ou do PR.

## Mapa do repositório

Os itens marcados como *(planejado)* ainda não existem; a estrutura completa está na seção 2 do [docs/plan.md](docs/plan.md). Quando uma pasta for criada ou mudar de nome, atualize este mapa no mesmo commit.

```text
.
├── CLAUDE.md               este guia
├── .gitignore              organizado por área (sistema, IDEs, .NET, Node, testes, segredos, IA)
├── .claude/                configuração compartilhada do Claude Code (versionada, faz parte da entrega)
│   ├── settings.json       permissões e registro dos hooks
│   ├── hooks/              scripts Node dos hooks (ver "Automação do Claude")
│   └── agents/             agentes revisor e escritor-de-testes
├── docker-compose.yml      (planejado) sobe banco, API e front com um único comando
├── database/               (planejado) scripts de criação e carga inicial, executados ao subir o ambiente
├── backend/                (planejado) API .NET 10 e testes unitários e de integração
├── frontend/               (planejado) React + TypeScript + shadcn/ui
├── e2e/                    (planejado) testes ponta a ponta com Playwright
└── docs/
    ├── spec.md             o quê e critérios de aceite (fonte da verdade)
    ├── plan.md             como implementar, incluindo índices e o motivo de cada um
    └── fluxos/             (planejado) cada fluxo principal explicado em prosa para quem nunca viu o projeto
```

Clientes e produtos vêm só da carga inicial em `database/`. Não existe tela nem endpoint para cadastrá-los.

## Comandos

> Os projetos ainda não foram criados. Ajuste esta seção assim que existirem (gerenciador de pacotes, nomes de solução e portas).

```bash
# Ambiente completo: banco criado e populado, API e front no ar, sem passo manual (CA-39)
docker compose up --build

# Derruba o ambiente e APAGA o volume do banco (a próxima subida recria do zero)
docker compose down -v

# Backend
dotnet build backend
dotnet test backend            # unitários + integração; a integração exige SQL Server real

# Frontend
cd frontend && npm install
npm run dev
npm run lint && npm run build

# Ponta a ponta (com o ambiente no ar)
cd e2e && npx playwright test
```

Antes de dizer que uma tarefa terminou, rode build, lint e testes da parte que você alterou. Se algum falhar, diga qual falhou e mostre a saída. Não esconda a falha.

## Regras de arquitetura

Estas regras traduzem a spec em restrições de código. Quebrar qualquer uma delas é um bug, mesmo que os testes passem.

**Dados**

- O valor total do pedido **nunca** é gravado. Ele é sempre calculado como `Σ quantidade × PrecoUnitario` dos itens.
- `PrecoUnitario` é copiado do produto na criação do pedido (RN-08). A API não aceita preço vindo do cliente.
- A chave de `ItensPedido` é `(PedidoId, ProdutoId)`. Ela já impede produto duplicado no banco (RN-04), mas a validação também acontece antes, para devolver `PRODUTO_DUPLICADO`.
- Mudanças de esquema ou de carga ficam em scripts de `database/`, executados automaticamente pelo Docker. Nada de passo manual.

**Criação de pedido**

- A criação é **tudo ou nada** (RN-07): pedido, itens e baixa de estoque ficam na mesma transação.
- A baixa de estoque nunca segue o padrão "ler e depois gravar". Ela é condicional no próprio `UPDATE` (`... WHERE Id = @id AND Estoque >= @quantidade`) e confere as linhas afetadas, para que dois pedidos simultâneos não deixem o estoque negativo (RN-10, CA-11).
- A ordem de validação segue a RN-11. Cliente inexistente ou pedido sem itens devolvem só esse erro. Fora isso, **todos** os erros de item voltam juntos, um por item.
- A data do pedido é definida pelo servidor, em UTC (RN-09).

**Datas e fuso**

- O banco e a API trabalham em **UTC**. O horário de São Paulo entra só na borda: na interpretação dos filtros e na exibição.
- A conversão usa o fuso `America/Sao_Paulo` (`TimeZoneInfo` no .NET e `Intl.DateTimeFormat` com `timeZone` no front). **Nunca** use um deslocamento fixo de "-3 horas".
- Um filtro de período cobre `[início do dia inicial em SP, início do dia seguinte ao final em SP)`, convertido para UTC (RN-13, CA-14, CA-15).
- O front exibe datas em São Paulo mesmo que o navegador esteja em outro fuso (CA-17).

**Consultas**

- A listagem ordena por `DataPedido DESC, Id DESC`. O desempate pelo `Id` é obrigatório para que a paginação não repita nem pule pedidos (RN-18).
- A busca por texto ignora maiúsculas, minúsculas e acentos. Quando o texto é só um número, ela também procura pelo número do pedido (RN-15).
- Agregações por cliente agrupam pelo `ClienteId`, **nunca** pelo nome, porque nomes se repetem (RN-20).
- Um filtro sem resultado devolve lista vazia, não erro.

**Front**

- Quem decide é o servidor. As validações da tela evitam erros óbvios, mas não substituem as da API.
- Os filtros da lista (busca, período, cliente e página) ficam na URL.
- Erros de item aparecem na linha do produto, identificados pelo `produtoId` do erro.

**Testes**

- Os testes de integração rodam contra um **SQL Server real**, nunca EF InMemory ou SQLite. Fuso, collation e concorrência só se comportam de verdade lá.
- Cada critério de aceite é coberto no nível indicado na spec (U, I ou E2E), e o nome do teste cita o `CA-xx`.
- Os testes não dependem do horário atual nem do fuso da máquina. A data entra por um relógio injetável (`TimeProvider`).

## Nomenclatura em português

O domínio fala português, e os **mesmos nomes** aparecem no banco, no código e na tela (ver a seção 2 da spec). O que vem do framework segue o idioma do framework.

| Onde | Convenção | Exemplos |
|---|---|---|
| Tabelas | PascalCase, plural | `Clientes`, `Produtos`, `Pedidos`, `ItensPedido` |
| Colunas | PascalCase | `ClienteId`, `DataPedido`, `PrecoUnitario` |
| Classes de domínio (C#) | PascalCase, singular | `Cliente`, `Pedido`, `ItemPedido` |
| Métodos e propriedades (C#) | PascalCase, verbo em português | `CriarPedido`, `BaixarEstoque`, `ValorTotal` |
| JSON e parâmetros de consulta | camelCase | `clienteId`, `dataInicio`, `tamanhoPagina` |
| Rotas | minúsculas, plural, kebab-case | `/pedidos`, `/relatorios/top-clientes` |
| Códigos de erro | UPPER_SNAKE_CASE | `ESTOQUE_INSUFICIENTE` |
| Componentes React | PascalCase | `ListaPedidos`, `ModalNovoPedido` |
| Testes | `Cenario_Resultado` com o critério | `CriarPedido_EstoqueInsuficiente_Retorna422_CA07` |

- Identificadores não levam acento nem `ç`: `Preco`, `Descricao`, `Posicao`. Textos exibidos ao usuário levam acento normalmente.
- Não traduza um termo do domínio pela metade (`OrderItem`, `PedidoService` com `customer` dentro). Sufixos e tipos do framework, como `Controller`, `DbContext`, `IActionResult` e `useQuery`, ficam como estão.
- Um termo novo do domínio entra primeiro na tabela de conceitos da spec e só depois no código.

## Contrato de erro

Todo erro sai como **ProblemDetails** (RFC 9457), com `Content-Type: application/problem+json`. O status diz o tipo de problema:

| Status | Quando | Formato |
|---|---|---|
| `400` | Requisição ilegível ou parâmetro fora do permitido (JSON malformado, campo ausente, `dataInicio > dataFim`, `tamanhoPagina=101`, `limite=21`) | Validação padrão do ASP.NET Core, com `errors` por campo |
| `404` | O recurso do endereço não existe (`GET /pedidos/999999`) | ProblemDetails simples |
| `422` | A requisição foi entendida, mas viola uma regra de negócio | Formato abaixo |

```json
{
  "title": "O pedido não pôde ser criado.",
  "status": 422,
  "codigo": "PEDIDO_INVALIDO",
  "erros": [
    { "codigo": "ESTOQUE_INSUFICIENTE", "mensagem": "...", "produtoId": 3, "solicitado": 8, "disponivel": 5 }
  ]
}
```

| `codigo` | Regra | Dados extras |
|---|---|---|
| `CLIENTE_NAO_ENCONTRADO` | RN-01 | |
| `PEDIDO_SEM_ITENS` | RN-02 | |
| `QUANTIDADE_INVALIDA` | RN-03 | `produtoId` |
| `PRODUTO_DUPLICADO` | RN-04 | `produtoId` |
| `PRODUTO_NAO_ENCONTRADO` | RN-05 | `produtoId` |
| `ESTOQUE_INSUFICIENTE` | RN-06, RN-10 | `produtoId`, `solicitado`, `disponivel` |

- O `codigo` é estável e faz parte do contrato. O front e os testes usam o `codigo` e **nunca** o texto da `mensagem`, que pode mudar.
- Um código novo ou alterado entra primeiro na seção 6.2 da spec e depois no código, no front e nos testes.
- Regras de negócio violadas geram `422`, nunca `400` nem `500`. Exceção não tratada gera `500` sem stack trace na resposta.

## Regras de git

- Não faça commit nem push sem pedido explícito.
- Mensagens seguem o Conventional Commits, em português, com descrição em minúsculas no presente: `tipo(escopo): descrição`. Exemplos do histórico: `docs(spec): define fuso de São Paulo, ...`, `chore: estrutura inicial do repositório`.
  - Tipos: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`, `build`, `ci`.
  - Escopos: `spec`, `plan`, `api`, `front`, `db`, `e2e`, `docker`.
- Cada commit traz uma mudança lógica e deixa o projeto compilando. Uma mudança na spec vai em commit `docs(spec)` próprio, antes do código que depende dela.
- Para trabalho novo, crie uma branch a partir da `main` (`feat/criar-pedido`, `fix/filtro-fuso`). Nunca use force push na `main`.
- Nunca pule hooks (`--no-verify`) nem assinatura.
- Nunca versione segredos: `.env`, `appsettings.*.local.json`, certificados (`*.pfx`, `*.pem`, `*.key`) e `CLAUDE.local.md`. Para configuração de exemplo, use `.env.example`.

## Automação do Claude

Tudo fica em `.claude/` e vale para quem abrir o projeto com o Claude Code. Os hooks são scripts Node (`.mjs`, sem dependências, iguais no Windows, Mac e Linux) que recebem o evento em JSON pelo stdin. Saída `0` deixa seguir; saída `2` bloqueia e devolve o erro ao Claude. Todos ficam em silêncio quando ainda não existe o que eles verificam, então não atrapalham a fase em que só há documentação.

### Hooks

| Hook | Quando roda | O que faz | Quando fica inativo |
|---|---|---|---|
| `proteger-historico` | Antes de um comando de terminal (Bash ou PowerShell) | Recusa comandos que reescrevem o histórico do git: `rebase`, `commit --amend`, `push --force` (também `-f`, `--force-with-lease` e `+ramo`), `reset --hard`, `merge --squash`, `filter-branch` e `filter-repo`. Quem errou faz um commit novo. | Nunca fica inativo. Só deixa passar o que não é um desses comandos: uma mensagem de commit que cita "rebase" passa. |
| `verificar-edicao` | Depois de editar um arquivo (Edit, Write ou MultiEdit) | Em `.cs`, compila com `dotnet build backend/BMO.slnx` e devolve só as linhas de erro (até 20). Em `.ts` e `.tsx`, roda o eslint só no arquivo editado. | Para qualquer outra extensão; sem `backend/BMO.slnx` (`.cs`); sem `frontend/package.json` ou sem o eslint instalado (`.ts` e `.tsx`); em arquivo `.ts` fora de `frontend/`; sem o comando `dotnet`; ou se passar de 110 s. |
| `portao-testes` | Quando o Claude vai encerrar o turno | Roda os testes unitários do backend. Se algum falhar, mostra quais e o Claude continua o turno para corrigir. Os de integração ficam de fora: são pesados e rodam no CI. | Sem mudanças em `backend/` (git status limpo); sem `backend/tests/BMO.Testes.Unitarios`; ou quando o Claude já está continuando por causa dele, para não prender o turno num laço. |

### Agentes

| Agente | Quando usar | O que faz |
|---|---|---|
| `revisor` | Antes de cada commit de feature | Lê o diff e o confere contra este guia e contra as regras (RN) e os critérios (CA) da spec, além de checar SQL, C# e segredos. Responde em três blocos (Bloqueadores, Sugestões e Ok), com arquivo e linha. Só lê: não edita nada e usa apenas `git diff`, `git diff --staged`, `git log` e `git show`. |
| `escritor-de-testes` | Para escrever os testes de um critério de aceite **antes** da implementação | Recebe IDs de critérios (ex.: `CA-05`), escreve o teste no nível que a spec indica (U, I ou E2E), com nome `Metodo_Cenario_ResultadoEsperado_CAxx` e `Trait("CA", "CA-xx")` (no Playwright, o CA vai no título) e roda para confirmar que falha pelo motivo certo. Escreve só em `backend/tests/` e `e2e/`, nunca em `src/`. |

### Permissões e cuidados

- `settings.json` libera sem perguntar `dotnet build`, `test` e `restore`, `npm run`, `npx playwright`, `docker compose` e os comandos de git do dia a dia (`status`, `diff`, `log`, `add`, `commit`, `branch`, `checkout`, `switch`). Liberar `git commit` não muda a regra de "Regras de git": só commitar quando for pedido.
- O bloqueio de leitura do `.env` evita acidentes, mas **não é uma fronteira de segurança**: a proteção de verdade é o `.env` conter só senhas de desenvolvimento local. Como o bloqueio de `cat .env*` usa curinga, ele também barra `cat .env.example`; para ler o exemplo, use a ferramenta de leitura de arquivos.
- Os hooks não interpretam `bash -c "..."`, `eval` nem aliases do git. Eles seguram acidentes, não quem quer burlar de propósito.
- Para testar um hook à mão, mande o JSON pelo stdin e olhe o código de saída. Exemplo: `echo '{"tool_input":{"command":"git rebase main"}}' | node .claude/hooks/proteger-historico.mjs; echo $?` deve mostrar a mensagem de bloqueio e `2`.
- Mudou um hook ou um agente? Atualize esta seção no mesmo commit.
