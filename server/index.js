import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import admin from 'firebase-admin';
import client from 'prom-client';
import RedisStore from 'rate-limit-redis';
import logger from './logger.js';
import { CircuitBreaker } from './breaker.js';
import redis from './redis.js';
import { webhookQueue } from './worker.js';

// ──────────────────────────────────────────
// PROMETHEUS OBSERVABILITY
// ──────────────────────────────────────────
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const orderSuccessCounter = new client.Counter({
  name: 'mjstore_orders_success_total',
  help: 'Total number of successfully captured orders',
});
const orderFailedCounter = new client.Counter({
  name: 'mjstore_orders_failed_total',
  help: 'Total number of failed transactions or webhooks',
});
register.registerMetric(orderSuccessCounter);
register.registerMetric(orderFailedCounter);

export function recordMetric(type) {
  if (type === 'success') orderSuccessCounter.inc();
  if (type === 'failure') orderFailedCounter.inc();
}

// ──────────────────────────────────────────
// 1. Firebase Admin Init
// ──────────────────────────────────────────
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID,
});
const db = admin.firestore();

// ──────────────────────────────────────────
// 2. Razorpay Init
// ──────────────────────────────────────────
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET,
});

const razorpayBreaker = new CircuitBreaker('RazorpayAPI', 3, 30000);

// ──────────────────────────────────────────
// 3. Express App Setup & Global Middlewares
// ──────────────────────────────────────────
const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-razorpay-signature', 'Idempotency-Key'],
}));

// We use express.raw for the webhook to access the raw buffer required for signature verification
app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));

// For all other routes, parse JSON bodies
app.use(express.json({ limit: '10kb' }));

// ──────────────────────────────────────────
// 4. Rate Limiting Setup
// ──────────────────────────────────────────
const globalLimiter = rateLimit({
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args) }),
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

const createOrderLimiter = rateLimit({
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args) }),
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many order attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const webhookLimiter = rateLimit({
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args) }),
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many webhook requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

const contactLimiter = rateLimit({
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args) }),
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many contact requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ──────────────────────────────────────────
// 5. Auth Middleware
// ──────────────────────────────────────────
async function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — no token provided' });
  }
  try {
    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.uid = decoded.uid;
    req.email = decoded.email;
    next();
  } catch (err) {
    logger.error('Token verification failed:', err.message);
    return res.status(401).json({ error: 'Unauthorized — invalid token' });
  }
}

// ──────────────────────────────────────────
// 5b. Distributed Fraud & Anomaly Middleware (Redis)
// ──────────────────────────────────────────
async function fraudGuard(req, res, next) {
  try {
    const fraudKey = `fraud_pts:${req.uid}`;
    const fifteenMinsAgo = Date.now() - 15 * 60 * 1000;
    
    // Remove old entries (older than 15 mins)
    await redis.zremrangebyscore(fraudKey, '-inf', fifteenMinsAgo);

    // Calculate score using redis time-series sets
    const attempts = await redis.zcount(fraudKey, fifteenMinsAgo, '+inf');
    const riskScore = attempts * 10;
      
    if (riskScore >= 50) {
      logger.warn(`Distributed fraud guard tripped for user ${req.uid}. Score: ${riskScore}. IP: ${req.ip}`);
      return res.status(429).json({ error: 'Checkout disabled due to unusual activity. Try again later.' });
    }
    next();
  } catch (err) {
    logger.error('Fraud guard error:', err);
    next(); // Fail open: do not block legitimate users if Redis briefly fails
  }
}

function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[<>'"&]/g, '');
}

// ──────────────────────────────────────────
// 6. Distributed Idempotent Order Fulfillment
// ──────────────────────────────────────────
export async function fulfillOrder(razorpay_order_id, razorpay_payment_id, userId = null) {
  return await db.runTransaction(async (transaction) => {
    // Check if logic has already processed this Razorpay order
    const ordersRef = db.collection('orders');
    const orderQuery = await transaction.get(ordersRef.where('razorpayOrderId', '==', razorpay_order_id).limit(1));
    if (!orderQuery.empty) {
      return { success: true, orderId: orderQuery.docs[0].id, alreadyProcessed: true };
    }

    const pendingRef = db.collection('pending_orders').doc(razorpay_order_id);
    const pendingDoc = await transaction.get(pendingRef);

    if (!pendingDoc.exists) {
      throw new Error('Pending order not found');
    }

    const pendingOrder = pendingDoc.data();

    if (userId && pendingOrder.userId !== userId) {
      throw new Error('Unauthorized — order does not belong to you');
    }

    // Atomically decrement stock
    for (const item of pendingOrder.items) {
      const productRef = db.collection('products').doc(item.product);
      transaction.update(productRef, {
        stock: admin.firestore.FieldValue.increment(-item.quantity),
      });
    }

    const newOrderRef = db.collection('orders').doc();
    transaction.set(newOrderRef, {
      ...pendingOrder,
      status: 'paid',
      paymentId: razorpay_payment_id,
      paymentMethod: 'razorpay',
      paidAt: new Date().toISOString(),
    });

    transaction.delete(pendingRef);

    return { success: true, orderId: newOrderRef.id, alreadyProcessed: false };
  });
}

