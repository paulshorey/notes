---
description: All about Dates on the World Wide Web
---

# Dates: UTC/ISO/GMT/Local

1. **Local time =**  the time in your time zone, in am/pm or 24hr format, doesn't matter, **Always includes the timezone**, which is just offset \(+ or -\) number of hours from GMT `new Date()` 
2. **GMT =** Also local time, but in the Greenwich Mean Time \(GMT\) timezone \(time in England\). **Includes timezone, because this is local time.** It is simply local time in a specific timezone.  `function localToGMT(date) {`  `// receives and returns Date object return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds());  }`  
3. **UTC =** your Local time converted to GMT Also no time zone information. `SAME AS GMT, but without the timezone info`



