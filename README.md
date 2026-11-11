# API Gateway 

Satu pintu masuk (port 3000) untuk dua service music-api: GraphQL (8080) dan gRPC (50051), dengan rate limiting.

| Gateway (port 3000) | Diteruskan ke |
|---|---|
| POST /graphql | GraphQL music-api, http://localhost:8080/graphql (reverse proxy) |
| GET /grpc/lagu/:id | gRPC LaguService.GetLagu di localhost:50051 (REST -> gRPC) |
| GET /health | dijawab gateway |

## Menjalankan
1. Jalankan music-api: `go run .` (HTTP 8080 dan gRPC 50051)
2. `npm install` lalu `npm start`
(Tanpa database: `npm run mock` menjalankan tiruan kedua service.)

Env: `GRAPHQL_URL`, `GRPC_ADDR`, `RATE_LIMIT_MAX` (default 5), `RATE_LIMIT_WINDOW_MS` (default 60000).

## Postman
- POST http://localhost:3000/graphql, Body raw JSON: `{"query":"{ lagu { id judul } }"}`
- GET http://localhost:3000/grpc/lagu/1

## Uji rate limiting
Restart gateway (reset hitungan), lalu `npm run test:ratelimit`.

## Event Asinkron dengan RabbitMQ

Untuk tugas lab asinkron, gateway tidak lagi menunggu proses notifikasi. Ketika request lagu berhasil diproses di endpoint `/grpc/lagu/:id`, gateway mempublikasikan event `lagu.requested` ke exchange `orders` dan consumer `notification-service` menangkapnya dari queue `notification-queue`.

### Producer dan consumer
- Producer: gateway
- Consumer: notification-service
- Event: `lagu.requested`
- Payload contoh:

```json
{
  "type": "lagu.requested",
  "data": {
    "id": 1,
    "judul": "Mock Lagu",
    "album_id": 1,
    "requestedAt": "2026-11-04T00:00:00.000Z"
  }
}
```

### Menjalankan consumer
```powershell
cd "C:\Documents\Kuliahh Uyy\Infor Smt 5\Prak Web Service\gateway-project"
$env:AMQP_URL = "amqps://<user>:<password>@<host>/<vhost>"
npm run consumer
```

### Variasi crash
```powershell
cd "C:\Documents\Kuliahh Uyy\Infor Smt 5\Prak Web Service\gateway-project"
$env:AMQP_URL = "amqps://<user>:<password>@<host>/<vhost>"
npm run consumer:crash
```

### Langkah uji RabbitMQ tanpa Docker (PowerShell)

1. Pastikan broker RabbitMQ sudah aktif dan bisa diakses dari mesin Anda.
   - Bisa menggunakan RabbitMQ lokal non-Docker.
   - Bisa juga menggunakan CloudAMQP / broker eksternal.

2. Set environment variable broker di terminal yang sama:
```powershell
cd "C:\Documents\Kuliahh Uyy\Infor Smt 5\Prak Web Service\gateway-project"
$env:AMQP_URL = "amqps://exucowsr:nSc-DydmW6-hey01YFTYP_snHn5qAOP-@armadillo.rmq.cloudamqp.com/exucowsr"
npm run consumer
```

3. Jalankan mock backend agar gateway punya service target:
```powershell
npm run mock
```

4. Jalankan gateway:
```powershell
npm start
```

5. Jalankan consumer di terminal baru dengan env yang sama:
```powershell
cd "C:\Documents\Kuliahh Uyy\Infor Smt 5\Prak Web Service\gateway-project"
$env:AMQP_URL = "amqps://exucowsr:nSc-DydmW6-hey01YFTYP_snHn5qAOP-@armadillo.rmq.cloudamqp.com/exucowsr"
npm run consumer
```

6. Kirim 3 request ke gateway supaya queue terisi:
```powershell
curl http://localhost:3000/grpc/lagu/1
curl http://localhost:3000/grpc/lagu/1
curl http://localhost:3000/grpc/lagu/1
```

7. Matikan consumer (Ctrl + C), lalu cek dashboard broker Anda.
   - Queue `notification-queue` harus menampung pesan.
   - Kondisi yang diharapkan: `Ready = 3` dan `Unacked = 0`.

8. Hidupkan consumer lagi:
```powershell
npm run consumer
```

9. Log yang diharapkan setelah consumer aktif kembali:
```text
[notification-queue] menunggu event...
[notification-queue] notifikasi terkirim: lagu #1 Mock Lagu (album 1)
[notification-queue] notifikasi terkirim: lagu #1 Mock Lagu (album 1)
[notification-queue] notifikasi terkirim: lagu #1 Mock Lagu (album 1)
```

### Uji crash dan duplikasi email

1. Jalankan consumer dengan mode crash di terminal baru dengan env aktif:
```powershell
cd "C:\Documents\Kuliahh Uyy\Infor Smt 5\Prak Web Service\gateway-project"
$env:AMQP_URL = "amqps://exucowsr:nSc-DydmW6-hey01YFTYP_snHn5qAOP-@armadillo.rmq.cloudamqp.com/exucowsr"
npm run consumer:crash
```

2. Kirim 1 request ke gateway:
```powershell
curl http://localhost:3000/grpc/lagu/1
```

3. Consumer akan menampilkan log seperti:
```text
[notification-queue] notifikasi terkirim: lagu #1 Mock Lagu (album 1)
Crash sebelum ACK!
```

4. Setelah itu, jalankan consumer normal lagi di terminal baru:
```powershell
cd "C:\Documents\Kuliahh Uyy\Infor Smt 5\Prak Web Service\gateway-project"
$env:AMQP_URL = "amqps://exucowsr:nSc-DydmW6-hey01YFTYP_snHn5qAOP-@armadillo.rmq.cloudamqp.com/exucowsr"
npm run consumer
```

5. Log yang menunjukkan email terkirim dua kali:
```text
[notification-queue] notifikasi terkirim: lagu #1 Mock Lagu (album 1)
[notification-queue] notifikasi terkirim: lagu #1 Mock Lagu (album 1)
```

Ini membuktikan bahwa sistem menggunakan at-least-once delivery. Karena `ack` tidak pernah dikirim saat crash, RabbitMQ akan redeliver pesan dan consumer baru akan memprosesnya lagi. Dengan kata lain, email/notifikasi bisa terkirim dua kali jika tidak ada mekanisme idempotency.

## Swagger UI dan OpenAPI

Swagger UI digunakan untuk melihat dokumentasi API Gateway secara interaktif dan mencoba endpoint secara langsung.

### Menjalankan Swagger

1. Install dependency Swagger UI:

```bash
npm install swagger-ui-express
```

2. Pastikan file `openapi.json` tersedia di folder utama project.

3. Jalankan API Gateway:

```bash
npm start
```

4. Buka dokumentasi Swagger melalui browser:

http://localhost:3000/docs

### Endpoint Dokumentasi

- `GET /docs` - Menampilkan Swagger UI.
- `GET /openapi.json` - Menampilkan dokumentasi OpenAPI dalam format JSON.

### Pengujian Error 409 Conflict

1. Buka Swagger UI.
2. Pilih endpoint `POST /test-conflict`.
3. Klik Try it out.
4. Klik Execute.
5. Periksa response yang menunjukkan HTTP 409 Conflict.