// ──────────────────────────────────────────
// 7. POST /api/contact
// ──────────────────────────────────────────
app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    const { name, email, message } = req.body;
    
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    if (name.trim().length === 0 || email.trim().length === 0 || message.trim().length === 0) {
      return res.status(400).json({ error: 'Fields cannot be empty' });
    }

    // Basic sanitization
    const sanitizedName = sanitize(name);
    const sanitizedEmail = sanitize(email);
    const sanitizedMessage = sanitize(message);

    await db.collection('contact_queries').add({
      name: sanitizedName,
      email: sanitizedEmail,
      message: sanitizedMessage,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip
    });

    logger.info(`Contact message received from ${sanitizedEmail}`);
    res.json({ success: true, message: 'Message sent perfectly. We will securely be in touch soon!' });
  } catch (err) {
    logger.error('Contact API Error:', err);
    res.status(500).json({ error: 'Internal server error while sending message' });
  }
});

// ──────────────────────────────────────────
// 8. POST /api/coupons/validate
// ──────────────────────────────────────────
app.post('/api/coupons/validate', createOrderLimiter, async (req, res) => {
  try {
    const { code, subtotal } = req.body;
    if (!code || typeof subtotal !== 'number') return res.status(400).json({ error: 'Invalid coupon payload' });

    const couponStr = code.toUpperCase().trim();
    const couponQuery = await db.collection('coupons').where('code', '==', couponStr).limit(1).get();
    
    if (couponQuery.empty) return res.status(404).json({ error: 'Coupon not found' });
    
    const coupon = couponQuery.docs[0].data();
    
    // Validations
    if (new Date() > new Date(coupon.expiryDate)) return res.status(400).json({ error: 'Coupon has expired' });
    if (coupon.usedCount >= coupon.usageLimit) return res.status(400).json({ error: 'Coupon usage limit reached' });
    if (subtotal < coupon.minOrderValue) return res.status(400).json({ error: `Minimum order value of ₹${coupon.minOrderValue} required` });

    let discountApplied = 0;
    if (coupon.discountType === 'percentage') {
       discountApplied = Math.round(subtotal * (coupon.value / 100));
    } else {
       discountApplied = coupon.value;
    }

    // Never let discount exceed subtotal
    if (discountApplied > subtotal) discountApplied = subtotal;

    res.json({
      valid: true,
      originalSubtotal: subtotal,
      discountApplied,
      finalSubtotal: subtotal - discountApplied,
      message: `${couponStr} applied directly! (-₹${discountApplied})`
    });
  } catch (err) {
    logger.error('Coupon validation error:', err);
    res.status(500).json({ error: 'Failed to validate coupon' });
  }
});

