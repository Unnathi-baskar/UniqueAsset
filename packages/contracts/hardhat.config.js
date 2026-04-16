require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const localhost = {
  url: "http://127.0.0.1:8545"
};

if (PRIVATE_KEY) {
  localhost.accounts = [PRIVATE_KEY];
}

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    localhost
  }
};
