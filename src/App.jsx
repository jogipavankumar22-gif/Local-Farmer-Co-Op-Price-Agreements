import { useState } from 'react';
import './App.css';

/** ✏️ CONFIG — set your deployed account address here */
const MODULE_ADDR = '0xa2873261bb7f21fd004fbe1fa90807919206701493291ce7cf38f3e5ce85cbc2';
const MODULE = `${MODULE_ADDR}::FarmerCoOp`;
const NODE_URL = 'https://fullnode.testnet.aptoslabs.com/v1';

export default function App() {
  // Wallet
  const [walletAddress, setWalletAddress] = useState('');
  const [connecting, setConnecting] = useState(false);

  // Farmer: create agreement
  const [minPriceAPT, setMinPriceAPT] = useState('1'); // APT per ton (human)
  const [quantityTons, setQuantityTons] = useState('1');
  const [buyerAddr, setBuyerAddr] = useState('');

  // Buyer: fulfill
  const [farmerAddrLookup, setFarmerAddrLookup] = useState('');
  const [agreement, setAgreement] = useState(null); // on-chain read
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  // Simple log list
  const [txs, setTxs] = useState([]);

  const show = (msg) => setToast(String(msg));

  const connectWallet = async () => {
    if (!window.aptos) {
      alert('Petra Wallet not found. Install: https://petra.app/');
      return;
    }
    try {
      setConnecting(true);
      const res = await window.aptos.connect();
      setWalletAddress(res.address);
      show(`✅ Connected: ${res.address}`);
    } catch (e) {
      console.error(e);
      show('❌ Wallet connection cancelled/failed.');
    } finally {
      setConnecting(false);
    }
  };

  // ------- Helpers -------

  // APT -> octas (u64)
  const aptToOctas = (v) => {
    // avoid float rounding issues for simple inputs
    const [whole, frac = ''] = String(v).trim().split('.');
    const fracPadded = (frac + '00000000').slice(0, 8); // 8 decimals
    return BigInt(whole || '0') * 100000000n + BigInt(fracPadded || '0');
  };

  const addTx = (hash) =>
    setTxs((prev) => [{ hash, time: new Date().toLocaleString() }, ...prev]);

  const fetchAgreementResource = async (farmerAddress) => {
    try {
      const typeTag = `${MODULE}::PriceAgreement`;
      const url = `${NODE_URL}/accounts/${farmerAddress}/resource/${encodeURIComponent(
        typeTag
      )}`;
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      // json.data has fields defined in the Move struct
      return {
        minimum_price: BigInt(json.data.minimum_price),
        quantity_tons: BigInt(json.data.quantity_tons),
        total_value: BigInt(json.data.total_value),
        is_fulfilled: !!json.data.is_fulfilled,
        buyer_address: json.data.buyer_address,
      };
    } catch (e) {
      console.error('fetchAgreementResource error:', e);
      throw e;
    }
  };

  // ------- On-chain calls (Petra) -------

  const initCoinStore = async () => {
    if (!window.aptos) return alert('Install Petra wallet.');
    try {
      setBusy(true);
      const payload = {
        type: 'entry_function_payload',
        function: `${MODULE}::init_coin_store`,
        type_arguments: [],
        arguments: [],
      };
      const tx = await window.aptos.signAndSubmitTransaction(payload);
      addTx(tx.hash);
      show('💾 Coin store initialized (AptosCoin registered).');
    } catch (e) {
      console.error(e);
      show('❌ Failed to init coin store.');
    } finally {
      setBusy(false);
    }
  };

  const createAgreement = async () => {
    if (!window.aptos) return alert('Install Petra wallet.');
    if (!buyerAddr) return show('⚠ Please enter a buyer address.');
    try {
      setBusy(true);
      const minPriceOctas = aptToOctas(minPriceAPT); // u64 per ton (octas)
      const qty = BigInt(quantityTons);
      if (minPriceOctas <= 0n || qty <= 0n) {
        show('⚠ Minimum price and quantity must be > 0.');
        setBusy(false);
        return;
      }

      const payload = {
        type: 'entry_function_payload',
        function: `${MODULE}::create_price_agreement`,
        type_arguments: [],
        arguments: [
          String(minPriceOctas), // u64
          String(qty),           // u64
          buyerAddr,             // address
        ],
      };

      const tx = await window.aptos.signAndSubmitTransaction(payload);
      addTx(tx.hash);
      show('✅ Agreement created on-chain.');
    } catch (e) {
      console.error(e);
      show('❌ Failed to create agreement.');
    } finally {
      setBusy(false);
    }
  };

  const lookupAgreement = async () => {
    if (!farmerAddrLookup) return show('⚠ Enter a farmer address.');
    try {
      setBusy(true);
      const a = await fetchAgreementResource(farmerAddrLookup);
      if (!a) {
        setAgreement(null);
        show('ℹ️ No agreement found at that farmer address.');
      } else {
        setAgreement(a);
        show('✅ Agreement fetched from chain.');
      }
    } catch (e) {
      show('❌ Could not fetch agreement.');
    } finally {
      setBusy(false);
    }
  };

  const fulfillAgreement = async () => {
    if (!window.aptos) return alert('Install Petra wallet.');
    if (!agreement || !farmerAddrLookup) {
      return show('⚠ Fetch an agreement first.');
    }
    try {
      setBusy(true);

      const payload = {
        type: 'entry_function_payload',
        function: `${MODULE}::fulfill_agreement`,
        type_arguments: [],
        arguments: [
          farmerAddrLookup,            // address
          String(agreement.total_value) // u64 payment in octas
        ],
      };

      const tx = await window.aptos.signAndSubmitTransaction(payload);
      addTx(tx.hash);
      show('✅ Payment sent. Agreement fulfilled.');
      // refresh view
      const a = await fetchAgreementResource(farmerAddrLookup);
      setAgreement(a);
    } catch (e) {
      console.error(e);
      show('❌ Failed to fulfill agreement.');
    } finally {
      setBusy(false);
    }
  };

  // ------- UI -------
  return (
    <div className="app-body">
      <div className="container">
        <header className="header">
          <h1>🌾 Farmer Co-Op Price Agreements</h1>
          <p>Transparent on-chain pricing & fair trade (Aptos + Petra)</p>

          {walletAddress ? (
            <p className="black-text"><strong>Connected:</strong> {walletAddress}</p>
          ) : (
            <button className="btn" onClick={connectWallet} disabled={connecting}>
              {connecting ? 'Connecting…' : 'Connect Petra Wallet'}
            </button>
          )}

          <div style={{ marginTop: 8 }}>
            <button className="btn" onClick={initCoinStore} disabled={!walletAddress || busy}>
              Init Coin Store (APT)
            </button>
          </div>
        </header>

        <div className="grid">
          {/* Farmer: Create Agreement */}
          <div className="card">
            <h3>👩‍🌾 Create Price Agreement (Farmer)</h3>

            <label className="label">Minimum Price (APT per ton)</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.00000001"
              value={minPriceAPT}
              onChange={(e) => setMinPriceAPT(e.target.value)}
              placeholder="e.g., 1.25"
            />

            <label className="label">Quantity (tons)</label>
            <input
              className="input"
              type="number"
              min="1"
              value={quantityTons}
              onChange={(e) => setQuantityTons(e.target.value)}
              placeholder="e.g., 10"
            />

            <label className="label">Buyer Address (0x…)</label>
            <input
              className="input"
              type="text"
              value={buyerAddr}
              onChange={(e) => setBuyerAddr(e.target.value.trim())}
              placeholder="0xBuyerAddress"
            />

            <button className="btn" onClick={createAgreement} disabled={!walletAddress || busy}>
              Create Agreement (on-chain)
            </button>

            <div className="output">
              <div className="black-text">
                <strong>Note:</strong> This stores a <code>PriceAgreement</code> under the farmer’s account.
                Prices are kept in <em>octas</em> (1 APT = 100,000,000 octas).
              </div>
            </div>
          </div>

          {/* Buyer: Fetch & Fulfill */}
          <div className="card">
            <h3>🛒 Buyer Purchase (Fulfill Agreement)</h3>

            <label className="label">Farmer Address (0x…)</label>
            <input
              className="input"
              type="text"
              value={farmerAddrLookup}
              onChange={(e) => setFarmerAddrLookup(e.target.value.trim())}
              placeholder="0xFarmerAddress"
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={lookupAgreement} disabled={busy}>
                Fetch Agreement
              </button>
              <button
                className="btn"
                onClick={fulfillAgreement}
                disabled={!walletAddress || !agreement || busy || agreement.is_fulfilled}
              >
                {agreement?.is_fulfilled ? 'Already Fulfilled' : 'Fulfill Agreement'}
              </button>
            </div>

            <div className="output">
              {!agreement ? (
                <div className="black-text">No agreement loaded yet.</div>
              ) : (
                <div className="black-text">
                  <strong>Agreement</strong>
                  <br />
                  Min Price (octas/ton): {agreement.minimum_price.toString()}
                  <br />
                  Quantity (tons): {agreement.quantity_tons.toString()}
                  <br />
                  <strong>Total (octas): {agreement.total_value.toString()}</strong>
                  <br />
                  Buyer: {agreement.buyer_address}
                  <br />
                  Status:{' '}
                  {agreement.is_fulfilled ? '✅ Fulfilled' : '⏳ Awaiting Payment'}
                </div>
              )}
            </div>
          </div>

          {/* Toast / Messages */}
          <div className="card full">
            <h3>📣 Messages</h3>
            <div className="output">{toast || '—'}</div>
          </div>

          {/* Simple TX log */}
          <div className="card full">
            <h3>📜 Recent Transactions</h3>
            {txs.length === 0 ? (
              <p className="black-text">No transactions yet.</p>
            ) : (
              <ul className="black-text">
                {txs.map((t, i) => (
                  <li key={i}>
                    {t.time} — <code>{t.hash}</code>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