// ──────────────────────────────────────────
// 9. POST /api/payment/create-order
// ──────────────────────────────────────────
app.post('/api/payment/create-order', createOrderLimiter, verifyAuth, fraudGuard, async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header is required' });
  }

  const keyString = `idempotency:${idempotencyKey}`;

  try {
    const existingRaw = await redis.get(keyString);
    if (existingRaw) {
      const stateObj = JSON.parse(existingRaw);
      if (stateObj.status === 'pending') {
        logger.warn(`Idempotency: Blocked duplicate concurrent request (PENDING). Key: ${idempotencyKey}`);
        return res.status(409).json({ error: 'Order is currently processing. Do not double click.' });
      } else if (stateObj.status === 'completed') {
        logger.info(`Idempotency: Re-serving successful idempotency mapped sequence (${idempotencyKey})`);
        return res.status(200).json(stateObj.responseData);
      }
      // If 'failed', we allow them to organically fall through and natively process a fresh Razorpay hook again down below.
    }

    // Set lock officially into distributed PENDING state natively
    await redis.set(keyString, JSON.stringify({ status: 'pending' }), 'EX', 86400);

  } catch(e) {
    logger.error('Redis Idempotency state validation failed natively:', e);
    // Fail open safely on cache crash
  }

  try {
    const { items, shippingAddress, couponCode } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    if (!shippingAddress || !shippingAddress.firstName || !shippingAddress.address || !shippingAddress.city) {
      return res.status(400).json({ error: 'Invalid shipping address' });
    }

    let subtotal = 0;
    const verifiedItems = [];

    for (const item of items) {
      if (!item.productId || !item.quantity || item.quantity < 1 || item.quantity > 10) {
        return res.status(400).json({ error: `Invalid item: ${item.productId}` });
      }

      // Try fetching from Redis products cache
      const cacheKey = `product:${item.productId}`;
      let product = null;
      let cachedRaw = await redis.get(cacheKey);

      if (cachedRaw) {
         product = JSON.parse(cachedRaw);
      } else {
         const productDoc = await db.collection('products').doc(item.productId).get();
         if (!productDoc.exists) {
           return res.status(400).json({ error: `Product not found: ${item.productId}` });
         }
         product = productDoc.data();
         await redis.set(cacheKey, JSON.stringify(product), 'EX', 3600); // 1 hour cache
      }

      if (product.stock < item.quantity) {
        return res.status(400).json({ error: `${product.name} is out of stock (${product.stock} left)` });
      }

      subtotal += product.price * item.quantity;
      verifiedItems.push({
        product: item.productId,
        name: product.name,
        image: product.images?.[0] || '/images/shoe-white.png',
        price: product.price,
        size: item.size || 'N/A',
        quantity: item.quantity,
      });
    }

    let discountApplied = 0;
    
    // Backend Coupon Pre-processor Validation
    if (couponCode) {
      const parsedCode = String(couponCode).toUpperCase().trim();
      const couQ = await db.collection('coupons').where('code', '==', parsedCode).limit(1).get();
      if (!couQ.empty) {
        const coupon = couQ.docs[0].data();
        if (new Date() <= new Date(coupon.expiryDate) && coupon.usedCount < coupon.usageLimit && subtotal >= coupon.minOrderValue) {
           // Apply valid coupon
           discountApplied = coupon.discountType === 'percentage' 
               ? Math.round(subtotal * (coupon.value / 100))
               : coupon.value;
           
           if (discountApplied > subtotal) discountApplied = subtotal;
           
           // Optionally increment usage synchronously or atomically later
           await db.collection('coupons').doc(couQ.docs[0].id).update({
               usedCount: admin.firestore.FieldValue.increment(1)
           });
           logger.info(`Coupon ${parsedCode} strictly validated. Discount applied: ₹${discountApplied}`);
        } else {
           logger.warn(`Coupon failed secure backend guard rails: ${parsedCode}`);
        }
      }
    }

    const shippingCost = subtotal >= 15000 ? 0 : 499;
    const discountedTotal = subtotal - discountApplied;
    const tax = Math.round(discountedTotal * 0.18);
    const totalAmount = discountedTotal + shippingCost + tax;
    const amountInPaise = totalAmount * 100;

    const razorpayOrder = await razorpayBreaker.fire(() => razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `order_${Date.now()}`,
      notes: {
        userId: req.uid,
        email: req.email,
        couponCode: couponCode ? String(couponCode).toUpperCase() : 'None',
      },
    }));

    // Record attempt in Redis time-series for fraud guard
    const fraudKey = `fraud_pts:${req.uid}`;
    await redis.zadd(fraudKey, Date.now(), razorpayOrder.id);

    await db.collection('pending_orders').doc(razorpayOrder.id).set({
      userId: req.uid,
      items: verifiedItems,
      shippingAddress: {
        firstName: sanitize(shippingAddress.firstName),
        lastName: sanitize(shippingAddress.lastName),
        email: sanitize(shippingAddress.email),
        phone: sanitize(shippingAddress.phone),
        address: sanitize(shippingAddress.address),
        city: sanitize(shippingAddress.city),
        state: sanitize(shippingAddress.state),
        zip: sanitize(shippingAddress.zip),
        country: sanitize(shippingAddress.country),
      },
      subtotal,
      discountApplied,
      shippingCost,
      tax,
      totalAmount,
      couponCode: couponCode ? String(couponCode).toUpperCase().trim() : null,
      razorpayOrderId: razorpayOrder.id,
      status: 'pending_payment',
      createdAt: new Date().toISOString(),
    });

    logger.info(`Created Razorpay Order ${razorpayOrder.id} for user ${req.uid}`);

    const responsePayload = {
      orderId: razorpayOrder.id,
      amount: amountInPaise,
      currency: 'INR',
      key: process.env.RAZORPAY_KEY_ID,
    };

    // Safely lock into distributed completed state arrays resolving the mapped ID
    await redis.set(keyString, JSON.stringify({
      status: 'completed',
      responseData: responsePayload
    }), 'EX', 86400);

    res.json(responsePayload);
  } catch (err) {
    logger.error('Create order error processing pipeline catch (marking failed):', err);
    try {
      await redis.set(`idempotency:${idempotencyKey}`, JSON.stringify({ status: 'failed' }), 'EX', 86400);
    } catch(redisErr) {}
    res.status(500).json({ error: 'Failed to create order securely' });
  }
});

