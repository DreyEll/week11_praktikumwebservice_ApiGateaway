const amqp = require('amqplib');

const AMQP_URL = process.env.AMQP_URL || 'amqp://localhost';
const QUEUE = process.argv.slice(2).find((arg) => !arg.startsWith('--')) || 'notification-queue';
const CRASH = process.argv.includes('--crash');
const processed = new Set();

async function main() {
  const conn = await amqp.connect(AMQP_URL);
  const ch = await conn.createChannel();

  await ch.assertExchange('orders', 'fanout', { durable: true });
  await ch.assertQueue(QUEUE, { durable: true });
  await ch.bindQueue(QUEUE, 'orders', '');
  ch.prefetch(1);

  console.log(`[${QUEUE}] menunggu event...`);

  ch.consume(QUEUE, async (msg) => {
    if (!msg) return;

    let event;
    try {
      event = JSON.parse(msg.content.toString());
    } catch (error) {
      console.error('Pesan rusak, dibuang');
      return ch.nack(msg, false, false);
    }

    const id = msg.properties.messageId;
    if (processed.has(id)) {
      console.log('Duplikat, dilewati:', id);
      return ch.ack(msg);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log(
      `[${QUEUE}] notifikasi terkirim: lagu #${event.data.id} ${event.data.judul} (album ${event.data.album_id})`
    );

    processed.add(id);

    if (CRASH) {
      console.log('Crash sebelum ACK!');
      process.exit(1);
    }

    ch.ack(msg);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
