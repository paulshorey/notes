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

