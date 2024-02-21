# MPC-TLS
Notarize requests by passing them through a proxy which forms an mpc tls connection to notarize data.

## How to run
1) Install dependencies by running cargo build at the root of the project
```
cargo build
```

2) Firstly we run the notary server by running
```
sh ./start_notary.sh
```

3) Secondly we start the prover server by running
```
sh ./start_prover.sh
```

4) Send a sample request to notarize
```
curl -X POST http://localhost:8080/proxy \
-H "T-PROXY-URL: https://jsonplaceholder.typicode.com/posts" \
-H "T-STORE: 0x392bd2cb87f5670f321ad521397d30a00c582b34/mpctlsproofspublic" \
-H "T-REDACTED: res:body:id,req:body:userId,res:body:userId, req:header:x-api-key" \
-H "Content-Type: application/json" \
-H "X-API-KEY: secret" \
-d '{"title": "usher", "body": "labs", "userId": 10}'
```
Note: Replace `http://localhost:8080/` with the url and port of your proxy.
Note: Replace the headers with the following to redact the all the body `-H "T-REDACTED: res:body:,res:body:" \`

You should get a response back and your request has been notarized.
