# CLI

### Files

`cat ./filename` show contents of file  
`echo $(cat ./filename) > ./file2` copy contents of file into another file  
`echo 'whatever=123' >> ./filename` write a string to the bottom of a file

### Switch directories

**`pushd .`** \# save current working directory **`popd`** \# go back to saved directory

### Change ownership

**`sudo chown -R $(id -u):$(id -g) .`** take ownership of . directory, recursively

### Running processes

**`ps -ef`** list all running processes  
**`ps -ef | grep node`** list only "node" processes  
**`lsof -i :4321`** find PID of running process  
**`kill 123`** kill process by PID

### Process on port

**`sudo lsof -i tcp:3000`** \(on macOS\)  
`netstat -vanp tcp | grep 3000` find all processes using port 3000

### Networking

**`dig +short myip.opendns.com @resolver1.opendns.com`** see public IP address

