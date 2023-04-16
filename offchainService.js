require("dotenv").config();
const Web3 = require("web3");
const { MongoClient } = require("mongodb");

// Configuración
const privateKey = process.env.PRIVATE_KEY;
const gethRpcUrl = process.env.GETH_RPC_URL;
const bscRpcUrl = process.env.BSC_RPC_URL;
const gethTokenBridgeAddress = process.env.GETH_TOKEN_BRIDGE_ADDRESS;
const bscTokenBridgeAddress = process.env.BSC_TOKEN_BRIDGE_ADDRESS;
const gethWrappedTokenAddress = process.env.GETH_WRAPPED_TOKEN_ADDRESS;
const bscWrappedTokenAddress = process.env.BSC_WRAPPED_TOKEN_ADDRESS;
const mongodbUri = process.env.MONGODB_URI;

// Conexión a los nodos RPC
const gethWeb3 = new Web3(gethRpcUrl);
const bscWeb3 = new Web3(new Web3.providers.HttpProvider(bscRpcUrl));


// Configuración de las cuentas y contratos
const account = gethWeb3.eth.accounts.privateKeyToAccount(privateKey);
gethWeb3.eth.accounts.wallet.add(account);
gethWeb3.eth.defaultAccount = account.address;

bscWeb3.eth.accounts.wallet.add(account);
bscWeb3.eth.defaultAccount = account.address;

const gethTokenBridgeJson = require("./abi/TokenBridge.json");
console.log('gethTokenBridgeJson:', gethTokenBridgeJson); // agrega esta línea para imprimir la variable
const bscTokenBridgeJson = require("./abi/TokenBridge.json");
const wrappedTokenJson = require("./abi/WrappedToken.json");

const gethTokenBridge = new gethWeb3.eth.Contract(
  gethTokenBridgeJson,
  gethTokenBridgeAddress
);
const bscTokenBridge = new bscWeb3.eth.Contract(
  bscTokenBridgeJson,
  bscTokenBridgeAddress
);

const gethWrappedToken = new gethWeb3.eth.Contract(
  wrappedTokenJson,
  gethWrappedTokenAddress
);
const bscWrappedToken = new bscWeb3.eth.Contract(
  wrappedTokenJson,
  bscWrappedTokenAddress
);

// Crear una conexión a la base de datos
async function connectToDatabase() {
  const client = new MongoClient(mongodbUri, { useNewUrlParser: true, useUnifiedTopology: true });
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
    const receipt = await wrappedToken.methods.mint(user, amount.toFixed(18)).send({ from: account.address, gas: 100000 });


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

const existingEvent = await eventsCollection.findOne({ chain: "geth", user, amount, processed: false });

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

const existingEvent = await eventsCollection.findOne({ chain: "bsc", user, amount, processed: false });

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
