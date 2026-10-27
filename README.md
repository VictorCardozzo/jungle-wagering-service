# Jungle Wagering Service 🎲

Microserviço de apostas e gestão de transações desenvolvido em **NestJS**, **TypeScript** e **PostgreSQL**, utilizando arquitetura orientada a eventos com o **Outbox Pattern** e **Docker Compose**.

---

## 🏗️ Arquitetura e Decisões Técnicas

O projeto foi construído seguindo os princípios de **Clean Architecture** e **Domain-Driven Design (DDD)**:

- **`Domain`**: Contém a lógica de negócio pura, entidades (`Wallet`, `WagerTransaction`), Value Objects (`Money`) e regras de validação de domínio.
- **`Application`**: Casos de uso (`ProcessWagerUseCase`) responsáveis pela orquestração do fluxo de transações, idempotência e integridade do saldo.
- **`Infrastructure`**: Adaptadores para a base de dados PostgreSQL, mensageria e controladores REST.

### 🎯 Resiliência e Outbox Pattern
Para garantir consistência eventual e evitar perda de eventos em falhas de rede ou no broker de mensageria, as alterações de saldo persistem registos transacionais na tabela `outbox_messages` antes do envio/publicação de eventos.

---

## 🚀 Tecnologias Utilizadas

- **Runtime & Package Manager:** [Bun](https://bun.sh/)
- **Framework:** NestJS
- **Linguagem:** TypeScript
- **Base de Dados:** PostgreSQL (Docker)
- **Mensageria / Cloud Mock:** LocalStack (AWS SQS)
- **Testes:** Jest & Bun Test Runner

---

## 🛠️ Como Executar o Projeto

### Pré-requisitos
- [Docker](https://www.docker.com/) e Docker Compose
- [Bun](https://bun.sh/) instalado no ambiente local

### 1. Iniciar a Infraestrutura
Para subir os contentores do PostgreSQL e do LocalStack SQS:

```bash
docker-compose up -d


2. Instalar Dependências e Iniciar a Aplicação

Bash
bun install
bun run start:dev

A aplicação ficará disponível em http://localhost:3000.


🧪 Execução de Testes
Para rodar a suíte de testes unitários:

Bash
bun run test
Para rodar os testes end-to-end (E2E):

Bash
bun test ./test/app.e2e-spec.ts


📡 Endpoints da API
POST /v1/wagers
Processa operações de aposta e ajusta o saldo da carteira do jogador.

Payload Exemplo (BET):
JSON
{
  "providerId": "provider-a",
  "externalTransactionId": "tx-1001",
  "idempotencyKey": "idem-1001",
  "playerId": "player-01",
  "walletId": "11111111-1111-1111-1111-111111111111",
  "roundId": "round-100",
  "gameId": "slots-01",
  "kind": "BET",
  "money": {
    "amount": "80.00",
    "currency": "BRL"
  }
}
Tipos de Transação Suportados (kind):
BET: Débito na carteira do jogador. Rejeita com INSUFFICIENT_FUNDS caso o saldo seja menor que o valor solicitado.

WIN: Crédito/Prémio na carteira do jogador.

ROLLBACK: Reversão de transação vinculada a um evento de referência.

REFUND: Estorno de aposta.