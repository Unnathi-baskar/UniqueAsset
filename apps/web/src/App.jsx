import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { API_BASE_URL, CONTRACT_ABI, CONTRACT_ADDRESS, REQUIRED_CHAIN_ID } from "./config";

const initialFormState = {
  title: "",
  description: "",
  category: "art",
  creator: "",
  copyright: "",
  license: "",
  priceEth: "0.01"
};

function shortAddress(value) {
  if (!value) return "";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function toBytes32Hex(hash) {
  const raw = hash.toLowerCase().replace(/^0x/, "");
  if (!/^[a-f0-9]{64}$/.test(raw)) {
    throw new Error("Invalid SHA-256 hash from API");
  }
  return `0x${raw}`;
}

function getInjectedProvider() {
  if (typeof window === "undefined") return null;

  const { ethereum } = window;
  if (!ethereum) return null;

  if (Array.isArray(ethereum.providers) && ethereum.providers.length > 0) {
    return ethereum.providers.find((provider) => provider.isMetaMask) || ethereum.providers[0];
  }

  return ethereum;
}

function toHexChainId(chainId) {
  return `0x${chainId.toString(16)}`;
}

function withTimeout(promise, ms, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), ms);
    })
  ]);
}

function formatEthDisplay(value) {
  if (!value) return "0.0000";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(4) : value;
}

