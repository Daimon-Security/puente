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
const gethWeb3 = new Web3(new Web3.providers.WebsocketProvider(GETH_RPC_URL));
const bscWeb3 = new Web3(new Web3.providers.WebsocketProvider(BSC_RPC_URL));

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
console.error(´Error minting tokens on ${chain === "geth" ? "BSC" : "Geth"} (attempt ${retryCount + 1}):´,
error
);

await new Promise((resolve) => setTimeout(resolve, 10000));
return processEvent(event, retryCount + 1);

}
}

async function processEvents(events) {
const eventsCollection = await connectToDatabase();

for (const event of events) {
const { returnValues, transactionHash } = event;
const { _user, _amount } = returnValues;
const chain = event.address.toLowerCase() === GETH_TOKEN_BRIDGE_ADDRESS.toLowerCase() ? "geth" : "bsc";

const existingEvent = await eventsCollection.findOne({ transactionHash });

if (!existingEvent) {
  await eventsCollection.insertOne({ chain, user: _user, amount: _amount, transactionHash, processed: false });
  console.log(`Nuevo evento detectado en ${chain}:`, { _user, _amount, transactionHash });
}

}

processQueue(eventsCollection);
}

const LOOKBACK_BLOCKS = 1000;

async function startListening() {
const currentBlock = await gethWeb3.eth.getBlockNumber();
const fromBlock = Math.max(currentBlock - LOOKBACK_BLOCKS, 0);

try {
const events = await gethTokenBridge.getPastEvents("TokensLocked", {
fromBlock: fromBlock,
toBlock: currentBlock,
});

console.log(`Eventos encontrados entre los bloques ${fromBlock} y ${currentBlock}: ${events.length}`);
await processEvents(events);

} catch (error) {
console.error(´Error al procesar eventos entre los bloques ${fromBlock} y ${currentBlock}: ${error}´);
}

gethWeb3.eth.subscribe("newBlockHeaders", async (error, blockHeader) => {
if (error) {
console.error(Error al suscribirse a nuevos bloques: ${error});
return;
}

const events = await gethTokenBridge.getPastEvents("TokensLocked", {
  fromBlock: blockHeader.number,
  toBlock: blockHeader.number,
});

await processEvents(events);

});
}

try {
startListening();
} catch (error) {
console.error("Error al iniciar el servicio de escucha:", error);
}
