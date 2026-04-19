import admin from 'firebase-admin';
import path from 'path';

// Usage: NODE_ENV=production GCS_BUCKET=my-backup-bucket node backup.js

if (!process.env.GCS_BUCKET) {
  console.error('Error: GCS_BUCKET environment variable must be set.');
  process.exit(1);
}

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const client = new admin.firestore.v1.FirestoreAdminClient();

async function exportFirestore() {
  const projectId = process.env.FIREBASE_PROJECT_ID || admin.app().options.projectId;
  const bucketName = process.env.GCS_BUCKET;

  if (!projectId) {
    console.error('Error: Project ID could not be determined. Set FIREBASE_PROJECT_ID.');
    process.exit(1);
  }

  const databaseName = client.databasePath(projectId, '(default)');
  const outputUriPrefix = `gs://${bucketName}/${new Date().toISOString()}`;

  try {
    console.log(`Starting Firestore export to ${outputUriPrefix}...`);
    const [operation] = await client.exportDocuments({
      name: databaseName,
      outputUriPrefix: outputUriPrefix,
      // Leave collectionIds empty to export all collections
      collectionIds: []
    });

    console.log(`Operation pending (ID: ${operation.name}). Waiting to finish...`);
    
    // Wait for the long running operation
    const [response] = await operation.promise();
    console.log('Export completed successfully:', response);
  } catch (err) {
    console.error('Error exporting Firestore data:', err);
    process.exit(1);
  }
}

exportFirestore();
