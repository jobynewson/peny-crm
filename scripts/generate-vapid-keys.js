// Prints a fresh VAPID key pair for web push (api/_push.js).
//   node scripts/generate-vapid-keys.js
// Put the three values in Vercel › Settings › Environment Variables
// (Production and Preview), then redeploy. Keep the private key secret: it is
// what proves a push came from Slate. Changing it later switches every
// device off, and each person turns push back on in Settings.
import webpush from 'web-push'

const { publicKey, privateKey } = webpush.generateVAPIDKeys()
console.log(`VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${privateKey}`)
console.log('VAPID_SUBJECT=mailto:slate@wearepeny.com')
