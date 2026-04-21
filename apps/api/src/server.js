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

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "marketplace-api" });
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
    name: title,
    image: fileUrl,
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
