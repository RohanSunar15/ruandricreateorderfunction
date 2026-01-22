const {onRequest} = require("firebase-functions/v2/https");
const Razorpay = require("razorpay");
const {defineSecret} = require("firebase-functions/params");
const cors = require("cors");


// Allow specific origins
const corsHandler = cors({
  origin: [
    "http://localhost:8080", // local dev
    "http://localhost:5173", // vite default (just in case)
    "https://https://www.ruandricare.com", // production domain (later)
  ],
  methods: ["POST"],
});


const RAZORPAY_TEST_KEY_ID = defineSecret("RAZORPAY_TEST_KEY_ID");
const RAZORPAY_TEST_KEY_SECRET = defineSecret("RAZORPAY_TEST_KEY_SECRET");

// const RAZORPAY_KEY_ID = defineString("RAZORPAY_KEY_ID");
// const RAZORPAY_KEY_SECRET = defineString("RAZORPAY_KEY_SECRET");

exports.createOrder = onRequest(
    {
      secrets: [RAZORPAY_TEST_KEY_ID, RAZORPAY_TEST_KEY_SECRET],
    },
    async (req, res) => {
      corsHandler(req, res, async () => {
        try {
          const razorpay = new Razorpay({
            key_id: RAZORPAY_TEST_KEY_ID.value(),
            key_secret: RAZORPAY_TEST_KEY_SECRET.value(),
          });

          const {amount} = req.body;

          const order = await razorpay.orders.create({
            amount: amount * 100,
            currency: "INR",
            receipt: "receipt_" + Date.now(),
          });

          res.json(order);
        } catch (err) {
          console.error(err);
          res.status(500).json({error: err.message});
        }
      });
    },
);
