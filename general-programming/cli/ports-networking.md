# Ports / Networking

What is my LAN IP address?  
**`ipconfig getifaddr en0`**

What is my internet IP address?  
**`dig +short myip.opendns.com @resolver1.opendns.com`**

## What process is using a port?

**`sudo lsof -i tcp:3000`** \(on macOS\)  
`netstat -vanp tcp | grep 3000` find all processes using port 3000

Find and kill what's blocking a port:  
**`kill -9 $(lsof -i TCP:8000 | grep LISTEN | awk '{print $2}')`**

## Network requests

```text
curl --header "Ocp-Apim-Subscription-Key: xxx" 
https://api.cognitive.microsoft.com/bing/v7.0/spellcheck\?text\=moticum\&mode\=spell\&mkt\=en-us
 -w "\n\n%{time_starttransfer}\n"
```

The last `-w ""` part is to log time request took to come back.

## DNS

Ping a website - find its IP, and if it is active:  
`ping -c 1 -i 10 bit.ly`   
-c  = call only N times  
-i = timeout and quit after N seconds

## Flush DNS cache

Mac:  
`sudo killall -HUP mDNSResponder;sudo killall mDNSResponderHelper;sudo dscacheutil -flushcache`

Linux:  
`sudo service nscd restart` or   
`/etc/rc.d/init.d/nscd stop; /etc/rc.d/init.d/nscd start` 











