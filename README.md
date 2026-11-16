# Earthly

[![CI](https://github.com/purnimakumarr/earthly/actions/workflows/ci.yml/badge.svg)](https://github.com/purnimakumarr/earthly/actions/workflows/ci.yml)

A booking platform for small-group, low-impact expeditions across India. Travelers browse expeditions, see each route on a map, pay through Razorpay and review the trips they have taken. Guides and admins manage the catalogue through the same API.

The project is backend-first: a REST API in Node.js, Express and MongoDB, with a small React client on top.

## What the backend does

- **Authentication.** Short-lived access JWTs (15 minutes) in an httpOnly, SameSite cookie or a bearer header, bcrypt password hashing, and sessions that stop working when the password changes or the account is deactivated.
- **Refresh tokens.** A single-use refresh token, stored only as a hash, renews the session. Tokens rotate on every use; replaying an old one revokes the whole chain from that login, with a ten-second grace so two tabs refreshing at once are not mistaken for theft. The cookie is scoped to the auth endpoints, and a refresh made by cookie does not echo the tokens in the response body.
- **Email confirmation.** New accounts can browse, but booking and reviewing need a confirmed address (hashed, 24-hour, single-use link). Changing the address asks for the password again and notifies the old address.
- **Two-factor authentication.** TOTP with any authenticator app. The seed is encrypted at rest (AES-256-GCM), recovery codes are hashed and single-use, a code is accepted for one login only, five wrong codes lock the second step for 15 minutes, and a password reset does not bypass the second factor.
- **Password reset.** Single-use tokens that expire after 10 minutes. Only a SHA-256 hash of the token is stored, and the endpoint answers the same way whether or not the email exists.
- **Role-based access.** Four roles (`traveler`, `guide`, `lead`, `admin`) enforced per route. Travelers can only edit their own reviews.
- **Payments.** The server creates the Razorpay order, so the client never sets the amount. The payment is confirmed twice, by the browser callback and by a webhook, each with HMAC-SHA256 signature checks in constant time. An upsert on a unique order id makes sure the two paths produce exactly one booking.
- **Seats.** Each departure has its own seat count. A booking takes a seat with one atomic conditional update, the departure is marked sold out when the group is full, and a traveler can hold only one booking per expedition (unique index). Reviews are limited to people who booked.
- **Query API.** Filtering, range operators, sorting, field selection and pagination from the query string, shared by every list endpoint through one query builder and a generic CRUD factory.
- **Geospatial queries.** Expeditions within a radius (`$geoWithin` on a 2dsphere index) and distances from any point (`$geoNear`).
- **Aggregation.** Price and rating statistics per difficulty, departures per month, and ratings that are recalculated whenever a review is created, edited or deleted.
- **Uploads.** Images are received in memory, resized and re-encoded with sharp before they reach the disk.
- **Hardening.** Helmet with a strict Content Security Policy, rate limiting (stricter on credential endpoints), NoSQL-injection and parameter-pollution guards, body size limits, and markup stripped from free-text fields.
- **Operations.** Environment validated at startup with zod, structured JSON logs with pino, a health endpoint, graceful shutdown, a Docker image and CI.

## Architecture

```mermaid
flowchart LR
  Browser[React client] -->|/api/v1, session cookie| API[Express API]
  Razorpay -->|signed webhook| API
  Browser -->|Checkout| Razorpay
  API --> Mongo[(MongoDB)]
  API --> SMTP[SMTP provider]
  API --> Disk[(uploads/)]
```

```
src/
  server.js        process start-up, DB connection, graceful shutdown
  app.js           middleware pipeline and route mounting
  config/          validated environment, logger
  routes/          one router per resource
  middleware/      auth, uploads, error handler
  controllers/     request handlers, plus the generic CRUD factory
  models/          Mongoose schemas, hooks and indexes
  services/        Razorpay client and signature checks
  utils/           QueryBuilder, ApiError, asyncHandler, mailer
  emails/          transactional email templates
client/            React + Vite + Tailwind single-page app
seed/              demo data and the seed script
tests/             Jest + Supertest integration tests
docs/openapi.yaml  API reference, served at /api/docs
```

In production the API also serves the built client, so the whole thing is one deployable on one origin.

## Run it locally

### With Docker

```bash
docker compose up --build
```

This starts MongoDB, loads the demo data and serves the site at <http://localhost:3000>. Payments need Razorpay test keys; everything else works without any configuration.

### Without Docker

Requires Node 22 and a MongoDB instance (local or Atlas).

```bash
cp .env.example .env        # then fill in MONGODB_URI and JWT_SECRET
npm install
npm install --prefix client
npm run seed                # load demo data
npm run dev                 # API on :3000, client on :5173
```

Open <http://localhost:5173>.

### Demo accounts

Every seeded account uses the password `earthly-demo-2026`.

| Role     | Email                    |
| -------- | ------------------------ |
| Traveler | `kavya@example.com`      |
| Guide    | `rohan@earthly.example`  |
| Lead     | `tenzin@earthly.example` |
| Admin    | `admin@earthly.example`  |

For payments, use a [Razorpay test card](https://razorpay.com/docs/payments/payments/test-card-details/).

The admin account also gets a **Manage** area in the site header for editing expeditions, bookings, reviews and users. Seeded accounts have a confirmed email. Accounts you sign up yourself need to follow the confirmation link before they can book or review; without SMTP settings, the link is written to the API log in development instead of being emailed.

### Known limit

Seats are taken when the payment is confirmed, not when checkout opens. If two people pay for the last seat at the same moment, both bookings are recorded and the second is logged for a refund. It is stored as `overbooked`, so cancelling it does not free a seat it never held.

Recording a payment is two writes (the booking, then the seat) and not a transaction, because transactions need a replica set. If the server stops between them, the next webhook retry from Razorpay finishes the seat step.

## API reference

Interactive documentation is served at [`/api/docs`](http://localhost:3000/api/docs) from [`docs/openapi.yaml`](docs/openapi.yaml). A few examples:

```bash
# Easy expeditions under ₹40,000, cheapest first, two fields only
curl "localhost:3000/api/v1/expeditions?difficulty=easy&price[lte]=40000&sort=price&fields=name,price"

# Expeditions that start within 300 km of Guwahati
curl "localhost:3000/api/v1/expeditions/nearby?latlng=26.1445,91.7362&distance=300&unit=km"

# Price and rating summary per difficulty
curl "localhost:3000/api/v1/expeditions/stats"
```

## Tests

```bash
npm test
```

129 integration tests run the real Express app against an in-memory MongoDB. They cover the authentication and reset flows, refresh-token rotation and reuse detection, email confirmation, two-factor login and recovery codes, role checks, the query API, geospatial and aggregation endpoints, rating recalculation, seat counting and sold-out departures, and the payment path, including forged signatures and the webhook and browser reporting the same payment at once.

## Deploying

The repository includes a `Dockerfile` and a `render.yaml` blueprint for [Render](https://render.com), with MongoDB Atlas as the database.

1. Create a free Atlas cluster and copy its connection string.
2. On Render, create a Blueprint from this repository and fill in the environment variables it asks for (see `.env.example`).
3. Run `npm run seed` once with `MONGODB_URI` pointing at Atlas.
4. In the Razorpay dashboard, add a webhook for `payment.captured` pointing to `https://<your-host>/api/v1/webhooks/razorpay` and set the same secret as `RAZORPAY_WEBHOOK_SECRET`.

Uploaded photos are stored on the instance's disk and are lost on redeploy on a free plan; object storage is the next step.

## Tech stack

Node.js, Express, MongoDB, Mongoose, JSON Web Tokens, Razorpay, sharp, Nodemailer, zod, pino, Jest, Supertest, React, Vite, Tailwind CSS, Leaflet, Docker, GitHub Actions.

## Credits

Expedition photos are from Wikimedia Commons under Creative Commons licences; see [CREDITS.md](CREDITS.md). Map tiles © OpenStreetMap contributors. The expeditions, people and reviews are fictional.
