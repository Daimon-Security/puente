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

  // Escuchar eventos del token en BSC
  bscWrappedToken.events.Transfer({}, async (error, event) => {
    if (error) {
      console.error("Error al recibir el evento:", error);
      return;
    }

    const { transactionHash } = event;
    const existingEvent = await eventsCollection.findOne({ transactionHash });

    if (!existingEvent) {
      console.log("Agregando evento a la base de datos...");
      await eventsCollection.insertOne({ transactionHash, network: "bsc" });
    } else {
      console.log("El evento ya existe en la base de datos.");
    }
  });
}

// Iniciar el servicio de escucha
async function startListening() {
  try {
    console.log("Conectando a la base de datos...");
    await connectToDatabase();
    console.log("Escuchando eventos del token en BSC...");
  } catch (error) {
    console.error("Error al iniciar el servicio de escucha:", error);
  }
}

// Escuchar eventos en Geth
gethTokenBridge.events.Transfer({ to: gethAccount.address }, async (error, event) => {
  if (error) {
    console.error("Error al recibir evento de Geth:", error);
    return;
  }

  const { transactionHash } = event;

  // Verificar si el evento ya ha sido registrado en la base de datos
  const existingEvent = await eventsCollection.findOne({ transactionHash });
  if (!existingEvent) {
  console.log("Agregando evento a la base de datos...");
  await eventsCollection.insertOne({ transactionHash, network: "geth" });

  // Crear un nuevo evento en BSC
  const nonce = await bscWeb3.eth.getTransactionCount(bscAccount.address, "pending");
  const wrappedAmount = await gethWrappedToken.methods.balanceOf(gethAccount.address).call();
  const txData = bscWrappedToken.methods.mint(wrappedAmount).encodeABI();
  const gasPrice = await bscWeb3.eth.getGasPrice();
  const gasLimit = 300000;

  const tx = {
  nonce,
  from: bscAccount.address,
  to: bscWrappedToken.options.address,
  data: txData,
  gasPrice,
  gasLimit,
  };

  const signedTx = await bscAccount.signTransaction(tx);
  const receipt = await bscWeb3.eth.sendSignedTransaction(signedTx.rawTransaction);
  console.log(`Transferencia realizada en BSC: ${receipt.transactionHash}`);

  } else {
    console.log(`El evento ya existe en la base de datos: ${existingEvent.transactionHash}`);
  }

  });
  } }

  startListening();
