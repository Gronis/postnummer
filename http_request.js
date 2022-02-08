const http = require('http');
const https = require('https');

const http_request = (url, options) => {
  url = new URL(url);
  options = options || {};
  const secure = (url.protocol != null && url.protocol.includes('https')) || url.port == 443;
  const body = options.body
  const opts = {
    hostname: url.hostname,
    port: url.port || (secure? 443 : 80),
    path: url.pathname + url.search,
    method: options.method || 'GET',
    headers: {
      'Accept': '*/*',
      'Content-Length': Buffer.byteLength(body || ''),
      ...(options.headers || {})
    }
  };
  const module = secure? https : http;
  
  return new Promise((resolve, reject) => {
    const req = module.request(opts, (res) => {
      let response = {}
      let body = []
      if(!options.buffer){
        res.setEncoding(options.encoding || 'utf8');
      }
      res.on('data', (chunk) => {
        body.push(chunk);
      });
      res.on('end', () => {
        if(options.buffer){
          response.body = Buffer.concat(body);
        } else {
          response.body = body.join('');
        }
        response.statusCode = res.statusCode;
        response.headers = res.headers;
        if(300 <= res.statusCode && res.statusCode < 400 && response.headers.location){
          http_request(new URL(response.headers.location, url))
              .then(r => resolve(r))
              .catch(reject)
        } else {
            resolve(response)
        }
      });
    });

    // Debug:
    // console.log("REQUEST", options)
    
    req.on('error', (e) => {
      reject(`problem with request: ${e.message}`);
    });
    if(body){
      req.write(body);
    }
    req.end();
  })
}

module.exports = http_request;