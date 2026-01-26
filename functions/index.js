const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const cors = require("cors");

const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

// ========================
// CORS
// ========================
const corsHandler = cors({
  origin: [
    "http://localhost:8080",
    "http://localhost:5173",
    "https://www.ruandricare.com",
  ],
  methods: ["POST"],
});

// ========================
// Secrets
// ========================
const RAZORPAY_TEST_KEY_ID = defineSecret("RAZORPAY_TEST_KEY_ID");
const RAZORPAY_TEST_KEY_SECRET = defineSecret("RAZORPAY_TEST_KEY_SECRET");

const RAZORPAY_LIVE_KEY_ID = defineSecret("RAZORPAY_LIVE_KEY_ID");
const RAZORPAY_LIVE_KEY_SECRET = defineSecret("RAZORPAY_LIVE_KEY_SECRET");
const RAZORPAY_WEBHOOK_SECRET = defineSecret("RAZORPAY_WEBHOOK_SECRET");

// ========================
// 1️⃣ CREATE ORDER
// ========================
exports.createOrder = onRequest(
  {
    secrets: ["RAZORPAY_LIVE_KEY_ID", "RAZORPAY_LIVE_KEY_SECRET"],
  },
  async (req, res) => {
    corsHandler(req, res, async () => {

     

      // ❌ Block anything except POST
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
      }

      try {
        const { amount, docId } = req.body;

        if (!amount || !docId) {
          return res.status(400).json({ error: "Missing amount or docId" });
        }

        const razorpay = new Razorpay({
          key_id: process.env.RAZORPAY_LIVE_KEY_ID,
          key_secret: process.env.RAZORPAY_LIVE_KEY_SECRET,
        });

        const order = await razorpay.orders.create({
          amount: amount * 100,
          currency: "INR",
          receipt: docId,
        });

        // ✅ THIS JSON RESPONSE IS REQUIRED
        return res.status(200).json({
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          keyId: process.env.RAZORPAY_LIVE_KEY_ID,
        });

      } catch (err) {
        console.error("❌ CreateOrder error:", err);
        return res.status(500).json({ error: err.message });
      }
    });
  }
);




exports.verifyPayment = onRequest(
  {
    secrets: ["RAZORPAY_LIVE_KEY_SECRET"],
  },
  async (req, res) => {
    corsHandler(req, res, async () => {
      console.log("🔥 verifyPayment HIT");
      console.log("Method:", req.method);
      console.log("Body:", req.body);

      try {
        const {
          docId,
          razorpay_payment_id,
          razorpay_order_id,
          razorpay_signature,
        } = req.body;

        if (
          !docId ||
          !razorpay_payment_id ||
          !razorpay_order_id ||
          !razorpay_signature
        ) {
          console.error("❌ Missing fields");
          return res.status(400).json({ error: "Missing fields" });
        }

        const secret = process.env.RAZORPAY_LIVE_KEY_SECRET;

        const body = razorpay_order_id + "|" + razorpay_payment_id;

        const expectedSignature = crypto
          .createHmac("sha256", secret)
          .update(body)
          .digest("hex");

        if (expectedSignature !== razorpay_signature) {
          console.error("❌ Signature mismatch");
          return res.status(400).json({ error: "Invalid signature" });
        }

        console.log("✅ Signature verified");

        const bookingRef = db.collection("sessions").doc(docId);
        const bookingSnap = await bookingRef.get();

        console.log("Booking exists:", bookingSnap.exists);

        if (!bookingSnap.exists) {
          return res.status(404).json({ error: "Booking not found" });
        }

        await bookingRef.set(
          {
            payment: {
              id: razorpay_payment_id,
              orderId: razorpay_order_id,
              status: "paid",
              verifiedAt: Date.now(),
            },
            isClosed: true,
          },
          { merge: true }
        );

        console.log("✅ Firestore updated");

        return res.json({ success: true });
      } catch (error) {
        console.error("🔥 VERIFY PAYMENT CRASH:", error);
        return res.status(500).json({
          error: error.message,
          stack: error.stack,
        });
      }
    });
  }
);




exports.razorpayWebhook = onRequest(
  {
    secrets: [RAZORPAY_WEBHOOK_SECRET],
  },
  async (req, res) => {
    try {
      const signature = req.headers["x-razorpay-signature"];

      const expectedSignature = crypto
        .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET.value())
        .update(JSON.stringify(req.body))
        .digest("hex");

      if (signature !== expectedSignature) {
        return res.status(400).send("Invalid signature");
      }

      const event = req.body.event;

      if (event === "payment.captured") {
        const payment = req.body.payload.payment.entity;
        const orderId = payment.order_id;

        const snapshot = await db
          .collection("bookings")
          .where("payment.orderId", "==", orderId)
          .limit(1)
          .get();

        if (!snapshot.empty) {
          const docRef = snapshot.docs[0].ref;
          const createdAt = snapshot.docs[0].data().createdAt || Date.now();
          const expireAt = createdAt + 30 * 24 * 60 * 60 * 1000;

          await docRef.set( 
            {
              payment: {
                id: payment.id,
                status: "paid",
                webhookVerifiedAt: Date.now(),
              },
              isClosed: true,
              expireAt,
            },
            { merge: true }
          );
        }
      }

      res.status(200).json({ status: "ok" });
    } catch (error) {
      console.error("Webhook error:", error);
      res.status(500).send("Webhook error");
    }
  }
);
