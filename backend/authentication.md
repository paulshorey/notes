---
description: Just a few notes. Not complete...
---

# RapidAPI Authentication

**Developer:**  
if server host is localhost  
**then allow admin access, return additional debugging data**

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

Then, validate that `req.headers.client_ip` is from a whitelisted IP.

This is with RapidAPI. Very easy! Standalone API authentication is much more complex.







