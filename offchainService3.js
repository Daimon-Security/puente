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
const gethWeb3 = new Web3(new Web3.providers.HttpProvider((GETH_RPC_URL));
const bscWeb3 = new Web3(new Web3.providers.HttpProvider(BSC_RPC_URL));

gethWeb3.eth.net.isListening().then(() => {
  console.log("Geth está escuchando");
}).catch((error) => {
  console.error("Error en el proveedor de Geth:", error);
});

bscWeb3.eth.net.isListening().then(() => {
  console.log("BSC está escuchando");
}).catch((error) => {
  console.error("Error en el proveedor de BSC:", error);
});

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
  const eventsCollection = db.collection("events");
  return eventsCollection;
}

// Reemplazar la función 'processEvent' con la versión mejorada
const MAX_RETRIES = 3;

async function processEvent(event, retryCount = 0) {
  if (retryCount > MAX_RETRIES) {
    console.error(`Max retries reached for event ${JSON.stringify(event)}. Marking as failed.`);
    return false;
  }

  const { chain, user, amount } = event;
  const wrappedToken = chain === "geth" ? bscWrappedToken : gethWrappedToken;
  const account = chain === "geth" ? gethAccount : bscAccount;

  try {
    const gasEstimate = await wrappedToken.methods
      .mint(user, amount.toFixed(18))
      .estimateGas({ from: account.address });

    const receipt = await wrappedToken.methods
      .mint(user, amount.toFixed(18))
      .send({ from: account.address, gas: gasEstimate });

    console.log(`Tokens minted on ${chain === "geth" ? "BSC" : "Geth"}:`, receipt);
    return true;
  } catch (error) {
    console.error(
      `Error minting tokens on ${chain === "geth" ? "BSC" : "Geth"} (attempt ${retryCount + 1}):`,
      error
    );

    await new Promise((resolve) => setTimeout(resolve, 10000));
    return processEvent(event, retryCount + 1);
  }
}

async function processQueue(eventsCollection) {
  const event = await eventsCollection.findOne({ processed: false });

  if (event) {
    const success = await processEvent(event);
    if (success) {
      await eventsCollection.updateOne({ _id: event._id }, { $set: { processed: true } });
    } else {
      await eventsCollection.updateOne({ _id: event._id }, { $set: { failed: true } });
    }
  }

  setTimeout(() => processQueue(eventsCollection), 1000);
}

// Iniciar el servicio de escucha
async function startListening() {
  try {
    const eventsCollection = await connectToDatabase();
    const gethPastEvents = await gethTokenBridge.getPastEvents("TokensLocked", {
      fromBlock: 0,
      toBlock: "latest",
    });
    const bscPastEvents = await bscTokenBridge.getPastEvents("TokensLocked", {
      fromBlock: 0,
      toBlock: "latest",
    });
    console.log("Iniciando servicio de escucha...");
    console.log("Eventos pasados en la cadena EVM forkeada de Geth:", gethPastEvents);
    console.log("Eventos pasados en Binance Smart Chain (BSC):", bscPastEvents);
    processQueue(eventsCollection);
  } catch (error) {
    console.error("Error al iniciar el servicio de escucha:", error);
  }
}

startListening();
