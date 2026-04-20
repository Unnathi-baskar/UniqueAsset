# Blockchain Marketplace for Unique Digital Assets

This repository contains a full-stack NFT marketplace that supports secure minting, listing, buying, ownership tracking, file hash verification, and metadata-driven search.

## Architecture

- `packages/contracts`: Solidity smart contract and deployment scripts.
- `apps/api`: Express API for file upload, cryptographic file hash generation, and metadata hosting.
- `apps/web`: React frontend for minting, listing, buying, and searching assets.

## Features mapped to requirements

- User-friendly interface: React marketplace dashboard with mint/list/buy/search views.
- Blockchain integration: EVM smart contract with immutable ownership and sale records.
- File hash identification: API computes SHA-256 hash of uploaded file.
- Ownership tracking: ownership is queryable on-chain (`ownerOf`) with transfer events.
- Secure transactions: contract-mediated purchases in ETH via payable `buyToken`.
- Metadata management: metadata JSON stored by API; metadata URI and file hash anchored on-chain.
- Search and discovery: frontend filters by title, category, creator, and popularity (trade count).

## Prerequisites

- Node.js 20+
- npm 10+
- MetaMask (or any injected EVM wallet)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment files:

- Copy `packages/contracts/.env.example` to `packages/contracts/.env`.
- Copy `apps/web/.env.example` to `apps/web/.env`.
- Copy `apps/api/.env.example` to `apps/api/.env`.

3. Start local blockchain node (from `packages/contracts`):

```bash
npm run node --workspace @marketplace/contracts
```

4. Deploy contract:

```bash
npm run deploy --workspace @marketplace/contracts
```

Copy the deployed contract address into:
- `apps/web/.env` as `VITE_MARKETPLACE_CONTRACT`

5. Run API server:

```bash
npm run dev --workspace @marketplace/api
```

6. Run frontend:

```bash
npm run dev --workspace @marketplace/web
```

## MetaMask local network setup

After starting the Hardhat node, add a custom network in MetaMask with:

- Network name: Hardhat Local
- Default RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency symbol: `ETH`
- Block explorer URL: leave empty

Then import one of the Hardhat test accounts using a private key shown in the `npm run node --workspace @marketplace/contracts` terminal output.

Mobile wallet note:

- If MetaMask is on your phone, `127.0.0.1` points to the phone, not your laptop.
- Use your laptop LAN IP instead, for example: `http://192.168.1.10:8545`.
- Keep the Hardhat node terminal running while using the app.

## Security and authenticity model

- Uploaded files are hashed with SHA-256 to produce a deterministic file fingerprint.
- The file hash is stored on-chain with the token during minting.
- Buyers can verify metadata and file integrity by recomputing the file hash.

## Notes

- This implementation is optimized for local development and demonstration.
- For production, use decentralized storage (IPFS/Arweave), robust indexing, and audit-grade contract hardening.
