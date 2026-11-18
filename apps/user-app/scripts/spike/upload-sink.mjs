// F2 native media spike (plan Task 20): a local stand-in for a presigned R2 PUT, used when the R2 keys aren't set.
// Accepts PUT /spike-upload, counts the streamed bytes, answers 200 and logs size, content type and chunk count, so the
// app's createUploadTask check (binary body, Content-Type kept, progress events) can run without storage.
//
//   node apps/user-app/scripts/spike/upload-sink.mjs [port=8099]
//   adb reverse tcp:8099 tcp:8099     (the device then reaches it as http://localhost:8099/spike-upload)

import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8099);

createServer((req, res) => {
  if (req.method !== 'PUT' || req.url !== '/spike-upload') {
    res.writeHead(404).end();
    return;
  }
  let bytes = 0;
  let chunks = 0;
  req.on('data', (c) => { bytes += c.length; chunks += 1; });
  req.on('end', () => {
    console.log(JSON.stringify({
      at: new Date().toISOString(), bytes, chunks, contentType: req.headers['content-type'] ?? null,
      contentLength: req.headers['content-length'] ?? null, transferEncoding: req.headers['transfer-encoding'] ?? null,
    }));
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
  });
}).listen(port, () => console.log(`upload sink on :${port} (PUT /spike-upload)`));
