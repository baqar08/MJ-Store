# Firestore Backup Strategy

Regular backups ensure our transactional data (orders, users, products) is safe and easily recoverable in the event of an incident. 

## Automated Exports (Cron Job)

We use the `@google-cloud/firestore` Admin API to automatically export backups to a GCS Bucket. 

### Prerequisites

1. Standard or Premium Tier of Firebase / GCP.
2. A Google Cloud Storage Bucket dedicated to backups (e.g., `gs://mj-store-backups`).
3. Appropriate IAM roles (`roles/datastore.importExportAdmin` & `roles/storage.admin`) configured.

### Setting Up the Cron Job on Unix / Linux

1. Ensure the env variables `GCS_BUCKET` and `FIREBASE_PROJECT_ID` are exported.
2. The `backup.js` script must be run with the correct service account or application default credentials.

```bash
# Edit your crontab
crontab -e
```

Add the following entry for a daily backup at 2 AM server time:
```bash
0 2 * * * cd /path/to/server && export GCS_BUCKET=mj-store-backups && /usr/local/bin/node backup.js >> logs/backup.log 2>&1
```

*(Adjust node path and project path depending on your server)*

### Setting Up via GCP Cloud Scheduler (Preferred)

Alternatively, if deployed on App Engine, Cloud Run, or Cloud Functions, use **Cloud Scheduler**:
1. Go to GCP Console -> Cloud Scheduler.
2. Create a job running on `0 2 * * *`.
3. Target: an HTTP endpoint or a Pub/Sub topic that triggers `backup.js`.