export default function App() {
  const [walletAddress, setWalletAddress] = useState("");
  const [walletBalance, setWalletBalance] = useState("");
  const [chainId, setChainId] = useState(0);
  const [formState, setFormState] = useState(initialFormState);
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("Connect wallet to start minting.");
  const [isBusy, setIsBusy] = useState(false);
  const [tokens, setTokens] = useState([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const injectedProvider = getInjectedProvider();
  const walletAvailable = Boolean(injectedProvider);

  async function getReadContract() {
    if (!CONTRACT_ADDRESS || CONTRACT_ADDRESS === "0x0000000000000000000000000000000000000000") {
      throw new Error("Set VITE_MARKETPLACE_CONTRACT in apps/web/.env.");
    }

    if (!walletAvailable) {
      throw new Error("No wallet detected. Install MetaMask or a compatible wallet.");
    }

    const provider = new ethers.BrowserProvider(injectedProvider);
    return new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
  }

  async function getWriteContract() {
    const provider = new ethers.BrowserProvider(injectedProvider);
    const signer = await provider.getSigner();
    return new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
  }

  async function resolveActiveSignerAddress() {
    if (!walletAvailable) return "";

    const provider = new ethers.BrowserProvider(injectedProvider);
    const signer = await provider.getSigner();
    return signer.getAddress();
  }

  async function refreshWalletBalance(address = walletAddress) {
    if (!address || !walletAvailable) {
      setWalletBalance("");
      return "";
    }

    try {
      const provider = new ethers.BrowserProvider(injectedProvider);
      const value = await provider.getBalance(address);
      const formatted = ethers.formatEther(value);
      setWalletBalance(formatted);
      return formatted;
    } catch {
      setWalletBalance("");
      return "";
    }
  }

  function formatTxError(error, actionLabel) {
    const rawMessage =
      error?.shortMessage ||
      error?.info?.error?.message ||
      error?.reason ||
      error?.message ||
      "Unknown wallet error";

    if (/insufficient funds/i.test(rawMessage)) {
      return `${actionLabel}: Insufficient ETH on Hardhat Local. Click \"Fund Wallet (Dev)\" or import a funded Hardhat account in MetaMask.`;
    }

    return `${actionLabel}: ${rawMessage}`;
  }

  async function ensureCorrectNetwork() {
    if (!injectedProvider) return;

    const currentChainHex = await injectedProvider.request({ method: "eth_chainId" });
    const requiredChainHex = toHexChainId(REQUIRED_CHAIN_ID);

    if (currentChainHex === requiredChainHex) return;

    try {
      setStatus(`Switching wallet network to ${REQUIRED_CHAIN_ID}...`);
      await injectedProvider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: requiredChainHex }]
      });
    } catch (switchError) {
      if (switchError?.code !== 4902) {
        throw switchError;
      }

      await injectedProvider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: requiredChainHex,
            chainName: "Hardhat Local",
            rpcUrls: ["http://127.0.0.1:8545", "http://localhost:8545"],
            nativeCurrency: {
              name: "Ethereum",
              symbol: "ETH",
              decimals: 18
            }
          }
        ]
      });
    }
  }

  async function connectWallet() {
    if (!walletAvailable) {
      setStatus("Wallet not found. Install MetaMask or enable an injected wallet.");
      return;
    }

    setIsBusy(true);
    setStatus("Checking wallet session...");

    try {
      let accounts = await withTimeout(
        injectedProvider.request({ method: "eth_accounts" }),
        10000,
        "Wallet did not respond. Open MetaMask and unlock it."
      );

      if (!accounts || accounts.length === 0) {
        setStatus("Requesting wallet access...");
        accounts = await withTimeout(
          injectedProvider.request({ method: "eth_requestAccounts" }),
          20000,
          "No MetaMask popup detected. Open MetaMask, then retry Reconnect."
        );
      }

      if (!accounts || accounts.length === 0) {
        throw new Error("No wallet account was returned.");
      }

      await ensureCorrectNetwork();

      const provider = new ethers.BrowserProvider(injectedProvider);
      const network = await provider.getNetwork();
      const activeAddress = await resolveActiveSignerAddress();
      const nextAddress = activeAddress || accounts[0];
      setWalletAddress(nextAddress);
      setChainId(Number(network.chainId));
      await refreshWalletBalance(nextAddress);
      setStatus("Wallet connected.");
    } catch (error) {
      if (error?.code === 4001) {
        setStatus("Wallet request was rejected in MetaMask.");
      } else {
        setStatus(`Wallet connection failed: ${error.message}`);
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function disconnectWallet() {
    setIsBusy(true);

    try {
      // Some injected wallets support revoking eth_accounts permission for this site.
      await injectedProvider?.request?.({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }]
      });
    } catch {
      // Ignore provider-specific revoke failures and still clear local app state.
    } finally {
      setWalletAddress("");
      setWalletBalance("");
      setStatus("Wallet disconnected in app.");
      setIsBusy(false);
    }
  }

  async function loadMarketplace() {
    try {
      const contract = await getReadContract();
      const totalSupply = await contract.totalSupply();
      const items = [];

      for (let i = 0n; i < totalSupply; i += 1n) {
        const tokenId = await contract.tokenByIndex(i);

        const [owner, tokenURI, listing, assetInfo, tradeCount] = await Promise.all([
          contract.ownerOf(tokenId),
          contract.tokenURI(tokenId),
          contract.getListing(tokenId),
          contract.getAssetInfo(tokenId),
          contract.tradeCount(tokenId)
        ]);

        let metadata = null;
        try {
          const response = await fetch(tokenURI);
          metadata = await response.json();
        } catch {
          metadata = {
            title: "Metadata unavailable",
            description: "",
            category: assetInfo.category,
            creator: ""
          };
        }

        items.push({
          tokenId: Number(tokenId),
          owner,
          tokenURI,
          fileHash: assetInfo.fileHash,
          category: metadata?.category || assetInfo.category,
          createdAt: Number(assetInfo.createdAt),
          imageUrl: metadata?.image || metadata?.fileUrl || "",
          listing: {
            seller: listing.seller,
            active: listing.active,
            price: listing.price
          },
          tradeCount: Number(tradeCount),
          metadata
        });
      }

      setTokens(items.reverse());
    } catch (error) {
      setStatus(`Failed to load marketplace: ${error.message}`);
    }
  }

  useEffect(() => {
    loadMarketplace();
  }, []);

  useEffect(() => {
    if (!walletAvailable) return undefined;

    async function syncWalletState() {
      const provider = new ethers.BrowserProvider(injectedProvider);
      const accounts = await injectedProvider.request({ method: "eth_accounts" });
      const network = await provider.getNetwork();
      setChainId(Number(network.chainId));
      if (accounts.length > 0) {
        const activeAddress = await resolveActiveSignerAddress();
        const nextAddress = activeAddress || accounts[0];
        setWalletAddress(nextAddress);
        await refreshWalletBalance(nextAddress);
      } else {
        setWalletBalance("");
      }
    }

    syncWalletState();

    const handleAccountsChanged = async () => {
      const nextAddress = await resolveActiveSignerAddress();
      setWalletAddress(nextAddress || "");
      await refreshWalletBalance(nextAddress || "");
    };

    const handleChainChanged = () => {
      window.location.reload();
    };

    injectedProvider.on("accountsChanged", handleAccountsChanged);
    injectedProvider.on("chainChanged", handleChainChanged);

    return () => {
      injectedProvider.removeListener("accountsChanged", handleAccountsChanged);
      injectedProvider.removeListener("chainChanged", handleChainChanged);
    };
  }, [walletAvailable, injectedProvider]);

  async function handleMintAndList(event) {
    event.preventDefault();
    if (!walletAddress) {
      setStatus("Connect wallet before minting.");
      return;
    }
    if (!file) {
      setStatus("Choose a file to upload.");
      return;
    }

    setIsBusy(true);
    setStatus("Uploading file and metadata...");

    try {
      const payload = new FormData();
      payload.append("file", file);
      Object.entries(formState).forEach(([key, value]) => {
        if (key !== "priceEth") {
          payload.append(key, value);
        }
      });

      const uploadResponse = await fetch(`${API_BASE_URL}/assets/upload`, {
        method: "POST",
        body: payload
      });

      if (!uploadResponse.ok) {
        const errorPayload = await uploadResponse.json();
        throw new Error(errorPayload.error || "Upload failed");
      }

      const upload = await uploadResponse.json();
      const fileHashBytes32 = toBytes32Hex(upload.fileHash);

      setStatus("Minting NFT on-chain...");
      const contract = await getWriteContract();
      const mintTx = await contract.mintAsset(upload.metadataUrl, fileHashBytes32, formState.category);
      const mintReceipt = await mintTx.wait();

      const mintEvent = mintReceipt.logs
        .map((entry) => {
          try {
            return contract.interface.parseLog(entry);
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed?.name === "TokenMinted") ||
        mintReceipt.logs
          .map((entry) => {
            try {
              return contract.interface.parseLog(entry);
            } catch {
              return null;
            }
          })
          .find((parsed) => parsed?.name === "Transfer" && parsed?.args?.from === ethers.ZeroAddress);

      const tokenId = mintEvent?.args?.tokenId;
      if (!tokenId) {
        throw new Error("Could not detect minted token id");
      }

      const parsedPrice = ethers.parseEther(formState.priceEth || "0");
      if (parsedPrice > 0n) {
        setStatus("Listing token for sale...");
        const listTx = await contract.listToken(tokenId, parsedPrice);
        await listTx.wait();
      }

      setStatus("Asset minted and listed successfully.");
      setFormState(initialFormState);
      setFile(null);
      await loadMarketplace();
    } catch (error) {
      setStatus(formatTxError(error, "Mint/list failed"));
    } finally {
      setIsBusy(false);
    }
  }

  async function buyToken(tokenId, price) {
    if (!walletAddress) {
      setStatus("Connect wallet before buying.");
      return;
    }

    setIsBusy(true);
    setStatus(`Purchasing token #${tokenId}...`);

    try {
      const contract = await getWriteContract();
      const tx = await contract.buyToken(tokenId, { value: price });
      await tx.wait();
      setStatus(`Token #${tokenId} purchased successfully.`);
      await loadMarketplace();
    } catch (error) {
      setStatus(formatTxError(error, "Purchase failed"));
    } finally {
      setIsBusy(false);
    }
  }

  async function fundWalletForGas() {
    if (!walletAddress) {
      setStatus("Connect wallet before requesting funds.");
      return;
    }

    setIsBusy(true);
    setStatus("Funding wallet with local test ETH...");

    try {
      const amountHex = "0x3635C9ADC5DEA00000";

      let chainBalanceEth = "";

      // First try funding through the same RPC MetaMask is currently using.
      try {
        await injectedProvider.request({
          method: "hardhat_setBalance",
          params: [walletAddress, amountHex]
        });

        const balanceHex = await injectedProvider.request({
          method: "eth_getBalance",
          params: [walletAddress, "latest"]
        });

        chainBalanceEth = ethers.formatEther(BigInt(balanceHex));
      } catch {
        // Fallback to API-funded local RPC path.
        const response = await fetch(`${API_BASE_URL}/dev/fund-wallet`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ address: walletAddress, amountHex })
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Wallet funding failed");
        }

        chainBalanceEth = payload.newBalanceEth || "";
      }

      const walletBalanceAfterFund = await refreshWalletBalance(walletAddress);

      if (chainBalanceEth && walletBalanceAfterFund) {
        const chainBalance = Number(chainBalanceEth);
        const walletBalanceValue = Number(walletBalanceAfterFund);

        if (Number.isFinite(chainBalance) && Number.isFinite(walletBalanceValue) && chainBalance > 0 && walletBalanceValue === 0) {
          setStatus(
            "Wallet funded on local RPC, but connected MetaMask RPC still shows 0 ETH. In MetaMask, edit Hardhat Local to RPC http://127.0.0.1:8545 and chain ID 31337, then reconnect."
          );
          return;
        }
      }

      setStatus(
        `Wallet funded. Current local balance: ${formatEthDisplay(chainBalanceEth || walletBalanceAfterFund)} ETH.`
      );
    } catch (error) {
      setStatus(`Funding failed: ${error.message}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function cancelListing(tokenId) {
    setIsBusy(true);
    setStatus(`Cancelling listing for token #${tokenId}...`);

    try {
      const contract = await getWriteContract();
      const tx = await contract.cancelListing(tokenId);
      await tx.wait();
      setStatus(`Listing cancelled for token #${tokenId}.`);
      await loadMarketplace();
    } catch (error) {
      setStatus(`Cancel listing failed: ${error.message}`);
    } finally {
      setIsBusy(false);
    }
  }

  const categoryOptions = useMemo(() => {
    const allCategories = tokens.map((item) => item.category).filter(Boolean);
    return ["all", ...new Set(allCategories)];
  }, [tokens]);

  const filteredTokens = useMemo(() => {
    const lowered = query.trim().toLowerCase();

    return tokens.filter((item) => {
      const byCategory = categoryFilter === "all" || item.category === categoryFilter;
      if (!byCategory) return false;
      if (!lowered) return true;

      const text = [
        item.metadata?.title,
        item.metadata?.description,
        item.metadata?.creator,
        item.category,
        item.owner,
        String(item.tokenId)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return text.includes(lowered);
    });
  }, [tokens, query, categoryFilter]);

  const wrongNetwork = chainId && chainId !== REQUIRED_CHAIN_ID;

  return (
    <main className="page-shell">
      <section className="hero">
        <p className="kicker">Blockchain-Proven Ownership</p>
        <h1>Unique Digital Asset Exchange</h1>
        <p>
          Mint NFTs from uploaded files with cryptographic fingerprinting, then list and trade them with
          transparent on-chain ownership.
        </p>
      </section>

      <section className="status-bar">
        <div>
          <strong>Wallet:</strong> {walletAddress ? shortAddress(walletAddress) : "Not connected"}
        </div>
        <div>
          <strong>Chain:</strong> {chainId || "Unknown"}
          {wrongNetwork ? ` (switch to ${REQUIRED_CHAIN_ID})` : ""}
        </div>
        <div>
          <strong>Balance:</strong> {walletBalance ? `${formatEthDisplay(walletBalance)} ETH` : "Unknown"}
        </div>
        <div className="status-actions">
          <button type="button" onClick={connectWallet} disabled={isBusy}>
            {walletAddress ? "Reconnect" : "Connect Wallet"}
          </button>
          <button type="button" onClick={disconnectWallet} disabled={isBusy || !walletAddress}>
            Disconnect Wallet
          </button>
          <button type="button" onClick={fundWalletForGas} disabled={isBusy || !walletAddress}>
            Fund Wallet (Dev)
          </button>
        </div>
      </section>

      <section className="panel mint-panel">
        <h2>Create and List Asset</h2>
        <form onSubmit={handleMintAndList} className="mint-form">
          <label>
            Title
            <input
              value={formState.title}
              onChange={(e) => setFormState((prev) => ({ ...prev, title: e.target.value }))}
              required
            />
          </label>

          <label>
            Description
            <textarea
              rows={3}
              value={formState.description}
              onChange={(e) => setFormState((prev) => ({ ...prev, description: e.target.value }))}
            />
          </label>

          <div className="grid-2">
            <label>
              Category
              <input
                value={formState.category}
                onChange={(e) => setFormState((prev) => ({ ...prev, category: e.target.value }))}
                required
              />
            </label>

            <label>
              Creator Name
              <input
                value={formState.creator}
                onChange={(e) => setFormState((prev) => ({ ...prev, creator: e.target.value }))}
                required
              />
            </label>
          </div>

          <div className="grid-2">
            <label>
              Copyright
              <input
                value={formState.copyright}
                onChange={(e) => setFormState((prev) => ({ ...prev, copyright: e.target.value }))}
              />
            </label>

            <label>
              License
              <input
                value={formState.license}
                onChange={(e) => setFormState((prev) => ({ ...prev, license: e.target.value }))}
              />
            </label>
          </div>

          <div className="grid-2">
            <label>
              Initial Price (ETH)
              <input
                type="number"
                min="0"
                step="0.0001"
                value={formState.priceEth}
                onChange={(e) => setFormState((prev) => ({ ...prev, priceEth: e.target.value }))}
              />
            </label>

            <label>
              Asset File
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                required
              />
            </label>
          </div>

          <button type="submit" disabled={isBusy || wrongNetwork}>
            {isBusy ? "Processing..." : "Upload, Mint, and List"}
          </button>
        </form>
      </section>

      <section className="panel filters-panel">
        <h2>Search and Discover</h2>
        <div className="grid-2">
          <label>
            Search
            <input
              placeholder="title, artist, category, token id"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>

          <label>
            Category
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              {categoryOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="asset-grid">
        {filteredTokens.map((asset) => {
          const isOwner = walletAddress && walletAddress.toLowerCase() === asset.owner.toLowerCase();
          const canBuy = asset.listing.active && !isOwner;

          return (
            <article key={asset.tokenId} className="asset-card">
              <div className="asset-card-top">
                <p className="token-id">Token #{asset.tokenId}</p>
                <p className="category-pill">{asset.category || "uncategorized"}</p>
              </div>

              <h3>{asset.metadata?.title || "Untitled"}</h3>
              <p>{asset.metadata?.description || "No description"}</p>

              <div className="meta-line"><strong>Creator:</strong> {asset.metadata?.creator || "Unknown"}</div>
              <div className="meta-line"><strong>Owner:</strong> {shortAddress(asset.owner)}</div>
              <div className="meta-line"><strong>File Hash:</strong> {asset.fileHash.slice(0, 16)}...</div>
              <div className="meta-line"><strong>Popularity:</strong> {asset.tradeCount} trades</div>

              {asset.imageUrl ? (
                <a href={asset.imageUrl} target="_blank" rel="noreferrer">
                  View Uploaded File
                </a>
              ) : null}

              <div className="actions-row">
                {asset.listing.active ? (
                  <>
                    <p className="price">{ethers.formatEther(asset.listing.price)} ETH</p>
                    <button type="button" onClick={() => buyToken(asset.tokenId, asset.listing.price)} disabled={isBusy || !canBuy || wrongNetwork}>
                      Buy Asset
                    </button>
                    {isOwner ? (
                      <button type="button" onClick={() => cancelListing(asset.tokenId)} disabled={isBusy || wrongNetwork}>
                        Cancel Listing
                      </button>
                    ) : null}
                  </>
                ) : (
                  <p className="price muted">Not listed</p>
                )}
              </div>
            </article>
          );
        })}

        {filteredTokens.length === 0 ? <p className="empty">No assets match your current search.</p> : null}
      </section>

      <footer className="status-footer">{status}</footer>
    </main>
  );
}
