---
description: Just a few notes. Not complete...
---

# RapidAPI Authentication

**Developer:**  
if server host === "Paul-Shoreys-MacBook-Pro.local" or whatever  
**allow admin access, return additional debugging data**

**Client:**  
if request coming from one of the official whitelisted RapidAPI IPs,  
**allow client access**

To do this, you must first verify the Client's IP address, and also your own server's hostname.   
**Do not trust headers! Instead...**

```text
import RequestIp from "@supercharge/request-ip"
const { getClientIp } = RequestIp
import os from "os"
const hostname = os.hostname()

expressApp.use(function (req, res, next) {
  req.clientIp = getClientIp(req)
  req.hostname = hostname
  next()
})
```

Then, validate that `req.clientIp` is one of your whitelisted IPs. For development, validate that `req.hostname` is the name of your development machine. 

This is with RapidAPI. Very very easy! Standalone API authentication is much more work.

## TL;DR

Detect if client is localhost, on local or corporate network...

```text
  /*
   *
   * DETECT LOCAL CLIENT
   * 10.x.x.x (Class A, large business private network)
   * 172.16.x.x (Class B, small-medium business private network)
   * 192.168.0.x (Class C, home single router private network)
   * 127.x.x.x (localhost)
   *
   */
  let client_ip = req.clientIp
  let client_ip_7 = client_ip.substr(0, 7)
  // if ipv6, cut off prefix, convert to ipv4
  if (client_ip_7 === "::ffff:") {
    client_ip = client_ip.substr(7)
    client_ip_7 = client_ip.substr(0, 7)
  }
  let client_ip_3 = client_ip.substr(0, 3)
  user.is_local =
    client_ip_7 === "192.168" || client_ip_7 === "172.16." || client_ip_3 === "127" || client_ip_3 === "10."
```



