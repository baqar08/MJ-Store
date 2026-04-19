import admin from 'firebase-admin';

// Usage: NODE_ENV=production GCS_BACKUP_URI=gs://my-backup-bucket/2026-X-X/ node restore.js

if (!process.env.GCS_BACKUP_URI) {
  console.error('Error: GCS_BACKUP_URI environment variable must be set.');
  console.error('Example: gs://mj-store-backups/2026-04-18T12:00:00.000Z');
  process.exit(1);
}

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const client = new admin.firestore.v1.FirestoreAdminClient();

async function restoreFirestore() {
  const projectId = process.env.FIREBASE_PROJECT_ID || admin.app().options.projectId;
  const backupUri = process.env.GCS_BACKUP_URI;

  if (!projectId) {
    console.error('Error: Project ID could not be determined. Set FIREBASE_PROJECT_ID.');
    process.exit(1);
  }

  const databaseName = client.databasePath(projectId, '(default)');

  try {
    console.warn(`\n🚨 WARNING: Restoring Firestore from ${backupUri}`);
    console.warn('This operation will overwrite conflicting documents with the backup version.');
    console.warn('Waiting 5 seconds before launching...');
    await new Promise(res => setTimeout(res, 5000));
    
    console.log(`Starting Firestore import...`);
    const [operation] = await client.importDocuments({
      name: databaseName,
      inputUriPrefix: backupUri,
      collectionIds: [] // Imports all collections
    });

    console.log(`Operation pending (ID: ${operation.name}). Waiting to finish...`);
    
    // Wait for the long running operation
    const [response] = await operation.promise();
    console.log('Restore completed successfully:', response);
  } catch (err) {
    console.error('Error importing Firestore data:', err);
    process.exit(1);
  }
}

restoreFirestore();
