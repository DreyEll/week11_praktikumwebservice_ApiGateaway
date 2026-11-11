
const path = require("path");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { createProxyMiddleware } = require("http-proxy-middleware");
const swaggerUi = require("swagger-ui-express");
const openapi = require("../openapi.json");

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const amqp = require("amqplib");

// ===============================
// CONFIG
// ===============================

const PORT = 3000;
const AMQP_URL = process.env.AMQP_URL || "amqp://localhost";

const GRAPHQL_URL =
  process.env.GRAPHQL_URL || "http://127.0.0.1:8080";

const GRPC_ADDR =
  process.env.GRPC_ADDR || "127.0.0.1:50051";

const LIMIT = Number(process.env.RATE_LIMIT_MAX || 5);

const WINDOW_MS = Number(
  process.env.RATE_LIMIT_WINDOW_MS || 60000
);

// ===============================
// gRPC CLIENT
// ===============================

const PROTO_PATH = path.join(
  __dirname,
  "..",
  "grpc-service",
  "lagu.proto"
);

const def = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  defaults: true
});

const music = grpc.loadPackageDefinition(def).music;

const laguClient = new music.LaguService(
  GRPC_ADDR,
  grpc.credentials.createInsecure()
);

let channel = null;

// ===============================
// RABBITMQ
// ===============================

async function connectQueue() {
  try {
    const conn = await amqp.connect(AMQP_URL);

    conn.on("error", () => {});

    conn.on("close", () => {
      channel = null;
      setTimeout(connectQueue, 3000);
    });

    channel = await conn.createChannel();

    await channel.assertExchange("orders", "fanout", {
      durable: true
    });

    console.log("Gateway terhubung ke RabbitMQ");
  } catch (error) {
    console.warn("RabbitMQ belum tersedia, retry dalam 3 detik");
    setTimeout(connectQueue, 3000);
  }
}

function publishLaguRequested(lagu) {
  if (!channel) {
    console.warn(
      "Channel RabbitMQ tidak tersedia, event tidak terkirim:",
      lagu.id
    );
    return false;
  }

  const payload = {
    type: "lagu.requested",
    data: {
      id: lagu.id,
      judul: lagu.judul,
      album_id: lagu.album_id,
      requestedAt: new Date().toISOString()
    }
  };

  return channel.publish(
    "orders",
    "",
    Buffer.from(JSON.stringify(payload)),
    {
      persistent: true,
      contentType: "application/json",
      messageId: `lagu-${lagu.id}-${Date.now()}`
    }
  );
}

// ===============================
// EXPRESS
// ===============================

const app = express();

// ===============================
// SWAGGER DOCUMENTATION
// ===============================

app.use(
  "/docs",
  swaggerUi.serve,
  swaggerUi.setup(openapi)
);

app.get("/openapi.json", (req, res) => {
  res.json(openapi);
});

// ===============================
// RATE LIMIT
// ===============================

app.use(
  rateLimit({
    windowMs: WINDOW_MS,
    limit: LIMIT,
    standardHeaders: true,
    legacyHeaders: false,

    handler: (req, res) => {
      res.status(429).json({
        error: "Too Many Requests",
        message:
          `Batas ${LIMIT} request per ` +
          `${WINDOW_MS / 1000} detik terlampaui.`
      });
    }
  })
);

// ===============================
// HEALTH CHECK
// ===============================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    gateway: true
  });
});

// ===============================
// DEMO ERROR 409 CONFLICT
// ===============================

app.post("/test-conflict", (req, res) => {
  res.status(409).json({
    error: "Conflict",
    message: "Data sudah tersedia"
  });
});

// ===============================
// DEMO SCHEMA DRIFT
// ===============================

// Response menggunakan title,
// sedangkan schema lama menggunakan judul.

app.get("/test-schema-drift", (req, res) => {
  res.json({
    id: 1,
    title: "Mock Lagu",
    album_id: 1
  });
});

// ===============================
// GRAPHQL SERVICE
// ===============================

app.use(
  "/graphql",
  createProxyMiddleware({
    target: GRAPHQL_URL,
    changeOrigin: true,

    pathRewrite: (path, req) => {
      return "/graphql";
    }
  })
);

// ===============================
// gRPC SERVICE
// REST -> gRPC
// ===============================

app.get("/grpc/lagu/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (Number.isNaN(id)) {
    return res.status(400).json({
      error: "id harus angka"
    });
  }

  laguClient.GetLagu(
    { id },

    (err, lagu) => {
      if (err) {
        let status = 500;

        if (err.code === grpc.status.NOT_FOUND) {
          status = 404;
        }

        if (err.code === grpc.status.UNAVAILABLE) {
          status = 503;
        }

        return res.status(status).json({
          error: err.details || err.message
        });
      }

      const eventPublished = publishLaguRequested(lagu);

      if (eventPublished) {
        console.log(
          `Event lagu.requested dipublikasikan untuk lagu #${lagu.id}`
        );
      }

      res.json(lagu);
    }
  );
});

// ===============================
// ROUTE TIDAK DITEMUKAN
// ===============================

app.use((req, res) => {
  res.status(404).json({
    error: "Route tidak ditemukan di gateway"
  });
});

// ===============================
// START
// ===============================

app.listen(PORT, () => {
  connectQueue();

  console.log(
    `Gateway berjalan di http://localhost:${PORT}`
  );

  console.log(
    `Swagger UI: http://localhost:${PORT}/docs`
  );

  console.log(
    `/graphql -> ${GRAPHQL_URL}/graphql`
  );

  console.log(
    `/grpc/lagu/:id -> gRPC ${GRPC_ADDR}`
  );

  console.log(
    `Rate limit: ${LIMIT} request / ${
      WINDOW_MS / 1000
    } detik`
  );
});
