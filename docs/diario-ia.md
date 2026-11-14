# Diário de uso de IA

Registro das correções feitas por pessoas no que a IA gerou. Cada entrada diz o que a IA propôs, o que foi corrigido e por quê, para que o próximo trabalho com IA comece mais perto do certo.

## 14/11/2026 · Bloco 3, configuração do Claude (branch `chore/config-claude`)

### 1. Bloqueio de leitura do `.env` cobria só uma das portas

- **O que a IA propôs:** no plano do passo 1, negar apenas a ferramenta de leitura (`Read(.env)`), mencionando que `cat .env` pelo Bash continuaria possível e perguntando se queria ampliar.
- **Correção:** acrescentar também `Bash(cat .env*)`, `Bash(type .env*)` e `Bash(Get-Content .env*)`, e deixar um comentário no `settings.json` dizendo que o bloqueio reduz acidentes, mas não é fronteira de segurança.
- **Por quê:** quem lê o `.env` pelo shell contorna o `Read`. E a proteção de verdade é o `.env` guardar só senhas de desenvolvimento, não a lista de bloqueios.
- **Efeito:** passo 1 já saiu com as regras e o comentário. A IA também replicou as regras para a ferramenta `PowerShell` (esta máquina usa PowerShell como shell principal), o que não foi pedido e deve ser conferido.
- **Lição para a IA:** quando o risco de uma proteção ser contornada é conhecido, propor já a versão que fecha as portas óbvias e deixar claro o que ela não cobre, em vez de perguntar depois.

### 2. Teste real do hook propunha um comando destrutivo

- **O que a IA propôs:** no plano, para o teste final do hook `proteger-historico`, rodar `git commit --amend --no-edit` e mostrar o bloqueio, seguindo o roteiro original.
- **Correção:** não usar esse comando. Primeiro confirmar pelo `/hooks` que o hook está carregado; depois testar com `git rebase --abort`, que o hook também bloqueia e que é inofensivo se escapar, porque não há rebase em andamento.
- **Por quê:** se o hook não estivesse carregado na sessão, o comando reescreveria de verdade o último commit. O teste de uma proteção não pode depender de a proteção funcionar.
- **Lição para a IA:** o comando de demonstração de uma trava deve ser inofensivo caso a trava falhe, mesmo que o roteiro peça outro. Apontar o risco ao receber o roteiro, não depois.
