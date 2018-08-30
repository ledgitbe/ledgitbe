let BITBOXCli = require('bitbox-cli/lib/bitbox-cli').default;
let BITBOX = new BITBOXCli();
var QRCode = require('qrcode');
var canvas = document.getElementById('canvas');
var splitCount = 25;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

let doPayment = true;
// create mnemonic
let mnemonic = BITBOX.Mnemonic.generate(128);
console.log(mnemonic);
document.getElementById('log').innerHTML += mnemonic;
// create seed buffer from mnemonic
let seedBuffer = BITBOX.Mnemonic.toSeed(mnemonic);
// create HDNode from seed buffer
let hdNode = BITBOX.HDNode.fromSeed(seedBuffer);
// get first derivation
derived = hdNode.deriveHardened(0);
// get address
let addr = BITBOX.Address.toCashAddress(derived.getAddress());

QRCode.toCanvas(canvas, addr, function (error) {
  if (error) console.error(error)
});

const main = async () => {
  pollForUtxo(addr);
};

const getUtxos = async (address) => {
  return new Promise((resolve, reject) => {
    BITBOX.Address.utxo(address).then((result) => {
      resolve(result)
    }, (err) => {
      console.log(err)
      reject(err)
    })
  })
}

const pollForUtxo = async (address) => {
  // poll for utxo
  try {
    while (doPayment) {
      // rate limit
      await sleep(5 * 1000)

      let utxos = await getUtxos(address)

      // utxos exist
      if (utxos && utxos.length > 0) {
	doPayment = false;
	// show received payment
	drawCheckMark();
	let satoshis = 0;
	let inputs = 0;
	let transactionBuilder = new BITBOX.TransactionBuilder('bitcoincash');
	// add inputs to tx
	utxos.forEach(output => {
	  transactionBuilder.addInput(output.txid, output.vout);
	  inputs++;
	  satoshis+=output.satoshis;
	});

	// calc bytes and add outputs to tx
	const bytes = BITBOX.BitcoinCash.getByteCount({ P2PKH: inputs }, { P2PKH: splitCount + 1 })

	let walletChains = []
	for (let i = 0; i < splitCount; i++) {

	  let firstNode = BITBOX.HDNode.derivePath(hdNode, `1/${i + 1}`)
	  let firstNodeLegacyAddress = BITBOX.HDNode.toLegacyAddress(firstNode)

	  walletChain = {
	    vout: i,
	    address: firstNodeLegacyAddress,
	    satoshis: parseInt((satoshis-bytes)/splitCount),
	    keyPair: BITBOX.HDNode.toKeyPair(firstNode)
	  };

	  transactionBuilder.addOutput(firstNodeLegacyAddress, parseInt((satoshis-bytes)/splitCount))

	  walletChains.push(walletChain)
	}

	// sign tx
	let redeemScript;
	transactionBuilder.sign(0, derived.keyPair, redeemScript, transactionBuilder.hashTypes.SIGHASH_ALL, satoshis);
	await sleep(2 * 1000);
	// broadcast tx
	BITBOX.RawTransactions.sendRawTransaction(transactionBuilder.build().toHex()).then(
	  async (txid) => {
	    console.log(txid);
	    if (txid === 'Missing inputs') {
	      console.log('missing inputs, trying again');
	      await sleep(2 * 1000)
	      txid = await BITBOX.RawTransactions.sendRawTransaction(transactionBuilder.build().toHex());
	      console.log(txid);
	    }	
	    // get handcash addr
	    let handcashGet = await fetch('http://api.handcash.io/api/receivingAddress/Christophe_Be');
	    let handcashAddr = await handcashGet.json();
	    for(var i = 0; i < splitCount; i++) {
	      let splitTransactionBuilder = new BITBOX.TransactionBuilder('bitcoincash');
	      splitTransactionBuilder.addInput(txid,i);
	      const splitBytes = BITBOX.BitcoinCash.getByteCount({ P2PKH: 1 }, { P2PKH: 1 })
	      splitTransactionBuilder.addOutput(handcashAddr.receivingAddress,parseInt((satoshis-bytes)/splitCount-splitBytes));
	      let splitRedeemScript;
	      splitTransactionBuilder.sign(0, walletChains[i].keyPair, splitRedeemScript, transactionBuilder.hashTypes.SIGHASH_ALL, parseInt((satoshis-bytes)/splitCount));
	      txidSplit = await BITBOX.RawTransactions.sendRawTransaction(splitTransactionBuilder.build().toHex());
	      if (txidSplit === 'Missing inputs') {
		console.log('missing inputs, trying again');
	        await sleep(2 * 1000)
	      	txidSplit = await BITBOX.RawTransactions.sendRawTransaction(splitTransactionBuilder.build().toHex());
	      }	
	      console.log('tx ' + i + ': '+ txidSplit);
	    }
	  }, (err) => {
	    console.log(err); 
	  }
	);
	/*
	*/

      }
      else
	console.log("Waiting for funding...")
    }
  } catch (ex) {
    console.log("Poll for utxo ex: ", ex)
  }
}

function drawCheckMark() {
  if (canvas.getContext){
    //circle  
    var ctx = canvas.getContext('2d');
    var centerX = canvas.width / 2;
    var centerY = canvas.height / 2;
    var radius = 45;
    //draw circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = 'green';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    //draw tick
    ctx.beginPath();
    ctx.moveTo(62,75);
    ctx.lineTo(75,87);
    ctx.lineTo(100,62);
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#fff';
    ctx.stroke();    
  }}

main();
