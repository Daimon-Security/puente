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
  const eventsCollection = db.collection("events");
  return eventsCollection;
}

// Procesar eventos en la base de datos
async function processEvent(event) {
  const { chain, user, amount } = event;
  const wrappedToken = chain === "geth" ? bscWrappedToken : gethWrappedToken;

  try {
    const receipt = await wrappedToken.methods
      .mint(user, amount.toFixed(18))
      .send({ from: account.address, gas: 100000 });

    console.log(`Tokens minted on ${chain === "geth" ? "BSC" : "Geth"}:`, receipt);
    return true;
  } catch (error) {
    console.error(`Error minting tokens on ${chain === "geth" ? "BSC" : "Geth"}:`, error);
    return false;
  }
}

async function processQueue(eventsCollection) {
  const event = await eventsCollection.findOne({ processed: false });

  if (event) {
    const success = await processEvent(event);
    if (success) {
      await eventsCollection.updateOne({ _id: event._id }, { $set: { processed: true } });
    } else {
      // En caso de error, esperar antes de volver a intentarlo
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }

  }

  setTimeout(() => processQueue(eventsCollection), 1000);
  }

  // Escucha eventos en la cadena EVM forkeada de Geth
  gethTokenBridge.events.TokensLocked({}, async (error, event) => {
  if (error) {
  console.error("Error in Geth TokensLocked event:", error);
  return;
  }

  const { user, amount } = event.returnValues;
  const eventsCollection = await connectToDatabase();

  const existingEvent = await eventsCollection.findOne({
  chain: "geth",
  user,
  amount,
  processed: false,
  });

  if (!existingEvent) {
  await eventsCollection.insertOne({ chain: "geth", user, amount, processed: false });
  }
  });

  // Escucha eventos en Binance Smart Chain (BSC)
  bscTokenBridge.events.TokensLocked({}, async (error, event) => {
  if (error) {
  console.error("Error in BSC TokensLocked event:", error);
  return;
  }

  const { user, amount } = event.returnValues;
  const eventsCollection = await connectToDatabase();

  const existingEvent = await eventsCollection.findOne({
  chain: "bsc",
  user,
  amount,
  processed: false,
  });

  if (!existingEvent) {
  await eventsCollection.insertOne({ chain: "bsc", user, amount, processed: false });
  }
  });

  // Iniciar el servicio de escucha
  async function startListening() {
  try {
  const eventsCollection = await connectToDatabase();
  const gethPastEvents = await gethTokenBridge.getPastEvents("TokensLocked", {
  fromBlock: "latest",
  });
  const bscPastEvents = await bscTokenBridge.getPastEvents("TokensLocked", {
  fromBlock: "latest",
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
