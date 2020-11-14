---
description: Just a few notes. Not complete...
---

# API Authentication

**Developer:**  
if server is localhost, port &gt; 80, client is also localhost port &gt; 80  
**then allow access, return additional debugging data**

**Client:**  
if server is port 80, client from whitelisted RapidAPI IP,   
**allow access**  
if also client header x-rapidapi-user === "wordio"  
**return additional debugging data, as if developer**

What if client spoofs domain/IP, fake RapidAPI credentials? I'm not checking RapidAPI credentials, only whitelisted IPs. **Check referrer IP, not custom header.** _Make sure my server is generating referrer IP headers. Make sure client can not spoof/set headers which I'm checking!_

Above is with RapidAPI. It's easy! Standalone API needs more thought.