// ──────────────────────────────────────────
// 10. POST /api/payment/verify (Frontend Fallback)
// ──────────────────────────────────────────
app.post('/api/payment/verify', verifyAuth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment details' });
    }

    // Verify signature cryptographically
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      logger.error('Payment signature mismatch during frontend verification!');
      return res.status(400).json({ error: 'Payment verification failed — signature mismatch' });
    }

    // Verify status securely with Razorpay directly through Circuit Breaker
    const payment = await razorpayBreaker.fire(() => razorpay.payments.fetch(razorpay_payment_id));
    if (payment.status !== 'captured' || payment.order_id !== razorpay_order_id) {
      logger.error(`Payment ${razorpay_payment_id} was not fully captured on Razorpay.`);
      return res.status(400).json({ error: 'Payment has not been captured yet' });
    }

    // Process idempotently via transaction
    const result = await fulfillOrder(razorpay_order_id, razorpay_payment_id, req.uid);

    if (result.alreadyProcessed) {
      logger.info(`Order ${razorpay_order_id} was already fulfilled (likely by webhook). Returned cached success.`);
    } else {
      logger.info(`Order ${razorpay_order_id} successfully fulfilled via frontend verification fallback.`);
      recordMetric('success');
    }

    res.json({
      success: true,
      orderId: result.orderId,
      message: 'Payment verified and order confirmed',
    });
  } catch (err) {
    logger.error('Verify payment error:', err);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

// ──────────────────────────────────────────
// 11. POST /api/payment/webhook (Backend Source of Truth)
// ──────────────────────────────────────────
app.post('/api/payment/webhook', webhookLimiter, async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.body; // express.raw makes this a Buffer
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_SECRET;

    // Verify razorpay webhook signature
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody.toString('utf8'))
      .digest('hex');

    if (signature !== expectedSignature) {
      logger.warn('Webhook signature mismatch. Possible unauthorized access attempt.');
      return res.status(400).json({ error: 'Invalid Signature' });
    }

    const event = JSON.parse(rawBody.toString('utf8'));
    const eventId = req.headers['x-razorpay-event-id'] || event.event_id || `webhook_${crypto.randomUUID()}`;
    
    logger.info(`Webhook Ingested into Queue Server: ${event.event} (${eventId})`);

    // In a distributed cluster, express logic handles 0 workload synchronously
    // Pushing onto BullMQ Queue for robust isolation execution
    await webhookQueue.add('process-webhook', { event, eventId }, {
       jobId: eventId,  // Bullmq naturally guarantees unique job ID idempotency
       attempts: 3,
       backoff: {
         type: 'exponential',
         delay: 5000
       }
    });

    res.json({ status: 'ok', msg: 'Queued' });
  } catch (err) {
    logger.error('Webhook ingestion error:', err);
    res.status(400).send('Webhook Ingestion Error');
  }
});

// ──────────────────────────────────────────
// 12. Health & Error Handling
// ──────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await db.collection('products').limit(1).get();
    res.json({ 
      status: 'ok', 
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      db: 'connected',
      timestamp: new Date().toISOString() 
    });
  } catch (err) {
    logger.error('Health check db fail:', err);
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

app.use((err, req, res, next) => {
  logger.error('Unhandled express error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ──────────────────────────────────────────
// 13. Custom Metrics Exposer
// ──────────────────────────────────────────
app.get('/api/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// ──────────────────────────────────────────
// 14. Local Chaos Testing
// ──────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/chaos', (req, res) => {
    const { action } = req.body;
    if (action === 'trip_razorpay') {
      for(let i=0; i<razorpayBreaker.threshold; i++) razorpayBreaker.fail();
      return res.json({ message: 'Razorpay CircuitBreaker manually tripped.' });
    }
    if (action === 'reset_razorpay') {
      razorpayBreaker.success();
      return res.json({ message: 'Razorpay CircuitBreaker reset.' });
    }
    if (action === 'simulate_memory_leak') {
      const leak = [];
      for(let i=0; i<100000; i++) leak.push(new Array(100).fill('chaos'));
      return res.json({ message: 'Memory bloat simulated', currentMemory: process.memoryUsage() });
    }
    res.status(400).json({ error: 'Unknown chaos action' });
  });
}

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  logger.info(`Payment server running on port ${PORT}`);
});
