## Bitespeed Backend Task – Identity Reconciliation

This repository implements the **Identity Reconciliation** backend for FluxKart.com, following the Bitespeed assignment PDF.

### Tech Stack

- **Runtime**: Node.js
- **Backend**: Express
- **Database**: MongoDB (via Mongoose)
- **Environment**: `.env` file for configuration

> Note: The PDF suggests “any SQL database”, but this implementation uses MongoDB as part of a MERN-style stack, as requested.

---

### Data Model

Collection: `contacts`

- `phoneNumber: string | null`
- `email: string | null`
- `linkedId: ObjectId | null` – points to the **primary** contact’s `_id` when this contact is **secondary**
- `linkPrecedence: "primary" | "secondary"`
- `createdAt: Date`
- `updatedAt: Date`
- `deletedAt: Date | null`

All of this is defined in `index.js` using a Mongoose schema.

---

### `/identify` Endpoint

- **Method**: `POST`
- **Path**: `/identify`
- **Body (JSON)** – exactly as specified in the PDF:

```json
{
  "email": "string or null",
  "phoneNumber": "string or null"
}
```

At least **one** of `email` or `phoneNumber` must be non-null / non-empty. The server **expects JSON body, not form-data**.

#### Response (HTTP 200)

```json
{
  "contact": {
    "primaryContatctId": "string",
    "emails": ["primary@example.com", "other@example.com"],
    "phoneNumbers": ["1234567890", "9876543210"],
    "secondaryContactIds": ["...", "..."]
  }
}
```

- `primaryContatctId`: `_id` of the **primary** contact (as a string).
- `emails`: **unique** emails for this user, with the primary contact’s email first (if present).
- `phoneNumbers`: **unique** phone numbers for this user, with the primary contact’s phone first (if present).
- `secondaryContactIds`: array of `_id`s (strings) for all **secondary** contacts linked to the primary.

---

### Reconciliation Rules (from the PDF, implemented in code)

The logic in `index.js` (function `reconcileContacts`) follows these rules:

- If **no existing contacts** exist with the given `email` or `phoneNumber`:
  - Create a **new Contact** with `linkPrecedence = "primary"`.
  - Return it as the primary with `secondaryContactIds: []`.

- If there **are existing contacts** sharing this `email` or `phoneNumber`:
  - Load all related contacts (same email/phone or linked via `linkedId`).
  - Pick the **oldest** contact (by `createdAt`) among those marked `linkPrecedence = "primary"` as the **canonical primary**.
  - Normalize:
    - Every other contact in the group is updated to `linkPrecedence = "secondary"` and `linkedId = primary._id`.
  - If the incoming `email` or `phoneNumber` is **new** to this group (not present on any existing contact):
    - Create a new **secondary** contact with that new information, linked to the primary.

The final response aggregates all emails, phone numbers, and secondary IDs from this unified group.

This covers:

- Example where a **secondary contact is created** when new info arrives with a shared phone/email.
- Example where **two primaries get merged**, and the younger primary becomes secondary.

---

### Running Locally

1. **Install dependencies**

```bash
npm install
```

2. **Create `.env` file** (in the project root), based on `.env.example`:

```bash
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/bitespeed_identity
```

3. **Start MongoDB**

- Run a local MongoDB instance, or change `MONGO_URI` to a cloud connection string (e.g. MongoDB Atlas).

4. **Run the server**

```bash
npm run dev
# or
npm start
```

You should see:

- `Server is running on port 3000`
- `Connected to MongoDB`

---

### Example Requests

#### 1. New customer (no existing contact)

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "lorraine@hillvalley.edu", "phoneNumber": "123456"}'
```

This creates a **primary** contact with those details and returns it.

#### 2. Same phone, new email → create secondary

Later, Doc orders with:

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "mcfly@hillvalley.edu", "phoneNumber": "123456"}'
```

Now the response will consolidate:

- Primary = first created contact
- Emails = `["lorraine@hillvalley.edu", "mcfly@hillvalley.edu"]`
- PhoneNumbers = `["123456"]`
- SecondaryContactIds = `[id_of_secondary]`

The same consolidated response is returned if you call `/identify` with:

- `{ "email": null, "phoneNumber": "123456" }`
- `{ "email": "lorraine@hillvalley.edu", "phoneNumber": null }`
- `{ "email": "mcfly@hillvalley.edu", "phoneNumber": null }`

#### 3. Two primaries becoming one primary and one secondary

If:

- Contact A: `("george@hillvalley.edu", "919191")` (primary)
- Contact B: `("biffsucks@hillvalley.edu", "717171")` (primary)

Then this request:

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "george@hillvalley.edu", "phoneNumber": "717171"}'
```

Will result in:

- Oldest primary stays **primary**.
- Newer primary is converted to **secondary** with `linkedId` pointing to the oldest.
- Response contains both emails, both phone numbers, and the secondary’s id.

---

### Hosting Instructions (Render or similar)

The PDF requires you to **host** the `/identify` endpoint and put its URL in this README.

1. **Push this repo to GitHub** (already configured for `https://github.com/hemant5037/BiteSpeedAssignment`).
2. **Create a MongoDB instance** (MongoDB Atlas or any hosted Mongo).
3. **Deploy on Render.com** (or any Node hosting):
   - Create a new Web Service.
   - Point it to this GitHub repo.
   - Set **Build Command**: `npm install`
   - Set **Start Command**: `npm start`
   - Add environment variables:
     - `PORT` (Render will often inject this automatically)
     - `MONGO_URI` (your hosted Mongo connection string)
4. **After deployment**, you’ll get a live URL, for example:

```text
https://your-bitespeed-service.onrender.com/identify
```

Update this README with your actual deployed endpoint URL here:

- **Live `/identify` endpoint**: `<YOUR_DEPLOYED_URL_HERE>`

You can then submit this URL in the Bitespeed task submission form.

