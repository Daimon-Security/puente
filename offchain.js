require("dotenv").config();
const Web3 = require("web3");
const { MongoClient } = require("mongodb");

// Configuración
const {
  PRIVATE_KEY,
  GETH_RPC_URL,
  BSC_RPC_URL,
  GETH_TOKEN_BRIDGE_ADDRESS,
  BSC_TOKEN_BRIDGE_ADDRESS,
  GETH_WRAPPED_TOKEN_ADDRESS,
  BSC_WRAPPED_TOKEN_ADDRESS,
  MONGODB_URI,
} = process.env;

// Conexión a los nodos RPC
const gethWeb3 = new Web3(GETH_RPC_URL);
const bscWeb3 = new Web3(new Web3.providers.HttpProvider(BSC_RPC_URL));

// Configuración de las cuentas y contratos
const setupAccountAndContracts = (web3, tokenBridgeAddress, wrappedTokenAddress) => {
  const account = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY);
  web3.eth.accounts.wallet.add(account);
  web3.eth.defaultAccount = account.address;

  const tokenBridgeJson = require("./abi/TokenBridge.json");
  const wrappedTokenJson = require("./abi/WrappedToken.json");

  const tokenBridge = new web3.eth.Contract(tokenBridgeJson, tokenBridgeAddress);
  const wrappedToken = new web3.eth.Contract(wrappedTokenJson, wrappedTokenAddress);

  return { account, tokenBridge, wrappedToken };
};

const {
  account: gethAccount,
  tokenBridge: gethTokenBridge,
  wrappedToken: gethWrappedToken,
} = setupAccountAndContracts(gethWeb3, GETH_TOKEN_BRIDGE_ADDRESS, GETH_WRAPPED_TOKEN_ADDRESS);

const {
  account: bscAccount,
  tokenBridge: bscTokenBridge,
  wrappedToken: bscWrappedToken,
} = setupAccountAndContracts(bscWeb3, BSC_TOKEN_BRIDGE_ADDRESS, BSC_WRAPPED_TOKEN_ADDRESS);

// Crear una conexión a la base de datos
async function connectToDatabase() {
  const client = new MongoClient(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  await client.connect();
  const db = client.db("token_bridge");
  const eventsCollection
} catch (error) {
console.error("Error al iniciar el servicio de escucha:", error);
}
}

startListening();
