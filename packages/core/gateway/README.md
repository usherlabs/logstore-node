# HTTP Gateway

An nginx template describing the mapping of the several development ports. Running this gateway exposes several internal components running on different ports via a unified point of entry.
There are several lines marked as TODO, where the values should be changed from default values to custom values depending on the use case.


## Checklist
- [ ] Generate ssl credentials and place them in the fixtures directory as indicated [here](https://www.notion.so/usherlabs/Notary-Keys-in-Production-b3ca251315254653a15d029474ecb6d9)
- [ ] Complete the TODOs in `./Dockerfile`
- [ ] Complete the TODO's in `./network.conf` or `./standalone.conf`
- [ ] Run `docker compose build`
- [ ] Run `docker compose up`
  
Running this nginx server should map the internal ports to standard ports i.e 80, 443, 7074.