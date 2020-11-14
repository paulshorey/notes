---
description: Just a few notes. Not complete...
---

# RapidAPI Authentication

**Developer access:**  
if server is being hosted on a MacBook, or has some admin secret token cookie,  
**allow admin access, return additional debugging data**

**Client:**  
if client request is coming from an official whitelisted RapidAPI IP,  
**allow client access**

To do this, you must first verify the Client's IP address, and also your own server's hostname.   
**Do not trust headers! Instead...**

```text
import RequestIp from "@supercharge/request-ip"
const { getClientIp } = RequestIp
import os from "os"
const os_platform = os.platform() // or use os.hostname()
const host_is_dev = os_platform==='darwin' // or whatever

expressApp.use(function (req, res, next) {
  req.client_ip = getClientIp(req)
  req.host_is_dev = host_is_dev
  next()
})
```

Then, validate that `req.clientIp` is one of your whitelisted IPs. For development, allow admin access if `req.host_is_dev`. 

This is with RapidAPI. Very very easy! Standalone API authentication needs much more work.

## Authenticate API endpoint:

```text
if (req.headers["x-rapidapi-user"] === "wordio") {
  /*
   * B2C website (free access) - use captcha
   */
  let user = await auth_captcha(req, {})
  if (user instanceof Error) {
    http_response(res, 500, user)
  }
  if (user) {
    response.auth_expires = user.expires
    response.user_id = user.id
    response.user_is_local = user.is_local
  }
} else {
  /*
   * B2B client (paid access) - only allow RapidAPI whitelisted IPs
   */
  let user = await auth_rapidapi(req, {})
  if (user instanceof Error) {
    http_response(res, 500, user)
  }
  if (user) {
    // ok, you may pass
  }
}
```

## Unrelated note:

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
  let client_ip = req.client_ip
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



