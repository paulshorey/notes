---
description: Just a few notes. Not complete...
---

# API Authentication

**Developer:**  
if server is localhost, port &gt; 80, client is also localhost port &gt; 80  
if in production, client header x-rapidapi-user === "wordio"  
**then allow access, return additional debugging data**

**Client:**  
if server is port 80, client from whitelisted RapidAPI IP,   
**allow access**

What if client spoofs domain/IP, fake RapidAPI credentials? I'm not checking RapidAPI credentials, only whitelisted IPs. _Make sure my server is generating **referrer IP headers, not sent custom from client!**_

Above is with RapidAPI. It's easy! Standalone API needs more thought.







