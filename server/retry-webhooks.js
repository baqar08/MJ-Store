import admin from 'firebase-admin';
import crypto from 'crypto';

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}
const db = admin.firestore();

// We need the secret strictly to verify/imitate successful signature locally if re-sending
const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_SECRET;

async function retryFailedWebhooks() {
  console.log('Fetching failed webhooks from webhook_dlq...');
  
  const failedDocs = await db.collection('webhook_dlq')
    .where('status', '==', 'failed')
    .get();
    
  if (failedDocs.empty) {
    console.log('No failed webhooks found. System healthy.');
    process.exit(0);
  }
  
  console.log(`Found ${failedDocs.size} failed webhooks to retry.`);
  
  for (const doc of failedDocs.docs) {
    const data = doc.data();
    console.log(`\nRetrying DLQ Record: ${doc.id}`);
    
    if (!data.payload) {
       console.log(`Skipping ${doc.id}: No payload exists.`);
       await doc.ref.update({ status: 'invalid_no_payload' });
       continue;
    }
    
    // Attempt local API fetch to our own server, or just parse payload locally and fix DB
    // To be perfectly pure, we will parse the payload and manually trigger business logic again, OR 
    // re-POST it to localhost. Re-POSTing is safest to guarantee all logic matches!

    try {
      const payloadString = data.payload;
      const reSignature = crypto
        .createHmac('sha256', secret)
        .update(payloadString)
        .digest('hex');

      const response = await fetch('http://localhost:5001/api/payment/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': reSignature
        },
        body: payloadString
      });

      if (response.ok) {
        console.log(`✅ Recovered webhook ${doc.id} successfully!`);
        await doc.ref.update({ 
           status: 'recovered',
           recoveredAt: new Date().toISOString()
        });
      } else {
        console.log(`❌ Failed to recover ${doc.id}. Server responded: ${response.status}`);
        await doc.ref.update({ 
           retryCount: admin.firestore.FieldValue.increment(1),
           lastRetryAt: new Date().toISOString()
        });
      }

    } catch (err) {
      console.error(`Error sending retry request for ${doc.id}:`, err.message);
      await doc.ref.update({ 
         retryCount: admin.firestore.FieldValue.increment(1),
         lastRetryAt: new Date().toISOString()
      });
    }
  }
}

retryFailedWebhooks();
