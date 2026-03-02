require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/bitespeed_identity";

mongoose
  .connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    // eslint-disable-next-line no-console
    console.log("Connected to MongoDB");
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("MongoDB connection error:", err.message);
  });

const contactSchema = new mongoose.Schema(
  {
    phoneNumber: { type: String, default: null },
    email: { type: String, default: null },
    linkedId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", default: null },
    linkPrecedence: {
      type: String,
      enum: ["primary", "secondary"],
      default: "primary",
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } }
);

const Contact = mongoose.model("Contact", contactSchema);

function unique(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (item == null) continue;
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

async function reconcileContacts(email, phoneNumber) {
  if (!email && !phoneNumber) {
    const error = new Error("At least one of email or phoneNumber must be provided");
    error.status = 400;
    throw error;
  }

  const baseQuery = { deletedAt: null };
  if (email && phoneNumber) {
    baseQuery.$or = [{ email }, { phoneNumber }];
  } else if (email) {
    baseQuery.email = email;
  } else if (phoneNumber) {
    baseQuery.phoneNumber = phoneNumber;
  }

  const existing = await Contact.find(baseQuery).sort({ createdAt: 1 }).exec();

  if (existing.length === 0) {
    const created = await Contact.create({
      email: email || null,
      phoneNumber: phoneNumber || null,
      linkPrecedence: "primary",
    });

    return {
      primary: created,
      allContacts: [created],
    };
  }

  const candidateIds = new Set();
  existing.forEach((c) => {
    candidateIds.add(c._id.toString());
    if (c.linkedId) candidateIds.add(c.linkedId.toString());
  });

  const idArray = Array.from(candidateIds).map((id) => new mongoose.Types.ObjectId(id));

  const allContacts = await Contact.find({
    deletedAt: null,
    $or: [{ _id: { $in: idArray } }, { linkedId: { $in: idArray } }],
  })
    .sort({ createdAt: 1 })
    .exec();

  let primary = allContacts[0];
  allContacts.forEach((c) => {
    if (c.linkPrecedence === "primary" && c.createdAt < primary.createdAt) {
      primary = c;
    }
  });

  const bulkOps = [];
  allContacts.forEach((c) => {
    if (c._id.toString() === primary._id.toString()) return;
    if (c.linkPrecedence !== "secondary" || !c.linkedId || c.linkedId.toString() !== primary._id.toString()) {
      bulkOps.push({
        updateOne: {
          filter: { _id: c._id },
          update: {
            $set: {
              linkPrecedence: "secondary",
              linkedId: primary._id,
            },
          },
        },
      });
    }
  });

  if (bulkOps.length > 0) {
    await Contact.bulkWrite(bulkOps);
  }

  const alreadyHasEmail =
    email && allContacts.some((c) => c.email === email);
  const alreadyHasPhone =
    phoneNumber && allContacts.some((c) => c.phoneNumber === phoneNumber);

  if ((email && !alreadyHasEmail) || (phoneNumber && !alreadyHasPhone)) {
    const newSecondary = await Contact.create({
      email: email || null,
      phoneNumber: phoneNumber || null,
      linkPrecedence: "secondary",
      linkedId: primary._id,
    });
    allContacts.push(newSecondary);
  }

  return { primary, allContacts };
}

app.post("/identify", async (req, res) => {
  const { email = null, phoneNumber = null } = req.body || {};

  try {
    const { primary, allContacts } = await reconcileContacts(email, phoneNumber);

    const emailsAll = unique(allContacts.map((c) => c.email));
    const phoneNumbersAll = unique(allContacts.map((c) => c.phoneNumber));

    const emails =
      primary.email && emailsAll.includes(primary.email)
        ? [primary.email, ...emailsAll.filter((e) => e !== primary.email)]
        : emailsAll;

    const phoneNumbers =
      primary.phoneNumber && phoneNumbersAll.includes(primary.phoneNumber)
        ? [primary.phoneNumber, ...phoneNumbersAll.filter((p) => p !== primary.phoneNumber)]
        : phoneNumbersAll;

    const secondaryContactIds = allContacts
      .filter((c) => c._id.toString() !== primary._id.toString())
      .map((c) => c._id.toString());

    res.status(200).json({
      contact: {
        primaryContactId: primary._id.toString(),
        emails,
        phoneNumbers,
        secondaryContactIds,
      },
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      error: err.message || "Unable to process identify request",
    });
  }
});

app.get("/", (_req, res) => {
  res.send(
    `
<h1>Bitespeed Identity Reconciliation</h1>
<p><strong>Bitespeed Identity Reconciliation service (Node/Express + MongoDB) is running.</strong></p>
<p>Service is running on Render.</p>

<h2>How to test the <code>/identify</code> API</h2>

<h3>1. Using Postman</h3>
<ol>
  <li>Method: <strong>POST</strong></li>
  <li>URL: <code>https://bitespeedassignment-38fh.onrender.com/identify</code></li>
  <li>Header: <code>Content-Type: application/json</code></li>
  <li>Body (raw JSON), for example:
    <pre>{
  "email": "lorraine@hillvalley.edu",
  "phoneNumber": "123456"
}</pre>
  </li>
</ol>

<h3>2. Using curl</h3>
<pre>curl -X POST https://bitespeedassignment-38fh.onrender.com/identify \\
  -H "Content-Type: application/json" \\
  -d '{"email":"lorraine@hillvalley.edu","phoneNumber":"123456"}'</pre>

<p>You should receive a JSON response with <code>primaryContactId</code>, <code>emails</code>, <code>phoneNumbers</code> and <code>secondaryContactIds</code>.</p>
`
  );
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server is running on port ${PORT}`);
});

