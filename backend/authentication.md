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







