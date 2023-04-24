require("dotenv").config();
const Web3 = require("web3");
const { MongoClient } = require("mongodb");

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

const gethWeb3 = new Web3(new Web3.providers.HttpProvider(GETH_RPC_URL));
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

async function connectToDatabase() {
  const client = new MongoClient(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  await client.connect();
  const db = client.db("token_bridge");
  const eventsCollection = db.collection("events");
  return eventsCollection;
}

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

  await new Promise((resolve) => setTimeout(resolve, 1000));
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

const startingBlock = 0;

async function startListeningGeth() {
const currentBlock = await gethWeb3.eth.getBlockNumber();
const step = 500;
let fromBlock = startingBlock;

while (fromBlock <= currentBlock) {
  const toBlock = Math.min(fromBlock + step - 1, currentBlock);

  try {
    const events = await gethTokenBridge.getPastEvents("TokensLocked", {
      fromBlock: fromBlock,
      toBlock: toBlock,
    });

    console.log(`Eventos encontrados entre los bloques ${fromBlock} y ${toBlock}: ${events.length}`);
    await processEvents(events);
  } catch (error) {
    console.error(`Error al procesar eventos entre los bloques ${fromBlock} y ${toBlock}: ${error}`);
  }

  fromBlock += step;
}

gethWeb3.eth.subscribe("newBlockHeaders", async (error, blockHeader) => {
  if (error) {
    console.error(`Error al suscribirse a nuevos bloques: ${error}`);
    return;
  }

  const events = await gethTokenBridge.getPastEvents("TokensLocked", {
    fromBlock: blockHeader.number,
    toBlock: blockHeader.number,
  });

  await processEvents(events);
});
}

async function startListeningBSC() {
const currentBlock = await bscWeb3.eth.getBlockNumber();
const step = 1000;
let fromBlock = startingBlock;

while (fromBlock <= currentBlock) {
  const toBlock = Math.min(fromBlock + step - 1, currentBlock);

  try {
    const events = await bscTokenBridge.getPastEvents("TokensLocked", {
      fromBlock: fromBlock,
      toBlock: toBlock,
    });

    console.log(`Eventos encontrados entre los bloques ${fromBlock} y ${toBlock}: ${events.length}`);
    await processEvents(events);
  } catch (error) {
    console.error(`Error al procesar eventos entre los bloques ${fromBlock} y ${toBlock}: ${error}`);
  }

  fromBlock += step;
}

bscWeb3.eth.subscribe("newBlockHeaders", async (error, blockHeader) => {
  if (error) {
    console.error(`Error al suscribirse a nuevos bloques: ${error}`);
    return;
  }

  const events = await bscTokenBridge.getPastEvents("TokensLocked", {
    fromBlock: blockHeader.number,
    toBlock: blockHeader.number,
  });

  await processEvents(events);
});
}

try {
startListeningGeth();
startListeningBSC();
} catch (error) {

console.error("Error al iniciar el servicio de escucha:", error);
}

async function processEvents(events) {
const eventsCollection = await connectToDatabase();

for (const event of events) {
  const { returnValues: { _chain, _user, _amount }, transactionHash } = event;

  const existingEvent = await eventsCollection.findOne({ transactionHash });

  if (!existingEvent) {
    await eventsCollection.insertOne({
      chain: _chain,
      user: _user,
      amount: _amount,
      transactionHash,
      processed: false,
      failed: false,
    });

    await processQueue(eventsCollection);
  }
}
}
