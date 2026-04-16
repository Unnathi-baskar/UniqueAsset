// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract UniqueAssetMarketplace is ERC721Enumerable, ERC721URIStorage, Ownable, ReentrancyGuard {
    struct AssetInfo {
        bytes32 fileHash;
        string category;
        uint256 createdAt;
    }

    struct Listing {
        address seller;
        uint256 price;
        bool active;
    }

    uint256 private _tokenIdCounter;

    mapping(uint256 => AssetInfo) private _assetInfo;
    mapping(uint256 => Listing) private _listings;
    mapping(bytes32 => bool) public usedFileHashes;
    mapping(uint256 => uint256) public tradeCount;

    event TokenMinted(uint256 indexed tokenId, address indexed owner, bytes32 indexed fileHash, string tokenURI, string category);
    event TokenListed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event TokenSaleCancelled(uint256 indexed tokenId, address indexed seller);
    event TokenPurchased(uint256 indexed tokenId, address indexed buyer, address indexed seller, uint256 price);

    constructor() ERC721("Unique Digital Asset", "UDA") {}

    function mintAsset(string memory tokenURI_, bytes32 fileHash, string memory category) external returns (uint256) {
        require(fileHash != bytes32(0), "Invalid file hash");
        require(!usedFileHashes[fileHash], "File hash already minted");

        _tokenIdCounter += 1;
        uint256 newTokenId = _tokenIdCounter;

        _safeMint(msg.sender, newTokenId);
        _setTokenURI(newTokenId, tokenURI_);

        _assetInfo[newTokenId] = AssetInfo({
            fileHash: fileHash,
            category: category,
            createdAt: block.timestamp
        });

        usedFileHashes[fileHash] = true;

        emit TokenMinted(newTokenId, msg.sender, fileHash, tokenURI_, category);

        return newTokenId;
    }

    function listToken(uint256 tokenId, uint256 price) external {
        require(ownerOf(tokenId) == msg.sender, "Only owner can list");
        require(price > 0, "Price must be greater than zero");

        _listings[tokenId] = Listing({
            seller: msg.sender,
            price: price,
            active: true
        });

        emit TokenListed(tokenId, msg.sender, price);
    }

    function cancelListing(uint256 tokenId) external {
        Listing memory listing = _listings[tokenId];
        require(listing.active, "Token is not listed");
        require(listing.seller == msg.sender, "Only seller can cancel");

        delete _listings[tokenId];

        emit TokenSaleCancelled(tokenId, msg.sender);
    }

    function buyToken(uint256 tokenId) external payable nonReentrant {
        Listing memory listing = _listings[tokenId];

        require(listing.active, "Token is not listed for sale");
        require(msg.value == listing.price, "Incorrect payment amount");
        require(ownerOf(tokenId) == listing.seller, "Seller no longer owns token");
        require(msg.sender != listing.seller, "Seller cannot buy own token");

        delete _listings[tokenId];

        (bool success, ) = payable(listing.seller).call{value: msg.value}("");
        require(success, "Payment transfer failed");

        _transfer(listing.seller, msg.sender, tokenId);
        tradeCount[tokenId] += 1;

        emit TokenPurchased(tokenId, msg.sender, listing.seller, msg.value);
    }

    function getAssetInfo(uint256 tokenId) external view returns (AssetInfo memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        return _assetInfo[tokenId];
    }

    function getListing(uint256 tokenId) external view returns (Listing memory) {
        return _listings[tokenId];
    }

    function totalMinted() external view returns (uint256) {
        return _tokenIdCounter;
    }

    function _beforeTokenTransfer(address from, address to, uint256 firstTokenId, uint256 batchSize)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._beforeTokenTransfer(from, to, firstTokenId, batchSize);
    }

    function _burn(uint256 tokenId) internal override(ERC721, ERC721URIStorage) {
        super._burn(tokenId);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Enumerable, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
