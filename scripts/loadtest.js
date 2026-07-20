// Run locally: TARGET=http://192.168.8.250:30080 DURATION_S=180 CONCURRENCY=30 node loadtest.js

const TARGET = process.env.TARGET || 'http://192.168.8.250:30080';
const DURATION_S = parseInt(process.env.DURATION_S || '120', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '20', 10);

let stop = false;
let total = 0;
let errors = 0;
const servedBy = new Map();

async function worker(id) {
  const sessionId = `session-${id % 5}`;
  while (!stop) {
    try {
      const res = await fetch(`${TARGET}/?session=${sessionId}`);
      const body = await res.json();
      total += 1;
      servedBy.set(body.servedBy, (servedBy.get(body.servedBy) || 0) + 1);
    } catch (err) {
      errors += 1;
    }
  }
}

function printStats() {
  console.log(`--- total=${total} errors=${errors} ---`);
  for (const [pod, count] of servedBy) {
    console.log(`  ${pod}: ${count}`);
  }
}

Array.from({ length: CONCURRENCY }, (_, i) => worker(i));
const statsInterval = setInterval(printStats, 5000);

setTimeout(() => {
  stop = true;
  clearInterval(statsInterval);
  setTimeout(() => {
    printStats();
    process.exit(0);
  }, 1000);
}, DURATION_S * 1000);
