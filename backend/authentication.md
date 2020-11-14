---
description: Just a few notes. Not complete...
---

# API Authentication

**Developer:**  
if server host is localhost  
**then allow access, return additional debugging data**

**Client:**  
client from whitelisted RapidAPI IP  
**allow access**

To do this, you must first verify the Client's IP address. Do not trust headers. Instead...

```text
import RequestIp from "@supercharge/request-ip"
const { getClientIp } = RequestIp

expressApp.use(function (req, res, next) {
  req.headers.client_ip = getClientIp(req)
  next()
})
```

Then, validate that `req.headers.client_ip` is from a whitelisted IP.

This is with RapidAPI. Very easy! Standalone API authentication is much more complex.







