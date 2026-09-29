import {generateVapidKeys} from '@mmmike/web-push/vapid';
import {writeFile} from 'node:fs/promises';
const keys=await generateVapidKeys();
const pairing=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
await writeFile('secrets.json',JSON.stringify({VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey,PAIRING_TOKEN:pairing}),{mode:0o600,flag:'wx'});
console.log('Clés créées dans secrets.json (privé). Ne publie jamais ce fichier.');
