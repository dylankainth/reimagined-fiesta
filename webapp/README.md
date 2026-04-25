# Government ID Verifier - Web App

A Vite + React webapp for government officials to verify and onboard passports, linking them to digital IDs via a peer-to-peer Hypercore network.

## Architecture

```
┌─────────────────────────────────────────┐
│  React UI (Vite)                         │
│  ├── PassportUpload (manual/OCR)        │
│  ├── IDLinker (create digital ID)       │
│  └── RecordsList (view verified IDs)    │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│  PearIDVerifier (pear-client.js)        │
│  ├── Hypercore (append-only log)        │
│  └── Hyperswarm (P2P sharing)           │
└──────────────────┬──────────────────────┘
                   │
              ┌────▼─────┐
              │  P2P Net  │
              └───────────┘
```

## Data Flow

1. **Passport Entry**: Government official enters or uploads passport data
2. **Digital ID Generation**: System generates a unique digital ID with keypair
3. **Verification**: Official confirms and adds their credentials
4. **P2P Storage**: Record is appended to local Hypercore and shared via Hyperswarm
5. **Mobile Verification**: Mobile app can verify ages/identity against this P2P core

## Running the Webapp

```bash
cd webapp
npm install
npm run dev
```

Then open `http://localhost:3000`

## Key Features

- **No Database**: All data stored in Hypercore (append-only ledger)
- **P2P Sharing**: Uses Hyperswarm for decentralized data distribution
- **Manual Entry**: Type in passport details
- **OCR Ready**: Upload passport images (integrated with client-side OCR)
- **Digital ID Linking**: Auto-generate cryptographic IDs for each verified passport
- **Official Tracking**: Records who verified each ID and when

## API Usage

```javascript
import { PearIDVerifier } from './src/pear-client'

const verifier = new PearIDVerifier()
await verifier.initialize()

// Store a verified ID
await verifier.storeVerifiedID(
  {
    number: 'AB123456',
    firstName: 'John',
    lastName: 'Doe',
    dateOfBirth: '1990-01-01',
    nationality: 'US',
    issuingCountry: 'US',
    expiryDate: '2030-01-01',
  },
  {
    id: 'crypto-id',
    publicKey: 'public-key-hex',
    createdAt: new Date().toISOString(),
  },
  {
    verifiedBy: 'Officer Smith',
    verificationMethod: 'manual',
  }
)

// Retrieve all records
const records = await verifier.getAllRecords()

// Get public key for sharing
const publicKey = verifier.getPublicKey()
```

## File Structure

```
webapp/
├── index.html
├── package.json
├── vite.config.js
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── index.css
│   ├── App.css
│   ├── pear-client.js          # P2P logic
│   ├── components/
│   │   ├── PassportUpload.jsx
│   │   ├── IDLinker.jsx
│   │   └── RecordsList.jsx
│   └── styles/
│       ├── PassportUpload.css
│       ├── IDLinker.css
│       └── RecordsList.css
└── README.md
```

## Integration with Mobile App

The mobile app can connect to this webapp's Hypercore by:

1. Getting the public key from the verifier
2. Joining the Hyperswarm discovery network
3. Reading verified ID records
4. Validating the user's linked digital ID

Example (mobile):
```javascript
const publicKey = 'webapp-public-key-from-ui'
const core = new Hypercore(`./storage/verified-ids`, {
  key: Buffer.from(publicKey, 'hex'),
})
const peers = await core.findingPeers()
// Now you can read the verified IDs
```

## TODOs

- [ ] Integrate Tesseract.js for client-side OCR
- [ ] Add photo capture from webcam
- [ ] Implement digital signature verification
- [ ] Add QR code generation for sharing public key
- [ ] Persister storage optimization
- [ ] Admin dashboard for statistics
- [ ] Age validation badge generation
