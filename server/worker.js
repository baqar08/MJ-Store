import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import logger from './logger.js';
import { fulfillOrder, recordMetric } from './index.js';
import admin from 'firebase-admin';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Isolated connection strictly for BullMQ Queue Producer
export const webhookQueue = new Queue('webhook-events', { 
  connection: new Redis(redisUrl, { maxRetriesPerRequest: null }) 
});

const worker = new Worker('webhook-events', async job => {
  const { event, eventId } = job.data;
  
  logger.info(`Worker processing webhook job ${job.id} for event ${eventId}`);
  
  if (event.event === 'payment.captured') {
    const paymentData = event.payload.payment.entity;
    const razorpay_order_id = paymentData.order_id;
    const razorpay_payment_id = paymentData.id;

    const result = await fulfillOrder(razorpay_order_id, razorpay_payment_id);
    if (result.alreadyProcessed) {
      logger.info(`Worker: Webhook Order ${razorpay_order_id} already processed. Skipping.`);
    } else {
      logger.info(`Worker: Successfully fulfilled order ${razorpay_order_id}`);
      recordMetric('success');
    }
  } else if (event.event === 'payment.failed') {
    const paymentData = event.payload.payment.entity;
    const razorpay_order_id = paymentData.order_id;
    logger.warn(`Worker: Payment failed event for ${paymentData.id} (Order: ${razorpay_order_id})`);
    
    try {
      await admin.firestore().collection('pending_orders').doc(razorpay_order_id).update({
         status: 'failed',
         failedAt: new Date().toISOString()
      });
    } catch (e) {
       logger.info(`Worker: Could not update failed status for ${razorpay_order_id} (not pending)`);
    }
  }
}, { 
  connection: new Redis(redisUrl, { maxRetriesPerRequest: null }), // Isolated connection for blocking Worker loop
  concurrency: 5,
  limiter: {
    max: 10,
    duration: 1000,
  }
});

worker.on('completed', job => {
  logger.info(`Worker: Job ${job.id} has completed successfully!`);
});

worker.on('failed', (job, err) => {
  logger.error(`Worker: Job ${job.id} has failed with ${err.message}`);
});

export default worker;
