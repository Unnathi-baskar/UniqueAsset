import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import morgan from "morgan";
import multer from "multer";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = Number(process.env.PORT || 4000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${PORT}`;
const DEV_RPC_URL = process.env.DEV_RPC_URL || "http://127.0.0.1:8545";

const assetsDir = path.resolve(__dirname, "../storage/assets");
const metadataDir = path.resolve(__dirname, "../storage/metadata");

for (const directory of [assetsDir, metadataDir]) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

app.use("/files", express.static(assetsDir));
app.use("/metadata", express.static(metadataDir));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

function sanitizeFilename(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function weiHexToEthString(weiHex) {
  const wei = BigInt(weiHex);
  const base = 10n ** 18n;
  const whole = wei / base;
  const fraction = (wei % base).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

async function callDevRpc(method, params = []) {
  const rpcResponse = await fetch(DEV_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id: Date.now()
    })
  });

  const payload = await rpcResponse.json();
  if (payload.error) {
    throw new Error(payload.error.message || `RPC call failed: ${method}`);
  }

  return payload.result;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "marketplace-api" });
});

app.post("/dev/fund-wallet", async (req, res) => {
  const { address, amountHex = "0x3635C9ADC5DEA00000" } = req.body || {};

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: "A valid wallet address is required" });
  }

  if (!/^0x[a-fA-F0-9]+$/.test(amountHex)) {
    return res.status(400).json({ error: "amountHex must be a valid hex quantity" });
  }

  try {
    await callDevRpc("hardhat_setBalance", [address, amountHex]);
    const newBalanceHex = await callDevRpc("eth_getBalance", [address, "latest"]);
    const newBalanceEth = weiHexToEthString(newBalanceHex);

    return res.json({
      message: "Wallet funded",
      address,
      amountHex,
      newBalanceHex,
      newBalanceEth
    });
  } catch (error) {
    return res.status(500).json({ error: `Unable to reach local chain at ${DEV_RPC_URL}: ${error.message}` });
  }
});

app.get("/dev/wallet-balance/:address", async (req, res) => {
  const { address } = req.params;

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: "A valid wallet address is required" });
  }

  try {
    const balanceHex = await callDevRpc("eth_getBalance", [address, "latest"]);
    const balanceEth = weiHexToEthString(balanceHex);

    return res.json({ address, balanceHex, balanceEth });
  } catch (error) {
    return res.status(500).json({ error: `Unable to reach local chain at ${DEV_RPC_URL}: ${error.message}` });
  }
});

app.post("/assets/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "File is required" });
  }

  const {
    title = "Untitled Asset",
    description = "",
    category = "uncategorized",
    creator = "",
    copyright = "",
    license = ""
  } = req.body;

  const fileHash = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
  const extension = path.extname(req.file.originalname) || ".bin";
  const assetFilename = sanitizeFilename(`${fileHash}${extension}`);
  const metadataFilename = sanitizeFilename(`${fileHash}.json`);

  const absoluteAssetPath = path.join(assetsDir, assetFilename);
  fs.writeFileSync(absoluteAssetPath, req.file.buffer);

  const fileUrl = `${API_BASE_URL}/files/${assetFilename}`;
  const metadata = {
    title,
    description,
    category,
    creator,
    copyright,
    license,
    fileHash,
    fileName: req.file.originalname,
    fileMimeType: req.file.mimetype,
    fileUrl,
    uploadedAt: new Date().toISOString()
  };

  const absoluteMetadataPath = path.join(metadataDir, metadataFilename);
  fs.writeFileSync(absoluteMetadataPath, JSON.stringify(metadata, null, 2));

  const metadataUrl = `${API_BASE_URL}/metadata/${metadataFilename}`;

  return res.status(201).json({
    message: "Asset uploaded successfully",
    fileHash,
    metadataUrl,
    metadata
  });
});

app.get("/assets/metadata-index", (_req, res) => {
  const files = fs.readdirSync(metadataDir).filter((file) => file.endsWith(".json"));

  const records = files.map((filename) => {
    const raw = fs.readFileSync(path.join(metadataDir, filename), "utf-8");
    return JSON.parse(raw);
  });

  res.json({ count: records.length, records });
});

app.listen(PORT, () => {
  console.log(`Marketplace API running on http://localhost:${PORT}`);
});
